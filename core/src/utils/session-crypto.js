#!/usr/bin/env node
"use strict";

/**
 * session-crypto.js — 会话加密模块
 *
 * AES-256-GCM 认证加密，PBKDF2 密钥派生
 * 无外部依赖，仅使用 Node.js crypto 模块
 *
 * 证据: `docs/persistent_login_design.md` 加密方案设计
 */

const crypto = require('node:crypto');

// 常量
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;          // 256 bit
const IV_LENGTH = 16;           // 128 bit
const SALT_LENGTH = 16;         // 128 bit
const AUTH_TAG_LENGTH = 16;     // 128 bit
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_DIGEST = 'sha256';
const CHECKSUM_ALGORITHM = 'sha256';

/**
 * 从密码派生加密密钥
 * @param {string} password - 主密码
 * @param {Buffer} salt - 随机盐值
 * @returns {Buffer} 派生密钥 (32 bytes)
 */
function deriveKey(password, salt) {
    return crypto.pbkdf2Sync(
        password,
        salt,
        PBKDF2_ITERATIONS,
        KEY_LENGTH,
        PBKDF2_DIGEST
    );
}

/**
 * 生成随机 ID
 * @returns {string} 24 字符 hex 字符串
 */
function generateId() {
    return crypto.randomBytes(12).toString('hex');
}

/**
 * 加密会话数据
 *
 * @param {object} data - 要加密的明文数据 (将被 JSON.stringify)
 * @param {string} password - 加密主密码
 * @returns {{ encrypted: string, iv: string, salt: string, authTag: string }}
 *
 * 输出示例:
 * {
 *   encrypted: "base64...",   // AES-256-GCM 加密后的密文
 *   iv: "base64...",          // 随机初始化向量
 *   salt: "base64...",        // 随机 PBKDF2 盐值
 *   authTag: "base64..."      // GCM 认证标签
 * }
 *
 * 风险: 密码泄漏则所有会话可解密
 */
function encrypt(data, password) {
    const salt = crypto.randomBytes(SALT_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = deriveKey(password, salt);

    const plaintext = JSON.stringify(data);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const authTag = cipher.getAuthTag();

    return {
        encrypted,
        iv: iv.toString('base64'),
        salt: salt.toString('base64'),
        authTag: authTag.toString('base64'),
    };
}

/**
 * 解密会话数据
 *
 * @param {{ encrypted: string, iv: string, salt: string, authTag: string }} data - 加密数据包
 * @param {string} password - 加密主密码
 * @returns {object|null} 解密后的对象，失败返回 null
 *
 * 异常: 密码错误 → null (GCM 认证失败)
 *       数据损坏 → null (JSON 解析失败)
 *       密钥变更 → null (认证标签不匹配)
 */
function decrypt(data, password) {
    try {
        const salt = Buffer.from(data.salt, 'base64');
        const iv = Buffer.from(data.iv, 'base64');
        const authTag = Buffer.from(data.authTag, 'base64');
        const key = deriveKey(password, salt);

        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(data.encrypted, 'base64', 'utf8');
        decrypted += decipher.final('utf8');

        return JSON.parse(decrypted);
    } catch (err) {
        // GCM 认证失败 (密码错误/数据篡改)
        return null;
    }
}

/**
 * 计算数据的 SHA-256 校验和
 * @param {object} data - 要校验的数据
 * @returns {string} hex 格式的哈希值
 */
function checksum(data) {
    return crypto
        .createHash(CHECKSUM_ALGORITHM)
        .update(JSON.stringify(data))
        .digest('hex');
}

module.exports = {
    encrypt,
    decrypt,
    checksum,
    generateId,
    deriveKey,
};
