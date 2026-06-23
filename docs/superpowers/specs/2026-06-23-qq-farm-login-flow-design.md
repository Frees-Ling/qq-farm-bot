# QQ农场Bot — 核心登录流程设计文档

## 概述

在现有 `qq-farm-bot-main` 项目基础上，复制 target site (http://103.39.65.212:8888) 的**用户注册/登录系统**和**QQ农场账号接入**核心流程。

**范围（B方案）：**
- 用户注册（邀请码） + 登录系统
- 3种添加农场账号方式：手动Code / 微信扫码 / 抓包捕获
- 账号管理与Dashboard概览
- 现有农场引擎完全复用

---

## 一、系统架构

```
┌──────────────────────────────────────────────────────────┐
│                      Web Frontend (Vue 3)                 │
│  ┌───────────┐ ┌──────────┐ ┌────────┐ ┌──────────────┐ │
│  │  Home     │ │  Login/  │ │ 仪表盘  │ │  账号管理     │ │
│  │  (已有)   │ │  Register │ │Dashboard│ │  Accounts    │ │
│  └───────────┘ └──────────┘ └────────┘ └──────────────┘ │
│  ┌────────────┐ ┌──────────────┐ ┌───────────────────┐  │
│  │ 微信扫码    │ │  抓包添加     │ │  设置/Settings    │  │
│  │ WechatQR   │ │  Capture     │ │                   │  │
│  └────────────┘ └──────────────┘ └───────────────────┘  │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP API (axios) + WebSocket (Socket.IO)
┌──────────────────────▼──────────────────────────────────┐
│                  Backend (Express/Node.js)                │
│  ┌──────────────┐ ┌──────────────┐ ┌────────────────┐   │
│  │ Auth 路由    │ │ Account 路由  │ │ 微信QR 路由    │   │
│  │ /api/login   │ │ /api/accounts│ │ /api/qr/*      │   │
│  │ /api/register│ │              │ │                │   │
│  │ /api/auth/*  │ │              │ │                │   │
│  ├──────────────┤ ├──────────────┤ ├────────────────┤   │
│  │ Capture 路由  │ │ Admin 路由   │ │ 节点路由        │   │
│  │ /api/capture-│ │ (已有扩展)    │ │ /api/nodes/*   │   │
│  │ proxy/*      │ │              │ │                │   │
│  └──────┬───────┘ └──────┬───────┘ └───────┬────────┘   │
│         │               │                  │            │
│  ┌──────▼───────────────▼──────────────────▼──────────┐ │
│  │              Farm Engine (复用)                     │ │
│  │  Worker Manager │ WebSocket Client │ Protobuf      │ │
│  │  自动化调度      │  数据持久化      │  日志系统      │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

---

## 二、API 端点设计

### 2.1 认证模块

| 方法 | 路径 | 说明 | 已存在？ |
|------|------|------|---------|
| POST | `/api/register` | 用户注册（需邀请码） | ✅ 已有（卡密模式 → 改为邀请码） |
| POST | `/api/login` | 用户登录 | ✅ 已有 |
| GET | `/api/auth/validate` | Token验证 | ✅ 已有 |
| POST | `/api/logout` | 登出 | ✅ 已有 |
| GET | `/api/user/me` | 获取当前用户信息 | ✅ 已有 |

**修改：注册改为邀请码模式**
```
POST /api/register
Body: { username, password, inviteCode }
Response: { ok: true, data: { token, user: { id, username, role } } }
```

**邀请码数据模型：**
```json
{
  "code": "ABCD-EFGH",        // 邀请码
  "usedBy": "username",       // null=未使用
  "usedAt": 1712345678000,    // 使用时间
  "createdAt": 1712345678000, // 创建时间
  "createdBy": "admin"        // 创建者
}
```

### 2.2 账号管理模块（增强现有）

| 方法 | 路径 | 说明 | 已存在？ |
|------|------|------|---------|
| GET | `/api/accounts` | 获取账号列表（分页+搜索） | ✅ 需增强分页 |
| POST | `/api/accounts` | 创建账号 | ✅ 已有 |
| DELETE | `/api/accounts/:id` | 删除账号 | ✅ 已有 |
| POST | `/api/accounts/:id/start` | 启动账号 | ✅ 已有 |
| POST | `/api/accounts/:id/stop` | 停止账号 | ✅ 已有 |
| POST | `/api/accounts/:id/login` | 更新Code | ✅ 已有 |

**增强分页支持：**
```
GET /api/accounts?page=1&limit=50&keyword=xxx
Response: { ok: true, data: { accounts: [...], total: 100, stats: { running: 5, stopped: 3 } } }
```

### 2.3 微信扫码模块（新增）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/qr/create` | 生成微信登录二维码 |
| POST | `/api/qr/check` | 轮询二维码状态 |
| POST | `/api/qr/reset` | 重置二维码会话 |

**生成二维码：**
```
POST /api/qr/create
Response: { ok: true, data: { uuid, qrImageUrl } }
```

**轮询状态：**
```
POST /api/qr/check
Body: { code: "uuid" }
Response: { ok: true, data: { status: "wait" | "scanned" | "ok" | "error", code: "farm_code", openId, account } }
```

**流程：**
1. 前端调用 `/api/qr/create` → 获取微信二维码URL显示
2. 用户用微信扫码确认
3. 前端每2s轮询 `/api/qr/check`
4. 状态流转: `wait` → `scanned` → `ok`（返回 farm code）
5. 拿到 farm code 后自动创建/更新账号

### 2.4 抓包代理模块（增强现有）

| 方法 | 路径 | 说明 | 已存在？ |
|------|------|------|---------|
| GET | `/api/capture-proxy/info` | 获取抓包服务配置 | ❌ 新增 |
| POST | `/api/capture-proxy/start` | 启动抓包会话 | ✅ 需增强 |
| GET | `/api/capture-proxy/status` | 轮询抓包状态 | ❌ 新增 |
| POST | `/api/capture-proxy/stop` | 停止抓包 | ✅ 已有 |
| GET | `/api/capture-proxy/cert` | 下载CA证书 | ❌ 新增 |

**目标网站数据流：**
```
POST /api/capture-proxy/start { clientType: "qq" | "wechat" }
→ { sessionId, proxyHost, proxyPort, bindUrlHttp }

GET /api/capture-proxy/status?sessionId=xxx (轮询2s)
→ { code: "farm_code", friends: [{open_id}], ... }

POST /api/capture-proxy/stop?sessionId=xxx
→ { ok: true }

GET /api/capture-proxy/cert (下载CA证书文件)
```

### 2.5 节点模块（增强现有）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/nodes/available` | 获取可用节点列表（创建账号时选择）|

**数据模型：**
```json
{
  "nodeId": 1,
  "name": "香港节点1",
  "type": "paid" | "free",
  "recommended": true,
  "online": true,
  "remainingSlots": 50,
  "maxAccounts": 100,
  "globalUsed": 30,
  "healthScore": 95,
  "latencyMs": 120
}
```

### 2.6 账号操作日志（Dashboard用）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/account-logs?limit=100` | 获取账号日志 |
| GET | `/api/accounts/:id/logs` | 获取指定账号日志（带筛选）|

### 2.7 概览模块（Dashboard用）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/accounts/:id/status` | 获取账号实时状态 |

---

## 三、前端组件设计

### 3.1 路由结构

```
/home            →  Home (已有)
/login           →  Login/Register 合并页 (已有, 需改造)
/                →  DefaultLayout
  /              →  Dashboard (需改造为目标站风格)
  /accounts      →  Accounts (改造)
  /personal      →  Personal (已有)
  /friends       →  Friends (已有)
  /analytics     →  Analytics (已有)
  /settings      →  Settings (已有)
  /wechat        →  WechatAccounts (新增)
  /capture       →  CaptureAddAccount (新增)
  /admin         →  AdminSettings (已有)
```

### 3.2 新增/改造组件

| 组件 | 说明 | 参考源 |
|------|------|--------|
| `Login.vue` | 改造：目标站风格UI + 邀请码注册 | 目标站 Register-DvCh4k_l.js |
| `Dashboard.vue` | 改造：实时状态+操作统计+日志面板 | 目标站 Dashboard-CfglMeW1.js |
| `Accounts.vue` | 改造：账号卡片列表+分页+搜索 | 目标站 Accounts-DCGBvM9f.js |
| `AccountModal.vue` | 改造：添加/编辑Code弹窗 | 目标站 AccountModal-CHF9me9h.js |
| `WechatAccounts.vue` | **新增**：微信扫码添加 | 目标站 WechatAccounts-O1sfhd6z.js |
| `CaptureAddAccount.vue` | **新增**：抓包功能+手动Code | 目标站 CaptureAddAccount-D0W89Fmd.js |
| `Settings.vue` | 改造：完善设置页 | 目标站 Settings-f0hhcJhW.js |

### 3.3 新增/改造 Store

| Store | 说明 |
|-------|------|
| `stores/auth.ts` | 认证状态管理（已存在 user.ts → 重命名为 auth.ts 或扩展） |
| `stores/qq-login.ts` | QQ登录状态（已有，需增强） |
| `stores/wx-login.ts` | 微信扫码登录状态（已有 wx-login.ts） |
| `stores/account.ts` | 账号管理状态（已有） |
| `stores/app.ts` | 应用状态（已有） |

### 3.4 Dashboard 主要功能

1. **账号卡片**：当前账号头像/昵称/等级/经验进度/在线状态
2. **资产资源**：金币/点券/金豆 的本次收益和今日收益
3. **巡查节奏**：农场/好友 巡查倒计时
4. **运营统计**：今日操作汇总（收获/种植/偷菜/浇水等）
5. **实时日志**：带筛选（模块/事件/关键词/等级）的日志面板
6. **护主犬礼包**：今日领取统计
7. **通知展示**：站点公告/卡密到期提醒

---

## 四、数据模型

### 4.1 User（扩展现有）

```json
{
  "id": 1,
  "username": "user1",
  "password": "sha256_hash",
  "role": "user" | "admin" | "agent",
  "inviteCode": "ABCD-EFGH",
  "createdAt": 1712345678000,
  "card": {
    "code": "XXXX-YYYY",
    "expiresAt": 1743881678000,
    "enabled": true
  }
}
```

### 4.2 Account（扩展现有，增加平台字段）

```json
{
  "id": "uuid",
  "name": "我的大号",
  "code": "farm_websocket_code",
  "platform": "qq" | "wx",
  "uin": 123456789,
  "nodeId": 1,
  "running": true,
  "createdAt": 1712345678000,
  "autoStart": true
}
```

### 4.3 邀请码

```json
{
  "code": "ABCD-EFGH",
  "usedBy": null,
  "usedAt": null,
  "createdAt": 1712345678000,
  "createdBy": "admin"
}
```

---

## 五、集成点 — 复用现有模块

| 模块 | 文件 | 复用方式 |
|------|------|---------|
| Farm Engine | `core/src/runtime/runtime-engine.js` | 完整复用 |
| Worker | `core/src/core/worker.js` | 完整复用 |
| Protobuf | `core/src/utils/proto.js` | 完整复用 |
| Network | `core/src/utils/network.js` | 完整复用 |
| Store | `core/src/models/store.js` | 增强复用 |
| User Store | `core/src/models/user-store.js` | 增强复用 |
| Phone Capture | `core/src/services/phone-capture.js` | 增强复用（简化启动/状态轮询） |
| Admin Controller | `core/src/controllers/admin.js` | 增强复用（添加微信QR/节点/抓包路由） |

---

## 六、实现计划

### 阶段1：后端API增强（~60% 工作量在backend）
1. 增强 admin controller：
   - 添加邀请码路由（创建/验证/管理）
   - 添加微信QR路由（create/check/reset）
   - 增强抓包路由（info/start/status/stop/cert）
   - 添加节点路由
   - 增强账号路由（分页）
2. 增强 user-store：
   - 支持邀请码模式

### 阶段2：前端页面改造（~40% 工作量在frontend）
1. 改造 Login.vue → 目标站风格 + 注册在前端完成
2. 新增/改造 WechatAccounts.vue
3. 新增/改造 CaptureAddAccount.vue
4. 改造 Dashboard.vue → 实时日志+操作统计
5. 改造 Accounts.vue → 卡片列表+分页
6. 改造 AccountModal.vue → 添加Code弹窗
7. 更新路由和菜单

### 阶段3：集成测试
1. 测试注册→登录→添加账号→Dashboard完整流程
2. 测试微信扫码流程
3. 测试抓包代理流程
4. 测试账号启动/停止（复用现有farm engine）

---

## 七、关键注意事项

1. **微信扫码实现**：目标站使用微信开放平台扫码授权。后端需要微信开放平台的 `appid` 和 `secret` 才能实现。如果未配置，需降级为直接生成二维码图片供用户扫码。
2. **抓包代理**：依赖 mitmdump 工具。现有项目已实现了 phone-capture 服务，需要增强使其支持简单的启动/状态轮询接口。
3. **农场Code**：Farm WebSocket 的 `code` 是一次性的，掉线需要重新获取。需要确保 UI 清楚提示用户。
4. **数据兼容**：现有项目用 `accounts.json` 存账号数据，需要确保字段兼容。
