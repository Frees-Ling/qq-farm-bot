# QQ农场 Bot - 开发者文档

> 本文档面向需要二次开发、理解架构或贡献代码的开发者。

---

## 目录

1. [项目概述](#1-项目概述)
2. [技术栈](#2-技术栈)
3. [目录结构](#3-目录结构)
4. [核心架构](#4-核心架构)
5. [数据流](#5-数据流)
6. [模块详解](#6-模块详解)
7. [WebSocket / Protobuf 协议](#7-websocket--protobuf-协议)
8. [添加新功能](#8-添加新功能)
9. [配置指南](#9-配置指南)
10. [构建与打包](#10-构建与打包)
11. [代码规范](#11-代码规范)

---

## 1. 项目概述

QQ农场 Bot 是一个自动化管理面板，核心功能包括：

- **多账号管理**：同时运行多个 QQ/微信农场账号
- **自动化挂机**：自动种植、浇水、施肥、除草、除虫、收获
- **Code 捕获**：通过 PC 补丁 / 手机代理 / 微信扫码 等方式捕获登录凭证
- **Web 管理面板**：基于 Vue 3 的管理界面
- **WebSocket 协议**: 与 QQ 农场服务端通信（Protobuf）

### 核心限制

| 项目 | 说明 |
|------|------|
| 客户端版本 | 必须使用 `X.Y.Z.W_YYYYMMDD` 格式（日期后缀），否则被踢下线 |
| WebSocket 地址 | `wss://gate-obt.nqf.qq.com/prod/ws` |
| Protobuf | 自定义 proto 文件在 `core/src/proto/` |

---

## 2. 技术栈

### 后端 (core/)

| 技术 | 用途 |
|------|------|
| Node.js 18+ | 运行时 |
| Express | HTTP API 服务器 |
| Socket.IO | 实时推送 (WebSocket to 前端) |
| Protobuf.js | 农场协议编解码 |
| Winston | 日志系统 |
| axios | HTTP 请求 |
| pnpm | 包管理器 |

### 前端 (web/)

| 技术 | 用途 |
|------|------|
| Vue 3 + Composition API | 框架 |
| Vite 7 | 构建工具 |
| Pinia | 状态管理 |
| UnoCSS | CSS 原子化框架 |
| Vue Router | 路由 |
| Socket.IO Client | 实时更新 |
| TypeScript | 类型安全 |
| NProgress | 进度条 |

### 其他

| 技术 | 用途 |
|------|------|
| Python 3 | Code 捕获服务 (sniff9988.py) |
| mitmproxy | 手机代理捕获 (可选) |

---

## 3. 目录结构

```
qq-farm-bot/
├── core/                          # 后端服务
│   ├── client.js                  # 入口文件
│   ├── package.json
│   ├── Dockerfile                 # Docker 构建文件
│   ├── src/
│   │   ├── config/
│   │   │   ├── config.js          # 环境变量映射 & 常量
│   │   │   ├── gameConfig.js      # 游戏数据加载器
│   │   │   └── runtime-paths.js   # 运行时路径解析
│   │   ├── controllers/
│   │   │   └── admin.js           # Express 路由 (~3800行, 所有API)
│   │   ├── core/
│   │   │   └── worker.js          # Bot 工作进程
│   │   ├── gameConfig/            # 游戏配置 JSON
│   │   │   ├── ItemInfo.json      # 物品价格信息
│   │   │   ├── Plant.json         # 植物数据
│   │   │   └── RoleLevel.json     # 等级/经验表
│   │   ├── models/
│   │   │   ├── store.js           # 主存储 (配置、账号、公告)
│   │   │   └── user-store.js      # 用户系统 (认证、卡密)
│   │   ├── proto/                 # Protobuf 协议定义
│   │   ├── runtime/
│   │   │   ├── runtime-engine.js  # 主引擎 (协调 Worker、Admin)
│   │   │   ├── runtime-state.js   # 运行时状态管理
│   │   │   ├── worker-manager.js  # 进程/线程管理
│   │   │   ├── data-provider.js   # 数据提供抽象层
│   │   │   └── relogin-reminder.js # 自动重登提醒
│   │   ├── services/              # 服务层
│   │   │   ├── farm.js            # 农场操作逻辑
│   │   │   ├── friend.js          # 好友交互
│   │   │   ├── oauth.js           # OAuth 登录
│   │   │   ├── qrlogin.js         # 小程序 QQ 扫码
│   │   │   ├── phone-capture.js   # 手机代理捕获
│   │   │   ├── scheduler.js       # 任务调度器
│   │   │   ├── push.js            # 推送通知
│   │   │   └── ...                # 其他服务
│   │   └── utils/                 # 工具函数
│   └── data/                      # 运行时数据 (JSON 持久化)
│       ├── store.json             # 全局配置
│       ├── accounts.json          # 账号列表
│       ├── users.json             # 用户账号
│       ├── cards.json             # 卡密
│       └── logs/                  # 日志文件
├── web/                           # 前端
│   ├── src/
│   │   ├── views/                 # 页面组件
│   │   ├── components/            # 通用组件
│   │   ├── stores/                # Pinia 状态
│   │   ├── router/                # 路由
│   │   ├── api/                   # API 封装
│   │   └── utils/                 # 工具函数
│   └── dist/                      # 构建输出
├── tools/                         # 工具脚本
│   ├── sniff9988.py               # Code 捕获 HTTP 服务
│   ├── patch-qq-farm-code-capture.js  # PC QQ 补丁脚本
│   ├── mitm-qq-farm-code-capture.py   # mitmproxy 捕获插件
│   ├── qq-farm-patch.ps1          # Windows 一键配置 PS1
│   ├── qq-farm-patch.bat          # Windows 一键配置 BAT
│   └── qq-farm-patch.sh           # Mac/Linux 一键配置 Shell
├── deploy/                        # 部署文件
│   ├── deploy.sh                  # 一键部署脚本 (全新服务器)
│   ├── qq-farm-bot.service        # systemd 服务文件
│   └── sniff9988.service          # sniff systemd 服务文件
├── install.sh                     # 更新脚本 (已有部署)
├── docker-compose.yml             # Docker 部署
└── docs/                          # 文档
```

---

## 4. 核心架构

### 进程模型

```
┌────────────────────────────────────────────────────┐
│                  RuntimeEngine                      │
│  ┌──────────────────────────────────────────────┐  │
│  │            Express HTTP Server                │  │
│  │  /api/* REST  +  Socket.IO  +  Static Files  │  │
│  └──────────────────────────────────────────────┘  │
│                          │                          │
│  ┌──────────────────────────────────────────────┐  │
│  │           WorkerManager                       │  │
│  │  ┌────────┐  ┌────────┐  ┌────────┐          │  │
│  │  │Worker 1│  │Worker 2│  │Worker N│  ...      │  │
│  │  └────────┘  └────────┘  └────────┘          │  │
│  │  (child_process 或 worker_threads)            │  │
│  └──────────────────────────────────────────────┘  │
│                          │                          │
│  ┌──────────────────────────────────────────────┐  │
│  │           Data Layer                          │  │
│  │  store.js → store.json & accounts.json       │  │
│  │  user-store.js → users.json & cards.json     │  │
│  └──────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────┘
            │
            ▼ WebSocket (wss://gate-obt.nqf.qq.com/prod/ws)
            ▼ Protobuf
```

### 启动流程

```
client.js
  └→ RuntimeEngine.init()
       ├→ 加载 Store (store.json + accounts.json)
       ├→ 加载 UserStore (users.json + cards.json)
       ├→ 启动 Express 服务器 (startAdminServer)
       │    ├── 静态文件 (web/dist)
       │    ├── REST API routes
       │    ├── Socket.IO (实时推送)
       │    └── 捕获服务集成
       ├→ 加载已有账号 → 逐一启动 Worker
       └→ 进入运行循环
```

### Worker 生命周期

```
Worker (每个账号独立进程/线程)
  ├→ WebSocket 连接到 gate-obt.nqf.qq.com
  ├→ Protobuf 消息处理循环
  ├→ 任务调度 (用定时器执行种植、浇水等)
  ├→ 与主进程通过 IPC 通信
  └→ 异常退出 → RuntimeEngine 自动重启
```

### WorkerManager 策略

`worker-manager.js` 控制 Worker 的创建方式：

| 策略 | 适用场景 | 实现 |
|------|---------|------|
| `child_process.fork()` | 默认，稳定性高 | 每个 Worker 独立进程，内存隔离 |
| `worker_threads` | 内存受限 | 同一进程内线程，内存共享 |

通过 `FARM_USE_THREADS` 环境变量切换。

---

## 5. 数据流

### Code 捕获流程

```
┌──────────┐     ┌──────────┐     ┌─────────────┐     ┌──────────┐
│ QQ农场   │────→│ PC补丁 / │────→│ sniff9988.py│────→│ Express  │
│ 小程序   │     │ 手机代理  │     │  (Python)   │     │  Server  │
└──────────┘     └──────────┘     └─────────────┘     └──────────┘
                                       │                    │
                                       │ WebSocket          │ POST /api/pending-code
                                       │ (ws://ip:9988)     │ (HTTP)
                                       ▼                    ▼
                                 收到 Code         存入 pending-code 队列
                                                         │
                                                         ▼
                                                   账号绑定 / 自动创建
```

### WebSocket 协议数据流

```
Worker                    gate-obt.nqf.qq.com
  │                              │
  │── connect →                  │
  │                              │
  │← proto: S2C_Handshake ──────│
  │── proto: C2S_Login ────────→│
  │← proto: S2C_LoginResp ─────│
  │                              │
  │── proto: C2S_EnterFarm ────→│
  │← proto: S2C_FarmData ──────│
  │                              │
  │── proto: C2S_Plant ────────→│  定时任务
  │── proto: C2S_Water ────────→│
  │── proto: C2S_Harvest ──────→│
  │                              │
```

---

## 6. 模块详解

### 6.1 store.js

位置: `core/src/models/store.js`

主存储模块，管理所有持久化 JSON 数据。提供原子写入保证。

**核心数据结构：**

```javascript
// store.json
{
  "globalConfig": {
    "heartbeatInterval": 30,
    "clientVersion": "1.12.1.6_20260623",
    "announcements": [...]
  },
  "autoInterval": {},        // 账号级自动任务间隔
  "blacklist": {},           // 黑名单
  "friendMode": {},          // 好友模式
  "offlineReminder": {},     // 离线提醒
  "autoFriendSteal": {},     // 自动偷取
  "autoSeedFlag": {}         // 自动种子标记
}

// accounts.json
[
  {
    "id": "uuid",
    "name": "账号名",
    "platform": "qq" | "wechat",
    "code": "xxx",
    "uin": "123456",
    "enabled": true,
    "createdAt": 1700000000000,
    "deletedAt": null
  }
]
```

**关键方法：**
- `getGlobalConfig()` / `setGlobalConfig()`
- `getAccount(id)` / `updateAccount(id, data)`
- `getAnnouncements()` / `addAnnouncement()` / `deleteAnnouncement()`

### 6.2 user-store.js

位置: `core/src/models/user-store.js`

用户认证系统。支持多角色、卡密注册、有效期管理。

**数据结构：**

```javascript
// users.json
[
  {
    "username": "admin",
    "password": "$2b$10$...",
    "role": "admin" | "user",
    "enabled": true,
    "expiresAt": 1777777777777,    // 过期时间戳, -1 表示永不过期
    "quota": 10,                    // 可用配额(天数/次数)
    "createdAt": 1700000000000
  }
]

// cards.json
[
  {
    "card": "XXXX-XXXX-XXXX",
    "days": 30,
    "quota": 5,
    "used": false,
    "usedBy": null,
    "createdAt": 1700000000000
  }
]
```

**中间件：**
- `authRequired` — 验证 JWT token，注入 `req.currentUser`
- `adminRequired` — 验证当前用户角色为 admin

### 6.3 runtime-engine.js

位置: `core/src/runtime/runtime-engine.js`

核心引擎，负责：
1. 启动 Express 服务器
2. 管理 Worker 生命周期
3. 协调模块间通信

### 6.4 worker.js

位置: `core/src/core/worker.js`

Bot 工作进程。每个账号独立运行一个 Worker，负责：
1. 建立 WebSocket 连接到 QQ 农场
2. Protobuf 消息编解码
3. 定时执行农场任务
4. 维护心跳

### 6.5 admin.js

位置: `core/src/controllers/admin.js`

**单体文件，约 3800 行**，包含所有 HTTP API 路由和 Socket.IO 处理。

**路由组织：**

```
/api/accounts/*       — 账号 CRUD
/api/admin/*          — 管理功能 (用户、公告、系统)
/api/user/*           — 用户自助功能
/api/pc-capture/*     — PC 捕获相关
/api/phone-capture/*  — 手机捕获相关
/api/announcement/*   — 公告接口
/api/pending-code     — Code 接收 (sniff 回调)
/api/code-capture/*   — Code 捕获
/api/config/*         — 配置接口
```

---

## 7. WebSocket / Protobuf 协议

### 连接

```
wss://gate-obt.nqf.qq.com/prod/ws?code=<CODE>&uin=<UIN>&ver=<VERSION>&platform=<PLATFORM>&os=<OS>
```

| 参数 | 说明 | 示例 |
|------|------|------|
| code | 登录凭证 | 从 QQ 扫码/微信扫码/抓包获取 |
| uin | QQ 号 | 123456 |
| ver | 客户端版本 | 1.12.1.6_20260623 |
| platform | 平台 | qq / wechat |
| os | 操作系统 | windows / android / ios |

### 客户端版本要求

**必须使用 `X.Y.Z.W_YYYYMMDD` 格式**，例如 `1.12.1.6_20260623`。

如果使用不带日期后缀的旧格式（如 `1.12.1.6`），服务器会返回 "客户端版本过低" 并断开连接。

版本格式在以下位置维护：
- `core/src/config/config.js` — `CLIENT_VERSION` 常量
- `core/src/controllers/admin.js` — `bumpClientVersion()` 函数
- `core/src/core/worker.js` — 连接时发送的版本值
- `web/` — 配置页面显示

更新版本时，三个位置必须同步修改。

### Protobuf

协议定义文件: `core/src/proto/`

---

## 8. 添加新功能

### 8.1 新增一个 API 端点

在 `core/src/controllers/admin.js` 中添加路由：

```javascript
// 在 startAdminServer 函数中找到路由登记区域
// 新增 GET 接口
app.get('/api/my-feature/list', authRequired, async (req, res) => {
    try {
        const data = await getSomeData(req.currentUser.username);
        res.json({ ok: true, data });
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// 新增 POST 接口
app.post('/api/my-feature/create', authRequired, async (req, res) => {
    try {
        const { name } = req.body;
        // ... 你的逻辑
        res.json({ ok: true });
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});
```

**注意中间件顺序：** 在 `app.use('/api', authCheck)` 之前定义的路由拿不到 `req.currentUser`。对于需要认证的路由，必须显式传入 `authRequired` 中间件。

### 8.2 新增前端页面

1. 在 `web/src/views/` 创建 `.vue` 文件
2. 在 `web/src/router/menu.ts` 注册路由
3. 在 `web/src/components/Sidebar.vue` 添加导航项

### 8.3 新增持久化数据

如果数据是全局配置，使用 `store.js`：

```javascript
const store = require('../models/store');

// 读取
const config = store.getGlobalConfig();
const mySetting = config.myFeature || {};

// 写入
store.setGlobalConfig({
    ...store.getGlobalConfig(),
    myFeature: { key: 'value' }
});
```

### 8.4 新增定时任务

在 `worker.js` 中添加任务调度逻辑，参考现有模式。

---

## 9. 配置指南

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ADMIN_PORT` | `3000` | Web 面板端口 |
| `ADMIN_PASSWORD` | `admin` | 管理员密码（仅首次启动使用） |
| `FARM_PUBLIC_IP` | 自动检测 | 服务器公网 IP |
| `FARM_PANEL_API` | — | 捕获服务回推地址 |
| `FARM_CAPTURE_PORT` | `9988` | Code 捕获端口 |
| `FARM_CAPTURE_USERNAME` | `admin` | 捕获服务用户名 |
| `FARM_PHONE_PROXY_PORT` | `8899` | 手机代理端口 |
| `FARM_WORKER` | — | 设为 `1` 启用 Worker 模式 |
| `NODE_ENV` | — | 设为 `production` 关闭调试 |
| `TZ` | — | 时区，如 `Asia/Shanghai` |

### 客户端版本管理

版本号格式：`主版本.次版本.修订.构建_日期`

配置文件位置：`core/src/config/config.js`

```javascript
const CLIENT_VERSION = '1.12.1.6_20260623';
```

### 数据备份

所有数据在 `core/data/` 目录。备份只需复制此目录：

```bash
cp -a core/data core/data.backup.$(date +%Y%m%d)
```

---

## 10. 构建与打包

### 构建前端

```bash
pnpm build:web
# 输出到 web/dist/
```

### 完整开发流程

```bash
# 安装所有依赖
pnpm install -r

# 同时运行前后端 (前端 HMR)
bash dev-fast.sh

# 或分别运行
pnpm dev:core  # 后端
cd web && npx vite  # 前端 HMR
```

### pkg 打包为二进制

```bash
cd core
npx pkg . --target node18-linux-x64 --output qq-farm-bot
```

---

## 11. 代码规范

### 后端

- 使用 CommonJS (`require` / `module.exports`)
- 错误处理：`try/catch` + `res.json({ ok: false, error })`
- 日志：使用 `winston` logger 而非 `console.log`

### 前端

- Vue 3 Composition API (`<script setup lang="ts">`)
- Pinia 管理全局状态
- UnoCSS 原子化样式，避免大量自定义 CSS

### API 响应格式

```javascript
// 成功
{ "ok": true, "data": { ... } }

// 失败
{ "ok": false, "error": "错误描述" }

// 列表
{ "ok": true, "data": [ ... ], "total": 100 }
```

---

> **相关文档：** [管理员文档](ADMIN.md) | [部署脚本](../deploy/deploy.sh)
