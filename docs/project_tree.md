# 项目目录结构

> 生成时间: 2026-06-26
> 基于代码扫描分析的完整项目树

```
qq-farm-bot/
│
├── package.json                    # 根包配置 (workspace: core + web)
├── pnpm-workspace.yaml             # pnpm 工作区配置
├── install.sh                      # 已部署服务器的更新脚本
├── dev-fast.sh                     # 开发快速启动 (前后端并发)
│
├── deploy/                         # 部署相关
│   ├── deploy.sh                   # 全新服务器一键部署脚本
│   ├── qq-farm-bot.service         # 主面板 systemd 服务
│   └── sniff9988.service           # Code 捕获 systemd 服务
│
├── docs/                           # 文档
│   ├── ADMIN.md                    # 管理员文档
│   ├── DEVELOPER.md                # 开发者文档
│   ├── LOGIN_ARCHITECTURE.md       # 登录架构总览 (本系列文档)
│   ├── login_flow.md               # 登录流程逆向
│   ├── http_requests.md            # HTTP 请求追踪
│   ├── token_analysis.md           # Token 分析
│   ├── cookie_lifecycle.md         # Cookie 生命周期
│   ├── session.md                  # Session 分析
│   ├── persistent_login_design.md  # 持久化登录设计
│   ├── protocol_analysis.md        # 协议分析
│   ├── login_validation.md         # 登录验证检测
│   ├── migration.md                # 迁移方案
│   └── test_plan.md                # 测试计划
│
├── core/                           # 后端 (Node.js)
│   ├── client.js                   # ██ 入口文件 ██ 进程管理器
│   ├── package.json
│   ├── Dockerfile                  # Docker 构建
│   │
│   ├── src/
│   │   ├── config/
│   │   │   ├── config.js           # ██ 配置常量 ██ 服务器地址/版本/端口
│   │   │   ├── gameConfig.js       # 游戏数据加载
│   │   │   └── runtime-paths.js    # 运行时路径解析
│   │   │
│   │   ├── controllers/
│   │   │   └── admin.js            # ██ HTTP API 服务器 ██ 所有REST路由~3800行
│   │   │
│   │   ├── core/
│   │   │   └── worker.js           # ██ 机器人 Worker ██ 单账号生命周期
│   │   │
│   │   ├── models/
│   │   │   ├── store.js            # ██ 主存储 ██ store.json + accounts.json
│   │   │   └── user-store.js       # ██ 用户存储 ██ users.json + cards.json
│   │   │
│   │   ├── runtime/
│   │   │   ├── runtime-engine.js   # 运行时引擎 (协调所有模块)
│   │   │   ├── runtime-state.js    # 运行时状态管理
│   │   │   ├── worker-manager.js   # Worker 进程管理
│   │   │   ├── data-provider.js    # 数据提供层
│   │   │   └── relogin-reminder.js # ██ 掉线重登通知 ██
│   │   │
│   │   ├── services/
│   │   │   ├── account-resolver.js # 账号解析
│   │   │   ├── analytics.js        # 数据分析
│   │   │   ├── email.js            # 邮件服务
│   │   │   ├── farm.js             # 农场操作
│   │   │   ├── friend.js           # 好友操作
│   │   │   ├── interact.js         # 互动记录
│   │   │   ├── invite.js           # 邀请码
│   │   │   ├── json-db.js          # JSON 原子读写
│   │   │   ├── logger.js           # 日志系统
│   │   │   ├── mall.js             # 商城
│   │   │   ├── manual-login-profile.js # ██ 手动登录获取资料 ██
│   │   │   ├── monthcard.js        # 月卡
│   │   │   ├── oauth.js            # ██ OAuth 服务 ██
│   │   │   ├── openserver.js       # 开服
│   │   │   ├── phone-capture.js    # ██ 手机代理抓包 ██
│   │   │   ├── push.js             # 推送通知
│   │   │   ├── qqvip.js            # QQ 会员
│   │   │   ├── qrlogin.js          # ██ 二维码登录 ██
│   │   │   ├── rate-limiter.js     # 限流
│   │   │   ├── scheduler.js        # 调度器
│   │   │   ├── security.js         # 安全签名
│   │   │   ├── share.js            # 分享
│   │   │   ├── stats.js            # 统计
│   │   │   ├── status.js           # 状态管理
│   │   │   ├── task.js             # 任务
│   │   │   └── warehouse.js        # 仓库
│   │   │
│   │   ├── proto/                  # Protobuf 协议定义
│   │   │   └── *.proto             # 游戏协议文件
│   │   │
│   │   ├── utils/
│   │   │   ├── common.js           # 通用工具
│   │   │   ├── crypto-wasm.js      # ██ WASM 加密 ██
│   │   │   ├── network.js          # ██ 网络层 ██ WebSocket + Protobuf
│   │   │   ├── proto.js            # Protobuf 工具
│   │   │   ├── qrutils.js          # ██ Cookie/QR 工具 ██
│   │   │   └── utils.js            # 工具函数
│   │   │
│   │   └── gameConfig/             # 游戏配置数据
│   │
│   └── data/                       # 运行时数据
│       ├── store.json              # 全局配置
│       ├── accounts.json           # 账号列表 (含code)
│       ├── users.json              # 用户账号
│       ├── cards.json              # 卡密
│       └── logs/                   # 日志
│
├── web/                            # 前端 (Vue 3 + Vite)
│   ├── src/
│   │   ├── main.ts                 # 入口
│   │   ├── App.vue                 # 根组件
│   │   ├── api/                    # API 客户端
│   │   ├── components/             # 组件
│   │   │   ├── AccountModal.vue    # 添加账号弹窗
│   │   │   ├── WxLoginModal.vue    # 微信登录弹窗
│   │   │   └── ui/                 # 基础UI组件
│   │   ├── layouts/                # 布局
│   │   ├── router/                 # 路由
│   │   ├── stores/                 # 状态管理 (Pinia)
│   │   │   ├── user.ts             # 用户状态
│   │   │   ├── account.ts          # 账号状态
│   │   │   ├── qq-login.ts         # QQ 登录状态
│   │   │   └── wx-login.ts         # 微信登录状态
│   │   ├── views/                  # 页面
│   │   │   ├── Login.vue           # 登录页
│   │   │   ├── Dashboard.vue       # 仪表盘
│   │   │   └── ...
│   │   └── utils/
│   └── dist/                       # 构建产物
│
└── tools/                          # 工具脚本
    ├── sniff9988.py                # ██ Code 捕获 HTTP 服务 ██
    ├── patch-qq-farm-code-capture.js   # PC QQ 补丁注入
    ├── mitm-qq-farm-code-capture.py    # mitmproxy 捕获插件
    ├── qq-farm-patch.ps1           # Windows 一键配置脚本
    ├── qq-farm-patch.bat           # Windows 一键配置 batch
    ├── qq-farm-patch.sh            # Mac/Linux 一键配置
    └── watch-qq-farm-code-capture.js   # 文件监视
```

## 模块分类

### 入口文件

| 文件 | 用途 |
|------|------|
| `core/client.js` | 主进程入口，进程管理器 |
| `core/src/core/worker.js` | Worker 子进程入口 |
| `web/src/main.ts` | 前端入口 |

### HTTP 模块

| 文件 | 用途 |
|------|------|
| `core/src/controllers/admin.js` | Express HTTP 服务器，所有 REST API |
| `tools/sniff9988.py` | Code 捕获 HTTP 服务（Python） |

### 登录模块

| 文件 | 用途 |
|------|------|
| `core/src/services/qrlogin.js` | QQ 二维码登录 + 小程序登录 |
| `core/src/services/oauth.js` | OAuth 第三方登录 |
| `core/src/services/phone-capture.js` | 手机抓包登录 |
| `core/src/services/manual-login-profile.js` | 手动登录获取用户资料 |

### 认证模块

| 文件 | 用途 |
|------|------|
| `core/src/controllers/admin.js` (authRequired) | 面板认证中间件 |
| `core/src/models/user-store.js` | 用户数据库 |
| `core/src/utils/network.js` | WebSocket 游戏认证 |
| `core/src/utils/qrutils.js` | Cookie 工具 + 哈希算法 |

### 配置模块

| 文件 | 用途 |
|------|------|
| `core/src/config/config.js` | 硬编码配置常量 |
| `core/src/config/runtime-paths.js` | 运行时路径解析 |
| `core/src/config/gameConfig.js` | 游戏数据加载 |

### 存储模块

| 文件 | 用途 |
|------|------|
| `core/src/models/store.js` | 主存储（store.json + accounts.json） |
| `core/src/models/user-store.js` | 用户存储（users.json + cards.json） |
| `core/src/services/json-db.js` | JSON 原子读写 |

### 缓存模块

| 项目 | 说明 |
|------|------|
| 无独立缓存层 | Token 存储在内存 Set 中（服务重启丢失） |
| pcCaptureInfoCache | PC 捕获信息 5 分钟缓存 |
| 运行时状态 | 在 memory 中维护，重启后重建 |
