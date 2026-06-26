const { Buffer } = require('node:buffer');
const EventEmitter = require('node:events');
/**
 * WebSocket 网络层 - 连接/消息编解码/登录/心跳
 */

const process = require('node:process');
const WebSocket = require('ws');
const { ProxyAgent } = require('proxy-agent');
const { CONFIG } = require('../config/config');
const { createScheduler } = require('../services/scheduler');
const { RateLimiter } = require('../services/rate-limiter');
const { updateStatusFromLogin, updateStatusGold, updateStatusLevel } = require('../services/status');
const { recordOperation } = require('../services/stats');
const { types } = require('./proto');
const { toLong, toNum, syncServerTime, log, logWarn } = require('./utils');
const cryptoWasm = require('./crypto-wasm');

// ============ 事件发射器 (用于推送通知) ============
const networkEvents = new EventEmitter();

// ============ 内部状态 ============
let ws = null;
let clientSeq = 1;
let serverSeq = 0;
const pendingCallbacks = new Map();
let wsErrorState = { code: 0, at: 0, message: '' };
let wsUrlFormat = 0;          // 当前使用的 URL 格式索引
let wsUrlFormatRetries = 0;   // URL 格式重试次数
const networkScheduler = createScheduler('network');

// ============ 发送限速（避免批量操作触发服务端限流） ============
// 默认启用；如需关闭，设置环境变量 NETWORK_RATE_LIMIT=0
const enableNetworkRateLimit = String(process.env.NETWORK_RATE_LIMIT ?? '1') !== '0';
const networkRateLimiter = new RateLimiter({
    maxConcurrent: Number(process.env.NETWORK_RATE_LIMIT_CONCURRENCY || 3) || 3,
    minInterval: Number(process.env.NETWORK_RATE_LIMIT_MIN_INTERVAL || 50) || 50,
    maxRetries: 0,
    retryDelay: 0,
});

function rejectAllPendingRequests(reason = '请求被中断') {
    const entries = Array.from(pendingCallbacks.entries());
    pendingCallbacks.clear();
    for (const [, callback] of entries) {
        try {
            callback(new Error(reason));
        } catch {
            // ignore callback failure
        }
    }
    return entries.length;
}

// ============ 用户状态 (登录后设置) ============
const userState = {
    gid: 0,
    name: '',
    level: 0,
    gold: 0,
    exp: 0,
    coupon: 0,
};

function getUserState() { return userState; }
function getWsErrorState() { return { ...wsErrorState }; }
function setWsErrorState(code, message) {
    wsErrorState = { code: Number(code) || 0, at: Date.now(), message: message || '' };
}
function clearWsErrorState() {
    wsErrorState = { code: 0, at: 0, message: '' };
}
function hasOwn(obj, key) {
    return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

// ============ 消息编解码 ============
async function encodeMsg(serviceName, methodName, bodyBytes, seqValue) {
    let finalBody = bodyBytes || Buffer.alloc(0);
    try {
        finalBody = await cryptoWasm.encryptBuffer(finalBody);
    } catch (e) {
        logWarn('系统', `WASM加密失败: ${e.message}`);
    }

    const msg = types.GateMessage.create({
        meta: {
            service_name: serviceName,
            method_name: methodName,
            message_type: 1,
            client_seq: toLong(seqValue),
            server_seq: toLong(serverSeq),
        },
        body: finalBody,
    });
    return types.GateMessage.encode(msg).finish();
}

async function sendMsg(serviceName, methodName, bodyBytes, callback) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        log('系统', '[WS] 连接未打开');
        if (callback) callback(new Error('连接未打开'));
        return false;
    }
    const seq = clientSeq;
    clientSeq += 1;

    let encoded;
    try {
        encoded = await encodeMsg(serviceName, methodName, bodyBytes, seq);
    } catch (err) {
        if (callback) callback(err);
        return false;
    }

    if (callback) pendingCallbacks.set(seq, callback);

    if (!ws || ws.readyState !== WebSocket.OPEN) {
        if (callback) {
            pendingCallbacks.delete(seq);
            callback(new Error('连接已在加密途中关闭'));
        }
        return false;
    }

    try {
        ws.send(encoded);
    } catch (err) {
        if (callback) {
            pendingCallbacks.delete(seq);
            callback(err);
        }
        return false;
    }
    return true;
}

function sendMsgAsyncInternal(serviceName, methodName, bodyBytes, timeout = 10000) {
    return new Promise((resolve, reject) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            reject(new Error(`连接未打开: ${methodName}`));
            return;
        }

        const seq = clientSeq;
        const timeoutKey = `request_timeout_${seq}`;
        networkScheduler.setTimeoutTask(timeoutKey, timeout, () => {
            pendingCallbacks.delete(seq);
            const pending = pendingCallbacks.size;
            reject(new Error(`请求超时: ${methodName} (seq=${seq}, pending=${pending})`));
        });

        sendMsg(serviceName, methodName, bodyBytes, (err, body, meta) => {
            networkScheduler.clear(timeoutKey);
            if (err) reject(err);
            else resolve({ body, meta });
        }).then(sent => {
            if (!sent) {
                networkScheduler.clear(timeoutKey);
            }
        }).catch(err => {
            networkScheduler.clear(timeoutKey);
            reject(err);
        });
    });
}

/**
 * 发送请求（带可选限速）
 * options:
 * - bypassRateLimit: true 时跳过全局限速（用于强实时场景）
 * - priority: 数字越大越优先
 */
function sendMsgAsync(serviceName, methodName, bodyBytes, timeout = 10000, options = {}) {
    const bypass = !!options.bypassRateLimit;
    const priority = Number(options.priority || 0) || 0;
    if (!enableNetworkRateLimit || bypass) {
        return sendMsgAsyncInternal(serviceName, methodName, bodyBytes, timeout);
    }
    return networkRateLimiter.add(
        () => sendMsgAsyncInternal(serviceName, methodName, bodyBytes, timeout),
        { priority },
    );
}

// ============ 消息处理 ============
function handleMessage(data) {
    try {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        const msg = types.GateMessage.decode(buf);
        const meta = msg.meta;
        if (!meta) return;

        if (meta.server_seq) {
            const seq = toNum(meta.server_seq);
            if (seq > serverSeq) serverSeq = seq;
        }

        const msgType = meta.message_type;

        if (msgType === 3) {
            handleNotify(msg);
            return;
        }

        if (msgType === 2) {
            const errorCode = toNum(meta.error_code);
            const clientSeqVal = toNum(meta.client_seq);

            const cb = pendingCallbacks.get(clientSeqVal);
            if (cb) {
                pendingCallbacks.delete(clientSeqVal);
                if (errorCode !== 0) {
                    cb(new Error(`${meta.service_name}.${meta.method_name} 错误: code=${errorCode} ${meta.error_message || ''}`));
                } else {
                    cb(null, msg.body, meta);
                }
                return;
            }

            if (errorCode !== 0) {
                logWarn('错误', `${meta.service_name}.${meta.method_name} code=${errorCode} ${meta.error_message || ''}`);
            }
        }
    } catch (err) {
        logWarn('解码', err.message);
    }
}

// ============ 通知处理器映射 ============
const notifyHandlers = new Map();

// 尝试获取今天的日期后缀
function getTodayDateSuffix() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `_${y}${m}${d}`;
}

// 尝试解析版本号并递增（始终包含日期后缀）
function bumpClientVersion(currentVer) {
    const str = String(currentVer || '').trim();
    // 尝试匹配 X.Y.Z.W 或 X.Y.Z.W_YYYYMMDD
    const match = str.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)(?:_(\d+))?$/);
    if (!match) {
        return `1.12.1.6${getTodayDateSuffix()}`;
    }
    const major = parseInt(match[1], 10);
    const minor = parseInt(match[2], 10);
    const build = parseInt(match[3], 10);
    const patch = parseInt(match[4], 10);

    let newMajor = major, newMinor = minor, newBuild = build, newPatch = patch;

    // 根据重试次数使用不同策略
    if (versionBumpRetries === 0) {
        newPatch = patch + 1;       // 1.12.1.7
    } else if (versionBumpRetries === 1) {
        newPatch = patch + 5;       // 1.12.1.11
    } else if (versionBumpRetries === 2) {
        newBuild = build + 1;       // 1.12.2.0
        newPatch = 0;
    } else if (versionBumpRetries === 3) {
        newMinor = minor + 1;       // 1.13.0.0
        newBuild = 0;
        newPatch = 0;
    } else {
        newMajor = major + 1;       // 2.0.0.0
        newMinor = 0;
        newBuild = 0;
        newPatch = 0;
    }
    return `${newMajor}.${newMinor}.${newBuild}.${newPatch}${getTodayDateSuffix()}`;
}

// 版本过低自动重试次数（防止无限循环）
let versionBumpRetries = 0;
const MAX_VERSION_BUMPS = 5;

notifyHandlers.set('Kickout', (eventBody) => {
    const notify = types.KickoutNotify.decode(eventBody);
    const reason = String(notify.reason_message || '未知');
    log('推送', `原因: ${reason}`);

    // 如果是因为版本过低，自动递增版本号并重连
    if ((reason.includes('版本过低') || reason.includes('version')) && versionBumpRetries < MAX_VERSION_BUMPS) {
        const oldVersion = CONFIG.clientVersion;
        CONFIG.clientVersion = bumpClientVersion(CONFIG.clientVersion);
        versionBumpRetries++;
        log('系统', `客户端版本过低 (${oldVersion})，自动递增至 ${CONFIG.clientVersion} (第${versionBumpRetries}次重试)，断开连接以触发重连...`);
        // 断开连接让上层的 auto_reconnect 逻辑用新版本重连
        if (ws) {
            try {
                ws.close();
            } catch {}
        }
        return;
    }

    // 版本重试耗尽，走正常踢下线流程
    if (reason.includes('版本过低') && versionBumpRetries >= MAX_VERSION_BUMPS) {
        log('系统', `已达最大版本重试次数 (${MAX_VERSION_BUMPS})，放弃重连`);
    }

    networkEvents.emit('kickout', {
        type: 'Kickout',
        reason,
    });
});

notifyHandlers.set('LandsNotify', (eventBody) => {
    const notify = types.LandsNotify.decode(eventBody);
    const hostGid = toNum(notify.host_gid);
    const lands = notify.lands || [];
    if (lands.length > 0 && (hostGid === userState.gid || hostGid === 0)) {
        networkEvents.emit('landsChanged', lands);
    }
});

notifyHandlers.set('ItemNotify', (eventBody) => {
    const notify = types.ItemNotify.decode(eventBody);
    const items = notify.items || [];
    for (const itemChg of items) {
        const item = itemChg.item;
        if (!item) continue;
        const id = toNum(item.id);
        const count = toNum(item.count);
        const delta = toNum(itemChg.delta);

        if (id === 1101) {
            if (count > 0) userState.exp = count;
            else if (delta !== 0) userState.exp = Math.max(0, Number(userState.exp || 0) + delta);
            updateStatusLevel(userState.level, userState.exp);
        } else if (id === 1 || id === 1001) {
            if (count > 0) {
                userState.gold = count;
            } else if (delta !== 0) {
                userState.gold = Math.max(0, Number(userState.gold || 0) + delta);
            }
            updateStatusGold(userState.gold);
        } else if (id === 1002) {
            if (count > 0) {
                userState.coupon = count;
            } else if (delta !== 0) {
                userState.coupon = Math.max(0, Number(userState.coupon || 0) + delta);
            }
        }
    }
});

notifyHandlers.set('BasicNotify', (eventBody) => {
    const notify = types.BasicNotify.decode(eventBody);
    if (!notify.basic) return;
    const oldLevel = userState.level;
    if (hasOwn(notify.basic, 'level')) {
        const nextLevel = toNum(notify.basic.level);
        if (Number.isFinite(nextLevel) && nextLevel > 0) userState.level = nextLevel;
    }
    let shouldUpdateGoldView = false;
    if (hasOwn(notify.basic, 'gold')) {
        const nextGold = toNum(notify.basic.gold);
        if (Number.isFinite(nextGold) && nextGold >= 0) {
            userState.gold = nextGold;
            shouldUpdateGoldView = true;
        }
    }
    if (hasOwn(notify.basic, 'exp')) {
        const exp = toNum(notify.basic.exp);
        if (Number.isFinite(exp) && exp >= 0) {
            userState.exp = exp;
            updateStatusLevel(userState.level, exp);
        }
    }
    if (shouldUpdateGoldView) {
        updateStatusGold(userState.gold);
    }
    if (userState.level !== oldLevel) {
        recordOperation('levelUp', 1);
    }
});

notifyHandlers.set('FriendApplicationReceivedNotify', (eventBody) => {
    const notify = types.FriendApplicationReceivedNotify.decode(eventBody);
    const applications = notify.applications || [];
    if (applications.length > 0) {
        networkEvents.emit('friendApplicationReceived', applications);
    }
});

notifyHandlers.set('FriendAddedNotify', (eventBody) => {
    const notify = types.FriendAddedNotify.decode(eventBody);
    const friends = notify.friends || [];
    if (friends.length > 0) {
        const names = friends.map(f => f.name || f.remark || `GID:${toNum(f.gid)}`).join(', ');
        log('好友', `新好友: ${names}`);
    }
});

notifyHandlers.set('GoodsUnlockNotify', (eventBody) => {
    const notify = types.GoodsUnlockNotify.decode(eventBody);
    const goods = notify.goods_list || [];
    if (goods.length > 0) {
        networkEvents.emit('goodsUnlockNotify', goods);
    }
});

notifyHandlers.set('TaskInfoNotify', (eventBody) => {
    const notify = types.TaskInfoNotify.decode(eventBody);
    if (notify.task_info) {
        networkEvents.emit('taskInfoNotify', notify.task_info);
    }
});

function handleNotify(msg) {
    if (!msg.body || msg.body.length === 0) return;
    try {
        const event = types.EventMessage.decode(msg.body);
        const type = event.message_type || '';
        const eventBody = event.body;

        for (const [key, handler] of notifyHandlers) {
            if (type.includes(key)) {
                try { handler(eventBody); } catch { }
                return;
            }
        }
    } catch (e) {
        logWarn('推送', `解码失败: ${e.message}`);
    }
}

// ============ 登录 ============
function sendLogin(onLoginSuccess) {
    const body = types.LoginRequest.encode(types.LoginRequest.create({
        sharer_id: toLong(0),
        sharer_open_id: '',
        device_info: {
            client_version: CONFIG.clientVersion,
            sys_software: String(CONFIG.device_info?.sys_software || 'iOS 26.2.1'),
            network: String(CONFIG.device_info?.network || 'wifi'),
            memory: String(CONFIG.device_info?.memory || '7672'),
            device_id: String(CONFIG.device_info?.device_id || 'iPhone X<iPhone18,3>'),
        },
        share_cfg_id: toLong(0),
        scene_id: '1256',
        report_data: {
            callback: '', cd_extend_info: '', click_id: '', clue_token: '',
            minigame_channel: 'other', minigame_platid: 2, req_id: '', trackid: '',
        },
    })).finish();

    sendMsg('gamepb.userpb.UserService', 'Login', body, (err, bodyBytes, _meta) => {
        if (err) {
            log('登录', `失败: ${err.message}`);
            if (err.message.includes('code=')) {
                log('系统', '账号验证失败，即将停止运行...');
                networkScheduler.setTimeoutTask('login_error_exit', 1000, () => process.exit(0));
            }
            return;
        }
        try {
            const reply = types.LoginReply.decode(bodyBytes);
            if (reply.basic) {
                // 登录成功，重置版本过低重试计数器
                versionBumpRetries = 0;

                clearWsErrorState();
                userState.gid = toNum(reply.basic.gid);
                userState.name = reply.basic.name || '未知';
                userState.level = toNum(reply.basic.level);
                userState.gold = toNum(reply.basic.gold);
                userState.exp = toNum(reply.basic.exp);

                updateStatusFromLogin({
                    name: userState.name,
                    level: userState.level,
                    gold: userState.gold,
                    exp: userState.exp,
                });

                log('系统', `登录成功: ${userState.name} (Lv${userState.level})`);

                console.warn('');
                console.warn('========== 登录成功 ==========');
                console.warn(`  GID:    ${userState.gid}`);
                console.warn(`  昵称:   ${userState.name}`);
                console.warn(`  等级:   ${userState.level}`);
                console.warn(`  金币:   ${userState.gold}`);
                if (reply.time_now_millis) {
                    syncServerTime(toNum(reply.time_now_millis));
                    console.warn(`  时间:   ${new Date(toNum(reply.time_now_millis)).toLocaleString()}`);
                }
                // 记录并自动更新服务器推荐的版本信息
                if (reply.version_info) {
                    const vi = reply.version_info;
                    console.warn(`  版本状态: ${vi.status || 0}`);
                    console.warn(`  推荐版本: ${vi.version_recommend || '(无)'}`);
                    console.warn(`  强制版本: ${vi.version_force || '(无)'}`);
                    console.warn(`  资源版本: ${vi.res_version || '(无)'}`);
                    const recommended = vi.version_recommend || '';
                    const forced = vi.version_force || '';
                    if (forced && forced !== CONFIG.clientVersion) {
                        log('系统', `服务器强制版本: ${forced} (当前: ${CONFIG.clientVersion})，自动更新`);
                        CONFIG.clientVersion = forced;
                    } else if (recommended && recommended !== CONFIG.clientVersion) {
                        log('系统', `服务器推荐版本: ${recommended} (当前: ${CONFIG.clientVersion})，自动更新`);
                        CONFIG.clientVersion = recommended;
                    }
                }
                console.warn('===============================');
                console.warn('');
            }

            startHeartbeat();
            if (onLoginSuccess) onLoginSuccess();
        } catch (e) {
            log('登录', `解码失败: ${e.message}`);
        }
    });
}

// ============ 心跳 ============
let lastHeartbeatResponse = Date.now();
let heartbeatMissCount = 0;

function startHeartbeat() {
    networkScheduler.clear('heartbeat_interval');
    lastHeartbeatResponse = Date.now();
    heartbeatMissCount = 0;

    networkScheduler.setIntervalTask('heartbeat_interval', CONFIG.heartbeatInterval, () => {
        if (!userState.gid) return;

        const timeSinceLastResponse = Date.now() - lastHeartbeatResponse;
        if (timeSinceLastResponse > 60000) {
            heartbeatMissCount++;
            logWarn('心跳', `连接可能已断开 (${Math.round(timeSinceLastResponse / 1000)}s 无响应, pending=${pendingCallbacks.size})`);
            if (heartbeatMissCount >= 2) {
                log('心跳', '尝试重连...');
                rejectAllPendingRequests('连接超时，已清理');
            }
        }

        const body = types.HeartbeatRequest.encode(types.HeartbeatRequest.create({
            gid: toLong(userState.gid),
            client_version: CONFIG.clientVersion,
        })).finish();
        sendMsg('gamepb.userpb.UserService', 'Heartbeat', body, (err, replyBody) => {
            if (err || !replyBody) return;
            lastHeartbeatResponse = Date.now();
            heartbeatMissCount = 0;
            try {
                const reply = types.HeartbeatReply.decode(replyBody);
                if (reply.server_time) syncServerTime(toNum(reply.server_time));
                // 记录并自动更新服务器推荐的版本信息
                if (reply.version_info) {
                    const vi = reply.version_info;
                    const recommended = vi.version_recommend || '';
                    const forced = vi.version_force || '';
                    if (forced && forced !== CONFIG.clientVersion) {
                        log('版本', `服务器强制版本: ${forced} (当前: ${CONFIG.clientVersion})，自动更新`);
                        CONFIG.clientVersion = forced;
                    } else if (recommended && recommended !== CONFIG.clientVersion) {
                        log('版本', `服务器推荐版本: ${recommended} (当前: ${CONFIG.clientVersion})`);
                        CONFIG.clientVersion = recommended;
                    }
                }
            } catch { }
        });
    });
}

// ============ WebSocket 连接 ============
let savedLoginCallback = null;
let savedCode = null;
let savedProxyUrl = '';
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;

function normalizeProxyUrl(proxyUrl) {
    const value = String(proxyUrl || '').trim();
    if (!value) return '';
    if (/^(https?|socks[45]?):\/\//i.test(value)) return value;
    return `http://${value}`;
}

function buildWsOptions(proxyUrl) {
    const options = {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13)',
            'Origin': 'https://gate-obt.nqf.qq.com',
        },
    };
    const normalizedProxy = normalizeProxyUrl(proxyUrl);
    if (normalizedProxy) {
        options.agent = new ProxyAgent(normalizedProxy);
        log('绯荤粺', `[WS] 使用账号代理: ${normalizedProxy.replace(/:\/\/([^:@/]+):([^@/]+)@/, '://$1:***@')}`);
    }
    return options;
}

// 尝试多种URL格式，用于应对服务器参数变更
function buildWsUrl(code, tryFormat = 0) {
    const base = CONFIG.serverUrl;
    const platform = CONFIG.platform;
    const os = CONFIG.os;
    const ver = CONFIG.clientVersion;
    const encodedCode = encodeURIComponent(code || '');
    // 多种格式以应对服务器更新
    const formats = [
        `${base}?platform=${platform}&os=${os}&ver=${ver}&code=${encodedCode}&openID=`,
        `${base}?platform=${platform}&os=${os}&ver=${ver}&code=${encodedCode}`,
        `${base}?code=${encodedCode}&platform=${platform}&ver=${ver}&os=${os}`,
        `${base}?code=${encodedCode}`,
    ];
    return formats[tryFormat] || formats[0];
}

function connect(code, onLoginSuccess, options = {}) {
    savedLoginCallback = onLoginSuccess;
    if (code) {
        savedCode = code;
        reconnectAttempts = 0; // 新 code 时重置重连计数
    }
    if (hasOwn(options, 'proxyUrl')) savedProxyUrl = normalizeProxyUrl(options.proxyUrl);
    const url = buildWsUrl(savedCode, 0);

    console.log(`\n========================================`);
    console.log(`[WS] 尝试连接服务器: ${CONFIG.serverUrl}`);
    console.log(`[WS] platform=${CONFIG.platform} os=${CONFIG.os} ver=${CONFIG.clientVersion}`);
    console.log(`[WS] code=${String(savedCode || '').substring(0, 30)}...`);
    console.log(`========================================\n`);

    ws = new WebSocket(url, buildWsOptions(savedProxyUrl));

    ws.binaryType = 'arraybuffer';

    ws.on('open', () => {
        console.log(`[WS] ✅ WebSocket 连接成功`);
        reconnectAttempts = 0;
        sendLogin(onLoginSuccess);
    });

    ws.on('message', (data) => {
        handleMessage(Buffer.isBuffer(data) ? data : Buffer.from(data));
    });

    ws.on('close', (code, _reason) => {
        console.warn(`[WS] 连接关闭 (code=${code})`);
        const reason = _reason && _reason.code ? _reason.code : (_reason ? String(_reason) : '');
        console.warn(`[WS] 关闭原因: ${reason}`);
        cleanup(`连接关闭(code=${code})`);
        if (savedLoginCallback) {
            reconnectAttempts++;
            if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                log('系统', `[WS] 已达最大重连次数 (${MAX_RECONNECT_ATTEMPTS})，停止重连，等待新 Code...`);
                // 通知父进程：code 已过期，需要新的登录凭证
                if (typeof process.send === 'function') {
                    process.send({ type: 'login_failed', reason: 'code_expired', accountId: process.env.FARM_ACCOUNT_ID || '' });
                }
                reconnectAttempts = 0;
                return;
            }
            networkScheduler.setTimeoutTask('auto_reconnect', 5000, () => {
                log('系统', `[WS] 尝试自动重连 (第${reconnectAttempts}次)...`);
                reconnect(null);
            });
        }
    });

    ws.on('error', (err) => {
        const message = err && err.message ? String(err.message) : '';
        logWarn('系统', `[WS] 错误: ${message}`);
        console.error(`[WS] ❌ 连接失败: ${message}`);
        console.error(`[WS] 使用的URL: ${url.substring(0, 200)}...`);
        const match = message.match(/Unexpected server response:\s*(\d+)/i);
        if (match) {
            const httpCode = Number.parseInt(match[1], 10) || 0;
            console.error(`[WS] ❌ 服务器返回 HTTP ${httpCode}`);
            // HTTP 400: 尝试不同 URL 格式（最多试4种）
            if (httpCode === 400 && wsUrlFormat < 3) {
                wsUrlFormat++;
                wsUrlFormatRetries++;
                console.log(`[WS] 🔄 尝试 URL 格式 ${wsUrlFormat + 1}/4...`);
                if (ws) { try { ws.removeAllListeners(); ws.close(); } catch(_) {} }
                wsUrlFormat = Math.min(wsUrlFormat, 3);
                const newUrl = buildWsUrl(savedCode, wsUrlFormat);
                ws = new WebSocket(newUrl, buildWsOptions(savedProxyUrl));
                ws.binaryType = 'arraybuffer';
                ws.on('open', () => { wsUrlFormat = 0; sendLogin(onLoginSuccess); });
                ws.on('message', (data) => handleMessage(Buffer.isBuffer(data) ? data : Buffer.from(data)));
                ws.on('close', (c, r) => { cleanup(`连接关闭(code=${c})`); if(savedLoginCallback) networkScheduler.setTimeoutTask('auto_reconnect',5000,()=>{log('系统','[WS] 尝试自动重连...');reconnect(null);}); });
                ws.on('error', (e) => { logWarn('系统',`[WS] 备选URL也失败: ${e.message}`); setWsErrorState(400, e.message); networkEvents.emit('ws_error',{code:400,message:e.message}); });
                return;
            }
            if (httpCode) {
                setWsErrorState(httpCode, message);
                networkEvents.emit('ws_error', { code: httpCode, message });
            }
        } else {
            setWsErrorState(0, message);
            networkEvents.emit('ws_error', { code: 0, message });
        }
        wsUrlFormat = 0; // 重置
    });
}

function cleanup(reason = '网络清理') {
    rejectAllPendingRequests(`请求已中断: ${reason}`);
    networkScheduler.clearAll();
}

function reconnect(newCode) {
    cleanup('主动重连');
    if (ws) {
        ws.removeAllListeners();
        ws.close();
        ws = null;
    }
    userState.gid = 0;
    connect(newCode || savedCode, savedLoginCallback, { proxyUrl: savedProxyUrl });
}

function getWs() { return ws; }

module.exports = {
    connect, reconnect, cleanup, getWs,
    sendMsg, sendMsgAsync,
    getUserState,
    getWsErrorState,
    networkEvents,
};
