# 登录流程逆向分析

> 来源: 代码逆向分析 | `core/src/services/qrlogin.js`, `core/src/utils/network.js`, `core/src/core/worker.js`, `core/src/runtime/relogin-reminder.js`, `core/src/services/manual-login-profile.js`

---

## 1. 登录架构总览

```mermaid
graph TB
    subgraph "获取Code"
        A1["MiniProgramLoginSession<br/>requestLoginCode()"]
        A2["QRLoginSession<br/>requestQRCode()"]
        A3["phone-capture.js<br/>mitmdump抓包"]
        A4["手动输入Code"]
    end

    subgraph "验证Code"
        B1["manual-login-profile.js<br/>fetchProfileByCode()"]
    end

    subgraph "持久化"
        C1["store.js<br/>addOrUpdateAccount()"]
        C2["accounts.json<br/>{ id, code, uin, ... }"]
    end

    subgraph "使用Code登录"
        D1["worker-manager.js<br/>startWorker()"]
        D2["worker.js<br/>startBot()"]
        D3["network.js<br/>connect()"]
        D4["WebSocket登录<br/>LoginRequest"]
    end

    subgraph "会话维持"
        E1["心跳 25s"]
        E2["消息加密 WASM"]
        E3["版本协商"]
    end

    subgraph "掉线恢复"
        F1["relogin-reminder.js<br/>推送二维码"]
        F2["扫码重新获取Code"]
        F3["更新accounts.json<br/>重启Worker"]
    end

    A1 --> B1
    A2 --> B1
    A3 --> B1
    A4 --> B1
    B1 --> C1 --> C2
    C2 --> D1 --> D2 --> D3 --> D4
    D4 --> E1 & E2 & E3
    E3 -.->|"版本过低踢下线"| D4
    E1 -.->|"心跳超时重连"| D3
    D4 -.->|"被踢/掉线"| F1 --> F2 --> F3 --> D1
```

---

## 2. Code 获取流程 (MiniProgramLoginSession)

这是当前项目主要使用的登录方式。它使用 QQ 小程序开发者工具接口获取登录码。

### 函数调用链

```mermaid
sequenceDiagram
    participant Client as 调用方 (admin.js/前端)
    participant MPLS as MiniProgramLoginSession
    participant QQ as https://q.qq.com
    participant Store as store.js

    Client->>MPLS: requestLoginCode()
    MPLS->>QQ: GET /ide/devtoolAuth/GetLoginCode
    Note over MPLS,QQ: Headers: QUA, User-Agent, Host

    QQ-->>MPLS: { code: "6位短码", image: "base64二维码" }
    MPLS-->>Client: { code, url, image }

    Note over Client: 显示二维码给用户扫码

    loop 轮询 (每2秒)
        Client->>MPLS: queryStatus(code)
        MPLS->>QQ: GET /ide/devtoolAuth/syncScanSateGetTicket?code={code}
        QQ-->>MPLS: { ok: 0 } (等待扫码)
        MPLS-->>Client: { status: "Wait" }
    end

    Note over QQ: 用户手机QQ扫码

    Client->>MPLS: queryStatus(code)
    MPLS->>QQ: GET /ide/devtoolAuth/syncScanSateGetTicket?code={code}
    QQ-->>MPLS: { ok: 1, ticket: "xxx", uin: "QQ号" }
    MPLS-->>Client: { status: "OK", ticket, uin }

    Client->>MPLS: getAuthCodeResult(ticket)
    MPLS->>QQ: POST /ide/login { appid, ticket }
    QQ-->>MPLS: { code: "authCode" }
    MPLS-->>Client: { ok: true, code: "正式登录凭证" }

    Note over Client: code 为负值（如 -1003）表示授权失败

    Client->>Store: addOrUpdateAccount({ code, uin, ... })
```

### 函数详情

#### `MiniProgramLoginSession.requestLoginCode()`

| 属性 | 值 |
|------|-----|
| **文件** | `core/src/services/qrlogin.js:148-177` |
| **HTTP方法** | GET |
| **URL** | `https://q.qq.com/ide/devtoolAuth/GetLoginCode` |
| **请求头** | `qua: V1_HT5_QDT_0.70.2209190_x64_0_DEV_D`, `User-Agent: ChromeUA` |
| **响应** | `{ code: string, image: string(base64), url: string }` |
| **副作用** | 无 |
| **异常** | 网络错误 → `console.error` |

#### `MiniProgramLoginSession.queryStatus(code)`

| 属性 | 值 |
|------|-----|
| **文件** | `core/src/services/qrlogin.js:179-234` |
| **HTTP方法** | GET |
| **URL** | `https://q.qq.com/ide/devtoolAuth/syncScanSateGetTicket?code={code}` |
| **响应** | `Wait → { ok: 0 }`, `OK → { ok: 1, ticket, uin }`, `Used → { resCode: -10003 }` |
| **副作用** | 无 |
| **异常** | 网络错误 → `console.error`, JSON解析错误 → 默认返回 `Wait` |

#### `MiniProgramLoginSession.getAuthCodeResult(ticket, appid)`

| 属性 | 值 |
|------|-----|
| **文件** | `core/src/services/qrlogin.js:236-278` |
| **HTTP方法** | POST |
| **URL** | `https://q.qq.com/ide/login` |
| **请求体** | `{ appid: "1112386029", ticket: "xxx" }` |
| **请求头** | `Content-Type: application/json`, `QUA`, `User-Agent` |
| **响应** | `{ code: "authCode" }` 或 `{ code: "-1003" }`（失败） |
| **副作用** | 无 |
| **异常** | 网络错误, HTTP 非200 |

---

## 3. 传统 QQ 网页登录 (QRLoginSession)

备用登录方式，使用 QQ 网页登录接口。

### 函数调用链

```mermaid
sequenceDiagram
    participant Client as 调用方
    participant QRS as QRLoginSession
    participant SSL as ssl.ptlogin2.qq.com

    Client->>QRS: requestQRCode(presetKey)
    QRS->>SSL: GET /ptqrshow?appid=&e=2&l=M&s=3&d=72&v=4&t={random}
    SSL-->>QRS: set-cookie: qrsig=xxx, body: 二维码图片
    QRS-->>Client: { qrsig, qrcode, url }

    loop 轮询
        Client->>QRS: checkStatus(qrsig, presetKey)
        QRS->>SSL: GET /ptqrlogin?ptqrtoken={hash}&...
        Note over QRS,SSL: Cookie: qrsig={qrsig}
        SSL-->>QRS: ptuiCB('66','0','','0','...', '...')
        QRS-->>Client: { ret: 66, msg: "等待扫码" }
    end

    Note over SSL: 用户扫码

    QRS->>SSL: GET /ptqrlogin?ptqrtoken={hash}&...
    SSL-->>QRS: ptuiCB('0','0','https://...','登录成功','...', '...')
    QRS-->>Client: { ret: 0, nickname, jumpUrl, cookie }
```

### 函数详情

#### `QRLoginSession.requestQRCode(presetKey)`

| 属性 | 值 |
|------|-----|
| **文件** | `core/src/services/qrlogin.js:27-58` |
| **HTTP方法** | GET |
| **URL** | `https://ssl.ptlogin2.qq.com/ptqrshow?appid={aid}&e=2&l=M&s=3&d=72&v=4&t={random}&daid={daid}&u1={redirectUri}` |
| **关键参数** | `aid = "21003204"`, `daid = "19"` |
| **Cookie** | 从 set-cookie 提取 `qrsig` |
| **响应** | 二维码图片（二进制） |
| **副作用** | 生成 qrsig cookie |

#### `QRLoginSession.checkStatus(qrsig, presetKey)`

| 属性 | 值 |
|------|-----|
| **文件** | `core/src/services/qrlogin.js:59-119` |
| **HTTP方法** | GET |
| **URL** | `https://ssl.ptlogin2.qq.com/ptqrlogin?ptqrtoken={HashUtils.hash(qrsig)}&aid={aid}&daid={daid}&u1={redirectUri}` |
| **Cookie** | `qrsig={qrsig}` |
| **响应** | JSONP 格式 `ptuiCB(ret, ..., msg, ..., jumpUrl, ...)` |
| **异常** | 网络错误 / JSONP 解析失败 |

---

## 4. WebSocket 登录流程 (游戏登录)

这是真正的游戏服务器认证。使用从上方获取的 `code` 连接 QQ 农场 WebSocket。

### 函数调用链

```mermaid
sequenceDiagram
    participant Worker as worker.js
    participant NW as network.js
    participant WS as wss://gate-obt.nqf.qq.com
    participant Crypto as crypto-wasm.js

    Worker->>NW: connect(code, onLoginSuccess)
    NW->>NW: 构建 URL: serverUrl + ?platform=&os=&ver=&code=&openID=
    NW->>WS: new WebSocket(url)
    WS-->>NW: ws.on('open')

    NW->>NW: sendLogin()
    NW->>NW: 构建 LoginRequest body
    Note over NW: device_info: {client_version, sys_software, network, memory, device_id}
    NW->>Crypto: encryptBuffer(body)
    Crypto-->>NW: 加密后的buffer
    NW->>NW: GateMessage 封装 (Protobuf)
    NW->>WS: WebSocket.send(encodedMessage)
    WS-->>NW: LoginReply (Protobuf + 加密)

    NW->>Crypto: decryptBuffer(reply)
    Crypto-->>NW: 解密后的body
    NW->>NW: 解析 LoginReply.basic
    Note over NW: { gid, name, level, gold, exp, time_now_millis, version_info }

    NW->>NW: 根据服务器版本强制更新 CONFIG.clientVersion
    NW->>NW: 启动心跳定时器 (每25s)

    NW-->>Worker: onLoginSuccess()

    Worker->>Worker: 初始化模块
    Worker->>Worker: 开始巡查循环
    Worker-->>WM: IPC: status_sync (running)
```

### 核心函数详情

#### `network.connect(code, onLoginSuccess, options)`

| 属性 | 值 |
|------|-----|
| **文件** | `core/src/utils/network.js:588-629` |
| **作用** | 建立 WebSocket 连接并发起登录 |
| **输入** | `code`(登录凭证), `onLoginSuccess`(回调), `options.proxyUrl` |
| **输出** | 无（调用回调） |
| **异常** | WebSocket 错误, 连接超时, 踢下线通知 |
| **副作用** | 设置 `savedCode`, 启动心跳, 发送 LoginRequest |

**WebSocket URL 结构：**
```
wss://gate-obt.nqf.qq.com/prod/ws?platform=qq&os=iOS&ver=1.12.1.6_20260623&code={CODE}&openID=
```

| 参数 | 来源 | 说明 |
|------|------|------|
| `platform` | CONFIG.platform | `qq` 或 `wx` |
| `os` | CONFIG.os | 模拟的操作系统 |
| `ver` | CONFIG.clientVersion | 客户端版本 (含日期后缀) |
| `code` | 参数传入 | 从扫码获取的登录凭证 |
| `openID` | 空 | 开放平台ID（当前未使用） |

**请求头：**
```
User-Agent: Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36 MicroMessenger/7.0.20.1781
Origin: https://gate-obt.nqf.qq.com
```

#### `network.sendLogin(onLoginSuccess)`

| 属性 | 值 |
|------|-----|
| **文件** | `core/src/utils/network.js:421-508` |
| **作用** | 发送 Protobuf LoginRequest 并处理响应 |
| **输入** | `onLoginSuccess`(成功回调) |
| **输出** | 调用回调或发送错误事件 |
| **异常** | 加密失败, Protobuf 编码失败, 服务器返回错误码 |
| **副作用** | 更新 `userState`, 设置 `CONFIG.clientVersion`, 启动心跳 |

**LoginRequest Protobuf 结构：**
```protobuf
message LoginRequest {
    sharer_id: ""
    sharer_open_id: ""
    device_info: {
        client_version: "1.12.1.6_20260623"
        sys_software: "iOS 26.2.1"
        network: "wifi"
        memory: "7672"
        device_id: "iPhone X<iPhone18,3>"
    }
    share_cfg_id: ""
    scene_id: "1256"
    report_data: {
        minigame_channel: "other"
        minigame_platid: 2
        // ... 其他报告字段
    }
}
```

**LoginReply 结构：**
```protobuf
message LoginReply {
    basic: {
        gid: number       // 游戏UID（后续请求的用户标识）
        name: string      // 游戏昵称
        level: number     // 等级
        gold: number      // 金币
        exp: number       // 经验
    }
    time_now_millis: number   // 服务器时间戳
    version_info: {           // 版本协商
        game_version: string
        min_version: string
        recommend_version: string
    }
}
```

---

## 5. 手动登录获取资料 (fetchProfileByCode)

用于在获取到 code 后直接验证其有效性并获取用户资料。

### `manual-login-profile.fetchProfileByCode(code, options)`

| 属性 | 值 |
|------|-----|
| **文件** | `core/src/services/manual-login-profile.js` |
| **作用** | 通过 WebSocket 用 code 换取用户资料 |
| **输入** | `code`, `options.timeout`(默认10s) |
| **输出** | `{ gid, name, level, exp, gold, openId, avatar, remark, signature, gender }` |
| **异常** | 超时, 加密失败, 网关错误码 |
| **副作用** | 无（不持久化任何数据） |

---

## 6. 掉线自动恢复流程

```mermaid
stateDiagram-v2
    [*] --> Connected: Login Success
    Connected --> Heartbeat: 每25s
    Heartbeat --> Connected: 心跳回复

    Connected --> Disconnected: 网络断开
    Disconnected --> Reconnecting: 5秒后自动重连
    Reconnecting --> Connected: 重连成功(savedCode)
    Reconnecting --> CodeFailed: Code无效(ws_error 400)

    Connected --> Kicked: 被踢下线
    Kicked --> Stopped: stopBot()
    Stopped --> ReloginNotify: 推送二维码
    ReloginNotify --> WaitingScan: 等待扫码
    WaitingScan --> CodeRefreshed: 获取新code
    CodeRefreshed --> Connected: 重启Worker

    Connected --> VersionTooLow: 版本过低
    VersionTooLow --> BumpingVersion: 递增版本号
    BumpingVersion --> Reconnecting: 重连(最多5次)

    CodeFailed --> [*]: 等待管理员手动更新
    Kicked --> [*]: 手动重新添加
```

## 7. 认证状态机

```mermaid
stateDiagram-v2
    state "面板认证" as PanelAuth {
        [*] --> LoggedOut: 未登录
        LoggedOut --> TokenCreated: POST /api/login
        TokenCreated --> Authenticated: token存入内存Set
        Authenticated --> TokenExpired: 服务重启
        Authenticated --> LoggedOut: POST /api/logout
        TokenExpired --> LoggedOut
    }

    state "游戏认证" as GameAuth {
        [*] --> CodeAcquired: 获取登录code
        CodeAcquired --> WSConnecting: connect(code)
        WSConnecting --> WSConnected: WebSocket open
        WSConnected --> LoginSending: sendLogin()
        LoginSending --> Authenticated: LoginReply(gid)
        LoginSending --> LoginFailed: code无效
        Authenticated --> Heartbeating: 心跳维持
        Heartbeating --> HeartbeatFailed: 2次无响应
        HeartbeatFailed --> WSConnecting: 自动重连

        Authenticated --> Kicked: 被踢
        Authenticated --> VersionTooLow: 版本过低检查
        VersionTooLow --> WSConnecting: 自动递增版本
    }

    PanelAuth --> GameAuth: 管理员在面板添加账号
    GameAuth --> PanelAuth: 状态同步至面板
```

## 8. 关键发现

| 发现 | 证据 | 风险 |
|------|------|------|
| **无持久 Token**：游戏认证只靠一次性 `code` | network.js `connect()` 将 code 作为 URL 参数 | 掉线后必须重新获取 code |
| **无 Refresh Token**：Tencent 不提供令牌刷新 | 代码中无 refresh 逻辑，只重新扫码 | 无法自动维持长期会话 |
| **设备模拟**：登陆时伪装 iOS 设备 | config.js `os: 'iOS'`, `deviceId: 'iPhone X'` | 可能被服务器端检测封禁 |
| **版本协商**：服务器会强制客户端更新版本 | network.js 登录/心跳响应中处理 `version_info` | 版本过旧会被踢下线 |
| **自动版本递增**：版本过低时自动重试最多5次 | network.js `Kickout` 处理 `bumpClientVersion()` | 抗检测能力有限 |
| **WASM 加密**：消息体使用 WebAssembly 加密 | `crypto-wasm.encryptBuffer` | 难以逆向自定义协议 |
| **心跳敏感**：25秒间隔，60秒无响应触发重连 | `heartbeatInterval: 25000`, 2次超时检测 | 网络抖动会频繁重连 |
