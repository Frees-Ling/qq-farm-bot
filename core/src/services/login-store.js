#!/usr/bin/env node
"use strict";

/**
 * login-store.js — 加密会话存储层
 *
 * 管理 session-store.json 的读写，支持:
 * - AES-256-GCM 加密存储
 * - 原子写入 (write-then-rename)
 * - 自动备份 (每次写入保留前一个版本)
 * - 版本号控制 (向前兼容)
 * - 完整性校验 (SHA-256 checksum)
 * - 与现有 accounts.json 兼容读取
 *
 * 证据: `docs/persistent_login_design.md` 存储设计
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sessionCrypto = require('../utils/session-crypto');

const STORE_VERSION = 1;
const MAX_BACKUPS = 3;

/**
 * @typedef {object} StoredSession
 * @property {string} encryptedCode - AES-256-GCM 加密的 code
 * @property {string} iv - 初始化向量 (base64)
 * @property {string} salt - PBKDF2 盐值 (base64)
 * @property {string} authTag - GCM 认证标签 (base64)
 * @property {object} metadata - 未加密的元数据
 * @property {number} version - 存储格式版本
 * @property {string} checksum - SHA-256 完整性校验
 * @property {string|null} backupOf - 备份来源 ID
 */

/**
 * @typedef {object} SessionStoreData
 * @property {number} version - 存储格式版本
 * @property {object<string, StoredSession>} sessions - 会话映射
 * @property {string[]} backupChain - 备份 ID 链
 * @property {number} createdAt - 创建时间戳
 * @property {number} updatedAt - 最后更新时间戳
 */

class LoginStore {
    /**
     * @param {object} options
     * @param {string} options.filePath - session-store.json 路径
     * @param {string} options.cryptoPassword - 加密主密码
     * @param {boolean} [options.autoBackup=true] - 是否自动备份
     * @param {number} [options.maxBackups=3] - 最大备份数
     */
    constructor(options) {
        if (!options.filePath) throw new Error('LoginStore: filePath is required');
        if (!options.cryptoPassword) throw new Error('LoginStore: cryptoPassword is required');

        this.filePath = path.resolve(options.filePath);
        this.bakPath = this.filePath + '.bak';
        this.cryptoPassword = options.cryptoPassword;
        this.autoBackup = options.autoBackup !== false;
        this.maxBackups = options.maxBackups || MAX_BACKUPS;

        // 内存缓存
        this._cache = null;
        this._dirty = false;
    }

    /**
     * 读取存储文件（自动尝试备份恢复）
     * @returns {SessionStoreData}
     */
    _readRaw() {
        // 1. 尝试主文件
        if (fs.existsSync(this.filePath)) {
            try {
                const raw = fs.readFileSync(this.filePath, 'utf8');
                const data = JSON.parse(raw);
                if (data && typeof data === 'object' && data.version) {
                    return data;
                }
            } catch (err) {
                console.warn(`[LoginStore] 主文件损坏: ${err.message}`);
            }
        }

        // 2. 尝试从备份恢复
        if (fs.existsSync(this.bakPath)) {
            try {
                const raw = fs.readFileSync(this.bakPath, 'utf8');
                const data = JSON.parse(raw);
                if (data && typeof data === 'object' && data.version) {
                    console.warn('[LoginStore] 已从备份文件恢复');
                    // 写回主文件
                    this._writeRaw(data);
                    return data;
                }
            } catch (err) {
                console.warn(`[LoginStore] 备份文件也损坏: ${err.message}`);
            }
        }

        // 3. 返回空数据
        return this._emptyData();
    }

    /**
     * @returns {SessionStoreData} 空存储结构
     */
    _emptyData() {
        return {
            version: STORE_VERSION,
            sessions: {},
            backupChain: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
    }

    /**
     * 原子写入存储文件
     * @param {SessionStoreData} data
     */
    _writeRaw(data) {
        const tmpPath = this.filePath + '.tmp.' + crypto.randomBytes(4).toString('hex');
        const json = JSON.stringify(data, null, 2);
        fs.writeFileSync(tmpPath, json, 'utf8');
        fs.renameSync(tmpPath, this.filePath);
    }

    /**
     * 创建备份
     */
    _createBackup() {
        if (!this.autoBackup) return;
        if (!fs.existsSync(this.filePath)) return;

        try {
            // 备份到 .bak
            const content = fs.readFileSync(this.filePath, 'utf8');
            fs.writeFileSync(this.bakPath, content, 'utf8');

            // 管理多版本备份
            const backupDir = path.dirname(this.filePath);
            const backupPrefix = path.basename(this.filePath) + '.v';
            const backups = fs.readdirSync(backupDir)
                .filter(f => f.startsWith(backupPrefix))
                .sort()
                .reverse();

            // 只保留最近 N 个
            while (backups.length >= this.maxBackups) {
                const old = backups.pop();
                try {
                    fs.unlinkSync(path.join(backupDir, old));
                } catch (_) {}
            }

            // 创建版本备份
            const verFile = backupPrefix + Date.now() + '.json';
            fs.writeFileSync(path.join(backupDir, verFile), content, 'utf8');
        } catch (err) {
            console.warn(`[LoginStore] 备份失败: ${err.message}`);
        }
    }

    // ========== 公开 API ==========

    /**
     * 初始化存储（读取或创建）
     * @returns {Promise<void>}
     */
    async init() {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        if (!fs.existsSync(this.filePath)) {
            this._cache = this._emptyData();
            this._writeRaw(this._cache);
        } else {
            this._cache = this._readRaw();
        }
        this._dirty = false;
    }

    /**
     * 读取会话
     * @param {string} accountId
     * @returns {Promise<StoredSession|null>}
     */
    async read(accountId) {
        if (!this._cache) await this.init();
        const session = this._cache.sessions[accountId];
        if (!session) return null;

        // 验证 checksum
        const { checksum: storedChecksum, ...dataToVerify } = session;
        const actualChecksum = sessionCrypto.checksum(dataToVerify);
        if (storedChecksum !== actualChecksum) {
            console.warn(`[LoginStore] 会话 ${accountId} 校验和无效，可能被篡改`);
            return null;
        }
        return session;
    }

    /**
     * 写入会话（自动加密 + 备份）
     * @param {string} accountId
     * @param {object} sessionData - { code, uin, gid, ... }
     * @returns {Promise<void>}
     */
    async write(accountId, sessionData) {
        if (!this._cache) await this.init();

        // 加密 code
        const encrypted = sessionCrypto.encrypt(
            { code: sessionData.code },
            this.cryptoPassword
        );

        // 构建 StoredSession
        const stored = {
            ...encrypted,
            metadata: {
                uin: sessionData.uin || '',
                gid: sessionData.gid || 0,
                nick: sessionData.nick || '',
                platform: sessionData.platform || 'qq',
                createdAt: sessionData.createdAt || Date.now(),
                lastUsedAt: Date.now(),
                lastValidatedAt: sessionData.lastValidatedAt || 0,
                version: sessionData.version || '',
            },
            version: STORE_VERSION,
            checksum: '',
            backupOf: null,
        };

        // 计算校验和
        const { checksum: _, ...checksumData } = stored;
        stored.checksum = sessionCrypto.checksum(checksumData);

        this._cache.sessions[accountId] = stored;
        this._cache.updatedAt = Date.now();
        this._dirty = true;

        this._flush();
    }

    /**
     * 删除会话
     * @param {string} accountId
     * @returns {Promise<void>}
     */
    async delete(accountId) {
        if (!this._cache) await this.init();
        if (this._cache.sessions[accountId]) {
            delete this._cache.sessions[accountId];
            this._cache.updatedAt = Date.now();
            this._dirty = true;
            this._flush();
        }
    }

    /**
     * 列出所有会话 ID
     * @returns {Promise<string[]>}
     */
    async list() {
        if (!this._cache) await this.init();
        return Object.keys(this._cache.sessions);
    }

    /**
     * 列出所有会话（含元数据，不含加密 code）
     * @returns {Promise<Array<{ accountId: string, metadata: object }>>}
     */
    async listWithMetadata() {
        if (!this._cache) await this.init();
        return Object.entries(this._cache.sessions).map(([accountId, session]) => ({
            accountId,
            metadata: session.metadata,
            version: session.version,
        }));
    }

    /**
     * 将变更刷入磁盘
     */
    _flush() {
        if (!this._dirty || !this._cache) return;

        // 先备份旧文件
        this._createBackup();

        // 原子写入
        this._writeRaw(this._cache);
        this._dirty = false;
    }

    /**
     * 强制刷入磁盘（同步）
     */
    flush() {
        this._flush();
    }

    /**
     * 从 accounts.json 导入现有会话（兼容模式）
     *
     * @param {Array<{ id: string, code: string, uin: string, gid: number, nick: string, platform: string }>} accounts
     * @returns {Promise<number>} 导入的会话数
     */
    async importFromAccounts(accounts) {
        if (!this._cache) await this.init();

        let imported = 0;
        for (const account of accounts) {
            if (!account.code || this._cache.sessions[account.id]) continue;

            await this.write(account.id, {
                code: account.code,
                uin: account.uin,
                gid: account.gid,
                nick: account.nick,
                platform: account.platform,
                createdAt: account.createdAt || Date.now(),
                lastValidatedAt: 0,
            });
            imported++;
        }
        return imported;
    }
}

module.exports = { LoginStore };
