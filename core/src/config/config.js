const process = require('node:process');
/**
 * 配置常量与枚举定义
 */

const CONFIG = {
    serverUrl: 'wss://gate-obt.nqf.qq.com/prod/ws',
    clientVersion: '1.12.1.6_20260623',
    platform: 'qq',              // 平台: qq 或 wx (可通过 --wx 切换为微信)
    os: 'iOS',
    heartbeatInterval: 25000,    // 心跳间隔 25秒
    farmCheckInterval: 3000,      // 兼容旧逻辑：自己农场固定巡查间隔(ms)
    friendCheckInterval: 12000,   // 兼容旧逻辑：好友固定巡查间隔(ms)
    farmCheckIntervalMin: 3000,   // 新逻辑：农场巡查间隔最小值(ms)
    farmCheckIntervalMax: 5000,   // 新逻辑：农场巡查间隔最大值(ms)
    friendCheckIntervalMin: 12000,// 新逻辑：好友巡查间隔最小值(ms)
    friendCheckIntervalMax: 15000,// 新逻辑：好友巡查间隔最大值(ms)
    adminPort: Number(process.env.ADMIN_PORT || 3000), // 管理面板 HTTP 端口
    adminPassword: process.env.ADMIN_PASSWORD || 'admin',

    // ====== 持久化登录配置 ======
    persistentLogin: {
        enabled: process.env.PLM_ENABLED !== 'false',       // 全局开关
        cryptoPassword: process.env.PLM_CRYPTO_PASSWORD      // 加密主密码（必须设置）
            || process.env.ADMIN_PASSWORD                    // 默认使用管理员密码
            || 'qq-farm-bot-default-key',
        autoValidateOnLoad: process.env.PLM_AUTO_VALIDATE !== 'false', // 启动时自动验证
        autoBackup: process.env.PLM_AUTO_BACKUP !== 'false',           // 自动备份
        maxBackups: Number(process.env.PLM_MAX_BACKUPS || 3),          // 最大备份数
        validateTimeout: Number(process.env.PLM_VALIDATE_TIMEOUT || 10000), // 验证超时(ms)
    },
};

// 生长阶段枚举
const PlantPhase = {
    UNKNOWN: 0,
    SEED: 1,
    GERMINATION: 2,
    SMALL_LEAVES: 3,
    LARGE_LEAVES: 4,
    BLOOMING: 5,
    MATURE: 6,
    DEAD: 7,
};

const PHASE_NAMES = ['未知', '种子', '发芽', '小叶', '大叶', '开花', '成熟', '枯死'];

module.exports = { CONFIG, PlantPhase, PHASE_NAMES };
