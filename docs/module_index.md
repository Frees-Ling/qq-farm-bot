# 模块索引

> 按功能分类的所有源文件索引

## 1. 启动与生命周期

| 模块 | 文件 | 角色 |
|------|------|------|
| ProcessManager | `core/client.js` | 判断主/子进程，创建 RuntimeEngine |
| RuntimeEngine | `core/src/runtime/runtime-engine.js` | 主协调器，启动 HTTP/Worker/服务 |
| WorkerManager | `core/src/runtime/worker-manager.js` | Worker 创建/销毁/IPC |
| Worker | `core/src/core/worker.js` | 单账号 Bot 逻辑 |
| RuntimeState | `core/src/runtime/runtime-state.js` | 运行时状态容器 |

## 2. HTTP 与 API

| 模块 | 文件 | 角色 |
|------|------|------|
| AdminServer | `core/src/controllers/admin.js` | Express 服务器，所有 REST 路由 |
| SniffServer | `tools/sniff9988.py` | Code 捕获 HTTP 服务（Python） |

## 3. 登录与认证 (面板)

| 模块 | 文件 | 角色 |
|------|------|------|
| AuthMiddleware | `core/src/controllers/admin.js` (L80-114) | `authRequired` 中间件 |
| AdminMiddleware | `core/src/controllers/admin.js` (L2412-2417) | `adminRequired` 中间件 |
| UserStore | `core/src/models/user-store.js` | 用户数据 + 密码验证 |
| TokenManager | `core/src/controllers/admin.js` (L77-79) | 内存 Token 生成/存储 |

## 4. 登录与认证 (游戏)

| 模块 | 文件 | 角色 |
|------|------|------|
| QRLogin (Web) | `core/src/services/qrlogin.js` QRLoginSession | QQ 网页版扫码登录 |
| QRLogin (MiniApp) | `core/src/services/qrlogin.js` MiniProgramLoginSession | QQ 小程序开发者工具登录 |
| OAuthService | `core/src/services/oauth.js` | 第三方 OAuth 登录 |
| PhoneCapture | `core/src/services/phone-capture.js` | mitmproxy 手机抓包 |
| ManualLoginProfile | `core/src/services/manual-login-profile.js` | 手动 code 获取用户资料 |
| CryptoWasm | `core/src/utils/crypto-wasm.js` | Protobuf 消息体加密 |
| NetworkLayer | `core/src/utils/network.js` | WebSocket 连接 + 登录 |
| QRUtils | `core/src/utils/qrutils.js` | Cookie 解析 + QQ 哈希算法 |
| ReloginReminder | `core/src/runtime/relogin-reminder.js` | 掉线推送重登二维码 |

## 5. 游戏逻辑

| 模块 | 文件 | 角色 |
|------|------|------|
| FarmService | `core/src/services/farm.js` | 农场操作 |
| FriendService | `core/src/services/friend.js` | 好友交互 |
| MallService | `core/src/services/mall.js` | 商城 |
| TaskService | `core/src/services/task.js` | 任务系统 |
| WarehouseService | `core/src/services/warehouse.js` | 仓库 |
| Scheduler | `core/src/services/scheduler.js` | 任务调度器 |
| ShareService | `core/src/services/share.js` | 分享码 |
| QQVIP | `core/src/services/qqvip.js` | QQ 会员 |
| MonthCard | `core/src/services/monthcard.js` | 月卡 |

## 6. 数据存储

| 模块 | 文件 | 角色 |
|------|------|------|
| Store | `core/src/models/store.js` | store.json + accounts.json CRUD |
| UserStore | `core/src/models/user-store.js` | users.json + cards.json CRUD |
| JsonDB | `core/src/services/json-db.js` | 原子 JSON 文件读写 |

## 7. 工具与服务

| 模块 | 文件 | 角色 |
|------|------|------|
| Logger | `core/src/services/logger.js` | Winston 日志 |
| PushService | `core/src/services/push.js` | 多渠道推送通知 |
| Security | `core/src/services/security.js` | API 签名验证 |
| RateLimiter | `core/src/services/rate-limiter.js` | 速率限制 |
| Analytics | `core/src/services/analytics.js` | 数据分析 |
| StatusService | `core/src/services/status.js` | 状态追踪 |
| ProtoUtils | `core/src/utils/proto.js` | Protobuf 加载工具 |
| Utils | `core/src/utils/utils.js` | 通用工具函数 |

## 8. 前端

| 文件 | 角色 |
|------|------|
| `web/src/stores/user.ts` | 面板用户认证状态 |
| `web/src/stores/qq-login.ts` | QQ 扫码登录状态 |
| `web/src/stores/wx-login.ts` | 微信扫码登录状态 |
| `web/src/stores/account.ts` | 账号管理状态 |
| `web/src/views/Login.vue` | 登录页面 |
| `web/src/components/AccountModal.vue` | 添加账号弹窗 |

## 9. 配置

| 文件 | 角色 |
|------|------|
| `core/src/config/config.js` | 硬编码常量 |
| `core/src/config/runtime-paths.js` | 运行时路径 |
| `core/src/config/gameConfig.js` | 游戏数据 |
| `core/data/store.json` | 运行时配置持久化 |
