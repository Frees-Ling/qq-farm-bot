# 迁移方案

> 如何将 PersistentLoginManager 集成到现有代码中

---

## 1. 迁移策略

**原则：** 向后兼容，不修改现有业务逻辑，逐步替换。

### 1.1 阶段划分

```mermaid
graph LR
    subgraph "Phase 1: 准备"
        P1["创建存储层<br/>session-store.json"]
        P1 --> P1a["加密模块"]
        P1 --> P1b["原子写入"]
        P1 --> P1c["备份机制"]
    end

    subgraph "Phase 2: 并行运行"
        P2["PersistentLoginManager<br/>作为可选模块"]
        P2 --> P2a["现有 accounts.json 依旧工作"]
        P2 --> P2b["新模块只读验证"]
    end

    subgraph "Phase 3: 逐步迁移"
        P3["Worker 启动流程修改"]
        P3 --> P3a["startWorker() 先走 PLM"]
        P3 --> P3b["PLM 失败则回退旧流程"]
    end

    subgraph "Phase 4: 默认启用"
        P4["移除旧逻辑"]
        P4 --> P4a["PLM 成为必需模块"]
        P4 --> P4b["仅保留兼容读取"]
    end

    P1 --> P2 --> P3 --> P4
```

---

## 2. 文件变更清单

### 2.1 新增文件

| 文件 | 用途 |
|------|------|
| `core/src/services/persistent-login.js` | PersistentLoginManager 实现 |
| `core/src/services/login-store.js` | 加密存储层 |
| `core/src/services/session-validator.js` | 会话验证器 |
| `core/src/services/refresh-handler.js` | 刷新处理器 |
| `core/src/utils/session-crypto.js` | 加密工具 |

### 2.2 修改文件

| 文件 | 修改内容 |
|------|---------|
| `core/src/runtime/runtime-engine.js` | 初始化 PLM |
| `core/src/runtime/worker-manager.js` | startWorker 中集成 PLM |
| `core/src/runtime/relogin-reminder.js` | 新 code 获取后更新 PLM |
| `core/src/services/qrlogin.js` | 获取新 code 后回写 PLM |
| `core/src/models/store.js` | 添加兼容读取方法 |
| `core/src/controllers/admin.js` | API 获取会话状态 |

### 2.3 无需修改的文件

| 文件 | 原因 |
|------|------|
| `core/src/core/worker.js` | Worker 仍接收 code 字符串 |
| `core/src/utils/network.js` | 网络层只关心 code 字符串 |
| `core/src/services/oauth.js` | OAuth 流程不变 |
| `core/src/services/phone-capture.js` | 手机抓包流程不变 |
| `web/` 所有文件 | 前端 API 不变 |

---

## 3. 修改点详情

### 3.1 runtime-engine.js 修改

```javascript
// 新增：初始化 PLM
async function initPersistentLogin() {
    const { PersistentLoginManager } = require('../services/persistent-login');
    const { LoginStore } = require('../services/login-store');
    const { SessionValidator } = require('../services/session-validator');
    const { RefreshHandler } = require('../services/refresh-handler');

    const store = new LoginStore({
        filePath: getDataFile('session-store.json'),
        cryptoKey: process.env.PERSISTENT_LOGIN_KEY || 'default-dev-key',
    });

    return new PersistentLoginManager({
        store,
        validator: new SessionValidator(),
        refreshHandler: new RefreshHandler(),
        autoBackup: true,
        backupInterval: 3600000,
    });
}

// 修改：账号启动流程
async function startAllAccounts() {
    const accounts = store.getAccounts();
    for (const account of accounts) {
        // 新增：通过 PLM 加载会话
        const session = await plm.load(account.id);
        if (session) {
            const validation = await plm.validate();
            if (validation.valid) {
                await startWorker(account, session.code);
                continue;
            }
        }
        // 回退：使用旧的 code（兼容）
        if (account.code) {
            await startWorker(account, account.code);
        }
    }
}
```

### 3.2 worker-manager.js 修改

```javascript
// 修改 startWorker 以支持 PLM
async function startWorker(account, code) {
    // ... 现有 fork/thread 逻辑保持不变 ...

    // 新增：PLM 会话跟踪
    if (plm) {
        const session = plm.getSession(account.id);
        if (session) {
            // 监听 Worker 状态，更新 PLM
            worker.on('message', (msg) => {
                if (msg.type === 'heartbeat_ok') {
                    plm.updateHeartbeat(account.id);
                }
                if (msg.type === 'ws_error' && msg.code === 400) {
                    plm.invalidate(account.id, 'code_expired');
                }
            });
        }
    }
}
```

### 3.3 relogin-reminder.js 修改

```javascript
// 修改：获取新 code 后同步到 PLM
function applyReloginCode({ accountId, authCode, uin }) {
    // ... 现有更新 accounts.json 的逻辑 ...

    // 新增：同步到 PLM
    if (plm) {
        plm.save({
            accountId,
            code: authCode,
            uin,
            createdAt: Date.now(),
            lastValidatedAt: Date.now(),
        });
    }
}
```

---

## 4. 回滚方案

```mermaid
graph TB
    subgraph "回滚条件"
        A["PLM 导致服务无法启动"]
        B["加密解密异常"]
        C["会话数据丢失"]
        D["性能降级"]
    end

    subgraph "回滚步骤"
        R1["停止服务"]
        R2["删除 session-store.json"]
        R3["回退代码版本"]
        R4["从 accounts.json 恢复"]
        R5["启动服务"]
    end

    A --> R1
    B --> R1
    C --> R1
    D --> R1

    R1 --> R2 --> R3 --> R4 --> R5

    R4 --> Verify["验证: 所有账号使用 accounts.json 中的 code"]
    Verify -->|"OK"| R5
    Verify -->|"失败"| FullRecovery["从备份恢复 accounts.json"]
    FullRecovery --> R5
```

**回滚关键是 accounts.json 始终保持写同步**，PLM 的 session-store.json 是附加层，不回写 accounts.json。删除 session-store.json 不会影响现有系统。

---

## 5. 测试策略

| 测试类型 | 测试内容 |
|---------|---------|
| 单元测试 | PLM load/save/validate/backup/restore |
| 集成测试 | PLM + Worker 启动 |
| 兼容测试 | 无 PLM 时系统正常运行 |
| 加密测试 | 加解密正确性 |
| 备份恢复测试 | 备份创建和恢复 |
| 并发测试 | 多账号同时加载 |
| 故障测试 | 文件损坏/加密密钥错误/磁盘满 |
