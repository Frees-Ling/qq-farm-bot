# QQ农场核心登录流程 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在现有 qq-farm-bot-main 项目上，实现目标网站(103.39.65.212:8888)的3种添加农场账号方式（微信扫码/手机抓包/手动Code），同时修复QQ扫码的-3000问题，双管齐下。

**架构:** 后端Express增强已有路由 + 前端Vue 3新增/改造页面。现有农场引擎（Worker、WebSocket、Protobuf）完整复用。

**Tech Stack:** Node.js/Express + Vue 3/Pinia/Vite + Socket.IO + axios

**设计文档:** `docs/superpowers/specs/2026-06-23-qq-farm-login-flow-design.md`

---

## 文件变更清单

### 后端 (core/src/)
| 文件 | 操作 | 说明 |
|------|------|------|
| `controllers/admin.js` | 修改 | 添加邀请码/微信QR/节点/增强抓包路由 |
| `models/user-store.js` | 修改 | 添加邀请码支持(load/save/validate) |
| `services/phone-capture.js` | 修改 | 添加状态轮询/证书下载/好友收集支持 |

### 前端 (web/src/)
| 文件 | 操作 | 说明 |
|------|------|------|
| `views/Login.vue` | 改造 | 目标站风格UI + 邀请码注册 |
| `views/Dashboard.vue` | 改造 | 实时状态+操作统计+日志面板 |
| `views/Accounts.vue` | 改造 | 卡片列表+分页+搜索 |
| `components/AccountModal.vue` | 改造 | Code添加弹窗 |
| `views/WechatAccounts.vue` | **新增** | 微信扫码添加账号 |
| `views/CaptureAddAccount.vue` | **新增** | 抓包添加账号 |
| `router/index.ts` | 修改 | 添加新路由 |
| `router/menu.ts` | 修改 | 添加菜单项 |
| `api/index.ts` | 修改 | 添加silentErrorToast支持 |
| `stores/user.ts` | 修改 | 增强邀请码注册支持 |
| `stores/account.ts` | 修改 | 添加分页参数 |

---

### Task 1: 后端 — 添加邀请码系统

**Files:**
- Modify: `core/src/models/user-store.js` — 添加邀请码数据模型和API
- Modify: `core/src/controllers/admin.js` — 添加邀请码路由

**Interfaces:**
- Consumes: 现有 `userStore.registerUser()`, `initDefaultAdmin()`
- Produces: 邀请码CRUD + 注册时验证邀请码

- [ ] **Step 1: 在 user-store.js 中添加邀请码支持**

在 `userStore` 对象的 `loadCards()` / `saveCards()` 同级，添加邀请码的加载/保存逻辑：

```javascript
// === 邀请码系统 ===
const INVITE_CODES_FILE = getDataFile('invite-codes.json');

let inviteCodes = [];

function loadInviteCodes() {
    ensureDataDir();
    try {
        if (fs.existsSync(INVITE_CODES_FILE)) {
            const data = JSON.parse(fs.readFileSync(INVITE_CODES_FILE, 'utf8'));
            inviteCodes = Array.isArray(data.codes) ? data.codes : [];
        } else {
            inviteCodes = [];
            saveInviteCodes();
        }
    } catch (e) {
        console.error('加载邀请码失败:', e.message);
        inviteCodes = [];
    }
}

function saveInviteCodes() {
    ensureDataDir();
    try {
        fs.writeFileSync(INVITE_CODES_FILE, JSON.stringify({ codes: inviteCodes }, null, 2), 'utf8');
    } catch (e) {
        console.error('保存邀请码失败:', e.message);
    }
}

function generateInviteCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// 创建邀请码
function createInviteCode(createdBy = 'admin', note = '') {
    loadInviteCodes();
    const code = generateInviteCode();
    const invite = {
        code,
        usedBy: null,
        usedAt: null,
        createdAt: Date.now(),
        createdBy,
        note: String(note || ''),
    };
    inviteCodes.push(invite);
    saveInviteCodes();
    return invite;
}

// 批量创建邀请码
function createInviteCodesBatch(count = 1, createdBy = 'admin', note = '') {
    loadInviteCodes();
    const codes = [];
    for (let i = 0; i < count; i++) {
        codes.push(createInviteCode(createdBy, note));
    }
    return codes;
}

// 验证并使用邀请码（返回 { ok, error }）
function useInviteCode(code, username) {
    loadInviteCodes();
    const invite = inviteCodes.find(c => c.code === code);
    if (!invite) {
        return { ok: false, error: '邀请码无效' };
    }
    if (invite.usedBy) {
        return { ok: false, error: '邀请码已被使用' };
    }
    invite.usedBy = username;
    invite.usedAt = Date.now();
    saveInviteCodes();
    return { ok: true };
}

// 获取所有邀请码
function getAllInviteCodes() {
    loadInviteCodes();
    return inviteCodes;
}

// 删除邀请码
function deleteInviteCode(code) {
    loadInviteCodes();
    const idx = inviteCodes.findIndex(c => c.code === code);
    if (idx === -1) return false;
    inviteCodes.splice(idx, 1);
    saveInviteCodes();
    return true;
}
```

然后将这些函数导出到 `module.exports`。

- [ ] **Step 2: 修改注册接口支持邀请码**

在 `admin.js` 中，修改 `/api/register` 路由：

```javascript
app.post('/api/register', (req, res) => {
    const { username, password, inviteCode } = req.body || {};
    if (!username || !password || !inviteCode) {
        return res.status(400).json({ ok: false, error: '请填写完整信息（用户名、密码、邀请码）' });
    }
    // 验证邀请码
    const inviteResult = userStore.useInviteCode(inviteCode, username);
    if (!inviteResult.ok) {
        return res.status(400).json(inviteResult);
    }
    // 注册用户（注册时不绑定卡密，仅创建账号）
    const result = userStore.registerUser(username, password, '');
    if (!result.ok) {
        return res.status(400).json(result);
    }
    res.json({ ok: true, data: result.user });
});
```

- [ ] **Step 3: 添加邀请码管理路由（仅管理员）**

同上文件，找到 `adminRequired` 中间件定义的后面，添加：

```javascript
// 获取所有邀请码
app.get('/api/admin/invite-codes', authRequired, adminRequired, (req, res) => {
    try {
        const codes = userStore.getAllInviteCodes();
        res.json({ ok: true, data: codes });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// 创建邀请码
app.post('/api/admin/invite-codes', authRequired, adminRequired, (req, res) => {
    try {
        const { count, note } = req.body || {};
        const num = Math.max(1, Math.min(100, Number(count) || 1));
        const codes = userStore.createInviteCodesBatch(num, req.currentUser?.username || 'admin', String(note || ''));
        res.json({ ok: true, data: codes, count: codes.length });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// 删除邀请码
app.delete('/api/admin/invite-codes/:code', authRequired, adminRequired, (req, res) => {
    try {
        const ok = userStore.deleteInviteCode(req.params.code);
        if (!ok) return res.status(404).json({ ok: false, error: '邀请码不存在' });
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});
```

- [ ] **Step 4: 在 `userStore.loadInviteCodes()` 和 `userStore.initDefaultAdmin()` 中初始化**

在 `initDefaultAdmin()` 中添加邀请码文件初始化：
```javascript
loadInviteCodes();
```

在 `module.exports` 中添加新函数。

- [ ] **Step 5: 添加 `/api/announcement` 端点**

在 `admin.js` 中添加：
```javascript
app.get('/api/announcement', (req, res) => {
    try {
        const data = store.getAnnouncement ? store.getAnnouncement() : null;
        res.json({ ok: true, data });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});
```

- [ ] **Step 6: Commit**

```bash
git add core/src/models/user-store.js core/src/controllers/admin.js
git commit -m "feat: add invite code system and announcement API"
```

---

### Task 2: 后端 — 添加微信QR和节点路由

**Files:**
- Modify: `core/src/controllers/admin.js`

**Interfaces:**
- Consumes: 现有 `store`, `userStore`, 微信配置
- Produces: `/api/qr/*` (微信扫码) + `/api/nodes/*` + 抓包增强路由

- [ ] **Step 1: 在 admin.js 中添加微信扫码路由**

微信扫码使用微信开放平台的OAuth流程。前端生成二维码，用户扫码后，微信回调到我们的服务器，我们获取用户的 `openId` 和 `code`。

在实际实现中，微信扫码需要微信开放平台的 `appid` 和 `secret`。由于我们没有这些凭据，我们实现一个**模拟/可配置**的微信扫码流程：

```javascript
// ============ 微信扫码 API（可配置） ============
// 微信扫码使用微信开放平台 OAuth 2.0
// 如果未配置微信凭据，则返回提示信息

app.post('/api/wx-qr/create', async (req, res) => {
    try {
        const wxConfig = store.getWxConfig ? store.getWxConfig() : {};
        if (!wxConfig.appId) {
            // 无配置时返回模拟二维码（用于开发/演示）
            const mockUuid = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const mockUrl = `https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=${mockUuid}`;
            return res.json({
                ok: true,
                data: { uuid: mockUuid, qrImageUrl: mockUrl, mock: true }
            });
        }
        // 真实微信扫码流程
        const { appId, secret } = wxConfig;
        const tokenRes = await fetch(`https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${secret}`);
        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) {
            return res.status(500).json({ ok: false, error: '获取微信token失败' });
        }
        const qrRes = await fetch('https://api.weixin.qq.com/cgi-bin/qrcode/create?access_token=' + tokenData.access_token, {
            method: 'POST',
            body: JSON.stringify({ expire_seconds: 300, action_name: 'QR_STR_SCENE', action_info: { scene: { scene_str: `farm_${Date.now()}` } } })
        });
        const qrData = await qrRes.json();
        if (!qrData.ticket) {
            return res.status(500).json({ ok: false, error: '创建微信二维码失败' });
        }
        const qrImageUrl = `https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=${encodeURIComponent(qrData.ticket)}`;
        res.json({ ok: true, data: { uuid: qrData.ticket, qrImageUrl } });
    } catch (e) {
        adminLogger.warn('wx qr create failed', { error: e.message });
        res.status(500).json({ ok: false, error: `创建微信二维码失败: ${e.message}` });
    }
});

app.post('/api/wx-qr/check', async (req, res) => {
    try {
        const { code } = req.body || {};
        if (!code) return res.status(400).json({ ok: false, error: 'Missing code' });

        // 如果是mock模式，根据uuid返回状态
        if (String(code).startsWith('mock_')) {
            // 模拟：第一次返回wait，后续返回ok
            const sessions = phoneCapture.getWxQRSessions ? phoneCapture.getWxQRSessions() : {};
            const session = sessions[code];
            if (!session) {
                // 注册监听session
                if (phoneCapture.registerWxQRSession) {
                    phoneCapture.registerWxQRSession(code);
                }
                return res.json({ ok: true, data: { status: 'wait', ok: 0, mock: true } });
            }
            if (session.status === 'ok' && session.code) {
                return res.json({ ok: true, data: { status: 'ok', code: session.code, openId: session.openId || '', mock: true } });
            }
            return res.json({ ok: true, data: { status: 'wait', ok: 0, mock: true } });
        }

        // 真实微信扫码轮询
        // 这里需要对接微信的扫码状态查询接口
        res.json({ ok: true, data: { status: 'wait', ok: 0 } });
    } catch (e) {
        adminLogger.warn('wx qr check failed', { error: e.message });
        res.status(500).json({ ok: false, error: `查询微信扫码状态失败: ${e.message}` });
    }
});

app.post('/api/wx-qr/reset', (req, res) => {
    try {
        const { code } = req.body || {};
        if (code && phoneCapture.unregisterWxQRSession) {
            phoneCapture.unregisterWxQRSession(code);
        }
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});
```

- [ ] **Step 2: 添加节点路由**

```javascript
// ============ 节点管理 API ============
app.get('/api/nodes/available', (req, res) => {
    try {
        // 返回可用节点列表（单机部署只有一个默认节点）
        const nodes = [{
            nodeId: 1,
            name: '默认节点',
            type: 'free',
            recommended: true,
            online: true,
            remainingSlots: 999,
            maxAccounts: 9999,
            globalUsed: 0,
            healthScore: 100,
            latencyMs: 0,
            pendingCommands: 0,
        }];
        // 如果有多节点配置，从store读取
        if (store.getAllNodes) {
            const configuredNodes = store.getAllNodes();
            if (Array.isArray(configuredNodes) && configuredNodes.length > 0) {
                res.json({ ok: true, data: configuredNodes });
                return;
            }
        }
        res.json({ ok: true, data: nodes });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});
```

- [ ] **Step 3: 增强抓包路由 — 添加 info/start/status/stop/cert**

增强现有 `/api/qq-phone-capture/*` 路由，使其匹配目标网站的 `/api/capture-proxy/*` 风格：

```javascript
// ============ 抓包代理 API ============
app.get('/api/capture-proxy/info', (req, res) => {
    try {
        const enabled = !!(process.env.FARM_PHONE_PROXY_PORT || fs.existsSync(require('child_process').spawnSync('mitmdump', ['--version']).stdout?.toString()?.trim()));
        res.json({ ok: true, data: { enabled, port: process.env.FARM_PHONE_PROXY_PORT || 8899 } });
    } catch (e) {
        res.json({ ok: true, data: { enabled: false } });
    }
});

app.post('/api/capture-proxy/start', (req, res) => {
    try {
        const currentUser = req.currentUser || {};
        const username = String(currentUser.username || 'admin').trim() || 'admin';
        const accountName = String((req.body && req.body.name) || '').trim();
        const clientType = String((req.body && req.body.clientType) || 'qq').trim();
        const panelPort = CONFIG.adminPort || 3000;
        const data = phoneCapture.startCapture({
            username,
            accountName,
            panelApi: `http://127.0.0.1:${panelPort}/api/code-capture`,
            port: process.env.FARM_PHONE_PROXY_PORT || 8899,
            clientType,
        });
        return res.json({ ok: true, data });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});

app.get('/api/capture-proxy/status', (req, res) => {
    try {
        const currentUser = req.currentUser || {};
        const sessionId = String(req.query.sessionId || '').trim();
        const data = phoneCapture.getStatus(sessionId, String(currentUser.username || ''));
        // 增强返回：包含code和friends
        const enhanced = {
            ...(data || { status: 'idle' }),
            code: data?.result?.code || data?.code || '',
            friends: data?.friends || [],
        };
        return res.json({ ok: true, data: enhanced });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});

app.post('/api/capture-proxy/stop', (req, res) => {
    try {
        const sessionId = String((req.body && req.body.sessionId) || '').trim();
        const data = phoneCapture.stopCapture(sessionId);
        return res.json({ ok: true, data: data || { status: 'idle' } });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});

app.get('/api/capture-proxy/cert', (req, res) => {
    try {
        const certPath = path.join(os.homedir(), '.mitmproxy', 'mitmproxy-ca-cert.pem');
        if (fs.existsSync(certPath)) {
            return res.download(certPath, 'mitmproxy-ca.cer');
        }
        // 尝试其他路径
        const altPaths = [
            '/usr/local/share/mitmproxy/mitmproxy-ca-cert.pem',
            '/etc/mitmproxy/mitmproxy-ca-cert.pem',
            path.join(os.homedir(), '.local/share/mitmproxy/mitmproxy-ca-cert.pem'),
        ];
        for (const p of altPaths) {
            if (fs.existsSync(p)) return res.download(p, 'mitmproxy-ca.cer');
        }
        return res.status(404).json({ ok: false, error: '证书文件未找到，请先安装 mitmproxy' });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});
```

- [ ] **Step 4: 增强账号列表 — 添加分页支持**

```javascript
// 在 GET /api/accounts 路由中（如果存在则增强，不存在则添加）
app.get('/api/accounts', (req, res) => {
    try {
        const currentUser = req.currentUser;
        const accounts = getAccountList(currentUser?.username);
        
        // 分页
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
        const keyword = String(req.query.keyword || '').trim().toLowerCase();
        
        let filtered = accounts.filter(a => !a.deletedAt);
        
        // 搜索
        if (keyword) {
            filtered = filtered.filter(a => 
                String(a.name || '').toLowerCase().includes(keyword) ||
                String(a.uin || '').includes(keyword) ||
                String(a.id || '').includes(keyword)
            );
        }
        
        const total = filtered.length;
        const totalPages = Math.ceil(total / limit);
        const start = (page - 1) * limit;
        const paged = filtered.slice(start, start + limit);
        
        const stats = {
            running: filtered.filter(a => a.running).length,
            stopped: filtered.filter(a => !a.running).length,
        };
        
        res.json({
            ok: true,
            data: {
                accounts: paged,
                total,
                page,
                limit,
                totalPages,
                stats,
            }
        });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});
```

- [ ] **Step 5: 在 `/api` 中间件白名单中添加新路径**

找到 `app.use('/api', ...)` 的白名单，添加新路径：
```javascript
if (req.path === '/login' || req.path === '/register' || req.path === '/qr/create' || ... || req.path === '/announcement' || req.path === '/wx-qr/create' || req.path === '/wx-qr/check' || req.path === '/capture-proxy/info' || req.path === '/capture-proxy/cert' || req.path === '/nodes/available') return next();
```

- [ ] **Step 6: 添加微信配置的store方法**

在 `core/src/models/store.js` 中添加 `getWxConfig` 方法（如果尚无）：
```javascript
function getWxConfig() {
    try {
        const data = readJsonFile(STORE_FILE);
        return (data && data.wxConfig) ? data.wxConfig : {};
    } catch { return {}; }
}
// 导出到 module.exports
```

- [ ] **Step 7: Commit**

```bash
git add core/src/controllers/admin.js core/src/models/store.js
git commit -m "feat: add wx-qr, nodes, capture-proxy, paginated accounts APIs"
```

---

### Task 3: 后端 — 增强 phone-capture 服务

**Files:**
- Modify: `core/src/services/phone-capture.js`

**Interfaces:**
- Consumes: 现有 mitmdump 检测/启动逻辑
- Produces: 增强的状态返回（含code/friends）+ 微信QR session管理

- [ ] **Step 1: 在 `publicSession` 函数中添加 code 和 friends 字段**

```javascript
function publicSession(session) {
    if (!session) return null;
    return {
        // ... 现有字段
        code: session.result?.code || session.code || '',
        friends: session.friends || [],
        // ... 其余字段保持不变
    };
}
```

- [ ] **Step 2: 添加微信QR session管理**

```javascript
// 微信QR session存储
const wxQrSessions = {};

function registerWxQRSession(uuid) {
    wxQrSessions[uuid] = { status: 'wait', code: '', openId: '', createdAt: Date.now() };
}

function unregisterWxQRSession(uuid) {
    delete wxQrSessions[uuid];
}

function getWxQRSessions() {
    return wxQrSessions;
}

function updateWxQRSession(uuid, data) {
    if (wxQrSessions[uuid]) {
        Object.assign(wxQrSessions[uuid], data);
    }
}
```

- [ ] **Step 3: 导出新函数**

在 `module.exports` 中添加：
```javascript
module.exports = {
    // ... 现有导出
    registerWxQRSession,
    unregisterWxQRSession,
    getWxQRSessions,
    updateWxQRSession,
};
```

- [ ] **Step 4: Commit**

```bash
git add core/src/services/phone-capture.js
git commit -m "feat: enhance phone-capture with wx QR session and code/friends fields"
```

---

### Task 4: 前端 — 改造 Login.vue（邀请码注册 + 目标站风格）

**Files:**
- Modify: `web/src/views/Login.vue`
- Modify: `web/src/stores/user.ts`

**Interfaces:**
- Consumes: `api.post('/api/register', ...)` 现在使用 inviteCode
- Produces: 邀请码注册流程UI

- [ ] **Step 1: 修改 user store 中的 register 方法**

```typescript
// 将 cardCode 改为 inviteCode
async function register(username: string, password: string, inviteCode: string) {
    const res = await api.post('/api/register', { username, password, inviteCode }, { silent: true })
    return res.data
}
```

- [ ] **Step 2: 改造 Login.vue**

将卡密输入改为邀请码输入，并更新UI风格：
```vue
<div v-if="!isLogin">
  <label>邀请码</label>
  <BaseInput v-model="inviteCode" placeholder="请输入邀请码" :required="!isLogin" />
  <p class="mt-1 text-xs text-foreground-muted">联系管理员获取邀请码</p>
</div>
```

并在setup中将 `cardCode` 引用改为 `inviteCode`：
```typescript
const inviteCode = ref('')

// 注册时
async function handleSubmit() {
  if (!isLogin.value) {
    const result = await userStore.register(username.value, password.value, inviteCode.value)
    // ...
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/views/Login.vue web/src/stores/user.ts
git commit -m "feat: update login/register to use invite code"
```

---

### Task 5: 前端 — 新增 WechatAccounts.vue（微信扫码页面）

**Files:**
- Create: `web/src/views/WechatAccounts.vue`

**Interfaces:**
- Consumes: `api.post('/api/wx-qr/create')`, `api.post('/api/wx-qr/check')`, `api.post('/api/wx-qr/reset')`, `api.post('/api/accounts')`, `api.get('/api/nodes/available')`
- Produces: 微信扫码添加账号的完整UI

- [ ] **Step 1: 创建 WechatAccounts.vue**

参考目标网站 `WechatAccounts-O1sfhd6z.js` 的实现逻辑，创建 Vue 3 组件：

关键功能：
1. 点击"生成二维码" → 调用 `/api/wx-qr/create` → 显示二维码图片
2. 用户用微信扫码 → 每2秒轮询 `/api/wx-qr/check`
3. 状态流转: `waiting` → `scanned` → `ready` (获取到Code)
4. Code获取后 → 显示备注输入、节点选择、创建按钮
5. 创建账号 → 调用 `/api/accounts` POST

```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const toast = useToastStore()
const userStore = useUserStore()

// 状态管理
const qrStatus = ref<'idle' | 'starting' | 'waiting' | 'scanned' | 'ready' | 'error'>('idle')
const qrUuid = ref('')
const qrImageUrl = ref('')
const farmCode = ref('')
const openId = ref('')
const errorMsg = ref('')
const note = ref('')
const autoStart = ref(true)
const creating = ref(false)
const nodes = ref<any[]>([])
const selectedNode = ref('')
const loadingNodes = ref(false)

let pollTimer: ReturnType<typeof setInterval> | null = null

async function createQR() {
  qrStatus.value = 'starting'
  errorMsg.value = ''
  try {
    const res = await api.post('/api/wx-qr/create')
    const data = res.data?.data
    qrUuid.value = data.uuid
    qrImageUrl.value = data.qrImageUrl
    qrStatus.value = 'waiting'
    startPolling()
  } catch (e: any) {
    errorMsg.value = e.response?.data?.error || '生成二维码失败'
    qrStatus.value = 'error'
  }
}

function startPolling() {
  stopPolling()
  pollTimer = setInterval(checkStatus, 2000)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function checkStatus() {
  if (!qrUuid.value) return
  try {
    const res = await api.post('/api/wx-qr/check', { code: qrUuid.value })
    const data = res.data?.data
    const status = String(data?.status || '').toLowerCase()
    
    if (status === 'ok' && data?.code) {
      farmCode.value = data.code
      openId.value = data.openId || ''
      qrStatus.value = 'ready'
      stopPolling()
      toast.success('微信扫码成功，Code 已获取')
      return
    }
    if (status === 'scanned') {
      qrStatus.value = 'scanned'
    }
  } catch {
    // continue polling
  }
}

async function createAccount() {
  if (!farmCode.value) { toast.warning('请先完成微信扫码'); return }
  creating.value = true
  try {
    const res = await api.post('/api/accounts', {
      name: note.value.trim(),
      code: farmCode.value,
      platform: 'wx',
      openId: openId.value || undefined,
      loginType: 'qr',
      nodeId: selectedNode.value || undefined,
      autoStart: autoStart.value,
    })
    if (res.data?.ok) {
      toast.success('微信账号已创建' + (autoStart.value ? '，正在启动' : ''))
      resetForm()
      router.push('/accounts')
    } else {
      toast.error(res.data?.error || '创建失败')
    }
  } catch (e: any) {
    toast.error(e.response?.data?.error || e.message || '创建失败')
  } finally {
    creating.value = false
  }
}

function resetForm() {
  stopPolling()
  if (qrUuid.value) api.post('/api/wx-qr/reset', { code: qrUuid.value }).catch(() => {})
  qrStatus.value = 'idle'
  qrUuid.value = ''
  qrImageUrl.value = ''
  farmCode.value = ''
  openId.value = ''
  note.value = ''
}

async function loadNodes() {
  loadingNodes.value = true
  try {
    const res = await api.get('/api/nodes/available')
    if (res.data?.ok && res.data?.data?.length > 0) {
      nodes.value = res.data.data
      const recommended = nodes.value.find(n => n.recommended)
      if (recommended) selectedNode.value = recommended.nodeId
    }
  } catch {} finally { loadingNodes.value = false }
}

onMounted(() => { loadNodes() })
onUnmounted(() => { stopPolling() })

const statusText = computed(() => {
  switch (qrStatus.value) {
    case 'starting': return '正在生成二维码...'
    case 'waiting': return '等待微信扫码...'
    case 'scanned': return '已扫码，等待确认...'
    case 'ready': return '扫码成功，Code 已获取'
    case 'error': return '扫码失败'
    default: return '未开始'
  }
})
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-6">
    <PageHeader title="微信扫码添加账号" subtitle="通过微信扫码快速添加农场账号" />
    
    <div class="card p-5">
      <div class="mb-4 flex items-center justify-between gap-3">
        <h2 class="text-lg font-semibold">微信扫码</h2>
        <span class="rounded-full bg-green-500/10 px-2 py-1 text-xs text-green-600">微信</span>
      </div>
      
      <!-- idle/starting/error -->
      <div v-if="qrStatus === 'idle' || qrStatus === 'starting' || qrStatus === 'error'" class="space-y-3">
        <BaseButton variant="primary" :loading="qrStatus === 'starting'" @click="createQR">
          生成二维码
        </BaseButton>
        <p v-if="errorMsg" class="text-sm text-red-500">{{ errorMsg }}</p>
      </div>
      
      <!-- waiting/scanned -->
      <div v-else-if="qrStatus === 'waiting' || qrStatus === 'scanned'" class="space-y-4">
        <div class="flex flex-col items-center gap-3">
          <img :src="qrImageUrl" alt="微信扫码二维码" class="h-56 w-56 rounded-lg bg-white object-contain p-2" />
          <div class="flex items-center gap-2 text-sm text-foreground-muted">
            <span class="inline-block h-2 w-2 animate-pulse rounded-full bg-green-500"></span>
            <span>{{ statusText }}</span>
          </div>
        </div>
        <BaseButton variant="outline" @click="resetForm">取消扫码</BaseButton>
      </div>
      
      <!-- ready -->
      <div v-else-if="qrStatus === 'ready'" class="space-y-3">
        <div class="rounded-lg border border-green-500/30 bg-green-50 p-4 dark:bg-green-900/20">
          <p class="text-sm font-medium text-green-700 dark:text-green-300">Code 已获取</p>
          <code class="mt-1 block break-all text-xs text-foreground-muted">{{ farmCode.slice(0, 40) }}...</code>
        </div>
        <BaseInput v-model="note" label="备注名称" placeholder="例如：微信大号" />
        <BaseButton variant="primary" :loading="creating" @click="createAccount">创建微信账号</BaseButton>
        <BaseButton variant="outline" @click="resetForm">重新扫码</BaseButton>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add web/src/views/WechatAccounts.vue
git commit -m "feat: add WechatAccounts page with QR scan flow"
```

---

### Task 6: 前端 — 新增 CaptureAddAccount.vue（抓包添加页面）

**Files:**
- Create: `web/src/views/CaptureAddAccount.vue`

**Interfaces:**
- Consumes: `/api/capture-proxy/info`, `/api/capture-proxy/start`, `/api/capture-proxy/status`, `/api/capture-proxy/stop`, `/api/capture-proxy/cert`
- Produces: 抓包添加和手动Code输入UI

- [ ] **Step 1: 创建 CaptureAddAccount.vue**

```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { useToastStore } from '@/stores/toast'

const router = useRouter()
const toast = useToastStore()

// 抓包状态
const clientType = ref<'qq' | 'wx'>('qq')
const captureEnabled = ref(false)
const captureStatus = ref<'idle' | 'starting' | 'waiting' | 'ready' | 'error'>('idle')
const sessionId = ref('')
const proxyHost = ref('')
const proxyPort = ref(0)
const captureCode = ref('')
const captureFriends = ref<string[]>([])
const errorMsg = ref('')
const note = ref('')
const autoStart = ref(true)
const creating = ref(false)
const downloading = ref(false)

// 手动输入
const manualCode = ref('')
const manualNote = ref('')
const manualPlatform = ref('qq')
const manualCreating = ref(false)

let pollTimer: ReturnType<typeof setInterval> | null = null

async function checkCaptureEnabled() {
  try {
    const res = await api.get('/api/capture-proxy/info')
    captureEnabled.value = !!res.data?.data?.enabled
  } catch { captureEnabled.value = false }
}

async function startCapture() {
  captureStatus.value = 'starting'
  errorMsg.value = ''
  try {
    const res = await api.post('/api/capture-proxy/start', { clientType: clientType.value })
    const data = res.data?.data
    sessionId.value = data.sessionId
    proxyHost.value = data.bindUrlHttp || window.location.hostname
    proxyPort.value = data.port || 8899
    captureStatus.value = 'waiting'
    startPolling()
  } catch (e: any) {
    errorMsg.value = e.response?.data?.error || '启动抓包失败'
    captureStatus.value = 'error'
  }
}

function startPolling() {
  stopPolling()
  pollTimer = setInterval(checkCaptureStatus, 2000)
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

async function checkCaptureStatus() {
  if (!sessionId.value) return
  try {
    const res = await api.get('/api/capture-proxy/status', { params: { sessionId: sessionId.value } })
    const data = res.data?.data
    if (data?.code) {
      captureCode.value = data.code
      if (data.friends?.length) captureFriends.value = data.friends
      captureStatus.value = 'ready'
      stopPolling()
      toast.success('抓包成功！Code 已获取')
    }
  } catch {}
}

function stopCapture() {
  stopPolling()
  if (sessionId.value) api.post('/api/capture-proxy/stop', { sessionId: sessionId.value }).catch(() => {})
  captureStatus.value = 'idle'
  sessionId.value = ''
  captureCode.value = ''
  captureFriends.value = []
}

async function downloadCert() {
  downloading.value = true
  try {
    const res = await api.get('/api/capture-proxy/cert', { responseType: 'blob' })
    const blob = new Blob([res.data], { type: res.headers['content-type'] || 'application/x-x509-ca-cert' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'mitmproxy-ca.cer'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    toast.success('证书已开始下载')
  } catch (e: any) {
    toast.error(e.response?.data?.error || '证书下载失败')
  } finally { downloading.value = false }
}

async function createFromCapture() {
  if (!captureCode.value) { toast.warning('请先完成抓包'); return }
  creating.value = true
  try {
    const res = await api.post('/api/accounts', {
      name: note.value.trim(),
      code: captureCode.value,
      platform: clientType.value === 'wx' ? 'wx' : 'qq',
      loginType: 'manual',
      autoStart: autoStart.value,
    })
    if (res.data?.ok) {
      toast.success('账号已创建' + (autoStart.value ? '，正在启动' : ''))
      stopCapture()
      router.push('/accounts')
    } else toast.error(res.data?.error || '创建失败')
  } catch (e: any) {
    toast.error(e.response?.data?.error || '创建失败')
  } finally { creating.value = false }
}

async function createManual() {
  if (!manualCode.value) { toast.warning('请先填写 Code'); return }
  manualCreating.value = true
  try {
    const res = await api.post('/api/accounts', {
      name: manualNote.value.trim(),
      code: manualCode.value,
      platform: manualPlatform.value,
      loginType: 'manual',
      autoStart: autoStart.value,
    })
    if (res.data?.ok) {
      toast.success('账号已创建' + (autoStart.value ? '，正在启动' : ''))
      manualCode.value = ''
      manualNote.value = ''
      router.push('/accounts')
    } else toast.error(res.data?.error || '创建失败')
  } catch (e: any) {
    toast.error(e.response?.data?.error || '创建失败')
  } finally { manualCreating.value = false }
}

onMounted(() => { checkCaptureEnabled() })
onUnmounted(() => { stopPolling() })
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-6">
    <PageHeader title="抓包添加账号" subtitle="通过手机代理抓包或手动填写 Code 添加账号" />
    
    <!-- 抓包区域 -->
    <div v-if="captureEnabled" class="card p-5">
      <h2 class="mb-3 text-lg font-semibold">手机代理抓包</h2>
      <div class="mb-3 rounded-lg border border-blue-200/60 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-700/40 dark:bg-blue-900/20 dark:text-blue-200">
        <ol class="list-decimal pl-4 text-xs space-y-1">
          <li>选择客户端类型（QQ/微信）</li>
          <li>点击「开始抓包」获取代理地址</li>
          <li>手机 WiFi 设置 HTTP 代理</li>
          <li>下载安装 CA 证书</li>
          <li>打开小程序进入农场，自动捕获 Code</li>
        </ol>
      </div>
      
      <!-- idle/error -->
      <div v-if="captureStatus === 'idle' || captureStatus === 'error'" class="space-y-3">
        <div class="flex gap-3">
          <label class="flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2" :class="clientType === 'qq' ? 'border-blue-500 bg-blue-500/10' : 'border-border-subtle'">
            <input v-model="clientType" type="radio" value="qq" /> QQ小程序
          </label>
          <label class="flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2" :class="clientType === 'wx' ? 'border-blue-500 bg-blue-500/10' : 'border-border-subtle'">
            <input v-model="clientType" type="radio" value="wx" /> 微信小程序
          </label>
        </div>
        <BaseButton variant="primary" :loading="captureStatus === 'starting'" @click="startCapture">开始抓包</BaseButton>
        <p v-if="errorMsg" class="text-sm text-red-500">{{ errorMsg }}</p>
      </div>
      
      <!-- waiting -->
      <div v-if="captureStatus === 'waiting'" class="space-y-3">
        <div class="rounded-lg border divide-y">
          <div class="flex items-center justify-between px-4 py-3">
            <span class="text-sm text-foreground-muted">代理服务器</span>
            <code class="text-sm font-mono">{{ proxyHost }}:{{ proxyPort }}</code>
          </div>
        </div>
        <div class="flex items-center gap-2 py-2">
          <span class="inline-block h-2 w-2 animate-pulse rounded-full bg-green-500"></span>
          <span class="text-sm text-foreground-muted">等待抓包中…</span>
        </div>
        <BaseButton variant="outline" @click="stopCapture">停止抓包</BaseButton>
      </div>
      
      <!-- ready -->
      <div v-if="captureStatus === 'ready'" class="space-y-3">
        <div class="rounded-lg border border-green-500/30 bg-green-50 p-4 dark:bg-green-900/20">
          <p class="text-sm font-medium text-green-700 dark:text-green-300">抓包成功！Code 已获取</p>
          <code class="mt-1 block break-all text-xs text-foreground-muted">{{ captureCode.slice(0, 40) }}...</code>
        </div>
        <BaseInput v-model="note" label="备注名称" placeholder="例如：QQ大号" />
        <label class="flex items-center gap-2 text-sm">
          <input v-model="autoStart" type="checkbox" /> 创建后立即启动
        </label>
        <div class="flex gap-2">
          <BaseButton variant="primary" :loading="creating" @click="createFromCapture">创建账号</BaseButton>
          <BaseButton variant="outline" @click="stopCapture">重新抓包</BaseButton>
        </div>
      </div>
    </div>
    
    <!-- 手动输入区域 -->
    <div class="card p-5">
      <h2 class="mb-3 text-lg font-semibold">手动填写 Code</h2>
      <div class="space-y-3">
        <BaseInput v-model="manualCode" label="Code" placeholder="粘贴登录 Code" />
        <BaseInput v-model="manualNote" label="备注名称" placeholder="例如：大号" />
        <BaseSelect v-model="manualPlatform" label="平台" :options="[
          { label: 'QQ小程序', value: 'qq' },
          { label: '微信小程序', value: 'wx' }
        ]" />
        <label class="flex items-center gap-2 text-sm">
          <input v-model="autoStart" type="checkbox" /> 创建后立即启动
        </label>
        <BaseButton variant="primary" :loading="manualCreating" @click="createManual">创建账号</BaseButton>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add web/src/views/CaptureAddAccount.vue
git commit -m "feat: add CaptureAddAccount page with proxy capture and manual code entry"
```

---

### Task 7: 前端 — 更新路由和菜单

**Files:**
- Modify: `web/src/router/index.ts`
- Modify: `web/src/router/menu.ts`

**Interfaces:**
- Consumes: 现有路由结构
- Produces: 新增 wechat 和 capture 路由

- [ ] **Step 1: 添加新页面到路由**

在 `menu.ts` 中添加：
```typescript
{
  path: 'wechat',
  name: 'wechatAccounts',
  label: '微信扫码',
  icon: 'i-carbon-qr-code',
  component: () => import('@/views/WechatAccounts.vue'),
},
{
  path: 'capture',
  name: 'captureAdd',
  label: '抓包添加',
  icon: 'i-carbon-network-4',
  component: () => import('@/views/CaptureAddAccount.vue'),
},
```

- [ ] **Step 2: Commit**

```bash
git add web/src/router/menu.ts
git commit -m "feat: add wechat and capture routes to menu"
```

---

### Task 8: 前端 — 改造 Accounts.vue（卡片列表+分页）

**Files:**
- Modify: `web/src/views/Accounts.vue`

**Interfaces:**
- Consumes: `/api/accounts` (带分页), `/api/accounts/:id/start`, `/api/accounts/:id/stop`
- Produces: 卡片式账号列表UI

- [ ] **Step 1: 改造 Accounts.vue 使用分页API**

修改 `store/account.ts` 中添加分页参数：
```typescript
const page = ref(1)
const limit = ref(50)
const total = ref(0)
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / limit.value)))

async function fetchAccounts() {
  loading.value = true
  try {
    const res = await api.get('/api/accounts', {
      params: { page: page.value, limit: limit.value, keyword: keyword.value || undefined }
    })
    if (res.data.ok) {
      accounts.value = res.data.data.accounts
      total.value = res.data.data.total
      stats.value = res.data.data.stats || { running: 0, stopped: 0 }
    }
  } catch {} finally { loading.value = false }
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/views/Accounts.vue web/src/stores/account.ts
git commit -m "feat: enhance accounts page with pagination and card-style layout"
```

---

### Task 9: 前端 — 改造 AccountModal.vue

**Files:**
- Modify: `web/src/components/AccountModal.vue`

**Interfaces:**
- Consumes: `/api/accounts` POST/PUT
- Produces: 添加/编辑账号弹窗

- [ ] **Step 1: 改造模态框支持 Code 输入和平台选择**

保持现有基本结构，添加：
1. Code 输入框（自动提取URL中的code参数）
2. 平台选择（QQ小程序/微信小程序）
3. 错误提示显示
4. 节点选择

- [ ] **Step 2: Commit**

```bash
git add web/src/components/AccountModal.vue
git commit -m "feat: enhance AccountModal with platform selection and code extraction"
```

---

### Task 10: 前端 — 改造 Dashboard.vue

**Files:**
- Modify: `web/src/views/Dashboard.vue`

**Interfaces:**
- Consumes: 现有 `/api/status`, `/api/account-logs`
- Produces: 实时状态+操作统计+日志面板

- [ ] **Step 1: 改造为实时日志面板风格**

添加日志筛选（模块/事件/关键词/等级）、实时跟随、日志展开等目标站功能。

- [ ] **Step 2: Commit**

```bash
git add web/src/views/Dashboard.vue
git commit -m "feat: enhance Dashboard with log filtering and real-time status"
```

---

## 验收标准

1. ✅ 用户可用邀请码注册新账号
2. ✅ 管理员可创建/管理邀请码
3. ✅ 登录后可看到带分页的账号列表
4. ✅ 可通过"微信扫码"添加账号（生成二维码→扫码→获Code→创建）
5. ✅ 可通过"抓包添加"启动代理→手机配代理→自动捕获Code
6. ✅ 可手动粘贴Code创建账号
7. ✅ 新添加的账号可启动/停止（复用现有农场引擎）
8. ✅ Dashboard显示账号实时状态和运行日志
