const crypto = require('node:crypto');
/**
 * 管理面板 HTTP 服务
 * 改写为接收 DataProvider 模式
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const process = require('node:process');
const express = require('express');
const fetch = require('node-fetch');
const { Server: SocketIOServer } = require('socket.io');
const { version } = require('../../package.json');
const { CONFIG } = require('../config/config');
const { getLevelExpProgress } = require('../config/gameConfig');
const { getResourcePath, getDataFile } = require('../config/runtime-paths');
const store = require('../models/store');
const { addOrUpdateAccount, deleteAccount } = store;
const { findAccountByRef, normalizeAccountRef, resolveAccountId } = require('../services/account-resolver');
const { createModuleLogger } = require('../services/logger');
const { getSchedulerRegistrySnapshot } = require('../services/scheduler');
const { OauthService } = require('../services/oauth');
const { fetchProfileByCode } = require('../services/manual-login-profile');
const { MiniProgramLoginSession } = require('../services/qrlogin');
const phoneCapture = require('../services/phone-capture');
const userStore = require('../models/user-store');

const hashPassword = (pwd) => crypto.createHash('sha256').update(String(pwd || '')).digest('hex');
const adminLogger = createModuleLogger('admin');

let app = null;
let server = null;
let provider = null; // DataProvider
let io = null;

function emitRealtimeStatus(accountId, status) {
    if (!io) return;
    const id = String(accountId || '').trim();
    if (!id) return;

    // 推送到特定账号房间（只有订阅了该账号的用户能收到）
    io.to(`account:${id}`).emit('status:update', { accountId: id, status });
}

function emitRealtimeLog(entry) {
    if (!io) return;
    const payload = (entry && typeof entry === 'object') ? entry : {};
    const id = String(payload.accountId || '').trim();

    // 如果没有指定账号ID，不推送给任何人（防止数据泄露）
    if (!id) return;

    // 推送到特定账号房间（只有订阅了该账号的用户能收到）
    io.to(`account:${id}`).emit('log:new', payload);
}

function emitRealtimeAccountLog(entry) {
    if (!io) return;
    const payload = (entry && typeof entry === 'object') ? entry : {};
    const id = String(payload.accountId || '').trim();

    // 如果没有指定账号ID，不推送给任何人（防止数据泄露）
    if (!id) return;

    // 推送到特定账号房间（只有订阅了该账号的用户能收到）
    io.to(`account:${id}`).emit('account-log:new', payload);
}

function startAdminServer(dataProvider) {
    if (app) return;
    provider = dataProvider;

    app = express();
    app.use(express.json({ limit: '5mb' }));

    const tokens = new Set();

    const issueToken = () => crypto.randomBytes(24).toString('hex');
    const authRequired = (req, res, next) => {
        const token = req.headers['x-admin-token'];
        if (!token || !tokens.has(token)) {
            return res.status(401).json({ ok: false, error: 'Unauthorized' });
        }
        req.adminToken = token;
        req.currentUser = tokenUserMap.get(token);

        // 管理员不检查封禁和过期
        if (req.currentUser && req.currentUser.role !== 'admin') {
            // 检查用户状态（每次请求都检查）
            if (req.currentUser.card) {
                // 检查是否被封禁
                if (req.currentUser.card.enabled === false) {
                    console.log('[请求拒绝] 用户已被封禁:', req.currentUser.username);
                    tokens.delete(token);
                    tokenUserMap.delete(token);
                    return res.status(403).json({ ok: false, error: '账号已被封禁，请联系管理员' });
                }

                // 检查是否过期
                if (req.currentUser.card.expiresAt) {
                    const now = Date.now();
                    if (req.currentUser.card.expiresAt < now) {
                        console.log('[请求拒绝] 用户已过期:', req.currentUser.username);
                        tokens.delete(token);
                        tokenUserMap.delete(token);
                        return res.status(403).json({ ok: false, error: '账号已过期，请续费后重新登录' });
                    }
                }
            }
        }

        next();
    };

    app.use((req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, x-account-id, x-admin-token, x-proxy-api-key, x-proxy-api-url, x-proxy-app-id');
        if (req.method === 'OPTIONS') return res.sendStatus(200);
        next();
    });

    const webDist = path.join(__dirname, '../../../web/dist');
    if (fs.existsSync(webDist)) {
        app.use(express.static(webDist));
    } else {
        adminLogger.warn('web build not found', { webDist });
        app.get('/', (req, res) => res.send('web build not found. Please build the web project.'));
    }
    app.use('/game-config', express.static(getResourcePath('gameConfig')));

    // Token 到用户映射（用于用户系统）
    const tokenUserMap = new Map();

    // 检查用户是否有权访问（管理员或普通用户）
    const checkUserAccess = (req, res, next) => {
        const token = req.headers['x-admin-token'];
        if (!token || !tokens.has(token)) {
            return res.status(401).json({ ok: false, error: 'Unauthorized' });
        }
        req.adminToken = token;
        req.currentUser = tokenUserMap.get(token);

        // 管理员不检查封禁和过期
        if (req.currentUser && req.currentUser.role !== 'admin') {
            // 检查用户状态（每次请求都检查）
            if (req.currentUser.card) {
                // 检查是否被封禁
                if (req.currentUser.card.enabled === false) {
                    console.log('[请求拒绝] 用户已被封禁:', req.currentUser.username);
                    tokens.delete(token);
                    tokenUserMap.delete(token);
                    return res.status(403).json({ ok: false, error: '账号已被封禁，请联系管理员' });
                }

                // 检查是否过期
                if (req.currentUser.card.expiresAt) {
                    const now = Date.now();
                    if (req.currentUser.card.expiresAt < now) {
                        console.log('[请求拒绝] 用户已过期:', req.currentUser.username);
                        tokens.delete(token);
                        tokenUserMap.delete(token);
                        return res.status(403).json({ ok: false, error: '账号已过期，请续费后重新登录' });
                    }
                }
            }
        }

        next();
    };

    // 定期清理过期用户（每5分钟检查一次）
    const cleanupExpiredUsers = () => {
        const now = Date.now();
        const usersToCleanup = [];

        for (const [token, user] of tokenUserMap.entries()) {
            if (user.role === 'admin') continue; // 管理员不检查

            // 检查是否被封禁
            if (user.card && user.card.enabled === false) {
                console.log(`[自动检查] 用户 ${user.username} 已被封禁，执行清理...`);
                usersToCleanup.push({ token, username: user.username, reason: 'banned' });
                continue;
            }

            // 检查是否过期
            if (user.card && user.card.expiresAt && user.card.expiresAt < now) {
                console.log(`[自动检查] 用户 ${user.username} 已过期，执行清理...`);
                usersToCleanup.push({ token, username: user.username, reason: 'expired' });
            }
        }

        for (const { token, username, reason } of usersToCleanup) {
            tokens.delete(token);
            tokenUserMap.delete(token);
            // 断开相关 socket 连接
            if (io) {
                for (const socket of io.sockets.sockets.values()) {
                    if (String(socket.data.adminToken || '') === String(token)) {
                        socket.disconnect(true);
                    }
                }
            }
            console.log(`[自动清理] 用户 ${username} 已${reason === 'banned' ? '被封禁' : '过期'}，已强制下线`);
        }
    };

    // 启动定期清理
    setInterval(cleanupExpiredUsers, 5 * 60 * 1000); // 每5分钟检查一次

    // 登录与鉴权
    app.post('/api/login', (req, res) => {
        const { username, password } = req.body || {};

        // 如果提供了用户名，使用用户系统登录
        if (username && password) {
            const user = userStore.validateUser(username, password);
            if (!user) {
                return res.status(401).json({ ok: false, error: '用户名或密码错误' });
            }

            console.log('[登录检查] 用户:', username, '角色:', user.role, '卡密信息:', user.card);

            // 管理员不检查封禁和过期
            if (user.role !== 'admin') {
                // 检查用户是否被封禁
                if (user.card && user.card.enabled === false) {
                    console.log('[登录拒绝] 用户已被封禁:', username);
                    return res.status(403).json({ ok: false, error: '账号已被封禁，请联系管理员' });
                }

                // 检查是否过期（仅对非永久卡）
                if (user.card && user.card.expiresAt) {
                    const now = Date.now();
                    if (user.card.expiresAt < now) {
                        console.log('[登录拒绝] 用户已过期:', username);
                        return res.status(403).json({ ok: false, error: '账号已过期，请续费后重新登录' });
                    }
                }
            }

            const token = issueToken();
            tokens.add(token);
            tokenUserMap.set(token, user);
            console.log('[登录成功]', username, '角色:', user.role);
            return res.json({ ok: true, data: { token, role: user.role, card: user.card, user: { username: user.username } } });
        }

        // 兼容旧版：仅密码登录（管理员）
        const input = String(password || '');
        const storedHash = store.getAdminPasswordHash ? store.getAdminPasswordHash() : '';
        let ok = false;
        if (storedHash) {
            ok = hashPassword(input) === storedHash;
        } else {
            ok = input === String(CONFIG.adminPassword || '');
        }
        if (!ok) {
            return res.status(401).json({ ok: false, error: 'Invalid password' });
        }
        const token = issueToken();
        tokens.add(token);
        // 旧版登录也创建用户对象（管理员）
        const adminUser = { username: 'admin', role: 'admin', card: null };
        tokenUserMap.set(token, adminUser);
        res.json({ ok: true, data: { token, role: 'admin', card: null, user: { username: 'admin' } } });
    });

    // 注册接口（支持邀请码/卡密）
    app.post('/api/register', (req, res) => {
        const { username, password, inviteCode, cardCode } = req.body || {};
        const code = inviteCode || cardCode;
        if (!username || !password || !code) {
            return res.status(400).json({ ok: false, error: '请填写完整信息（用户名、密码、邀请码/卡密）' });
        }
        const result = userStore.registerUser(username, password, code);
        if (!result.ok) {
            return res.status(400).json(result);
        }
        res.json({ ok: true, data: result.user });
    });

    // OAuth 登录接口 - 获取登录跳转URL
    app.post('/api/oauth/login', async (req, res) => {
        const { type } = req.body || {};
        if (!type) {
            return res.status(400).json({ ok: false, error: '请提供登录类型' });
        }

        const oauthConfig = store.getOAuthConfig();

        if (!oauthConfig.enabled) {
            return res.status(400).json({ ok: false, error: 'OAuth登录未启用' });
        }

        const apiUrl = oauthConfig.apiUrl;
        const appId = oauthConfig.appId;
        const appKey = oauthConfig.appKey;

        if (!apiUrl || !appId || !appKey) {
            return res.status(500).json({ ok: false, error: 'OAuth配置不完整，请联系管理员' });
        }

        const protocol = req.protocol;
        const host = req.get('host');
        const callbackBaseUrl = String(oauthConfig.callbackBaseUrl || '').trim().replace(/\/+$/, '');
        const callbackUrl = `${callbackBaseUrl || `${protocol}://${host}`}/api/oauth/callback`;

        const oauth = new OauthService(apiUrl, appId, appKey, callbackUrl);
        const result = await oauth.login(type);

        if (result.code === 0 && result.url) {
            res.json({ ok: true, data: { url: result.url } });
        } else {
            res.status(400).json({ ok: false, error: result.msg || '获取登录链接失败' });
        }
    });

    // ============ OAuth 扫码登录（通过u.daib.cn等聚合登录平台） ============
    const OAUTH_QR_FILE = getDataFile('oauth-qr-sessions.json');

    function loadOAuthQrSessions() {
        try {
            if (fs.existsSync(OAUTH_QR_FILE)) {
                const raw = JSON.parse(fs.readFileSync(OAUTH_QR_FILE, 'utf8'));
                return new Map(Object.entries(raw));
            }
        } catch (e) {
            adminLogger.warn('load oauth qr sessions failed', { error: e.message });
        }
        return new Map();
    }

    function saveOAuthQrSessions(sessions) {
        try {
            const obj = Object.fromEntries(sessions);
            fs.writeFileSync(OAUTH_QR_FILE, JSON.stringify(obj), 'utf8');
        } catch (e) {
            adminLogger.warn('save oauth qr sessions failed', { error: e.message });
        }
    }

    let oauthQrSessions = loadOAuthQrSessions();

    // 生成OAuth二维码
    app.post('/api/oauth/qr-create', async (req, res) => {
        try {
            const { type } = req.body || {};
            const loginType = type || 'qq';

            const QRCode = require('qrcode');
            const sessionId = `oauth_qr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const protocol = req.protocol;
            const host = req.get('host');
            const oauthConfig = store.getOAuthConfig();

            // 确定回调地址：优先用配置的，其次用请求host
            const callbackBaseUrl = String(oauthConfig.callbackBaseUrl || '').trim().replace(/\/+$/, '');
            const publicUrl = callbackBaseUrl || `${protocol}://${host}`;
            const callbackUrl = `${publicUrl}/api/oauth/callback?qrSession=${sessionId}&type=${loginType}`;

            let oauthUrl;
            if (oauthConfig.enabled && oauthConfig.apiUrl && oauthConfig.appId && oauthConfig.appKey) {
                // 使用配置的OAuth服务
                const oauth = new OauthService(oauthConfig.apiUrl, oauthConfig.appId, oauthConfig.appKey, callbackUrl);
                const result = await oauth.login(loginType);
                if (result.code !== 0 || !result.url) {
                    return res.status(500).json({ ok: false, error: result.msg || '获取登录链接失败' });
                }
                oauthUrl = result.url;
            } else {
                // 默认使用 u.daib.cn 配置
                oauthUrl = `https://u.daib.cn/connect.php?act=login&appid=2637&appkey=2d0b86a212509b1708ccd64ecfcd8452&type=${loginType}&redirect_uri=${encodeURIComponent(callbackUrl)}`;
            }

            // 保存session到文件
            oauthQrSessions.set(sessionId, {
                status: 'waiting',
                socialUid: '',
                nickname: '',
                platform: loginType,
                callbackUrl: callbackUrl,
                createdAt: Date.now()
            });
            saveOAuthQrSessions(oauthQrSessions);

            // 生成二维码
            const qrDataUrl = await QRCode.toDataURL(oauthUrl, { width: 300, margin: 1, errorCorrectionLevel: 'M' });

            res.json({
                ok: true,
                data: {
                    uuid: sessionId,
                    qrImageUrl: qrDataUrl,
                    platform: loginType,
                    expiresIn: 300,
                    callbackHost: publicUrl,
                }
            });
        } catch (e) {
            adminLogger.warn('oauth qr create failed', { error: e.message });
            res.status(500).json({ ok: false, error: `生成二维码失败: ${e.message}` });
        }
    });

    // 轮询OAuth扫码状态
    app.post('/api/oauth/qr-status', (req, res) => {
        try {
            const { code } = req.body || {};
            if (!code) return res.status(400).json({ ok: false, error: 'Missing code' });

            oauthQrSessions = loadOAuthQrSessions();
            const session = oauthQrSessions.get(code);

            if (!session) {
                return res.json({ ok: true, data: { status: 'wait', ok: 0 } });
            }

            if (session.status === 'ok' && session.socialUid) {
                // 扫码成功，返回身份信息
                return res.json({
                    ok: true,
                    data: {
                        status: 'ok',
                        socialUid: session.socialUid,
                        nickname: session.nickname,
                        ok: 1
                    }
                });
            }

            if (session.status === 'error') {
                return res.json({
                    ok: true,
                    data: { status: 'error', error: session.error || '授权失败', ok: 0 }
                });
            }

            res.json({ ok: true, data: { status: 'wait', ok: 0 } });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // OAuth 回调接口
    app.get('/api/oauth/callback', async (req, res) => {
        const { code, type, qrSession } = req.query;

        if (!code || !type) {
            return res.redirect('/login?error=invalid_callback');
        }

        // 尝试使用配置的OAuth，如果没有配置则使用硬编码的u.daib.cn
        let apiUrl, appId, appKey;
        const oauthConfig = store.getOAuthConfig();
        if (oauthConfig.enabled && oauthConfig.apiUrl && oauthConfig.appId && oauthConfig.appKey) {
            apiUrl = oauthConfig.apiUrl;
            appId = oauthConfig.appId;
            appKey = oauthConfig.appKey;
        } else {
            apiUrl = 'https://u.daib.cn/';
            appId = '2637';
            appKey = '2d0b86a212509b1708ccd64ecfcd8452';
        }

        const protocol = req.protocol;
        const host = req.get('host');
        const callbackBaseUrl = String(oauthConfig.callbackBaseUrl || (qrSession ? `${protocol}://${host}` : '')).trim().replace(/\/+$/, '');
        const callbackUrl = `${callbackBaseUrl || `${protocol}://${host}`}/api/oauth/callback${qrSession ? `?qrSession=${qrSession}` : ''}`;

        const oauth = new OauthService(apiUrl, appId, appKey, callbackUrl);
        const result = await oauth.callback(code, type);

        if (result.code === 0 && result.social_uid) {
            const { social_uid, nickname, faceimg } = result;

            // 如果是扫码session模式
            if (qrSession) {
                oauthQrSessions = loadOAuthQrSessions();
                if (oauthQrSessions.has(qrSession)) {
                    const session = oauthQrSessions.get(qrSession);
                    session.status = 'ok';
                    session.socialUid = social_uid;
                    session.nickname = nickname || (type === 'qq' ? 'QQ用户' : '微信用户');
                    session.faceimg = faceimg || '';
                    oauthQrSessions.set(qrSession, session);
                    saveOAuthQrSessions(oauthQrSessions);
                    adminLogger.info('oauth qr scan success', { type, social_uid, nickname });
                    return res.redirect(`/oauth-success?social_uid=${social_uid}&nickname=${encodeURIComponent(nickname || '')}`);
                }
            }

            const { user, isNew } = userStore.findOrCreateOAuthUser(type, social_uid, nickname, faceimg);

            const token = issueToken();
            tokens.add(token);
            tokenUserMap.set(token, user);

            adminLogger.info('oauth login success', {
                type,
                social_uid,
                username: user.username,
                isNew
            });

            const redirectUrl = `/login?oauth_token=${token}&oauth_user=${encodeURIComponent(JSON.stringify({
                username: user.username,
                role: user.role,
                card: user.card
            }))}`;
            res.redirect(redirectUrl);
        } else {
            res.redirect(`/login?error=${encodeURIComponent(result.msg || '登录失败')}`);
        }
    });

    // OAuth Token 登录接口
    app.post('/api/oauth/token-login', (req, res) => {
        const { token } = req.body || {};
        
        if (!token || !tokens.has(token)) {
            return res.status(401).json({ ok: false, error: '无效的登录凭证' });
        }

        const user = tokenUserMap.get(token);
        if (!user) {
            return res.status(401).json({ ok: false, error: '用户信息不存在' });
        }

        res.json({ 
            ok: true, 
            data: { 
                token, 
                role: user.role, 
                card: user.card, 
                user: { username: user.username } 
            } 
        });
    });

    // 用户续费接口
    app.post('/api/user/renew', checkUserAccess, (req, res) => {
        const { cardCode } = req.body || {};
        const username = req.currentUser?.username;

        if (!username) {
            return res.status(401).json({ ok: false, error: '未登录' });
        }

        if (!cardCode) {
            return res.status(400).json({ ok: false, error: '请提供卡密' });
        }

        const result = userStore.renewUser(username, cardCode);
        if (!result.ok) {
            return res.status(400).json(result);
        }

        // 更新 token 中的用户信息
        for (const [token, user] of tokenUserMap.entries()) {
            if (user.username === username) {
                user.card = result.card;
                tokenUserMap.set(token, user);
                break;
            }
        }

        const message = result.cardType === 'days' ? '续费成功' : '配额增加成功';
        res.json({ ok: true, data: result.card, cardType: result.cardType, message });
    });

    // 修改密码接口
    app.post('/api/user/change-password', checkUserAccess, (req, res) => {
        const { oldPassword, newPassword } = req.body || {};
        const username = req.currentUser?.username;

        if (!username) {
            return res.status(401).json({ ok: false, error: '未登录' });
        }

        if (!oldPassword || !newPassword) {
            return res.status(400).json({ ok: false, error: '请提供原密码和新密码' });
        }

        const result = userStore.changePassword(username, oldPassword, newPassword);
        res.json(result);
    });

    // ============ QQ 扫码登录 API ============
    app.post('/api/qr/create', async (req, res, next) => {
        if (process.env.FARM_DISABLE_WEB_QQ_QR === '1') return next();
        try {
            const data = await MiniProgramLoginSession.requestLoginCode();
            return res.json({ ok: true, data });
        } catch (e) {
            adminLogger.warn('qq qr create failed', { error: e.message });
            return res.status(500).json({ ok: false, error: `Get QQ QR code failed: ${e.message}` });
        }
    });

    app.post('/api/qr/check', async (req, res, next) => {
        if (process.env.FARM_DISABLE_WEB_QQ_QR === '1') return next();
        try {
            const { code } = req.body || {};
            if (!code) return res.status(400).json({ ok: false, error: 'Missing code' });
            const data = await MiniProgramLoginSession.queryStatus(String(code));
            return res.json({ ok: true, data });
        } catch (e) {
            adminLogger.warn('qq qr check failed', { error: e.message });
            return res.status(500).json({ ok: false, error: `Check QQ QR status failed: ${e.message}` });
        }
    });

    app.post('/api/qr/auth-code', async (req, res, next) => {
        if (process.env.FARM_DISABLE_WEB_QQ_QR === '1') return next();
        try {
            const { ticket, appid, uin: reqUin } = req.body || {};
            if (!ticket) return res.status(400).json({ ok: false, error: 'Missing ticket' });
            const result = await MiniProgramLoginSession.getAuthCodeResult(String(ticket), appid || '1112386029');
            // 即使code兑换失败（-3000），只要前端传了uin就返回成功
            if ((!result || !result.ok || !result.code) && reqUin) {
                return res.json({
                    ok: true,
                    data: { code: '', uin: String(reqUin), authOnly: true, error: (result && result.error) || 'QQ扫码验证成功但未返回农场code' }
                });
            }
            if (!result || !result.ok || !result.code) {
                return res.status(400).json({
                    ok: false,
                    error: (result && result.error) || 'QQ QR auth failed: no usable Farm code returned',
                    data: result || null,
                });
            }
            return res.json({ ok: true, data: { code: result.code } });
        } catch (e) {
            adminLogger.warn('qq qr auth-code failed', { error: e.message });
            return res.status(500).json({ ok: false, error: `Exchange QQ Farm code failed: ${e.message}` });
        }
    });

    const codeCaptureHandler = (req, res) => {
        try {
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const code = String(req.query.code || body.code || '').trim();
            const uin = String(body.uin || body.qq || req.query.uin || req.query.qq || '').trim();
            if (!code || /^-\d+$/.test(code)) {
                return res.status(400).json({ ok: false, error: 'Missing or invalid code' });
            }
            // 所有经过code-capture的Code都重定向到pending队列（多用户认领系统）
            pendingCodes.push({ code, uin, platform: 'qq', capturedAt: Date.now(), claimed: false });
            adminLogger.info('code-capture -> pending: 已重定向', { code: code.substring(0, 20), uin, pendingCount: pendingCodes.filter(c => !c.claimed).length });
            res.json({ ok: true, data: { redirected: true, message: 'Code已转入待认领队列' } });
        } catch (e) {
            adminLogger.error('code-capture failed', { error: e.message });
            res.status(500).json({ ok: false, error: e.message });
        }
    };
    app.get('/api/code-capture', codeCaptureHandler);
    app.post('/api/code-capture', codeCaptureHandler);

    // ============ 待认领Code（多用户抓包） ============
    const pendingCodes = [];

    // sniff9988发来的待认领Code（公开接口，支持GET+POST）
    function pendingCodeHandler(req, res) {
        try {
            const code = req.query.code || (req.body && req.body.code) || '';
            const uin = req.query.uin || (req.body && req.body.uin) || '';
            const platform = req.query.platform || (req.body && req.body.platform) || 'qq';
            if (!code || /^-\d+$/.test(code)) {
                adminLogger.warn('pending-code: 无效code', { code: code.substring(0, 20) });
                console.warn(`[capture-debug] ❌ 无效code: ${String(code || '').substring(0, 20)}`);
                return res.status(400).json({ ok: false, error: 'Missing or invalid code' });
            }
            pendingCodes.push({ code, uin, platform, capturedAt: Date.now(), claimed: false });
            adminLogger.info('pending-code: 收到待认领Code', { code: code.substring(0, 20), uin, platform, pendingCount: pendingCodes.filter(c => !c.claimed).length });
            console.log(`\n========================================`);
            console.log(`[capture-debug] ✅ 捕获到 Code!`);
            console.log(`[capture-debug]    code: ${code.substring(0, 30)}...`);
            console.log(`[capture-debug]    uin: ${uin || '(空)'}`);
            console.log(`[capture-debug]    platform: ${platform}`);
            console.log(`[capture-debug]    待认领队列: ${pendingCodes.filter(c => !c.claimed).length} 个`);
            console.log(`========================================\n`);
            addCaptureLog('pending-code', { code: code.substring(0, 20), uin, platform });
            res.json({ ok: true });
        } catch (e) {
            adminLogger.error('pending-code 异常', { error: e.message });
            console.error(`[capture-debug] ❌ pending-code 异常: ${e.message}`);
            res.status(500).json({ ok: false, error: e.message });
        }
    }
    app.get('/api/pending-code', pendingCodeHandler);
    app.post('/api/pending-code', pendingCodeHandler);

    // 当前用户认领一个待处理Code（需登录）- 注册在auth中间件之后
    // 实际注册在app.use('/api')之后
    function registerClaimRoute() {
        app.post('/api/pending-code/claim', (req, res) => {
            try {
                const currentUser = req.currentUser;
                if (!currentUser) {
                    adminLogger.warn('pending-code claim: 未登录');
                    return res.status(401).json({ ok: false, error: '未登录' });
                }

                adminLogger.info('pending-code claim: 用户查找待认领Code', { username: currentUser.username });
                const idx = pendingCodes.findIndex(c => !c.claimed);
                if (idx === -1) {
                    adminLogger.info('pending-code claim: 无待认领Code');
                    return res.json({ ok: true, data: null });
                }

                const item = pendingCodes[idx];
                item.claimed = true;
                item.claimedBy = currentUser.username;
                item.claimedAt = Date.now();
                adminLogger.info('pending-code claim: 认领成功', { username: currentUser.username, code: item.code.substring(0, 20) });

                while (pendingCodes.length > 50) pendingCodes.shift();
                res.json({ ok: true, data: { code: item.code } });
            } catch (e) {
                adminLogger.error('pending-code claim 异常', { error: e.message });
                res.status(500).json({ ok: false, error: e.message });
            }
        });
    }

    // ============ 系统日志 ============
    const CAPTURE_LOG_FILE = getDataFile('capture-system.log');

    function appendCaptureLog(message) {
        try {
            const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
            const line = `[${ts}] ${message}`;
            fs.appendFileSync(CAPTURE_LOG_FILE, line + '\n', 'utf8');
        } catch (_) {}
    }

    app.get('/api/system-logs', (req, res) => {
        try {
            // 仅管理员可查看系统日志
            const user = req.currentUser;
            if (!user || user.role !== 'admin') {
                return res.status(403).json({ ok: false, error: '仅管理员可查看系统日志' });
            }

            const lines = Number(req.query.lines) || 200;
            const keyword = String(req.query.keyword || '').trim().toLowerCase();
            let data = [];
            if (fs.existsSync(CAPTURE_LOG_FILE)) {
                const content = fs.readFileSync(CAPTURE_LOG_FILE, 'utf8');
                data = content.split('\n').filter(Boolean);
            }
            // 添加journal日志
            try {
                const execSync = require('child_process').execSync;
                const journal = execSync('journalctl -u qq-farm-bot --no-pager -n 100 2>/dev/null | grep -E "pending-code|code-capture|claim|TRACE" || true', { timeout: 3000 }).toString();
                if (journal.trim()) {
                    data = [...data, '--- journal ---', ...journal.trim().split('\n')];
                }
            } catch (_) {}
            if (keyword) data = data.filter(l => l.toLowerCase().includes(keyword));
            res.json({ ok: true, data: { lines: data.slice(-lines).reverse() } });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 用appendCaptureLog代替console日志
    const origInfo = adminLogger.info;
    adminLogger.info = function(msg, meta) {
        origInfo.call(adminLogger, msg, meta);
        if (msg.includes('pending-code') || msg.includes('code-capture') || msg.includes('TRACE') || msg.includes('claim')) {
            appendCaptureLog(`${msg} ${meta ? JSON.stringify(meta) : ''}`);
        }
    };

    app.use('/api', (req, res, next) => {
        if (req.path === '/pending-code') return next(); // 公开
        if (req.path === '/login' || req.path === '/register' || req.path === '/announcement' || req.path === '/ping' || req.path === '/qr/create' || req.path === '/qr/check' || req.path === '/qr/auth-code' || req.path === '/code-capture' || req.path === '/proxy' || req.path === '/oauth/login' || req.path === '/oauth/callback' || req.path === '/oauth/qr-create' || req.path === '/oauth/qr-status' || req.path === '/admin/oauth' || req.path === '/wx-qr/create' || req.path === '/wx-qr/check' || req.path === '/wx-qr/reset' || req.path === '/capture-proxy/info' || req.path === '/capture-proxy/cert' || req.path === '/nodes/available' || req.path === '/pc-capture/info' || req.path === '/pc-capture/download-patch' || req.path === '/pc-capture/download-ps1' || req.path === '/pc-capture/download-script' || (req.method === 'GET' && req.path.startsWith('/announcement'))) return next();
        return authRequired(req, res, next);
    });

    // claim路由必须在auth中间件之后注册，才能正确获取req.currentUser
    registerClaimRoute();

    // 管理员密码修改已移除，统一使用 /api/user/change-password 接口

    app.get('/api/ping', (req, res) => {
        res.json({ ok: true, data: { ok: true, uptime: process.uptime(), version } });
    });

    app.get('/api/auth/validate', (req, res) => {
        res.json({ ok: true, data: { valid: true } });
    });

    // ============ 公告 API ============
    // 获取公告列表（登录用户可见，自动标记已读）
    app.get('/api/announcement', (req, res) => {
        try {
            const data = store.getAnnouncements ? store.getAnnouncements() : { announcements: [] };
            const currentUser = req.currentUser;

            if (currentUser) {
                // 自动标记当前用户已读所有公告
                for (const ann of data.announcements) {
                    if (!ann.readBy.includes(currentUser.username)) {
                        store.markAnnouncementRead(ann.id, currentUser.username);
                    }
                }
            }

            // 管理员看到完整信息，普通用户不暴露 readBy 列表
            const isAdmin = currentUser && currentUser.role === 'admin';
            const list = data.announcements.map(a => ({
                id: a.id,
                title: a.title,
                content: a.content,
                createdAt: a.createdAt,
                createdBy: a.createdBy,
                ...(isAdmin ? { readBy: a.readBy || [] } : {}),
            }));

            // 按时间倒序（最新在前）
            list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

            res.json({ ok: true, data: { announcements: list } });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 管理员发布公告
    app.post('/api/announcement', authRequired, (req, res) => {
        try {
            if (req.currentUser.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可发布公告' });
            const { title, content } = req.body || {};
            const result = store.createAnnouncement ? store.createAnnouncement(title, content, req.currentUser.username) : { ok: false, error: '公告系统不可用' };
            if (!result.ok) return res.status(400).json(result);
            res.json(result);
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 获取未读公告数（登录用户）
    app.get('/api/announcement/unread', (req, res) => {
        try {
            if (!req.currentUser) return res.json({ ok: true, data: { unread: 0 } });
            const data = store.getAnnouncements ? store.getAnnouncements() : { announcements: [] };
            const username = req.currentUser.username;
            const unread = data.announcements.filter(a => !a.readBy.includes(username)).length;
            res.json({ ok: true, data: { unread } });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 管理员删除公告
    app.delete('/api/announcement/:id', authRequired, (req, res) => {
        try {
            if (req.currentUser.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可删除公告' });
            const result = store.deleteAnnouncement ? store.deleteAnnouncement(req.params.id) : { ok: false, error: '公告系统不可用' };
            if (!result.ok) return res.status(404).json(result);
            res.json(result);
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 管理员编辑公告
    app.put('/api/announcement/:id', authRequired, (req, res) => {
        try {
            if (req.currentUser.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可编辑公告' });
            const { title, content } = req.body || {};
            const result = store.updateAnnouncement ? store.updateAnnouncement(req.params.id, title, content) : { ok: false, error: '公告系统不可用' };
            if (!result.ok) return res.status(404).json(result);
            res.json(result);
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 管理员删除公告
    app.delete("/api/announcement/:id", authRequired, (req, res) => {
        try {
            if (req.currentUser.role !== "admin") return res.status(403).json({ ok: false, error: "仅管理员可删除公告" });
            const result = store.deleteAnnouncement ? store.deleteAnnouncement(req.params.id) : { ok: false, error: "公告系统不可用" };
            if (!result.ok) return res.status(404).json(result);
            res.json(result);
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ============ 微信扫码 API ============
    app.post('/api/wx-qr/create', async (req, res) => {
        try {
            const wxConfig = userStore.getWxConfig ? userStore.getWxConfig() : {};
            if (!wxConfig.appId) {
                const mockUuid = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                // 使用qrcode生成真实的二维码图片（指向本地的mock回调）
                const QRCode = require('qrcode');
                const callbackUrl = `http://localhost:${CONFIG.adminPort || 3000}/api/wx-qr/callback?code=${mockUuid}`;
                const qrDataUrl = await QRCode.toDataURL(callbackUrl, { width: 300, margin: 1, errorCorrectionLevel: 'M' });
                return res.json({ ok: true, data: { uuid: mockUuid, qrImageUrl: qrDataUrl, mock: true } });
            }
            const { appId, secret } = wxConfig;
            const tokenRes = await fetch(`https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${secret}`);
            const tokenData = await tokenRes.json();
            if (!tokenData.access_token) return res.status(500).json({ ok: false, error: '获取微信token失败' });
            const qrRes = await fetch('https://api.weixin.qq.com/cgi-bin/qrcode/create?access_token=' + tokenData.access_token, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ expire_seconds: 300, action_name: 'QR_STR_SCENE', action_info: { scene: { scene_str: `farm_${Date.now()}` } } })
            });
            const qrData = await qrRes.json();
            if (!qrData.ticket) return res.status(500).json({ ok: false, error: '创建微信二维码失败' });
            res.json({ ok: true, data: { uuid: qrData.ticket, qrImageUrl: `https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=${encodeURIComponent(qrData.ticket)}` } });
        } catch (e) {
            adminLogger.warn('wx qr create failed', { error: e.message });
            res.status(500).json({ ok: false, error: `创建微信二维码失败: ${e.message}` });
        }
    });

    app.post('/api/wx-qr/check', async (req, res) => {
        try {
            const { code } = req.body || {};
            if (!code) return res.status(400).json({ ok: false, error: 'Missing code' });
            if (String(code).startsWith('mock_')) {
                const sessions = phoneCapture.getWxQRSessions ? phoneCapture.getWxQRSessions() : {};
                const session = sessions[code];
                if (!session) {
                    if (phoneCapture.registerWxQRSession) phoneCapture.registerWxQRSession(code);
                    return res.json({ ok: true, data: { status: 'wait', ok: 0, mock: true } });
                }
                if (session.status === 'ok' && session.code) {
                    return res.json({ ok: true, data: { status: 'ok', code: session.code, openId: session.openId || '', mock: true } });
                }
                return res.json({ ok: true, data: { status: 'wait', ok: 0, mock: true } });
            }
            res.json({ ok: true, data: { status: 'wait', ok: 0 } });
        } catch (e) {
            adminLogger.warn('wx qr check failed', { error: e.message });
            res.status(500).json({ ok: false, error: `查询微信扫码状态失败: ${e.message}` });
        }
    });

    app.post('/api/wx-qr/reset', (req, res) => {
        try {
            const { code } = req.body || {};
            if (code && phoneCapture.unregisterWxQRSession) phoneCapture.unregisterWxQRSession(code);
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ============ 节点管理 API ============
    app.get('/api/nodes/available', (req, res) => {
        try {
            const nodes = [{ nodeId: 1, name: '默认节点', type: 'free', recommended: true, online: true, remainingSlots: 999, maxAccounts: 9999, globalUsed: 0, healthScore: 100, latencyMs: 0, pendingCommands: 0 }];
            if (store.getAllNodes) {
                const configuredNodes = store.getAllNodes();
                if (Array.isArray(configuredNodes) && configuredNodes.length > 0) { res.json({ ok: true, data: configuredNodes }); return; }
            }
            res.json({ ok: true, data: nodes });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    // ============ 抓包代理 API（增强） ============
    app.get('/api/capture-proxy/info', (req, res) => {
        try {
            const hasMitmdump = (() => { try { return !!require('child_process').spawnSync('mitmdump', ['--version']).stdout?.toString()?.trim(); } catch { return false; } })();
            res.json({ ok: true, data: { enabled: !!(process.env.FARM_PHONE_PROXY_PORT || hasMitmdump), port: process.env.FARM_PHONE_PROXY_PORT || 8899 } });
        } catch (e) { res.json({ ok: true, data: { enabled: false } }); }
    });

    app.get('/api/capture-proxy/cert', (req, res) => {
        try {
            const homeDir = require('os').homedir();
            const certPath = path.join(homeDir, '.mitmproxy', 'mitmproxy-ca-cert.pem');
            if (fs.existsSync(certPath)) return res.download(certPath, 'mitmproxy-ca.cer');
            const altPaths = ['/usr/local/share/mitmproxy/mitmproxy-ca-cert.pem', '/etc/mitmproxy/mitmproxy-ca-cert.pem', path.join(homeDir, '.local/share/mitmproxy/mitmproxy-ca-cert.pem')];
            for (const p of altPaths) { if (fs.existsSync(p)) return res.download(p, 'mitmproxy-ca.cer'); }
            return res.status(404).json({ ok: false, error: '证书文件未找到，请先安装 mitmproxy' });
        } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
    });

    // ============ QQ手机抓包API ============

    app.post('/api/qq-phone-capture/start', (req, res) => {
        try {
            const currentUser = req.currentUser || {};
            const username = String(currentUser.username || 'admin').trim() || 'admin';
            const accountName = String((req.body && req.body.name) || '').trim();
            const panelPort = CONFIG.adminPort || 3000;
            const data = phoneCapture.startCapture({
                username,
                accountName,
                panelApi: `http://127.0.0.1:${panelPort}/api/code-capture`,
                port: process.env.FARM_PHONE_PROXY_PORT || 8899,
            });
            return res.json({ ok: true, data });
        } catch (e) {
            return res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.get('/api/qq-phone-capture/status', (req, res) => {
        try {
            const currentUser = req.currentUser || {};
            const sessionId = String(req.query.sessionId || '').trim();
            const data = phoneCapture.getStatus(sessionId, String(currentUser.username || ''));
            return res.json({ ok: true, data: data || { status: 'idle', message: '未启动监听' } });
        } catch (e) {
            return res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.post('/api/qq-phone-capture/stop', (req, res) => {
        try {
            const sessionId = String((req.body && req.body.sessionId) || '').trim();
            const data = phoneCapture.stopCapture(sessionId);
            return res.json({ ok: true, data: data || { status: 'idle', message: '未启动监听' } });
        } catch (e) {
            return res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ============ PC抓码信息 API ============
    let pcCaptureInfoCache = { data: null, at: 0 };

    app.get('/api/pc-capture/info', async (req, res) => {
        try {
            // 缓存5分钟
            if (pcCaptureInfoCache.data && Date.now() - pcCaptureInfoCache.at < 300000) {
                return res.json({ ok: true, data: pcCaptureInfoCache.data });
            }

            // 1. 获取公网IP
            let publicIp = process.env.FARM_PUBLIC_IP || '';
            if (!publicIp) {
                try {
                    const execSync = require('child_process').execSync;
                    publicIp = execSync('curl -s --max-time 5 ifconfig.me 2>/dev/null || curl -s --max-time 5 ip.sb 2>/dev/null || true', { timeout: 8000 }).toString().trim();
                } catch {}
            }
            if (!publicIp) {
                try {
                    const ifaces = os.networkInterfaces();
                    for (const name of Object.keys(ifaces)) {
                        for (const iface of ifaces[name] || []) {
                            if (iface.family === 'IPv4' && !iface.internal) {
                                publicIp = iface.address;
                                break;
                            }
                        }
                        if (publicIp) break;
                    }
                } catch {}
            }

            // 2. 检测sniff服务状态
            let sniffRunning = false;
            let sniffHealth = 'unknown';
            try {
                const execSync = require('child_process').execSync;
                const health = execSync('curl -s --max-time 2 http://127.0.0.1:9988/health 2>/dev/null || true', { timeout: 3000 }).toString().trim();
                if (health === 'ok') {
                    sniffRunning = true;
                    sniffHealth = 'healthy';
                }
            } catch {}
            if (!sniffRunning) {
                try {
                    const execSync = require('child_process').execSync;
                    const listening = execSync('ss -tlnp 2>/dev/null | grep -q ":9988 " && echo 1 || echo 0', { timeout: 3000 }).toString().trim();
                    if (listening === '1') {
                        sniffRunning = true;
                        sniffHealth = 'listening';
                    }
                } catch {
                    sniffHealth = 'stopped';
                }
            }

            // 3. 检测UFW状态
            let ufwActive = false;
            let ufwPortAllowed = false;
            let ufwStatus = 'unknown';
            try {
                const execSync = require('child_process').execSync;
                const ufwOut = execSync('ufw status 2>/dev/null || true', { timeout: 3000 }).toString().trim();
                if (ufwOut.includes('Status: active')) {
                    ufwActive = true;
                    ufwPortAllowed = ufwOut.includes('9988');
                    ufwStatus = ufwPortAllowed ? 'active_allowed' : 'active_blocked';
                } else if (ufwOut.includes('Status: inactive')) {
                    ufwStatus = 'inactive';
                }
            } catch {
                ufwStatus = 'not_installed';
            }

            const sniffPort = Number(process.env.FARM_CAPTURE_PORT) || 9988;
            const safeIp = publicIp || 'SERVER_IP';
            const result = {
                publicIp: safeIp,
                sniffPort,
                sniffRunning,
                sniffHealth,
                ufwActive,
                ufwPortAllowed,
                ufwStatus,
                wsUrl: `ws://${safeIp}:${sniffPort}/admin`,
                httpUrl: `http://${safeIp}:${sniffPort}/admin`,
                patchCommand: `node patch-qq-farm-code-capture.js --capture-ws ws://${safeIp}:${sniffPort}/admin`,
                downloadUrl: '/api/pc-capture/download-patch',
                defaultTarget: 'ws://127.0.0.1:9988/admin',
            };

            pcCaptureInfoCache = { data: result, at: Date.now() };
            res.json({ ok: true, data: result });
        } catch (e) {
            res.json({ ok: true, data: { publicIp: '', sniffPort: 9988, sniffRunning: false, sniffHealth: 'error', ufwActive: false, ufwPortAllowed: false, ufwStatus: 'error', wsUrl: '', httpUrl: '', patchCommand: '', error: e.message } });
        }
    });

    app.get('/api/pc-capture/download-patch', (req, res) => {
        const scriptPath = path.join(__dirname, '..', '..', '..', 'tools', 'patch-qq-farm-code-capture.js');
        if (fs.existsSync(scriptPath)) {
            res.download(scriptPath, 'patch-qq-farm-code-capture.js');
        } else {
            res.status(404).json({ ok: false, error: '补丁脚本文件未找到' });
        }
    });

    // ============ Code 捕获调试 ============
    const captureLogs = [];
    function addCaptureLog(type, data) {
        captureLogs.unshift({ type, data, at: Date.now() });
        if (captureLogs.length > 50) captureLogs.length = 50;
    }
    // 拦截 pending-code 记录日志
    app.get('/api/pc-capture/debug', async (req, res) => {
        res.json({ ok: true, data: { logs: captureLogs, now: Date.now() } });
    });

    // API: 调度任务快照（用于调度收敛排查）
    app.get('/api/scheduler', async (req, res) => {
        try {
            const id = getAccId(req);

            // 检查权限（如果指定了账号ID）
            if (id && !checkAccountAccess(req, id)) {
                return res.status(403).json({ ok: false, error: '无权访问此账号' });
            }

            if (provider && typeof provider.getSchedulerStatus === 'function') {
                const data = await provider.getSchedulerStatus(id);
                return res.json({ ok: true, data });
            }
            return res.json({ ok: true, data: { runtime: getSchedulerRegistrySnapshot(), worker: null, workerError: 'DataProvider does not support scheduler status' } });
        } catch (e) {
            return handleApiError(res, e);
        }
    });

    app.post('/api/logout', (req, res) => {
        const token = req.adminToken;
        if (token) {
            tokens.delete(token);
            tokenUserMap.delete(token);
            if (io) {
                for (const socket of io.sockets.sockets.values()) {
                    if (String(socket.data.adminToken || '') === String(token)) {
                        socket.disconnect(true);
                    }
                }
            }
        }
        res.json({ ok: true });
    });

    function getAccountList(username = null) {
        try {
            if (provider && typeof provider.getAccounts === 'function') {
                const data = provider.getAccounts();
                if (data && Array.isArray(data.accounts)) {
                    // 如果指定了用户名，只返回该用户的账号
                    if (username) {
                        return data.accounts.filter(a => a.username === username);
                    }
                    return data.accounts;
                }
            }
        } catch {
            // ignore provider failures
        }
        const data = store.getAccounts ? store.getAccounts() : { accounts: [] };
        let accounts = Array.isArray(data.accounts) ? data.accounts : [];
        // 如果指定了用户名，只返回该用户的账号
        if (username) {
            accounts = accounts.filter(a => a.username === username);
        }
        return accounts;
    }

    // 检查用户是否有权访问指定账号
    const checkAccountAccess = (req, accountId) => {
        const currentUser = req.currentUser;
        if (!currentUser) return false;
        // 所有用户（包括管理员）只能访问自己的账号
        const accounts = getAccountList();
        const account = accounts.find(a => a.id === accountId);
        if (!account) return false;
        return account.username === currentUser.username;
    };

    // 获取当前用户可访问的账号ID列表
    const getAccessibleAccountIds = (req) => {
        const currentUser = req.currentUser;
        if (!currentUser) return [];
        // 所有用户（包括管理员）只能访问自己的账号
        const accounts = getAccountList(currentUser.username);
        return accounts.map(a => a.id);
    };

    // 根据用户对象获取可访问的账号ID列表（用于WebSocket）
    const getAccessibleAccountIdsForUser = (user) => {
        if (!user) return [];
        // 所有用户（包括管理员）只能访问自己的账号
        const accounts = getAccountList(user.username);
        return accounts.map(a => a.id);
    };

    function getUserAutomationSyncConfig(user) {
        if (!user || !store.getUserAutomationSync) return { enabled: false, snapshot: {} };
        return store.getUserAutomationSync(user.username);
    }

    function buildAutomationSyncSnapshotFromAccount(accountId) {
        const id = String(accountId || '').trim();
        if (!id) return {};
        const automation = store.getAutomation ? store.getAutomation(id) : {};
        const plantingStrategy = store.getPlantingStrategy ? store.getPlantingStrategy(id) : 'preferred';
        const preferredSeedId = store.getPreferredSeed ? store.getPreferredSeed(id) : 0;
        const intervals = store.getIntervals ? store.getIntervals(id) : {};
        const friendQuietHours = store.getFriendQuietHours ? store.getFriendQuietHours(id) : { enabled: false, start: '23:00', end: '07:00' };
        const stealDelaySeconds = store.getStealDelaySeconds ? store.getStealDelaySeconds(id) : 0;
        const plantOrderRandom = store.getPlantOrderRandom ? store.getPlantOrderRandom(id) : false;
        const plantDelaySeconds = store.getPlantDelaySeconds ? store.getPlantDelaySeconds(id) : 0;
        const fastHarvestConfig = (typeof store.getFastHarvestConfig === 'function') ? store.getFastHarvestConfig(id) : { advanceMs: 200 };
        const stakeoutStealConfig = (typeof store.getStakeoutStealConfig === 'function') ? store.getStakeoutStealConfig(id) : { enabled: false, delaySec: 3, maxAheadSec: 4 * 3600, friendList: [] };
        return {
            automation,
            plantingStrategy,
            preferredSeedId,
            intervals,
            friendQuietHours,
            stealDelaySeconds,
            plantOrderRandom,
            plantDelaySeconds,
            fastHarvestAdvanceMs: fastHarvestConfig.advanceMs,
            stakeoutSteal: {
                enabled: !!stakeoutStealConfig.enabled,
                delaySec: stakeoutStealConfig.delaySec,
                maxAheadSec: stakeoutStealConfig.maxAheadSec,
            },
            stakeoutFriendList: Array.isArray(stakeoutStealConfig.friendList) ? stakeoutStealConfig.friendList : [],
        };
    }

    const isSoftRuntimeError = (err) => {
        const msg = String((err && err.message) || '');
        return msg === '账号未运行' || msg === 'API Timeout';
    };

    function handleApiError(res, err) {
        if (isSoftRuntimeError(err)) {
            return res.json({ ok: false, error: err.message });
        }
        return res.status(500).json({ ok: false, error: err.message });
    }

    const resolveAccId = (rawRef) => {
        const input = normalizeAccountRef(rawRef);
        if (!input) return '';

        if (provider && typeof provider.resolveAccountId === 'function') {
            const resolvedByProvider = normalizeAccountRef(provider.resolveAccountId(input));
            if (resolvedByProvider) return resolvedByProvider;
        }

        const resolved = resolveAccountId(getAccountList(), input);
        return resolved || input;
    };

    // Helper to get account ID from header
    function getAccId(req) {
        return resolveAccId(req.headers['x-account-id']);
    }

    // API: 完整状态
    app.get('/api/status', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.json({ ok: false, error: 'Missing x-account-id' });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        try {
            const data = provider.getStatus(id);
            if (data && data.status) {
                const { level, exp } = data.status;
                const progress = getLevelExpProgress(level, exp);
                data.levelProgress = progress;
            }
            res.json({ ok: true, data });
        } catch (e) {
            res.json({ ok: false, error: e.message });
        }
    });

    app.post('/api/automation', async (req, res) => {
        const id = getAccId(req);
        if (!id) {
            return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        }

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        try {
            let lastData = null;
            const currentUser = req.currentUser;
            const syncCfg = getUserAutomationSyncConfig(currentUser);
            const targets = (syncCfg.enabled && currentUser)
                ? getAccessibleAccountIds(req)
                : [id];
            for (const [k, v] of Object.entries(req.body)) {
                for (const accountId of targets) {
                    lastData = await provider.setAutomation(accountId, k, v);
                }
            }
            if (syncCfg.enabled && currentUser && store.setUserAutomationSyncSnapshot) {
                store.setUserAutomationSyncSnapshot(currentUser.username, { automation: store.getAutomation(id) });
            }
            res.json({ ok: true, data: lastData || {} });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 农田详情
    app.get('/api/lands', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        try {
            const data = await provider.getLands(id);
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 好友列表
    app.get('/api/friends', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        try {
            const data = await provider.getFriends(id);
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 访客记录
    app.get('/api/interact-records', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        try {
            const data = await provider.getInteractRecords(id);
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 好友农田详情
    app.get('/api/friend/:gid/lands', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        try {
            const data = await provider.getFriendLands(id, req.params.gid);
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 对指定好友执行单次操作（偷菜/浇水/除草/捣乱）
    app.post('/api/friend/:gid/op', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        try {
            const opType = String((req.body || {}).opType || '');
            const data = await provider.doFriendOp(id, req.params.gid, opType);
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 好友批量操作（一键帮助/一键偷取/一键捣乱）
    app.post('/api/friends/batch-op', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        try {
            const opType = String((req.body || {}).opType || '');
            if (!opType) {
                return res.status(400).json({ ok: false, error: '缺少 opType 参数' });
            }
            const data = await provider.doBatchFriendOp(id, opType);
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 手动添加好友（支持批量）
    app.post('/api/friends/add', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        try {
            const body = req.body || {};
            let gids = [];
            
            // 支持批量 gid 数组或单个 gid
            if (Array.isArray(body.gids)) {
                gids = body.gids.filter(g => g > 0);
            } else if (body.gid) {
                gids = [body.gid];
            }
            
            if (gids.length === 0) {
                return res.status(400).json({ ok: false, error: 'Invalid GID' });
            }
            
            const results = await provider.addManualFriends(id, gids);
            res.json(results);
        } catch (e) {
            handleApiError(res, e);
        }
    });

    app.post('/api/friends/add-hex', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });

        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        try {
            const hex = String((req.body || {}).hex || '').trim();
            if (!hex) {
                return res.status(400).json({ ok: false, error: 'Missing hex' });
            }
            const results = await provider.addManualFriendsByHex(id, hex);
            res.json(results);
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 好友黑名单
    app.get('/api/friend-blacklist', (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        if (store.reloadGlobalConfig) {
            store.reloadGlobalConfig();
        }
        const list = store.getFriendBlacklist ? store.getFriendBlacklist(id) : [];
        res.json({ ok: true, data: list });
    });

    app.post('/api/friend-blacklist/toggle', (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        const gid = Number((req.body || {}).gid);
        if (!gid) return res.status(400).json({ ok: false, error: 'Missing gid' });
        if (store.reloadGlobalConfig) {
            store.reloadGlobalConfig();
        }
        const current = store.getFriendBlacklist ? store.getFriendBlacklist(id) : [];
        let next;
        if (current.includes(gid)) {
            next = current.filter(g => g !== gid);
        } else {
            next = [...current, gid];
        }
        const saved = store.setFriendBlacklist ? store.setFriendBlacklist(id, next) : next;
        // 同步配置到 worker 进程
        if (provider && typeof provider.broadcastConfig === 'function') {
            provider.broadcastConfig(id);
        }
        res.json({ ok: true, data: saved });
    });

    // API: 导入黑名单
    app.get('/api/import-blacklist', (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        if (store.reloadGlobalConfig) {
            store.reloadGlobalConfig();
        }
        const list = store.getImportBlacklist ? store.getImportBlacklist(id) : [];
        res.json({ ok: true, data: list });
    });

    app.post('/api/import-blacklist/add', (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        const gid = Number((req.body || {}).gid);
        if (!gid) return res.status(400).json({ ok: false, error: 'Missing gid' });

        if (store.reloadGlobalConfig) {
            store.reloadGlobalConfig();
        }
        const saved = store.addToImportBlacklist ? store.addToImportBlacklist(id, gid) : [];
        // 同步配置到 worker 进程
        if (provider && typeof provider.broadcastConfig === 'function') {
            provider.broadcastConfig(id);
        }
        res.json({ ok: true, data: saved });
    });

    app.post('/api/import-blacklist/remove', (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        const gid = Number((req.body || {}).gid);
        if (!gid) return res.status(400).json({ ok: false, error: 'Missing gid' });

        if (store.reloadGlobalConfig) {
            store.reloadGlobalConfig();
        }
        const saved = store.removeFromImportBlacklist ? store.removeFromImportBlacklist(id, gid) : [];
        // 同步配置到 worker 进程
        if (provider && typeof provider.broadcastConfig === 'function') {
            provider.broadcastConfig(id);
        }
        res.json({ ok: true, data: saved });
    });

    // API: 将好友从访客列表移到导入黑名单（用于手动移除）
    app.post('/api/friends/remove-to-blacklist', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        const gid = Number((req.body || {}).gid);
        if (!gid) return res.status(400).json({ ok: false, error: 'Missing gid' });

        try {
            if (store.reloadGlobalConfig) {
                store.reloadGlobalConfig();
            }
            // 1. 从访客列表中移除
            const visitors = store.getVisitors ? store.getVisitors(id) : [];
            const updatedVisitors = visitors.filter(v => v.gid !== gid);
            if (store.setVisitors) {
                store.setVisitors(id, updatedVisitors);
            }

            // 2. 添加到导入黑名单
            const blacklist = store.addToImportBlacklist ? store.addToImportBlacklist(id, gid) : [];

            // 3. 从蹲守列表中移除，避免继续被巡查
            let stakeoutFriendList = [];
            if (store.getStakeoutStealConfig && store.setStakeoutFriendList) {
                const cfg = store.getStakeoutStealConfig(id) || {};
                const currentList = Array.isArray(cfg.friendList) ? cfg.friendList : [];
                const nextList = currentList.filter(friendGid => Number(friendGid) !== gid);
                stakeoutFriendList = store.setStakeoutFriendList(id, nextList);
            }

            // 4. 同步配置
            if (provider && typeof provider.broadcastConfig === 'function') {
                provider.broadcastConfig(id);
            }

            res.json({ ok: true, data: { blacklist, visitors: updatedVisitors, stakeoutFriendList } });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 从导入黑名单恢复好友到访客列表
    app.post('/api/import-blacklist/restore', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        const gid = Number((req.body || {}).gid);
        if (!gid) return res.status(400).json({ ok: false, error: 'Missing gid' });

        try {
            if (store.reloadGlobalConfig) {
                store.reloadGlobalConfig();
            }
            // 1. 从导入黑名单中移除
            const blacklist = store.removeFromImportBlacklist ? store.removeFromImportBlacklist(id, gid) : [];

            // 2. 添加到访客列表
            const visitors = store.getVisitors ? store.getVisitors(id) : [];
            const exists = visitors.find(v => v.gid === gid);
            if (!exists) {
                visitors.push({
                    gid,
                    name: `GID:${gid}`,
                    avatarUrl: '',
                    lastSeen: Date.now(),
                });
                if (store.setVisitors) {
                    store.setVisitors(id, visitors);
                }
            }

            // 3. 同步配置
            if (provider && typeof provider.broadcastConfig === 'function') {
                provider.broadcastConfig(id);
            }

            res.json({ ok: true, data: { blacklist, visitors } });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 蔬菜黑名单
    app.get('/api/plant-blacklist', authRequired, (req, res) => {
        try {
            const accountId = getAccId(req);
            if (!accountId) return res.status(400).json({ ok: false, error: 'Missing accountId' });

            // 检查权限
            if (!checkAccountAccess(req, accountId)) {
                return res.status(403).json({ ok: false, error: '无权访问此账号' });
            }

            const list = store.getPlantBlacklist ? store.getPlantBlacklist(accountId) : [];
            res.json({ ok: true, data: list });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    app.post('/api/plant-blacklist', authRequired, (req, res) => {
        try {
            const accountId = getAccId(req);
            if (!accountId) return res.status(400).json({ ok: false, error: 'Missing accountId' });

            // 检查权限
            if (!checkAccountAccess(req, accountId)) {
                return res.status(403).json({ ok: false, error: '无权访问此账号' });
            }

            const seedId = Number((req.body || {}).seedId);
            if (!seedId) return res.status(400).json({ ok: false, error: 'Missing seedId' });

            const current = store.getPlantBlacklist ? store.getPlantBlacklist(accountId) : [];

            if (!current.includes(seedId)) {
                const next = [...current, seedId];
                if (store.setPlantBlacklist) {
                    store.setPlantBlacklist(accountId, next);
                }
            }

            if (provider && typeof provider.broadcastConfig === 'function') {
                provider.broadcastConfig(accountId);
            }

            const saved = store.getPlantBlacklist ? store.getPlantBlacklist(accountId) : [];
            res.json({ ok: true, data: saved });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    app.put('/api/plant-blacklist', authRequired, (req, res) => {
        try {
            const accountId = getAccId(req);
            if (!accountId) return res.status(400).json({ ok: false, error: 'Missing accountId' });

            // 检查权限
            if (!checkAccountAccess(req, accountId)) {
                return res.status(403).json({ ok: false, error: '无权访问此账号' });
            }

            const seedIds = Array.isArray((req.body || {}).seedIds) ? req.body.seedIds.map(Number).filter(n => Number.isFinite(n) && n > 0) : [];

            if (store.setPlantBlacklist) {
                store.setPlantBlacklist(accountId, seedIds);
            }

            if (provider && typeof provider.broadcastConfig === 'function') {
                provider.broadcastConfig(accountId);
            }

            const saved = store.getPlantBlacklist ? store.getPlantBlacklist(accountId) : [];
            res.json({ ok: true, data: saved });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    app.delete('/api/plant-blacklist/:seedId', authRequired, (req, res) => {
        try {
            const accountId = getAccId(req);
            if (!accountId) return res.status(400).json({ ok: false, error: 'Missing accountId' });

            // 检查权限
            if (!checkAccountAccess(req, accountId)) {
                return res.status(403).json({ ok: false, error: '无权访问此账号' });
            }

            const seedId = Number(req.params.seedId);
            if (!seedId) return res.status(400).json({ ok: false, error: 'Missing seedId' });

            const current = store.getPlantBlacklist ? store.getPlantBlacklist(accountId) : [];
            const next = current.filter(id => id !== seedId);

            if (store.setPlantBlacklist) {
                store.setPlantBlacklist(accountId, next);
            }

            if (provider && typeof provider.broadcastConfig === 'function') {
                provider.broadcastConfig(accountId);
            }

            const saved = store.getPlantBlacklist ? store.getPlantBlacklist(accountId) : [];
            res.json({ ok: true, data: saved });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 种子列表
    app.get('/api/seeds', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        try {
            const data = await provider.getSeeds(id);
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 背包物品
    app.get('/api/bag', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        try {
            const data = await provider.getBag(id);
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 使用背包物品
    app.post('/api/bag/use', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        try {
            const { itemId, count } = req.body;
            if (!itemId) return res.status(400).json({ ok: false, error: '缺少 itemId' });
            const data = await provider.useItem(id, Number(itemId), Math.max(1, Number(count) || 1));
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 出售背包物品
    app.post('/api/bag/sell', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        try {
            const { items } = req.body;
            if (!Array.isArray(items) || items.length === 0) {
                return res.status(400).json({ ok: false, error: '缺少出售物品列表' });
            }
            const data = await provider.sellItems(id, items);
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 每日礼包状态总览
    app.get('/api/daily-gifts', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        try {
            const data = await provider.getDailyGifts(id);
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 启动账号
    app.post('/api/accounts/:id/start', (req, res) => {
        try {
            const accountId = resolveAccId(req.params.id);

            // 检查权限
            if (!checkAccountAccess(req, accountId)) {
                return res.status(403).json({ ok: false, error: '无权访问此账号' });
            }

            const ok = provider.startAccount(accountId);
            if (!ok) {
                return res.status(404).json({ ok: false, error: 'Account not found' });
            }
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 停止账号
    app.post('/api/accounts/:id/stop', (req, res) => {
        try {
            const accountId = resolveAccId(req.params.id);

            // 检查权限
            if (!checkAccountAccess(req, accountId)) {
                return res.status(403).json({ ok: false, error: '无权访问此账号' });
            }

            const ok = provider.stopAccount(accountId);
            if (!ok) {
                return res.status(404).json({ ok: false, error: 'Account not found' });
            }
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 农场一键操作
    app.post('/api/farm/operate', async (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        try {
            const { opType } = req.body; // 'harvest', 'clear', 'plant', 'all'
            await provider.doFarmOp(id, opType);
            res.json({ ok: true });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 数据分析
    app.get('/api/analytics', async (req, res) => {
        try {
            const sortBy = req.query.sort || 'exp';
            const { getPlantRankings } = require('../services/analytics');
            const data = getPlantRankings(sortBy);
            res.json({ ok: true, data });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 设置页统一保存（单次写入+单次广播）
    app.post('/api/settings/save', async (req, res) => {
        const id = getAccId(req);
        if (!id) {
            return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        }

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        try {
            const data = await provider.saveSettings(id, req.body || {});

            const currentUser = req.currentUser;
            const syncCfg = getUserAutomationSyncConfig(currentUser);
            if (syncCfg.enabled && currentUser) {
                const body = (req.body && typeof req.body === 'object') ? req.body : {};
                const syncPayload = {};
                if (body.plantingStrategy !== undefined) syncPayload.plantingStrategy = body.plantingStrategy;
                if (body.preferredSeedId !== undefined) syncPayload.preferredSeedId = body.preferredSeedId;
                if (body.intervals !== undefined) syncPayload.intervals = body.intervals;
                if (body.friendQuietHours !== undefined) syncPayload.friendQuietHours = body.friendQuietHours;
                if (body.stealDelaySeconds !== undefined) syncPayload.stealDelaySeconds = body.stealDelaySeconds;
                if (body.plantOrderRandom !== undefined) syncPayload.plantOrderRandom = body.plantOrderRandom;
                if (body.plantDelaySeconds !== undefined) syncPayload.plantDelaySeconds = body.plantDelaySeconds;
                if (body.fastHarvestAdvanceMs !== undefined) syncPayload.fastHarvestAdvanceMs = body.fastHarvestAdvanceMs;
                if (body.stakeoutSteal !== undefined) syncPayload.stakeoutSteal = body.stakeoutSteal;
                if (body.stakeoutFriendList !== undefined) syncPayload.stakeoutFriendList = body.stakeoutFriendList;

                if (Object.keys(syncPayload).length > 0) {
                    const targets = getAccessibleAccountIds(req).filter(aid => String(aid) !== String(id));
                    for (const accountId of targets) {
                        store.applyConfigSnapshot(syncPayload, { accountId });
                        if (provider && typeof provider.broadcastConfig === 'function') {
                            provider.broadcastConfig(accountId);
                        }
                    }
                    if (store.setUserAutomationSyncSnapshot) {
                        store.setUserAutomationSyncSnapshot(currentUser.username, syncPayload);
                    }
                }
            }

            res.json({ ok: true, data: data || {} });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 设置面板主题
    app.post('/api/settings/theme', async (req, res) => {
        try {
            const theme = String((req.body || {}).theme || '');
            const data = await provider.setUITheme(theme);
            res.json({ ok: true, data: data || {} });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.get('/api/user/automation-sync', (req, res) => {
        const currentUser = req.currentUser;
        if (!currentUser) {
            return res.status(401).json({ ok: false, error: '未登录' });
        }
        const cfg = getUserAutomationSyncConfig(currentUser);
        return res.json({ ok: true, data: { enabled: !!cfg.enabled } });
    });

    app.post('/api/user/automation-sync', async (req, res) => {
        try {
            const currentUser = req.currentUser;
            if (!currentUser) {
                return res.status(401).json({ ok: false, error: '未登录' });
            }

            const enabled = !!(req.body && req.body.enabled);
            const sourceAccountIdRaw = (req.body && (req.body.sourceAccountId || req.body.accountId)) || '';
            const sourceAccountId = sourceAccountIdRaw ? resolveAccId(sourceAccountIdRaw) : '';

            if (enabled) {
                const accessibleIds = getAccessibleAccountIds(req);
                const baseId = sourceAccountId && checkAccountAccess(req, sourceAccountId)
                    ? sourceAccountId
                    : (accessibleIds[0] || '');
                const snapshot = buildAutomationSyncSnapshotFromAccount(baseId);
                if (store.setUserAutomationSync) {
                    store.setUserAutomationSync(currentUser.username, true, snapshot);
                }
                for (const accountId of accessibleIds) {
                    store.applyConfigSnapshot(snapshot, { accountId });
                    if (provider && typeof provider.broadcastConfig === 'function') {
                        provider.broadcastConfig(accountId);
                    }
                }
            }
            else {
                const currentCfg = getUserAutomationSyncConfig(currentUser);
                if (store.setUserAutomationSync) {
                    store.setUserAutomationSync(currentUser.username, false, currentCfg.snapshot || {});
                }
            }

            const cfg = getUserAutomationSyncConfig(currentUser);
            return res.json({ ok: true, data: { enabled: !!cfg.enabled } });
        } catch (e) {
            return res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 保存下线提醒配置
    app.post('/api/settings/offline-reminder', async (req, res) => {
        try {
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const currentUser = req.currentUser;

            // 必须登录才能保存下线提醒配置
            if (!currentUser) {
                return res.status(401).json({ ok: false, error: '未登录' });
            }

            // 保存到用户隔离的配置中
            const data = store.setOfflineReminder
                ? store.setOfflineReminder(body, currentUser.username)
                : {};
            res.json({ ok: true, data: data || {} });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 测试下线提醒推送（不落盘）
    app.post('/api/settings/offline-reminder/test', async (req, res) => {
        try {
            const currentUser = req.currentUser;
            const saved = store.getOfflineReminder && currentUser
                ? store.getOfflineReminder(currentUser.username)
                : {};
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const cfg = { ...(saved || {}), ...body };

            const channel = String(cfg.channel || '').trim().toLowerCase();
            const endpoint = String(cfg.endpoint || '').trim();
            const token = String(cfg.token || '').trim();
            const titleBase = String(cfg.title || '账号下线提醒').trim();
            const msgBase = String(cfg.msg || '账号下线').trim();

            if (!channel) {
                return res.status(400).json({ ok: false, error: '推送渠道不能为空' });
            }
            if (channel === 'webhook' && !endpoint) {
                return res.status(400).json({ ok: false, error: 'Webhook 渠道需要填写接口地址' });
            }

            const now = new Date();
            const ts = now.toISOString().replace('T', ' ').slice(0, 19);
            const { sendPushooMessage } = require('../services/push');
            const ret = await sendPushooMessage({
                channel,
                endpoint,
                token,
                title: `${titleBase}（测试）`,
                content: `${msgBase}\n\n这是一条下线提醒测试消息。\n时间: ${ts}`,
            });

            if (!ret) {
                return res.status(400).json({ ok: false, error: '推送失败：无返回结果' });
            }
            
            const isSuccess = ret.ok || 
                ret.code === 'ok' || 
                ret.code === '0' || 
                String(ret.msg || '').includes('成功') ||
                String(ret.raw?.status || '').toLowerCase() === 'success';
            
            if (!isSuccess && ret.msg && !String(ret.msg).includes('成功')) {
                return res.status(400).json({ ok: false, error: ret.msg || '推送失败', data: ret });
            }
            return res.json({ ok: true, data: ret, message: ret.msg || '推送成功' });
        } catch (e) {
            return res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 获取运行时连接配置
    app.get('/api/settings/runtime-config', authRequired, async (req, res) => {
        try {
            const currentUser = req.currentUser;
            if (!currentUser) {
                return res.status(401).json({ ok: false, error: '未登录' });
            }

            // 从用户配置中读取运行时连接配置
            const runtimeConfig = store.getRuntimeConfig
                ? store.getRuntimeConfig(currentUser.username)
                : {
                    serverUrl: 'wss://gate-obt.nqf.qq.com/prod/ws',
                    clientVersion: '1.12.1.6_20260623',
                    os: 'iOS',
                    osVersion: 'iOS 26.2.1',
                    networkType: 'wifi',
                    memory: '7672',
                    deviceId: 'iPhone X<iPhone18,3>',
                };

            res.json({ ok: true, data: runtimeConfig });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 保存运行时连接配置
    app.post('/api/settings/runtime-config', authRequired, async (req, res) => {
        try {
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const currentUser = req.currentUser;

            if (!currentUser) {
                return res.status(401).json({ ok: false, error: '未登录' });
            }

            // 验证必填字段
            const requiredFields = ['serverUrl', 'clientVersion', 'os'];
            for (const field of requiredFields) {
                if (!body[field]) {
                    return res.status(400).json({ ok: false, error: `缺少必填字段: ${field}` });
                }
            }

            const config = {
                serverUrl: String(body.serverUrl || '').trim(),
                clientVersion: String(body.clientVersion || '').trim(),
                os: String(body.os || '').trim(),
                osVersion: String(body.osVersion || '').trim(),
                networkType: String(body.networkType || '').trim(),
                memory: String(body.memory || '').trim(),
                deviceId: String(body.deviceId || '').trim(),
            };

            // 保存到用户配置中
            const data = store.setRuntimeConfig
                ? store.setRuntimeConfig(config, currentUser.username)
                : config;

            res.json({ ok: true, data: data || {} });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 获取配置
    app.get('/api/settings', async (req, res) => {
        try {
            const id = getAccId(req);
            const currentUser = req.currentUser;

            // 检查权限（如果指定了账号ID）
            if (id && !checkAccountAccess(req, id)) {
                return res.status(403).json({ ok: false, error: '无权访问此账号' });
            }

            // 直接从主进程的 store 读取，确保即使账号未运行也能获取配置
            const intervals = store.getIntervals(id);
            const strategy = store.getPlantingStrategy(id);
            const preferredSeed = store.getPreferredSeed(id);
            const friendQuietHours = store.getFriendQuietHours(id);
            const automation = store.getAutomation(id);
            const stealDelaySeconds = (typeof store.getStealDelaySeconds === 'function') ? store.getStealDelaySeconds(id) : 0;
            const plantOrderRandom = (typeof store.getPlantOrderRandom === 'function') ? store.getPlantOrderRandom(id) : false;
            const plantDelaySeconds = (typeof store.getPlantDelaySeconds === 'function') ? store.getPlantDelaySeconds(id) : 0;
            const ui = store.getUI();
            // 获取用户隔离的下线提醒配置
            const offlineReminder = store.getOfflineReminder && currentUser
                ? store.getOfflineReminder(currentUser.username)
                : { channel: 'webhook', reloginUrlMode: 'none', endpoint: '', token: '', title: '账号下线提醒', msg: '账号下线', offlineDeleteSec: 120 };
            // 获取秒收取配置
            const fastHarvestConfig = (typeof store.getFastHarvestConfig === 'function') ? store.getFastHarvestConfig(id) : { enabled: false, advanceMs: 200 };
            // 获取蹲守偷菜配置
            const stakeoutStealConfig = (typeof store.getStakeoutStealConfig === 'function') ? store.getStakeoutStealConfig(id) : { enabled: false, delaySec: 3, maxAheadSec: 4 * 3600, friendList: [] };
            const automationSyncEnabled = !!getUserAutomationSyncConfig(currentUser).enabled;

            res.json({
                ok: true,
                data: {
                    intervals,
                    strategy,
                    preferredSeed,
                    friendQuietHours,
                    automation,
                    stealDelaySeconds,
                    plantOrderRandom,
                    plantDelaySeconds,
                    ui,
                    offlineReminder,
                    // 秒收取配置
                    fastHarvestAdvanceMs: fastHarvestConfig.advanceMs,
                    // 蹲守偷菜配置
                    stakeoutSteal: {
                        enabled: stakeoutStealConfig.enabled,
                        delaySec: stakeoutStealConfig.delaySec,
                        maxAheadSec: stakeoutStealConfig.maxAheadSec,
                    },
                    stakeoutFriendList: stakeoutStealConfig.friendList,
                    automationSyncEnabled,
                }
            });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 获取蹲守好友列表
    app.get('/api/stakeout/friends', authRequired, async (req, res) => {
        try {
            const id = getAccId(req);
            if (!id) {
                return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
            }

            // 检查权限
            if (!checkAccountAccess(req, id)) {
                return res.status(403).json({ ok: false, error: '无权访问此账号' });
            }

            const config = (typeof store.getStakeoutStealConfig === 'function')
                ? store.getStakeoutStealConfig(id)
                : { friendList: [] };

            res.json({ ok: true, data: { friendList: config.friendList || [] } });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 添加蹲守好友
    app.post('/api/stakeout/friends/add', authRequired, async (req, res) => {
        try {
            const id = getAccId(req);
            if (!id) {
                return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
            }

            // 检查权限
            if (!checkAccountAccess(req, id)) {
                return res.status(403).json({ ok: false, error: '无权访问此账号' });
            }

            const { friendGid } = req.body || {};
            if (!friendGid || !Number.isFinite(Number(friendGid))) {
                return res.status(400).json({ ok: false, error: 'Invalid friendGid' });
            }

            const result = (typeof store.setStakeoutFriendList === 'function')
                ? store.setStakeoutFriendList(id, [
                    ...(((store.getStakeoutStealConfig && store.getStakeoutStealConfig(id).friendList) || [])),
                    Number(friendGid)
                ])
                : [];

            const currentUser = req.currentUser;
            const syncCfg = getUserAutomationSyncConfig(currentUser);
            if (syncCfg.enabled && currentUser && typeof store.setStakeoutFriendList === 'function') {
                const targets = getAccessibleAccountIds(req).filter(aid => String(aid) !== String(id));
                for (const accountId of targets) {
                    store.setStakeoutFriendList(accountId, result);
                    if (provider && typeof provider.broadcastConfig === 'function') {
                        provider.broadcastConfig(accountId);
                    }
                }
                if (store.setUserAutomationSyncSnapshot) {
                    store.setUserAutomationSyncSnapshot(currentUser.username, { stakeoutFriendList: result });
                }
            }

            res.json({ ok: true, data: { friendList: result } });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 移除蹲守好友
    app.post('/api/stakeout/friends/remove', authRequired, async (req, res) => {
        try {
            const id = getAccId(req);
            if (!id) {
                return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
            }

            // 检查权限
            if (!checkAccountAccess(req, id)) {
                return res.status(403).json({ ok: false, error: '无权访问此账号' });
            }

            const { friendGid } = req.body || {};
            if (!friendGid || !Number.isFinite(Number(friendGid))) {
                return res.status(400).json({ ok: false, error: 'Invalid friendGid' });
            }

            const currentList = (store.getStakeoutStealConfig && store.getStakeoutStealConfig(id).friendList) || [];
            const newList = currentList.filter(gid => gid !== Number(friendGid));

            const result = (typeof store.setStakeoutFriendList === 'function')
                ? store.setStakeoutFriendList(id, newList)
                : [];

            const currentUser = req.currentUser;
            const syncCfg = getUserAutomationSyncConfig(currentUser);
            if (syncCfg.enabled && currentUser && typeof store.setStakeoutFriendList === 'function') {
                const targets = getAccessibleAccountIds(req).filter(aid => String(aid) !== String(id));
                for (const accountId of targets) {
                    store.setStakeoutFriendList(accountId, result);
                    if (provider && typeof provider.broadcastConfig === 'function') {
                        provider.broadcastConfig(accountId);
                    }
                }
                if (store.setUserAutomationSyncSnapshot) {
                    store.setUserAutomationSyncSnapshot(currentUser.username, { stakeoutFriendList: result });
                }
            }

            res.json({ ok: true, data: { friendList: result } });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ============ 卡密管理 API（仅管理员） ============
    const adminRequired = (req, res, next) => {
        if (!req.currentUser || req.currentUser.role !== 'admin') {
            return res.status(403).json({ ok: false, error: '需要管理员权限' });
        }
        next();
    };

    // 获取所有卡密
    app.get('/api/admin/cards', authRequired, adminRequired, (req, res) => {
        try {
            const cards = userStore.getAllCards();
            res.json({ ok: true, data: cards });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 创建卡密
    app.post('/api/admin/cards', authRequired, adminRequired, (req, res) => {
        try {
            const { description, days, count, type, quota } = req.body || {};
            if (!description) {
                return res.status(400).json({ ok: false, error: '请提供描述' });
            }
            
            const cardType = type || 'days';
            if (cardType === 'days' && days === undefined) {
                return res.status(400).json({ ok: false, error: '天数卡密请提供天数' });
            }
            if (cardType === 'quota' && quota === undefined) {
                return res.status(400).json({ ok: false, error: '配额卡密请提供配额数量' });
            }
            
            // 批量创建
            if (count && Number.parseInt(count, 10) > 1) {
                const cards = userStore.createCardsBatch(description, days, count, cardType, quota);
                return res.json({ ok: true, data: cards, batch: true, count: cards.length });
            }
            
            const card = userStore.createCard(description, days, cardType, quota);
            res.json({ ok: true, data: card });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 批量删除卡密（必须放在 /:code 路由之前，避免被当作 code 参数）
    app.post('/api/admin/cards/batch-delete', authRequired, adminRequired, (req, res) => {
        try {
            const { codes } = req.body || {};
            if (!Array.isArray(codes) || codes.length === 0) {
                return res.status(400).json({ ok: false, error: '请提供要删除的卡密列表' });
            }
            const result = userStore.deleteCardsBatch(codes);
            res.json(result);
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 更新卡密
    app.post('/api/admin/cards/:code', authRequired, adminRequired, (req, res) => {
        try {
            const { code } = req.params;
            const updates = req.body || {};
            const card = userStore.updateCard(code, updates);
            if (!card) {
                return res.status(404).json({ ok: false, error: '卡密不存在' });
            }
            res.json({ ok: true, data: card });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 删除卡密
    app.delete('/api/admin/cards/:code', authRequired, adminRequired, (req, res) => {
        try {
            const { code } = req.params;
            const ok = userStore.deleteCard(code);
            if (!ok) {
                return res.status(404).json({ ok: false, error: '卡密不存在' });
            }
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ============ 用户管理 API（仅管理员） ============
    // 获取所有用户
    app.get('/api/admin/users', authRequired, adminRequired, (req, res) => {
        try {
            const users = userStore.getAllUsers();
            res.json({ ok: true, data: users });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 获取所有用户（带密码，仅管理员）
    app.get('/api/admin/users-with-password', authRequired, adminRequired, (req, res) => {
        try {
            const users = userStore.getAllUsersWithPassword();
            res.json({ ok: true, data: users });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 管理员创建用户（不需要卡密）
    app.post('/api/admin/users/create', authRequired, adminRequired, (req, res) => {
        try {
            const { username, password, days, quota, enabled } = req.body || {};
            const result = userStore.adminCreateUser(username, password, { days, quota, enabled });
            if (!result.ok) return res.status(400).json(result);
            res.json({ ok: true, data: result.user });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 更新用户（同步更新 tokenUserMap 确保用户端即时刷新）
    app.post('/api/admin/users/:username', authRequired, adminRequired, (req, res) => {
        try {
            const { username } = req.params;
            const updates = req.body || {};
            const user = userStore.updateUser(username, updates);
            if (!user) {
                return res.status(404).json({ ok: false, error: '用户不存在' });
            }
            // 更新 tokenUserMap 中的缓存数据
            for (const [token, u] of tokenUserMap.entries()) {
                if (u.username === username) {
                    const fresh = userStore.getAllUsers().find(x => x.username === username);
                    tokenUserMap.set(token, fresh || u);
                    // 如果被禁用或过期，强制下线
                    if (updates.enabled === false || (updates.expiresAt && updates.expiresAt < Date.now())) {
                        tokens.delete(token);
                        tokenUserMap.delete(token);
                        if (io) {
                            for (const socket of io.sockets.sockets.values()) {
                                if (String(socket.data.adminToken || '') === String(token)) socket.disconnect(true);
                            }
                        }
                    }
                }
            }
            res.json({ ok: true, data: user });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 删除用户
    app.delete('/api/admin/users/:username', authRequired, adminRequired, (req, res) => {
        try {
            const { username } = req.params;
            const result = userStore.deleteUser(username);
            if (!result.ok) {
                return res.status(400).json(result);
            }
            // 强制下线该用户的所有会话
            for (const [token, user] of tokenUserMap.entries()) {
                if (user.username === username) {
                    tokens.delete(token);
                    tokenUserMap.delete(token);
                    if (io) {
                        for (const socket of io.sockets.sockets.values()) {
                            if (String(socket.data.adminToken || '') === String(token)) {
                                socket.disconnect(true);
                            }
                        }
                    }
                }
            }
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 管理员为用户续费
    app.post('/api/admin/users/:username/renew', authRequired, adminRequired, (req, res) => {
        try {
            const { username } = req.params;
            const { cardCode } = req.body || {};

            if (!cardCode) {
                return res.status(400).json({ ok: false, error: '请提供卡密' });
            }

            const result = userStore.renewUser(username, cardCode);
            if (!result.ok) {
                return res.status(400).json(result);
            }

            // 更新该用户所有会话中的卡密信息
            for (const [token, user] of tokenUserMap.entries()) {
                if (user.username === username) {
                    user.card = result.card;
                    tokenUserMap.set(token, user);
                }
            }

            const message = result.cardType === 'days' ? '续费成功' : '配额增加成功';
            res.json({ ok: true, data: result.card, cardType: result.cardType, message });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 管理员重置用户密码
    app.post('/api/admin/users/:username/reset-password', authRequired, adminRequired, (req, res) => {
        try {
            const { username } = req.params;
            const { newPassword } = req.body || {};
            if (!newPassword || String(newPassword).length < 4) {
                return res.status(400).json({ ok: false, error: '新密码至少4个字符' });
            }
            const result = userStore.adminSetPassword(username, newPassword);
            if (!result.ok) return res.status(400).json(result);
            for (const [token, u] of tokenUserMap.entries()) {
                if (u.username === username) {
                    tokens.delete(token);
                    tokenUserMap.delete(token);
                    if (io) {
                        for (const socket of io.sockets.sockets.values()) {
                            if (String(socket.data.adminToken || '') === String(token)) socket.disconnect(true);
                        }
                    }
                }
            }
            res.json(result);
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 获取当前登录用户信息
    app.get('/api/user/me', authRequired, (req, res) => {
        try {
            const user = req.currentUser;
            if (!user) {
                return res.status(401).json({ ok: false, error: '未登录' });
            }
            res.json({
                ok: true,
                data: {
                    username: user.username,
                    role: user.role,
                    card: user.card
                }
            });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ============ OAuth 配置 API（仅管理员） ============
    // 获取OAuth配置（公开，用于登录页判断是否显示QQ登录）
    app.get('/api/admin/oauth', (req, res) => {
        try {
            const config = store.getOAuthConfig();
            res.json({ ok: true, data: config });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 更新OAuth配置（仅管理员）
    app.post('/api/admin/oauth', authRequired, adminRequired, (req, res) => {
        try {
            const { enabled, apiUrl, appId, appKey, callbackBaseUrl } = req.body || {};
            const config = store.setOAuthConfig({
                enabled: !!enabled,
                apiUrl: String(apiUrl || '').trim(),
                appId: String(appId || '').trim(),
                appKey: String(appKey || '').trim(),
                callbackBaseUrl: String(callbackBaseUrl || '').trim(),
            });
            res.json({ ok: true, data: config });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 获取OAuth用户默认配置（仅管理员）
    app.get('/api/admin/oauth-user-default', authRequired, adminRequired, (req, res) => {
        try {
            const config = store.getOAuthUserDefault();
            res.json({ ok: true, data: config });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 更新OAuth用户默认配置（仅管理员）
    app.post('/api/admin/oauth-user-default', authRequired, adminRequired, (req, res) => {
        try {
            const { days, quota } = req.body || {};
            const config = store.setOAuthUserDefault({
                days: Number.parseInt(days, 10),
                quota: Number.parseInt(quota, 10),
            });
            res.json({ ok: true, data: config });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 获取卡密注册默认配置（仅管理员）
    app.get('/api/admin/card-register-default', authRequired, adminRequired, (req, res) => {
        try {
            const config = store.getCardRegisterDefault();
            res.json({ ok: true, data: config });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 更新卡密注册默认配置（仅管理员）
    app.post('/api/admin/card-register-default', authRequired, adminRequired, (req, res) => {
        try {
            const { quota } = req.body || {};
            const config = store.setCardRegisterDefault({
                quota: Number.parseInt(quota, 10),
            });
            res.json({ ok: true, data: config });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 获取管理员微信配置（仅管理员）
    app.get('/api/admin/wx-config', authRequired, adminRequired, (req, res) => {
        try {
            const config = store.getAdminWxConfig();
            res.json({ ok: true, data: config });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ============ 持久化登录管理 (PLM) ============

    // PLM 状态查询
    app.get('/api/admin/plm/status', authRequired, adminRequired, (req, res) => {
        try {
            const plm = provider && typeof provider.getPlm === 'function' ? provider.getPlm() : null;
            if (!plm) {
                return res.json({ ok: false, error: 'PLM 未启用', data: { enabled: false } });
            }
            const sessions = plm.listSessions();
            res.json({
                ok: true,
                data: {
                    enabled: true,
                    sessionCount: sessions.length,
                    sessions,
                },
            });
        } catch (e) {
            res.json({ ok: false, error: e.message });
        }
    });

    // PLM 强制备份
    app.post('/api/admin/plm/backup', authRequired, adminRequired, async (req, res) => {
        try {
            const plm = provider && typeof provider.getPlm === 'function' ? provider.getPlm() : null;
            if (!plm) return res.json({ ok: false, error: 'PLM 未启用' });
            const backupId = await plm.backup();
            res.json({ ok: true, data: { backupId } });
        } catch (e) {
            res.json({ ok: false, error: e.message });
        }
    });

    // PLM 验证指定会话
    app.post('/api/admin/plm/validate/:accountId', authRequired, adminRequired, async (req, res) => {
        try {
            const plm = provider && typeof provider.getPlm === 'function' ? provider.getPlm() : null;
            if (!plm) return res.json({ ok: false, error: 'PLM 未启用' });
            const { accountId } = req.params;
            const session = plm.getSession(accountId);
            if (!session) return res.json({ ok: false, error: '会话未加载' });
            const result = await plm.validate(accountId, { timeout: 10000 });
            res.json({ ok: true, data: result });
        } catch (e) {
            res.json({ ok: false, error: e.message });
        }
    });

    // 更新管理员微信配置（仅管理员）
    app.post('/api/admin/wx-config', authRequired, adminRequired, (req, res) => {
        try {
            const { showWxConfigTab, showWxLoginTab, apiBase, apiKey, proxyApiUrl } = req.body || {};
            const config = store.setAdminWxConfig({
                showWxConfigTab: showWxConfigTab !== false,
                showWxLoginTab: showWxLoginTab !== false,
                apiBase,
                apiKey,
                proxyApiUrl,
            });
            res.json({ ok: true, data: config });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 获取管理员微信配置（普通用户可访问，用于判断是否显示标签）
    app.get('/api/wx-config/public', (req, res) => {
        try {
            const config = store.getAdminWxConfig();
            res.json({
                ok: true,
                data: {
                    showWxConfigTab: config.showWxConfigTab,
                    showWxLoginTab: config.showWxLoginTab,
                }
            });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 保存用户微信登录配置
    app.post('/api/user/wxlogin-config', authRequired, (req, res) => {
        try {
            const user = req.currentUser;
            if (!user) {
                return res.status(401).json({ ok: false, error: '未登录' });
            }

            const config = req.body || {};
            const result = userStore.saveWxLoginConfig(user.username, config);

            if (!result.ok) {
                return res.status(400).json(result);
            }

            res.json(result);
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 获取用户微信登录配置
    app.get('/api/user/wxlogin-config', authRequired, (req, res) => {
        try {
            const user = req.currentUser;
            if (!user) {
                return res.status(401).json({ ok: false, error: '未登录' });
            }

            const adminWxConfig = store.getAdminWxConfig();

            // 如果管理员关闭了微信配置标签但打开了微信扫码登录标签，则使用管理员配置
            if (!adminWxConfig.showWxConfigTab && adminWxConfig.showWxLoginTab) {
                return res.json({
                    ok: true,
                    config: {
                        enabled: true,
                        apiBase: adminWxConfig.apiBase,
                        apiKey: adminWxConfig.apiKey,
                        proxyApiUrl: adminWxConfig.proxyApiUrl,
                        appId: 'wx5306c5978fdb76e4',
                        autoAddAccount: true,
                        userIsolation: false,
                    }
                });
            }

            const result = userStore.getWxLoginConfig(user.username);

            if (!result.ok) {
                return res.status(400).json(result);
            }

            res.json(result);
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 账号管理
        app.get('/api/accounts', (req, res) => {
            try {
                const currentUser = req.currentUser;
                let data;

                if (currentUser) {
                    const allAccounts = provider.getAccounts();
                    let accounts = allAccounts.accounts.filter(a => a.username === currentUser.username);

                    // 分页支持
                    const page = Math.max(1, Number(req.query.page) || 1);
                    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
                    const keyword = String(req.query.keyword || '').trim().toLowerCase();

                    let filtered = accounts.filter(a => !a.deletedAt);
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

                    data = {
                        accounts: paged,
                        total,
                        page,
                        limit,
                        totalPages,
                        stats: {
                            running: filtered.filter(a => a.running).length,
                            stopped: filtered.filter(a => !a.running).length,
                        }
                    };
                } else {
                    data = { accounts: [], total: 0, page: 1, limit: 50, totalPages: 0, stats: { running: 0, stopped: 0 } };
                }

                res.json({ ok: true, data });
            } catch (e) {
                res.status(500).json({ ok: false, error: e.message });
            }
        });

    // API: 更新账号备注（兼容旧接口）
    app.post('/api/account/remark', (req, res) => {
        try {
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const rawRef = body.id || body.accountId || body.uin || req.headers['x-account-id'];
            const accountList = getAccountList();
            const target = findAccountByRef(accountList, rawRef);
            if (!target || !target.id) {
                return res.status(404).json({ ok: false, error: 'Account not found' });
            }

            const remark = String(body.remark !== undefined ? body.remark : body.name || '').trim();
            if (!remark) {
                return res.status(400).json({ ok: false, error: 'Missing remark' });
            }

            const accountId = String(target.id);
            const data = addOrUpdateAccount({ id: accountId, name: remark });
            if (provider && typeof provider.setRuntimeAccountName === 'function') {
                provider.setRuntimeAccountName(accountId, remark);
            }
            if (provider && provider.addAccountLog) {
                provider.addAccountLog('update', `更新账号备注: ${remark}`, accountId, remark);
            }
            res.json({ ok: true, data });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.post('/api/accounts', async (req, res) => {
        try {
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const currentUser = req.currentUser;
            let isUpdate = !!body.id;

            const resolvedUpdateId = isUpdate ? resolveAccId(body.id) : '';
            const payload = isUpdate
                ? { ...body, id: resolvedUpdateId || String(body.id) }
                : { ...body };

            const incomingCode = String(payload.code || '').trim();
            const manualPlatform = String(payload.platform || 'qq').trim().toLowerCase();
            if (incomingCode && /^-\d+$/.test(incomingCode)) {
                return res.status(400).json({ ok: false, error: '无效登录 Code，请重新扫码获取。' });
            }

            let basicProfile = null;
            if (incomingCode && manualPlatform === 'qq') {
                try {
                    basicProfile = await fetchProfileByCode(incomingCode, {
                        platform: manualPlatform,
                    });
                    if (basicProfile && basicProfile.avatar) {
                        payload.avatar = basicProfile.avatar;
                        payload.avatarUrl = basicProfile.avatar;
                    }
                    if (basicProfile && basicProfile.gid > 0 && !String(payload.gid || '').trim()) {
                        payload.gid = String(basicProfile.gid);
                    }
                    if (basicProfile && basicProfile.openId && !String(payload.openId || '').trim()) {
                        payload.openId = basicProfile.openId;
                    }
                    if (basicProfile && basicProfile.name) {
                        payload.nick = basicProfile.name;
                    }
                } catch (error) {
                    adminLogger.warn('fetch manual account profile failed', {
                        error: error.message,
                        accountId: payload.id || '',
                    });
                }
            }

            // 新增账号时：如果 code 可解析到 gid，且该用户已有同 gid 账号，则改为仅更新该账号的 code（不新增）
            if (!isUpdate && currentUser && manualPlatform === 'qq') {
                const profileGid = Number.parseInt(String((basicProfile && basicProfile.gid) || payload.gid || ''), 10) || 0;
                if (profileGid > 0) {
                    const existing = getAccountList(currentUser.username).find((a) => {
                        const agid = Number.parseInt(String(a && a.gid || ''), 10) || 0;
                        const platform = String((a && a.platform) || 'qq').trim().toLowerCase();
                        return platform === 'qq' && agid === profileGid;
                    });
                    if (existing && existing.id) {
                        isUpdate = true;
                        payload.id = String(existing.id);
                    }
                }
            }

            // 检查权限：普通用户只能更新自己的账号
            if (isUpdate && currentUser && currentUser.role !== 'admin') {
                if (!checkAccountAccess(req, resolveAccId(payload.id))) {
                    return res.status(403).json({ ok: false, error: '无权访问此账号' });
                }
            }

            // 如果是新增账号，检查配额限制并设置用户关联
            if (!isUpdate && currentUser) {
                if (currentUser.role !== 'admin') {
                    const userQuota = currentUser.card?.quota;
                    if (userQuota !== undefined && userQuota !== null && userQuota !== -1) {
                        const currentAccounts = getAccountList(currentUser.username);
                        if (currentAccounts.length >= userQuota) {
                            return res.status(403).json({ ok: false, error: `账号数量已达上限（${userQuota}个），请购买配额卡密增加配额` });
                        }
                    }
                }
                payload.username = currentUser.username;
            }

            let wasRunning = false;
            if (isUpdate && provider.isAccountRunning) {
                wasRunning = provider.isAccountRunning(payload.id);
            }

            // 检查是否仅修改了备注信息
            let onlyRemarkChanged = false;
            if (isUpdate) {
                const oldAccounts = provider.getAccounts();
                const oldAccount = oldAccounts.accounts.find(a => a.id === payload.id);
                if (oldAccount) {
                    // 检查 payload 中是否只包含 id 和 name 字段
                    const payloadKeys = Object.keys(payload);
                    const onlyIdAndName = payloadKeys.length === 2 && payloadKeys.includes('id') && payloadKeys.includes('name');
                    if (onlyIdAndName) {
                        onlyRemarkChanged = true;
                    }
                }
            }

            const data = addOrUpdateAccount(payload);
            if (provider.addAccountLog) {
                const accountId = isUpdate ? String(payload.id) : String((data.accounts[data.accounts.length - 1] || {}).id || '');
                const accountName = payload.name || '';
                provider.addAccountLog(
                    isUpdate ? 'update' : 'add',
                    isUpdate ? `更新账号: ${accountName || accountId}` : `添加账号: ${accountName || accountId}`,
                    accountId,
                    accountName
                );
            }
            // 如果是新增，自动启动
            if (!isUpdate) {
                const newAcc = data.accounts[data.accounts.length - 1];
                if (newAcc) {
                    const syncCfg = getUserAutomationSyncConfig(currentUser);
                    if (syncCfg.enabled && syncCfg.snapshot && Object.keys(syncCfg.snapshot).length > 0) {
                        store.applyConfigSnapshot(syncCfg.snapshot, { accountId: newAcc.id });
                        if (provider && typeof provider.broadcastConfig === 'function') {
                            provider.broadcastConfig(newAcc.id);
                        }
                    }
                    provider.startAccount(newAcc.id);
                }
            } else if (wasRunning && !onlyRemarkChanged) {
                // 如果是更新，且之前在运行，且不是仅修改备注，则重启
                provider.restartAccount(payload.id);
            }
            res.json({ ok: true, data });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.delete('/api/accounts/:id', (req, res) => {
        try {
            const resolvedId = resolveAccId(req.params.id) || String(req.params.id || '');

            // 检查权限
            if (!checkAccountAccess(req, resolvedId)) {
                return res.status(403).json({ ok: false, error: '无权访问此账号' });
            }

            const before = provider.getAccounts();
            const target = findAccountByRef(before.accounts || [], req.params.id);
            provider.stopAccount(resolvedId);
            const data = deleteAccount(resolvedId);
            if (provider.addAccountLog) {
                provider.addAccountLog('delete', `删除账号: ${(target && target.name) || req.params.id}`, resolvedId, target ? target.name : '');
            }
            res.json({ ok: true, data });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 账号日志
    app.get('/api/account-logs', (req, res) => {
        try {
            const limit = Number.parseInt(req.query.limit) || 100;
            const currentUser = req.currentUser;

            let list = provider.getAccountLogs ? provider.getAccountLogs(limit) : [];
            if (!Array.isArray(list)) list = [];

            // 所有用户（包括管理员）只能看到自己账号的操作日志
            if (currentUser) {
                const accessibleIds = getAccessibleAccountIds(req);
                list = list.filter(log => {
                    const logAccountId = log.accountId || log.id;
                    return accessibleIds.includes(logAccountId);
                });
            }

            // 与当前 web 前端保持一致：直接返回数组
            res.json(list);
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 日志
    app.get('/api/logs', (req, res) => {
        const queryAccountIdRaw = (req.query.accountId || '').toString().trim();
        const id = queryAccountIdRaw ? (queryAccountIdRaw === 'all' ? '' : resolveAccId(queryAccountIdRaw)) : getAccId(req);
        const currentUser = req.currentUser;

        // 必须登录才能查看日志
        if (!currentUser) {
            return res.status(401).json({ ok: false, error: '未登录' });
        }

        // 如果指定了账号ID，检查权限
        if (id && !checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        // 如果没有指定账号ID，获取当前用户可访问的所有账号的日志
        if (!id) {
            // 所有用户（包括管理员）只能获取自己可访问账号的日志
            const accessibleIds = getAccessibleAccountIds(req);
            const allLogs = [];
            const options = {
                limit: Number.parseInt(req.query.limit) || 100,
                tag: req.query.tag || '',
                module: req.query.module || '',
                event: req.query.event || '',
                keyword: req.query.keyword || '',
                isWarn: req.query.isWarn,
                timeFrom: req.query.timeFrom || '',
                timeTo: req.query.timeTo || '',
            };

            // 获取每个可访问账号的日志
            for (const accId of accessibleIds) {
                const logs = provider.getLogs(accId, options);
                if (Array.isArray(logs)) {
                    allLogs.push(...logs);
                }
            }

            // 按时间排序并限制数量
            allLogs.sort((a, b) => (b.time || 0) - (a.time || 0));
            const limitedLogs = allLogs.slice(0, options.limit);

            return res.json({ ok: true, data: limitedLogs });
        }

        // 指定了账号ID且通过权限检查，返回该账号的日志
        const options = {
            limit: Number.parseInt(req.query.limit) || 100,
            tag: req.query.tag || '',
            module: req.query.module || '',
            event: req.query.event || '',
            keyword: req.query.keyword || '',
            isWarn: req.query.isWarn,
            timeFrom: req.query.timeFrom || '',
            timeTo: req.query.timeTo || '',
        };
        const list = provider.getLogs(id, options);
        res.json({ ok: true, data: list });
    });

    // API: 清空当前账号运行日志
    app.delete('/api/logs', (req, res) => {
        const id = getAccId(req);
        if (!id) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });

        // 检查权限
        if (!checkAccountAccess(req, id)) {
            return res.status(403).json({ ok: false, error: '无权访问此账号' });
        }

        try {
            const data = provider.clearLogs(id);

            if (io && provider && typeof provider.getLogs === 'function') {
                const accountLogs = provider.getLogs(id, { limit: 100 });
                io.to(`account:${id}`).emit('logs:snapshot', {
                    accountId: id,
                    logs: Array.isArray(accountLogs) ? accountLogs : [],
                });

                const allLogs = provider.getLogs('', { limit: 100 });
                io.to('account:all').emit('logs:snapshot', {
                    accountId: 'all',
                    logs: Array.isArray(allLogs) ? allLogs : [],
                });
            }

            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // ============ 聚合日志 API（管理员专用） ============

    // 聚合所有日志来源
    app.get('/api/logs/all', adminRequired, (req, res) => {
        try {
            const source = String(req.query.source || 'all').trim();
            const keyword = String(req.query.keyword || '').trim().toLowerCase();
            const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
            const severity = String(req.query.severity || '').trim();

            let lines = [];

            // 运行时日志 (globalLogs)
            if (source === 'all' || source === 'global') {
                const opts = { keyword, limit: 1000 };
                if (severity === 'error') opts.isWarn = '1';
                const entries = provider.getLogs('all', opts) || [];
                for (const e of entries) {
                    const line = `[${e.time}] [${e.tag}] ${e.msg}`;
                    lines.push({ text: line, time: e.time, tag: e.tag, source: 'runtime', level: e.isWarn ? 'error' : 'info' });
                }
            }

            // 账户操作日志 (accountLogs)
            if (source === 'all' || source === 'account') {
                const accEntries = provider.getAccountLogs ? provider.getAccountLogs(300) : [];
                for (const e of accEntries) {
                    const line = `[${e.time}] [${e.action}] ${e.msg}`;
                    if (keyword && !line.toLowerCase().includes(keyword)) continue;
                    lines.push({ text: line, time: e.time, tag: e.action, source: 'account', level: e.action === 'kickout_stop' || e.action === 'ws_400' ? 'error' : 'info' });
                }
            }

            // 系统捕获日志 (capture-system.log)
            if (source === 'all' || source === 'capture') {
                try {
                    if (fs.existsSync(CAPTURE_LOG_FILE)) {
                        const content = fs.readFileSync(CAPTURE_LOG_FILE, 'utf8');
                        const fileLines = content.split('\n').filter(Boolean);
                        for (const line of fileLines) {
                            if (keyword && !line.toLowerCase().includes(keyword)) continue;
                            const level = line.includes('异常') || line.includes('失败') ? 'error' : line.includes('认领成功') || line.includes('forwarded') ? 'success' : 'info';
                            const time = line.match(/\[([^\]]+)\]/)?.[1] || '';
                            lines.push({ text: line, time, source: 'capture', level });
                        }
                    }
                } catch {}
            }

            // 仅错误
            if (severity === 'error') {
                lines = lines.filter(l => l.level === 'error');
            }

            // 按时间排序（最新在前）
            lines.sort((a, b) => (b.time || '').localeCompare(a.time || '') || 0);

            res.json({ ok: true, data: { lines: lines.slice(0, limit), total: lines.length } });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 下载日志
    app.get('/api/logs/download', adminRequired, (req, res) => {
        try {
            const format = String(req.query.format || 'txt').trim();
            const source = String(req.query.source || 'all').trim();

            // 复用聚合接口获取数据
            const mockReq = { query: { ...req.query, limit: '5000' }, currentUser: req.currentUser };
            let lines = [];
            const CAPTURE_FILE = getDataFile('capture-system.log');

            if (source === 'all' || source === 'capture') {
                try {
                    if (fs.existsSync(CAPTURE_FILE)) {
                        const content = fs.readFileSync(CAPTURE_FILE, 'utf8');
                        for (const line of content.split('\n').filter(Boolean)) {
                            lines.push(line);
                        }
                    }
                } catch {}
            }
            if (source === 'all' || source === 'global') {
                const entries = provider.getLogs('all', { limit: 1000 });
                for (const e of entries) {
                    lines.push(`[${e.time}] [${e.tag}] ${e.msg}${e.isWarn ? ' [WARN]' : ''}`);
                }
            }
            if (source === 'all' || source === 'account') {
                const accEntries = provider.getAccountLogs ? provider.getAccountLogs(300) : [];
                for (const e of accEntries) {
                    lines.push(`[${e.time}] [${e.action}] ${e.msg}`);
                }
            }

            lines.sort().reverse();

            if (format === 'json') {
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition', `attachment; filename="qq-farm-logs-${new Date().toISOString().slice(0, 10)}.json"`);
                return res.json({ ok: true, data: { lines, count: lines.length, exportedAt: new Date().toISOString() } });
            }

            const content = lines.join('\n');
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="qq-farm-logs-${new Date().toISOString().slice(0, 10)}.txt"`);
            res.send(content);
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 服务器运行信息
    app.get('/api/system/info', adminRequired, (req, res) => {
        try {
            const execSync = require('child_process').execSync;
            let cpuLoad = 'N/A';
            let memoryInfo = { total: 'N/A', used: 'N/A', percent: 'N/A' };
            let uptimeDays = 0;
            let nodeVersion = process.version;
            let pid = process.pid;

            try {
                const load = execSync('cat /proc/loadavg 2>/dev/null | cut -d" " -f1-3 || true', { timeout: 3000 }).toString().trim();
                if (load) cpuLoad = load;
            } catch {}

            try {
                const mem = execSync('free -m 2>/dev/null | grep Mem || true', { timeout: 3000 }).toString().trim().split(/\s+/);
                if (mem.length >= 3) {
                    memoryInfo = { total: mem[1] + 'MB', used: mem[2] + 'MB', percent: Math.round(parseInt(mem[2]) / parseInt(mem[1]) * 100) + '%' };
                }
            } catch {}

            try {
                uptimeDays = Math.floor(process.uptime() / 86400);
            } catch {}

            // 工作者和账户统计
            const accounts = typeof store.getAccounts === 'function' ? store.getAccounts() : { accounts: [] };
            const allAccounts = Array.isArray(accounts.accounts) ? accounts.accounts : [];
            const workerCount = provider.getWorkerCount ? provider.getWorkerCount() : 0;

            // sniff状态
            let sniffRunning = false;
            try {
                const health = execSync('curl -s --max-time 2 http://127.0.0.1:9988/health 2>/dev/null || true', { timeout: 3000 }).toString().trim();
                sniffRunning = health === 'ok';
            } catch {}
            if (!sniffRunning) {
                try {
                    const listening = execSync('ss -tlnp 2>/dev/null | grep -q ":9988 " && echo 1 || echo 0', { timeout: 3000 }).toString().trim();
                    sniffRunning = listening === '1';
                } catch {}
            }

            res.json({
                ok: true,
                data: {
                    uptime: process.uptime(),
                    uptimeDays,
                    nodeVersion,
                    pid,
                    cpuLoad,
                    memory: memoryInfo,
                    workerCount,
                    totalAccounts: allAccounts.length,
                    sniffRunning,
                    snapshot: {
                        globalLogsCount: provider.getLogs ? provider.getLogs('all', { limit: 10000 }).length : 0,
                        captureLogFile: fs.existsSync(getDataFile('capture-system.log')) ? (fs.statSync(getDataFile('capture-system.log')).size || 0) : 0,
                    },
                },
            });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ============ 一键全栈配置脚本下载 ============
    app.get('/api/pc-capture/download-ps1', (req, res) => {
        try {
            // 获取公网IP
            let publicIp = process.env.FARM_PUBLIC_IP || '';
            if (!publicIp) {
                try {
                    const execSync = require('child_process').execSync;
                    publicIp = execSync('curl -s --max-time 5 ifconfig.me 2>/dev/null || curl -s --max-time 5 ip.sb 2>/dev/null || true', { timeout: 8000 }).toString().trim();
                } catch {}
            }
            if (!publicIp) publicIp = 'SERVER_IP';

            const sniffPort = Number(process.env.FARM_CAPTURE_PORT) || 9988;
            const panelPort = Number(process.env.ADMIN_PORT) || 3000;

            // 读取模板文件并替换占位符
            const templatePath = path.join(__dirname, '..', '..', '..', 'tools', 'qq-farm-patch.ps1');
            if (!fs.existsSync(templatePath)) {
                return res.status(500).json({ ok: false, error: '模板文件未找到' });
            }
            let content = fs.readFileSync(templatePath, 'utf8');
            content = content.replace(/\{\{SERVER_IP\}\}/g, publicIp);
            content = content.replace(/\{\{SNIFF_PORT\}\}/g, String(sniffPort));
            content = content.replace(/\{\{PANEL_PORT\}\}/g, String(panelPort));

            res.setHeader('Content-Type', 'application/octet-stream; charset=utf-8');
            res.setHeader('Content-Disposition', 'attachment; filename="qq-farm-patch.ps1"');
            res.send(content);
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 跨平台一键脚本下载（支持 ?os=windows|macos|linux 参数）
    app.get('/api/pc-capture/download-script', (req, res) => {
        try {
            const osParam = String(req.query.os || '').trim().toLowerCase();
            let templateFile = 'qq-farm-patch.ps1';
            let fileName = 'qq-farm-patch.ps1';

            if (osParam === 'windows') {
                templateFile = 'qq-farm-patch.bat';
                fileName = 'qq-farm-patch.bat';
            } else if (osParam === 'macos' || osParam === 'linux' || osParam === 'mac') {
                templateFile = 'qq-farm-patch.sh';
                fileName = 'qq-farm-patch.sh';
            }

            // 获取公网IP
            let publicIp = process.env.FARM_PUBLIC_IP || '';
            if (!publicIp) {
                try {
                    const execSync = require('child_process').execSync;
                    publicIp = execSync('curl -s --max-time 5 ifconfig.me 2>/dev/null || curl -s --max-time 5 ip.sb 2>/dev/null || true', { timeout: 8000 }).toString().trim();
                } catch {}
            }
            if (!publicIp) publicIp = 'SERVER_IP';

            const sniffPort = Number(process.env.FARM_CAPTURE_PORT) || 9988;
            const panelPort = Number(process.env.ADMIN_PORT) || 3000;

            const templatePath = path.join(__dirname, '..', '..', '..', 'tools', templateFile);
            if (!fs.existsSync(templatePath)) {
                return res.status(500).json({ ok: false, error: '模板文件未找到: ' + templateFile });
            }
            let content = fs.readFileSync(templatePath, 'utf8');
            content = content.replace(/\{\{SERVER_IP\}\}/g, publicIp);
            content = content.replace(/\{\{SNIFF_PORT\}\}/g, String(sniffPort));
            content = content.replace(/\{\{PANEL_PORT\}\}/g, String(panelPort));

            res.setHeader('Content-Type', 'application/octet-stream; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
            res.send(content);
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });
    // 用于转发请求到第三方微信登录 API（如 api.aineishe.com）
    app.post('/api/proxy', async (req, res) => {
        const { action, ...params } = req.body || {};

        if (!action) {
            return res.status(400).json({ code: -1, msg: '缺少 action 参数' });
        }

        // 从请求头或配置中获取 API 配置
        // 优先使用请求头中的配置（前端传入）
        const apiUrl = req.headers['x-proxy-api-url'] || process.env.WX_PROXY_API_URL || 'https://api.aineishe.com/api/wxnc';
        const apiKey = req.headers['x-proxy-api-key'] || process.env.WX_PROXY_API_KEY || '';
        const appId = req.headers['x-proxy-app-id'] || process.env.WX_PROXY_APP_ID || 'wx5306c5978fdb76e4';

        if (!apiKey) {
            return res.status(400).json({ code: -1, msg: '缺少 API Key' });
        }

        // 如果是 jslogin 动作，自动添加 appid
        if (action === 'jslogin') {
            params.appid = appId;
        }

        try {
            const url = `${apiUrl}?api_key=${encodeURIComponent(apiKey)}&action=${action}`;
            adminLogger.info('proxy request', { action, apiUrl });

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params)
            });

            const data = await response.json();
            res.json(data);
        } catch (error) {
            adminLogger.error('proxy error', { error: error.message, action });
            res.status(500).json({
                code: -1,
                msg: `代理请求失败: ${  error.message}`,
            });
        }
    });

    app.get('*', (req, res) => {
        if (req.path.startsWith('/api') || req.path.startsWith('/game-config')) {
             return res.status(404).json({ ok: false, error: 'Not Found' });
        }
        if (fs.existsSync(webDist)) {
            res.sendFile(path.join(webDist, 'index.html'));
        } else {
            res.status(404).send('web build not found. Please build the web project.');
        }
    });

    const applySocketSubscription = (socket, accountRef = '') => {
        const incoming = String(accountRef || '').trim();
        const resolved = incoming && incoming !== 'all' ? resolveAccId(incoming) : '';

        // 获取当前用户信息
        const token = socket.data.adminToken;
        const currentUser = token ? tokenUserMap.get(token) : null;

        // 检查权限：如果指定了账号ID，检查用户是否有权访问
        if (resolved && currentUser) {
            const accounts = getAccountList();
            const account = accounts.find(a => a.id === resolved);
            if (!account || account.username !== currentUser.username) {
                // 无权访问，拒绝订阅
                socket.emit('subscribed', { accountId: 'all', error: '无权访问此账号' });
                // 只订阅all频道（空数据）
                for (const room of socket.rooms) {
                    if (room.startsWith('account:')) socket.leave(room);
                }
                socket.join('account:all');
                socket.data.accountId = '';
                return;
            }
        }

        for (const room of socket.rooms) {
            if (room.startsWith('account:')) socket.leave(room);
        }
        if (resolved) {
            socket.join(`account:${resolved}`);
            socket.data.accountId = resolved;
        } else {
            socket.join('account:all');
            socket.data.accountId = '';
        }
        socket.emit('subscribed', { accountId: socket.data.accountId || 'all' });

        try {
            const targetId = socket.data.accountId || '';
            const user = socket.data.user;

            if (targetId && provider && typeof provider.getStatus === 'function') {
                const currentStatus = provider.getStatus(targetId);
                socket.emit('status:update', { accountId: targetId, status: currentStatus });
            }
            if (provider && typeof provider.getLogs === 'function') {
                let currentLogs = provider.getLogs(targetId, { limit: 100 });
                if (!Array.isArray(currentLogs)) currentLogs = [];

                // 过滤日志：只返回用户有权限访问的账号的日志
                if (user) {
                    const accessibleIds = getAccessibleAccountIdsForUser(user);
                    currentLogs = currentLogs.filter(log => {
                        const logAccountId = log.accountId || log.id;
                        // 如果没有账号ID，只返回给用户自己的日志（系统日志）
                        if (!logAccountId) return true;
                        return accessibleIds.includes(logAccountId);
                    });
                }

                socket.emit('logs:snapshot', {
                    accountId: targetId || 'all',
                    logs: currentLogs,
                });
            }
            if (provider && typeof provider.getAccountLogs === 'function') {
                let currentAccountLogs = provider.getAccountLogs(100);
                if (!Array.isArray(currentAccountLogs)) currentAccountLogs = [];

                // 过滤账号操作日志：只返回用户有权限访问的账号的日志
                if (user) {
                    const accessibleIds = getAccessibleAccountIdsForUser(user);
                    currentAccountLogs = currentAccountLogs.filter(log => {
                        const logAccountId = log.accountId || log.id;
                        return accessibleIds.includes(logAccountId);
                    });
                }

                socket.emit('account-logs:snapshot', {
                    logs: currentAccountLogs,
                });
            }
        } catch {
            // ignore snapshot push errors
        }
    };

    const port = CONFIG.adminPort || 3000;
    server = app.listen(port, '0.0.0.0', () => {
        adminLogger.info('admin panel started', { url: `http://localhost:${port}`, port });
    });

    io = new SocketIOServer(server, {
        path: '/socket.io',
        cors: {
            origin: '*',
            methods: ['GET', 'POST'],
            allowedHeaders: ['x-admin-token', 'x-account-id'],
        },
    });

    io.use((socket, next) => {
        const authToken = socket.handshake.auth && socket.handshake.auth.token
            ? String(socket.handshake.auth.token)
            : '';
        const headerToken = socket.handshake.headers && socket.handshake.headers['x-admin-token']
            ? String(socket.handshake.headers['x-admin-token'])
            : '';
        const token = authToken || headerToken;
        if (!token || !tokens.has(token)) {
            return next(new Error('Unauthorized'));
        }
        socket.data.adminToken = token;
        // 存储用户信息到socket
        socket.data.user = tokenUserMap.get(token);
        return next();
    });

    io.on('connection', (socket) => {
        const initialAccountRef = (socket.handshake.auth && socket.handshake.auth.accountId)
            || (socket.handshake.query && socket.handshake.query.accountId)
            || '';
        applySocketSubscription(socket, initialAccountRef);
        socket.emit('ready', { ok: true, ts: Date.now() });

        socket.on('subscribe', (payload) => {
            const body = (payload && typeof payload === 'object') ? payload : {};
            applySocketSubscription(socket, body.accountId || '');
        });
    });
}

module.exports = {
    startAdminServer,
    emitRealtimeStatus,
    emitRealtimeLog,
    emitRealtimeAccountLog,
};
