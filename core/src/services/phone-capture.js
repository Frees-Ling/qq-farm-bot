const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createModuleLogger } = require('./logger');

const logger = createModuleLogger('phone-capture');
const rootDir = path.join(__dirname, '../../..');
const addonPath = path.join(rootDir, 'tools/mitm-qq-farm-code-capture.py');
const logDir = path.join(rootDir, 'logs');

const sessions = new Map();
let activeSessionId = '';

function ensureLogDir() {
    try {
        fs.mkdirSync(logDir, { recursive: true });
    } catch {
        // ignore log directory creation failures; process stderr still carries details
    }
}

function findMitmdump() {
    const explicit = String(process.env.MITMDUMP_BIN || '').trim();
    if (explicit) return explicit;

    const names = process.platform === 'win32' ? ['mitmdump.exe', 'mitmdump.cmd', 'mitmdump'] : ['mitmdump'];
    const dirs = [
        ...String(process.env.PATH || '').split(path.delimiter),
        path.join(os.homedir(), '.local/bin'),
        '/root/.local/bin',
        '/usr/local/bin',
        '/usr/bin',
        '/bin',
    ].filter(Boolean);

    for (const dir of dirs) {
        for (const name of names) {
            const candidate = path.join(dir, name);
            try {
                if (fs.existsSync(candidate)) return candidate;
            } catch {
                // ignore unreadable PATH entries
            }
        }
    }
    return 'mitmdump';
}

function publicSession(session) {
    if (!session) return null;
    return {
        sessionId: session.sessionId,
        username: session.username,
        accountName: session.accountName,
        status: session.status,
        message: session.message,
        port: session.port,
        startedAt: session.startedAt,
        updatedAt: session.updatedAt,
        accountId: session.accountId || '',
        result: session.result || null,
        mitmdump: session.mitmdump || '',
        pid: session.proc && session.proc.pid ? session.proc.pid : 0,
        logPath: session.logPath || '',
        events: Array.isArray(session.events) ? session.events.slice(-20) : [],
        stdoutTail: String(session.stdout || '').slice(-2000),
        stderrTail: String(session.stderr || '').slice(-2000),
    };
}

function addEvent(session, message, extra = {}) {
    if (!session) return;
    const event = {
        time: Date.now(),
        message,
        ...extra,
    };
    session.events = [...(session.events || []), event].slice(-50);
    session.updatedAt = Date.now();
    logger.info(message, {
        sessionId: session.sessionId,
        username: session.username,
        ...extra,
    });
}

function stopSession(session, reason = 'stopped') {
    if (!session || !session.proc || session.proc.killed) return;
    session.message = reason;
    session.updatedAt = Date.now();
    try {
        session.proc.kill('SIGTERM');
    } catch {
        // ignore process teardown races
    }
}

function startCapture(options = {}) {
    const username = String(options.username || 'admin').trim() || 'admin';
    const accountName = String(options.accountName || '').trim();
    const panelApi = String(options.panelApi || 'http://127.0.0.1:3000/api/code-capture').trim();
    const port = Number.parseInt(String(options.port || process.env.FARM_PHONE_PROXY_PORT || '8899'), 10) || 8899;
    const listenHost = String(options.listenHost || process.env.FARM_PHONE_PROXY_LISTEN_HOST || '0.0.0.0');
    const mitmdump = findMitmdump();
    const logPath = String(process.env.FARM_CAPTURE_LOG || path.join(logDir, 'phone-code-capture.log'));
    ensureLogDir();

    if (activeSessionId) {
        const active = sessions.get(activeSessionId);
        if (active && active.status === 'running') {
            stopSession(active, 'replaced by new capture session');
            active.status = 'stopped';
        }
    }

    const sessionId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
    const session = {
        sessionId,
        username,
        accountName,
        port,
        status: 'starting',
        message: '正在启动监听',
        startedAt: Date.now(),
        updatedAt: Date.now(),
        proc: null,
        stdout: '',
        stderr: '',
        events: [],
        mitmdump,
        logPath,
    };
    sessions.set(sessionId, session);
    activeSessionId = sessionId;

    const env = {
        ...process.env,
        FARM_CAPTURE_USERNAME: username,
        FARM_CAPTURE_ACCOUNT_NAME: accountName,
        FARM_CAPTURE_SESSION_ID: sessionId,
        FARM_PANEL_API: panelApi,
        FARM_CAPTURE_ONESHOT: '1',
        FARM_CAPTURE_LOG: logPath,
        PATH: [
            String(process.env.PATH || ''),
            path.join(os.homedir(), '.local/bin'),
            '/root/.local/bin',
            '/usr/local/bin',
            '/usr/bin',
            '/bin',
        ].filter(Boolean).join(path.delimiter),
    };

    const args = [
        '--listen-host', listenHost,
        '--listen-port', String(port),
        '--mode', 'regular',
        '--set', 'block_global=false',
        '-s', addonPath,
    ];

    try {
        addEvent(session, 'starting phone proxy capture', {
            mitmdump,
            port,
            listenHost,
            panelApi,
            addonPath,
            logPath,
        });
        const proc = spawn(mitmdump, args, {
            cwd: rootDir,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        session.proc = proc;
        session.status = 'running';
        session.message = '监听已启动';
        session.updatedAt = Date.now();
        addEvent(session, 'phone proxy capture process started', {
            pid: proc.pid || 0,
        });

        proc.stdout.on('data', (chunk) => {
            session.stdout = `${session.stdout}${chunk}`.slice(-4000);
        });
        proc.stderr.on('data', (chunk) => {
            session.stderr = `${session.stderr}${chunk}`.slice(-4000);
        });
        proc.on('error', (error) => {
            session.status = 'error';
            session.message = error.code === 'ENOENT'
                ? '服务器找不到 mitmdump，请安装 mitmproxy 或设置 MITMDUMP_BIN'
                : error.message;
            session.updatedAt = Date.now();
            addEvent(session, 'phone proxy capture spawn failed', {
                error: error.message,
                code: error.code || '',
            });
            logger.warn('phone capture spawn failed', { error: error.message });
        });
        proc.on('exit', (code, signal) => {
            if (session.status === 'complete') {
                session.message = '账号已创建';
            } else if (session.status !== 'error' && session.status !== 'stopped') {
                session.status = code === 0 ? 'stopped' : 'error';
                session.message = code === 0 ? '监听已结束' : `监听已退出 code=${code} signal=${signal || 'none'}`;
            }
            session.updatedAt = Date.now();
            addEvent(session, 'phone proxy capture process exited', {
                code,
                signal: signal || '',
                stdoutTail: session.stdout.slice(-800),
                stderrTail: session.stderr.slice(-800),
            });
            if (activeSessionId === sessionId) activeSessionId = '';
        });
    } catch (error) {
        session.status = 'error';
        session.message = error.message;
        session.updatedAt = Date.now();
        addEvent(session, 'phone proxy capture start failed', {
            error: error.message,
        });
        logger.warn('phone capture start failed', { error: error.message });
    }

    return publicSession(session);
}

function getStatus(sessionId = '', username = '') {
    const id = String(sessionId || '').trim();
    if (id && sessions.has(id)) return publicSession(sessions.get(id));
    const user = String(username || '').trim();
    if (user) {
        const list = [...sessions.values()]
            .filter(s => s.username === user)
            .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
        return publicSession(list[0]);
    }
    return publicSession(activeSessionId ? sessions.get(activeSessionId) : null);
}

function stopCapture(sessionId = '') {
    const session = sessions.get(String(sessionId || activeSessionId || '').trim());
    if (!session) return null;
    if (session.status === 'complete') return publicSession(session);
    session.status = 'stopped';
    stopSession(session, '用户关闭监听');
    return publicSession(session);
}

function markCaptured(sessionId = '', username = '', result = {}) {
    let session = null;
    const id = String(sessionId || '').trim();
    if (id && sessions.has(id)) {
        session = sessions.get(id);
    }
    if (!session) {
        const user = String(username || '').trim();
        session = [...sessions.values()]
            .filter(s => s.username === user && ['starting', 'running'].includes(s.status))
            .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))[0] || null;
    }
    if (!session) return null;

    session.status = 'complete';
    session.message = '账号已创建';
    session.result = result;
    session.accountId = String(result.accountId || '');
    session.updatedAt = Date.now();
    stopSession(session, 'capture complete');
    return publicSession(session);
}

// 微信QR session管理
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
    if (wxQrSessions[uuid]) Object.assign(wxQrSessions[uuid], data);
}

module.exports = {
    startCapture,
    getStatus,
    stopCapture,
    markCaptured,
    registerWxQRSession,
    unregisterWxQRSession,
    getWxQRSessions,
    updateWxQRSession,
};
