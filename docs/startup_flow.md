# 启动流程

> 系统启动时的完整流程

## 1. 总启动流程

```mermaid
graph TB
    Start["node core/client.js 启动"] --> CheckEnv{"FARM_WORKER=1?"}

    CheckEnv -->|"是"| WorkerProc["进入 Worker 子进程模式"]
    CheckEnv -->|"否"| MainProc["进入主进程模式"]

    MainProc --> LoadConfig["加载配置常量 config.js"]
    LoadConfig --> InitRuntimePaths["初始化运行时路径 runtime-paths.js"]
    InitRuntimePaths --> LoadStore["加载 Store<br/>store.json + accounts.json"]
    LoadStore --> LoadUserStore["加载 UserStore<br/>users.json + cards.json"]
    LoadUserStore --> InitState["初始化 RuntimeState"]
    InitState --> StartAdmin["启动 HTTP 服务<br/>startAdminServer()"]

    StartAdmin --> StartExpress["Express 服务器监听端口"]
    StartExpress --> RegisterRoutes["注册所有 API 路由"]
    RegisterRoutes --> StartSocket["启动 Socket.IO"]
    StartSocket --> StartSniff["集成 Code 捕获服务<br/>(可选)"]

    StartSniff --> LoadAccounts["从 store 加载所有账号"]
    LoadAccounts --> StartWorkers["为每个账号启动 Worker"]

    StartWorkers --> WorkerFork["worker-manager.js<br/>fork/thread 创建子进程"]
    WorkerFork --> IPCInit["IPC 通道建立"]
    IPCInit --> SendStart["发送 {type:'start', config}"]
    SendStart --> BotInit["Worker 初始化"]

    BotInit --> LoadProto["加载 Protobuf"]

    subgraph "Worker 子进程初始化"
        LoadProto --> ApplyRuntimeConfig["应用运行时配置"]
        ApplyRuntimeConfig --> SetEvents["注册事件监听"]
        SetEvents --> ConnectWS["WebSocket 连接"]
        ConnectWS --> SendLogin["发送 LoginRequest"]
        SendLogin --> LoginOK{"登录成功?"}

        LoginOK -->|"是"| InitModules["初始化农场/好友/任务模块"]
        InitModules --> StartLoops["启动定时循环"]
        StartLoops --> SyncStatus["同步状态到主进程"]

        LoginOK -->|"否"| HandleError{"错误类型?"}
        HandleError -->|"版本过低"| BumpVersion["递增版本号"]
        BumpVersion --> RetryConnect["重试连接 (最多5次)"]
        HandleError -->|"Code无效"| ReportWS_400["通知主进程 ws_error"]
        HandleError -->|"被踢"| ReportKick["通知主进程 account_kicked"]
    end

    StartLoops --> FarmLoop["农场巡查循环"]
    StartLoops --> FriendLoop["好友巡查循环"]
    StartLoops --> DailyTask["每日任务定时器"]

    SyncStatus --> RuntimeReady["主进程: 运行时就绪"]
```

## 2. 主进程详细启动流程

```mermaid
sequenceDiagram
    participant CLI as node client.js
    participant Engine as RuntimeEngine
    participant Admin as AdminServer
    participant WM as WorkerManager
    participant Store as Store
    participant UStore as UserStore

    CLI->>Engine: createRuntimeEngine(config)
    Engine->>Engine: init()
    Engine->>Store: load()
    Store-->>Engine: store.json + accounts.json
    Engine->>UStore: load()
    UStore-->>Engine: users.json + cards.json
    Engine->>Engine: initRuntimeState()

    Engine->>Admin: startAdminServer(port)
    Admin->>Admin: Express app.listen(3000)
    Admin->>Admin: 注册 /api/* 路由
    Admin->>Admin: 注册 Socket.IO
    Admin-->>Engine: adminServerReady

    Engine->>Engine: 启动自动清理任务 (每5分钟)

    Engine->>Store: getAccounts()
    Store-->>Engine: [account1, account2, ...]

    loop 每个账号
        Engine->>WM: startWorker(account)
        WM->>WM: fork() / new Worker()
        WM->>Worker: IPC: {type:'start', config}
        alt 账号已启用
            Worker-->>WM: status_sync (running)
            WM-->>Engine: workerRunning
        else 账号已禁用
            WM-->>Engine: workerSkipped
        end
    end

    Engine-->>CLI: RuntimeEngine ready
```

## 3. Worker 子进程启动流程

```mermaid
sequenceDiagram
    participant WM as WorkerManager (主进程)
    participant W as Worker (子进程)
    participant NW as network.js
    participant WS as WebSocket
    participant Farm as farm.js
    participant Friend as friend.js

    WM->>W: fork() / new Worker()
    Note over W: workerData = { accountId }

    WM->>W: IPC: {type:'start', config:{code, platform, ...}}

    W->>W: startBot(config)
    W->>W: applyRuntimeConfig()
    W->>W: loadProto()

    W->>NW: connect(code, onLoginSuccess, options)
    NW->>WS: new WebSocket(url?platform=&code=&ver=...)
    NW->>NW: ws.on('open')
    NW->>WS: sendLogin() [Protobuf LoginRequest]
    WS-->>NW: LoginReply [Protobuf]
    NW->>NW: 解析 LoginReply
    NW->>NW: 填充 userState
    NW->>NW: 启动心跳
    NW-->>W: onLoginSuccess()

    W->>W: 初始化各模块
    W->>Farm: 拉取背包/点券
    W->>Farm: 设置金币/经验基线
    W->>W: 开始巡查循环

    loop 每 heartbeatInterval ms
        NW->>WS: HeartbeatRequest
        WS-->>NW: HeartbeatReply
    end

    loop 每 interval ms
        W->>Farm: 巡查农场
        W->>Friend: 巡查好友
        W-->>WM: IPC: status_sync
    end

    W-->>WM: IPC: status_sync
    Note over W,WM: Worker 就绪
```

## 4. 面板（Express）启动流程

```mermaid
graph TB
    Start["startAdminServer()"] --> Express["new Express()"]
    Express --> Cors["CORS 配置<br/>Access-Control-Allow-Origin: *"]
    Cors --> BodyParser["Body Parser 中间件"]
    BodyParser --> Logger["请求日志中间件"]

    Logger --> RoutePublic["注册公开路由<br/>POST /api/login<br/>POST /api/register<br/>POST /api/pending-code<br/>GET /api/qr/*<br/>GET /api/pc-capture/*"]

    RoutePublic --> AuthWall["全局认证墙<br/>app.use('/api', authCheck)"]

    AuthWall --> RouteUser["注册用户路由<br/>GET /api/user/me<br/>POST /api/user/renew<br/>POST /api/logout"]
    RouteUser --> RouteAdmin["注册管理路由<br/>GET /api/admin/users<br/>POST /api/admin/cards"]

    RouteAdmin --> StaticFiles["静态文件中间件<br/>web/dist/ (Vue构建)"]
    StaticFiles --> Fallback["SPA Fallback<br/>所有非API路由 → index.html"]

    Fallback --> SocketIO["Socket.IO 初始化<br/>认证 + 命名空间 + 事件"]
    SocketIO --> Listen["app.listen(ADMIN_PORT)"]
    Listen --> Ready["服务器就绪 ✓"]
```

## 5. 关键启动参数

| 阶段 | 耗时 | 说明 |
|------|------|------|
| 加载配置 | <10ms | config.js + runtime-paths.js |
| 加载 Store | <100ms | 读取 store.json + accounts.json（取决于文件大小） |
| 加载 UserStore | <50ms | 读取 users.json + cards.json |
| 启动 Express | <200ms | 注册所有路由 + 中间件 |
| Socket.IO | <100ms | 握手 + 认证配置 |
| 启动 Worker | 500ms+/每个 | fork子进程 + IPC初始化 + WebSocket连接 + 登录 |
| 总计 | 1-5s | 取决于账号数量 |
