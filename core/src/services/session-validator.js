#!/usr/bin/env node
"use strict";

/**
 * session-validator.js — 会话验证器
 *
 * 通过 WebSocket 使用 `fetchProfileByCode` 验证 code 的有效性
 * 检测登录状态: 有效/过期/版本过低/被踢
 *
 * 证据: `docs/login_validation.md` 检测点
 */

const manualLoginProfile = require('./manual-login-profile');

/**
 * @typedef {object} ValidationResult
 * @property {boolean} valid - 是否有效
 * @property {string} [code] - 状态码: 'ok' | 'code_expired' | 'code_invalid' | 'version_too_low' | 'network_error'
 * @property {string} [reason] - 详细原因
 * @property {number} [gid] - 游戏 UID (有效时)
 * @property {string} [name] - 游戏昵称 (有效时)
 * @property {number} [level] - 等级 (有效时)
 * @property {object} [versionInfo] - 版本信息
 * @property {boolean} [canRefresh] - 是否可自动刷新
 */

class SessionValidator {

    /**
     * 验证会话是否有效
     *
     * 通过建立 WebSocket 连接并发送 LoginRequest 来验证 code
     *
     * @param {string} code - 要验证的登录凭证
     * @param {object} [options]
     * @param {number} [options.timeout=10000] - 超时(ms)
     * @returns {Promise<ValidationResult>}
     *
     * 风险: 每次验证消耗一次 code 使用机会
     *       部分 code 为一次性，验证后不能再用于实际登录
     */
    async validate(code, options = {}) {
        const timeout = options.timeout || 10000;

        if (!code) {
            return {
                valid: false,
                code: 'code_invalid',
                reason: 'Code 为空',
                canRefresh: false,
            };
        }

        // 负值 code = 授权失败
        if (/^-\d+$/.test(code)) {
            return {
                valid: false,
                code: 'code_invalid',
                reason: 'Code 为负值，授权失败',
                canRefresh: false,
            };
        }

        try {
            // 使用 manual-login-profile 验证
            const profile = await manualLoginProfile.fetchProfileByCode(code, { timeout });

            if (profile && profile.gid) {
                return {
                    valid: true,
                    code: 'ok',
                    gid: profile.gid,
                    name: profile.name,
                    level: profile.level,
                    canRefresh: false, // Tencent 不支持刷新
                };
            }

            // 登录失败但未抛异常
            return {
                valid: false,
                code: 'code_invalid',
                reason: '服务器未返回用户资料',
                canRefresh: false,
            };

        } catch (err) {
            const msg = String(err.message || '');

            // WebSocket 400 = code 过期
            if (msg.includes('400') || msg.includes('code') || msg.includes('invalid')) {
                return {
                    valid: false,
                    code: 'code_expired',
                    reason: `Code 已过期: ${msg}`,
                    canRefresh: false,
                };
            }

            // 网络错误
            if (msg.includes('connect') || msg.includes('timeout') || msg.includes('ETIMEDOUT') || msg.includes('ECONNREFUSED')) {
                return {
                    valid: false,
                    code: 'network_error',
                    reason: `网络连接失败: ${msg}`,
                    canRefresh: true, // 可重试
                };
            }

            // 未知错误
            return {
                valid: false,
                code: 'unknown',
                reason: `验证异常: ${msg}`,
                canRefresh: false,
            };
        }
    }

    /**
     * 快速检查 code 格式是否合法
     * @param {string} code
     * @returns {boolean}
     */
    validateFormat(code) {
        return !!code && typeof code === 'string' && code.length > 0 && !/^-\d+$/.test(code);
    }
}

module.exports = { SessionValidator };
