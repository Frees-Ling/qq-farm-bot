# 协议分析

> 研究腾讯是否支持自动会话刷新

---

## 1. 结论速览

| 机制 | 腾讯支持 | 证据 |
|------|---------|------|
| Refresh Token | ❌ 不支持 | 代码中无任何 refresh_token 相关逻辑 |
| Token Rotation | ❌ 不支持 | code 是一次性的，用完即废 |
| Cookie Rotation | ⚠️ 有限支持 | qrsig cookie 随二维码刷新而旋转 |
| Silent Refresh | ❌ 不支持 | 无静默重新认证端点 |
| Background Login | ❌ 不支持 | 需用户主动扫码 |
| Re-authentication | ❌ 不支持 | 每次需完整扫码流程 |
| Set-Cookie updates | ⚠️ 仅传统QQ登录 | ptqrlogin 响应中有 set-cookie |
| Session Keepalive | ✅ 支持 | WebSocket 心跳维持会话 |
| Heartbeat | ✅ 支持 | 每25秒发送一次 |
| Session Validation | ✅ 支持 | 验证通过 LoginRequest/LoginReply |

---

## 2. WebSocket 认证协议

### 2.1 协议结构

```
┌─────────────────────────────────────────────────┐
│                WebSocket Frame                   │
├─────────────────────────────────────────────────┤
│ GateMessage (Protobuf)                          │
│ ├── client_seq / server_seq (请求-响应配对)      │
│ ├── service_name (如 "gamepb.userpb.UserService")│
│ ├── method_name (如 "Login", "Heartbeat")        │
│ ├── body (Protobuf 序列化 + WASM 加密)           │
│ └── encrypt_flag                                 │
└─────────────────────────────────────────────────┘
```

**证据** (`utils/network.js:79`):
```javascript
const encrypted = await cryptoWasm.encryptBuffer(body);
```

### 2.2 消息序列

| 方向 | 消息 | 频率 | 包含 |
|------|------|------|------|
| C→S | WebSocket Connect | 1次 | URL 参数: code, platform, ver, os |
| S→C | WebSocket Open | 1次 | - |
| C→S | LoginRequest | 1次 | device_info, scene_id |
| S→C | LoginReply | 1次 | gid, level, gold, exp, version_info |
| C→S | HeartbeatRequest | 每25秒 | gid, clientVersion |
| S→C | HeartbeatReply | 每25秒 | time_now_millis, version_info |
| C→S | PlantRequest | 可变 | land_ids, host_gid |
| S→C | PlantReply | 可变 | 操作结果 |
| S→C | KickoutNotify | 异常 | 原因（如版本过低） |
| S→C | FarmHarvestedPush | 推播 | 收获通知 |

---

## 3. 会话保活分析

### 3.1 心跳机制

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server

    Note over C,S: 登录成功后

    C->>S: HeartbeatRequest { gid, clientVersion }
    S-->>C: HeartbeatReply { time_now_millis, version_info }
    Note over C: 重置心跳超时计数器

    loop 每25秒
        C->>S: HeartbeatRequest
        S-->>C: HeartbeatReply
    end

    Note over C: 60秒(2次)无响应
    C->>C: 触发重连
    C->>S: 重新连接
```

**证据** (`utils/network.js:514-559`):
```javascript
const HEARTBEAT_INTERVAL = 25000; // 25秒
let hbFailCount = 0;
// 每次心跳响应重置 hbFailCount = 0
// 60秒无响应 (2次) → 触发重连
```

### 3.2 版本协商

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server

    C->>S: LoginRequest { client_version: "1.12.1.6_20260623" }
    S-->>C: LoginReply { version_info: { recommend_version: "1.12.1.6_20260629" } }

    Note over C: 自动更新 CONFIG.clientVersion = "1.12.1.6_20260629"

    C->>S: HeartbeatRequest { clientVersion: "1.12.1.6_20260629" }
    S-->>C: HeartbeatReply { version_info: { ... } }

    alt 版本过低
        S-->>C: KickoutNotify("版本过低")
        C->>C: bumpClientVersion() (递增版本号)
        C->>S: 重连 + 新版本号
        Note over C: 最多重试5次
    end
```

**证据** (`utils/network.js:264-297`):
```javascript
if (String(reason).includes('版本过低')) {
    bumpClientVersion();
    reconnect();
}
```

---

## 4. 自动刷新可行性评估

### 4.1 不可自动刷新的原因

```mermaid
graph TB
    A["为什么不能自动刷新会话？"] --> B["腾讯不提供 refresh_token API"]
    A --> C["code 是一次性使用凭证"]
    A --> D["WebSocket 断开后原 code 立即失效"]
    A --> E["无静默重新认证端点"]
    A --> F["每次扫码需用户交互"]

    B --> G["证据: qrlogin.js 中无 refresh 相关代码"]
    C --> H["证据: code 在首次 WebSocket 登录后被服务器标记已用"]
    D --> I["证据: 重连时使用原 code 返回 400 错误"]
    E --> J["证据: login 接口只有 q.qq.com 的交互式扫码"]
    F --> K["证据: 重新登录必须走完整的 getAuthCode 流程"]

    style A fill:#f99
    style G fill:#ff9
    style H fill:#ff9
    style I fill:#ff9
    style J fill:#ff9
    style K fill:#ff9
```

### 4.2 可自动维持的部分

```mermaid
graph TB
    subgraph "可自动维持"
        A["WebSocket 长连接<br/>通过心跳保活"]
        B["版本号更新<br/>自动跟随服务器推荐"]
        C["版本过低重试<br/>自动递增重连(5次)"]
        D["重连<br/>连接断开后自动重连"]
    end

    subgraph "不可自动维持"
        E["code 过期<br/>需人工扫码"]
        F["被踢下线<br/>需重新添加账号"]
        G["400 错误<br/>需更新 code"]
    end

    A --> D
    B --> C
    C --> D

    style E fill:#f99
    style F fill:#f99
    style G fill:#f99
```

---

## 5. 协议安全分析

| 方面 | 实现 | 风险 |
|------|------|------|
| 传输加密 | WSS (WebSocket Secure) | ✅ 安全 |
| 消息体加密 | WASM 加密 (自定义) | ⚠️ 安全性依赖 WASM 实现 |
| 认证凭证 | code 明文在 URL 中 | 🔴 中间人可截获 |
| 设备指纹 | 客户端设备模拟 | 🟢 抗检测 |
| 心跳 | 25秒间隔 | ✅ 正常 |
| 重连 | 5秒后自动重连 | ⚠️ 频繁重连可能被服务器限流 |

---

## 6. 主要协议端点

| 端点 | 协议 | 用途 | 是否可替代 |
|------|------|------|-----------|
| `wss://gate-obt.nqf.qq.com/prod/ws` | WebSocket + Protobuf | 游戏主连接 | ❌ 唯一游戏服务器 |
| `https://q.qq.com/ide/devtoolAuth/GetLoginCode` | HTTPS | 获取登录码 | ⚠️ 可用传统 QQ 登录替代 |
| `https://q.qq.com/ide/devtoolAuth/syncScanSateGetTicket` | HTTPS | 轮询扫码状态 | ⚠️ 同上 |
| `https://q.qq.com/ide/login` | HTTPS | 换取 authCode | ❌ 核心认证接口 |
| `https://ssl.ptlogin2.qq.com/ptqrshow` | HTTPS | 传统 QQ 二维码 | ✅ 备用方案 |
| `https://ssl.ptlogin2.qq.com/ptqrlogin` | HTTPS | 传统 QQ 轮询 | ✅ 备用方案 |
