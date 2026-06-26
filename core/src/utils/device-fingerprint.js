#!/usr/bin/env node
"use strict";

/**
 * device-fingerprint.js — 设备指纹生成与管理
 *
 * 生成稳定的设备指纹，用于 WebSocket 登录时的 device_id。
 * 服务器会将会话绑定到设备指纹，指纹变化可能导致登录被拒。
 *
 * 原理:
 * - QQ 小程序登录的 code 只有 5 分钟有效期，但服务器会将 WebSocket 会话
 *   绑定到 LoginRequest 中的 device_info (设备指纹)
 * - 使用一致的设备指纹可以:
 *   1. 避免服务器风控检测（同一账号频繁更换设备）
 *   2. 提高重连成功率（使用绑定过的指纹重连）
 *   3. 分散风险（不同服务器使用不同指纹）
 *
 * 证据:
 * - network.js sendLogin() 发送 device_info 到 LoginRequest
 * - store.js DEFAULT_RUNTIME_CONFIG 硬编码 deviceId
 */

const crypto = require('node:crypto');

// 从环境变量读取服务器标识，用于生成可复现的指纹
const SERVER_ID = process.env.FARM_SERVER_ID || '';

/**
 * 生成随机设备 ID
 * 格式: "品牌<型号>" 风格，兼容现有格式
 * @returns {string}
 */
function generateDeviceId() {
    // 设备型号池（模拟真实 iOS 设备）
    const models = [
        'iPhone15,2', 'iPhone15,3', 'iPhone15,4', 'iPhone15,5',
        'iPhone16,1', 'iPhone16,2', 'iPhone16,3', 'iPhone16,4',
        'iPhone17,1', 'iPhone17,2', 'iPhone17,3', 'iPhone17,4',
        'iPad13,11', 'iPad13,19',
    ];
    // 用服务器 ID 或随机数确定性地选择型号
    const seed = SERVER_ID || crypto.randomBytes(4).toString('hex');
    const hash = crypto.createHash('md5').update(seed).digest('hex');
    const index = parseInt(hash.slice(0, 8), 16) % models.length;
    return `iPhone X<${models[index]}>`;
}

/**
 * 生成设备指纹标识符（全局唯一）
 * 用于区分不同部署的服务器
 * @returns {string} 32 字符 hex
 */
function generateDeviceFingerprint() {
    const seed = SERVER_ID || crypto.randomBytes(16).toString('hex');
    return crypto.createHash('md5').update(seed).digest('hex');
}

/**
 * 组装完整的 device_info
 * @param {object} options
 * @param {string} options.clientVersion - 客户端版本
 * @param {string} options.deviceId - 设备 ID
 * @param {string} [options.osVersion='iOS 26.2.1']
 * @param {string} [options.network='wifi']
 * @param {string} [options.memory='7672']
 * @returns {object} device_info object
 */
function buildDeviceInfo(options = {}) {
    return {
        client_version: options.clientVersion || '1.12.1.6_20260623',
        sys_software: options.osVersion || 'iOS 26.2.1',
        network: options.network || 'wifi',
        memory: options.memory || '7672',
        device_id: options.deviceId || 'iPhone X<iPhone18,3>',
    };
}

module.exports = {
    generateDeviceId,
    generateDeviceFingerprint,
    buildDeviceInfo,
};
