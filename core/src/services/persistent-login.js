#!/usr/bin/env node
"use strict";

/**
 * persistent-login.js — 持久化登录管理器
 *
 * 管理游戏会话 (authCode) 的完整生命周期:
 * - load(): 加载已保存的加密会话
 * - save(): 加密保存新会话
 * - validate(): 验证会话是否有效
 * - backup(): 创建备份
 * - restore(): 从备份恢复
 * - refresh(): 尝试刷新会话
 * - invalidate(): 标记会话失效
 *
 * 证据: `docs/persistent_login_design.md` 完整设计
 *       `docs/session.md` 会话分析
 */

const sessionCrypto = require('../utils/session-crypto');
const { SessionValidator } = require('./session-validator');

/**
 * @typedef {object} LoginSession
 * @property {string} accountId - 账号 ID
 * @property {string} code - 登录凭证 (authCode)
 * @property {string} uin - QQ 号
 * @property {number} gid - 游戏 UID
 * @property {string} openId - 开放平台 ID
 * @property {string} nick - 游戏昵称
 * @property {number} expiresAt - 过期时间
 * @property {number} createdAt - 创建时间
 * @property {number} lastValidatedAt - 最后验证时间
 * @property {string} version - 客户端版本
 * @property {object} [metadata] - 扩展元数据
 */

/**
 * @typedef {object} StateChangeEvent
 * @property {string} accountId
 * @property {string} state - 'loaded' | 'valid' | 'expired' | 'refreshing' | 'failed' | 'invalidated'
 * @property {number} timestamp
 * @property {string} [reason]
 */

class PersistentLoginManager {
    /**
     * @param {object} options
     * @param {import('./login-store').LoginStore} options.store - 存储层实例
     * @param {SessionValidator} [options.validator] - 会话验证器
     * @param {boolean} [options.autoValidateOnLoad=true] - 加载时自动验证
     * @param {boolean} [options.enableBackup=true] - 启用自动备份
     */
    constructor(options) {
        if (!options.store) throw new Error('PersistentLoginManager: store is required');

        this.store = options.store;
        this.validator = options.validator || new SessionValidator();
        this.autoValidateOnLoad = options.autoValidateOnLoad !== false;
        this.enableBackup = options.enableBackup !== false;

        /** @type {Map<string, LoginSession>} */
        this._sessions = new Map();

        /** @type {Map<string, string>} */
        this._states = new Map();

        /** @type {Array<(event: StateChangeEvent) => void>} */
        this._listeners = [];
    }

    /**
     * 初始化管理器
     */
    async init() {
        await this.store.init();
    }

    /**
     * 注册状态变更监听器
     * @param {(event: StateChangeEvent) => void} listener
     */
    onStateChange(listener) {
        this._listeners.push(listener);
    }

    /**
     * 触发状态变更事件
     * @param {string} accountId
     * @param {string} state
     * @param {string} [reason]
     */
    _emitStateChange(accountId, state, reason) {
        const event = { accountId, state, timestamp: Date.now(), reason };
        for (const listener of this._listeners) {
            try { listener(event); } catch (_) {}
        }
    }

    /**
     * 加载已保存的会话
     *
     * 从加密存储中读取并解密会话
     *
     * @param {string} accountId
     * @returns {Promise<LoginSession|null>}
     *
     * 异常: 存储损坏 → 尝试从备份恢复
     *       密码错误 → 解密失败返回 null
     *       没找到 → 返回 null
     */
    async load(accountId) {
        const stored = await this.store.read(accountId);
        if (!stored) return null;

        // 解密 code
        let decrypted;
        try {
            decrypted = sessionCrypto.decrypt({
                encrypted: stored.encryptedCode,
                iv: stored.iv,
                salt: stored.salt,
                authTag: stored.authTag,
            }, this.store.cryptoPassword);
        } catch (_) {
            decrypted = null;
        }

        if (!decrypted || !decrypted.code) {
            console.warn(`[PLM] 会话 ${accountId} 解密失败（密码可能已变更）`);
            return null;
        }

        const session = {
            accountId,
            code: decrypted.code,
            uin: stored.metadata?.uin || '',
            gid: stored.metadata?.gid || 0,
            openId: stored.metadata?.openId || '',
            nick: stored.metadata?.nick || '',
            platform: stored.metadata?.platform || 'qq',
            version: stored.metadata?.version || '',
            createdAt: stored.metadata?.createdAt || Date.now(),
            lastValidatedAt: stored.metadata?.lastValidatedAt || 0,
            expiresAt: stored.metadata?.expiresAt || 0,
            metadata: stored.metadata || {},
        };

        this._sessions.set(accountId, session);
        this._states.set(accountId, 'loaded');
        this._emitStateChange(accountId, 'loaded');

        // 自动验证
        if (this.autoValidateOnLoad) {
            const result = await this.validate(accountId);
            if (!result.valid) {
                this._states.set(accountId, 'expired');
                this._emitStateChange(accountId, 'expired', result.reason);
            }
        }

        return session;
    }

    /**
     * 保存新会话
     *
     * 加密保存到 session-store.json
     *
     * @param {LoginSession} session
     * @returns {Promise<void>}
     */
    async save(session) {
        if (!session.accountId) throw new Error('PLM: accountId is required');
        if (!session.code) throw new Error('PLM: code is required');

        await this.store.write(session.accountId, {
            code: session.code,
            uin: session.uin || '',
            gid: session.gid || 0,
            nick: session.nick || '',
            openId: session.openId || '',
            platform: session.platform || 'qq',
            version: session.version || '',
            createdAt: session.createdAt || Date.now(),
            lastValidatedAt: session.lastValidatedAt || Date.now(),
            expiresAt: session.expiresAt || 0,
        });

        this._sessions.set(session.accountId, session);
        this._states.set(session.accountId, 'valid');
        this._emitStateChange(session.accountId, 'valid');
    }

    /**
     * 验证会话是否有效
     *
     * 通过 WebSocket 连接服务器验证 code
     *
     * @param {string} accountId
     * @param {object} [options]
     * @param {number} [options.timeout=10000]
     * @returns {Promise<import('./session-validator').ValidationResult>}
     */
    async validate(accountId, options = {}) {
        const session = this._sessions.get(accountId);
        if (!session) {
            return {
                valid: false,
                code: 'session_not_found',
                reason: '会话未加载',
                canRefresh: false,
            };
        }

        this._emitStateChange(accountId, 'validating');
        const result = await this.validator.validate(session.code, options);

        if (result.valid) {
            // 更新元数据
            session.gid = result.gid || session.gid;
            session.nick = result.name || session.nick;
            session.level = result.level || session.level;
            session.lastValidatedAt = Date.now();

            // 持久化更新
            await this.store.write(accountId, {
                code: session.code,
                uin: session.uin,
                gid: session.gid,
                nick: session.nick,
                platform: session.platform,
                version: session.version,
                createdAt: session.createdAt,
                lastValidatedAt: Date.now(),
            });

            this._states.set(accountId, 'valid');
            this._emitStateChange(accountId, 'valid');
        }

        return result;
    }

    /**
     * 创建备份
     * @returns {Promise<string>} 备份 ID
     */
    async backup() {
        const backupId = sessionCrypto.generateId();
        const accounts = Array.from(this._sessions.entries())
            .map(([id, session]) => ({
                accountId: id,
                code: session.code,
                uin: session.uin,
                gid: session.gid,
                nick: session.nick,
            }));

        // 逐个备份
        for (const account of accounts) {
            const stored = await this.store.read(account.accountId);
            if (stored) {
                // 标记为备份
                stored.backupOf = account.accountId;
                // 使用特殊 key 存储备份
                await this.store.write(`__backup__${backupId}__${account.accountId}`, {
                    code: account.code,
                    uin: account.uin,
                    gid: account.gid,
                    nick: account.nick,
                });
            }
        }

        console.log(`[PLM] 备份创建: ${backupId} (${accounts.length} 个会话)`);
        return backupId;
    }

    /**
     * 从备份恢复
     *
     * @param {string} backupId
     * @param {string} accountId
     * @returns {Promise<LoginSession|null>}
     *
     * 异常: 备份不存在 → null
     *       解密失败 → null
     */
    async restore(backupId, accountId) {
        const backupKey = `__backup__${backupId}__${accountId}`;
        const stored = await this.store.read(backupKey);
        if (!stored) return null;

        let decrypted;
        try {
            decrypted = sessionCrypto.decrypt({
                encrypted: stored.encryptedCode,
                iv: stored.iv,
                salt: stored.salt,
                authTag: stored.authTag,
            }, this.store.cryptoPassword);
        } catch (_) {
            decrypted = null;
        }

        if (!decrypted || !decrypted.code) return null;

        const session = {
            accountId,
            code: decrypted.code,
            uin: stored.metadata?.uin || '',
            gid: stored.metadata?.gid || 0,
            nick: stored.metadata?.nick || '',
            createdAt: stored.metadata?.createdAt || Date.now(),
            lastValidatedAt: 0,
        };

        this._sessions.set(accountId, session);
        this._emitStateChange(accountId, 'restored', `从备份 ${backupId} 恢复`);

        return session;
    }

    /**
     * 刷新会话
     *
     * 腾讯不提供自动刷新机制，此方法检查是否能通过备用方式恢复
     *
     * @param {string} accountId
     * @returns {Promise<{ success: boolean, newSession?: LoginSession, strategy: string }>}
     *
     * 结论: 腾讯不支持 Code Rotation / Silent Refresh / Refresh Token
     *       唯一方式: 重新扫码 (manual)
     */
    async refresh(accountId) {
        const session = this._sessions.get(accountId);
        if (!session) {
            return { success: false, strategy: 'none' };
        }

        this._emitStateChange(accountId, 'refreshing');

        // 策略 1: 重新验证（网络错误时可重试）
        if (this.validator.validateFormat(session.code)) {
            const result = await this.validate(accountId, { timeout: 5000 });
            if (result.valid) {
                this._emitStateChange(accountId, 'valid', '重验证成功');
                return { success: true, newSession: session, strategy: 'revalidate' };
            }

            if (result.code === 'network_error') {
                // 网络错误可重试
                return { success: false, strategy: 'retry_later' };
            }
        }

        // 策略 2: 检查备份
        // (无自动刷新，需要人工扫码)

        this._states.set(accountId, 'failed');
        this._emitStateChange(accountId, 'failed', '需要重新扫码');
        return { success: false, strategy: 'manual' };
    }

    /**
     * 标记会话失效
     *
     * @param {string} accountId
     * @param {string} [reason='unknown'] - 失效原因
     * @returns {Promise<void>}
     */
    async invalidate(accountId, reason = 'unknown') {
        this._states.set(accountId, 'invalidated');
        this._emitStateChange(accountId, 'invalidated', reason);
        // 保留加密存储，但标记需要更新
    }

    /**
     * 获取会话状态
     * @param {string} accountId
     * @returns {string|null} 'loaded' | 'valid' | 'expired' | 'failed' | 'invalidated' | null
     */
    getState(accountId) {
        return this._states.get(accountId) || null;
    }

    /**
     * 获取会话对象
     * @param {string} accountId
     * @returns {LoginSession|undefined}
     */
    getSession(accountId) {
        return this._sessions.get(accountId);
    }

    /**
     * 获取所有已加载的会话摘要
     * @returns {Array<{ accountId: string, uin: string, nick: string, state: string, lastValidatedAt: number }>}
     */
    listSessions() {
        return Array.from(this._sessions.entries()).map(([accountId, session]) => ({
            accountId,
            uin: session.uin,
            nick: session.nick,
            state: this._states.get(accountId) || 'unknown',
            lastValidatedAt: session.lastValidatedAt,
            createdAt: session.createdAt,
        }));
    }

    /**
     * 从 accounts.json 导入现有会话
     * @param {Array} accounts
     * @returns {Promise<number>}
     */
    async importFromAccounts(accounts) {
        return this.store.importFromAccounts(accounts);
    }
}

module.exports = { PersistentLoginManager };
