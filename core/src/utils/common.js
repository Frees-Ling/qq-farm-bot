/**
 * 公共工具模块
 * 统一管理日期、奖励摘要、每日状态等通用功能
 */

const { toNum, getServerTimeSec } = require('./utils');

function getDateKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function getBeijingDateKey() {
    const nowSec = getServerTimeSec();
    const nowMs = nowSec > 0 ? nowSec * 1000 : Date.now();
    const bjOffset = 8 * 3600 * 1000;
    const bjDate = new Date(nowMs + bjOffset);
    return getDateKey(bjDate);
}

function getRewardSummary(items) {
    const list = Array.isArray(items) ? items : [];
    const summary = [];
    for (const it of list) {
        const id = toNum(it.id);
        const count = toNum(it.count);
        if (count <= 0) continue;
        if (id === 1 || id === 1001) summary.push(`金币${count}`);
        else if (id === 2 || id === 1101) summary.push(`经验${count}`);
        else if (id === 1002) summary.push(`点券${count}`);
        else summary.push(`物品#${id}x${count}`);
    }
    return summary.join('/');
}

class DailyStateManager {
    constructor(key, cooldownMs = 10 * 60 * 1000) {
        this.key = key;
        this.cooldownMs = cooldownMs;
        this.doneDateKey = '';
        this.lastCheckAt = 0;
        this.lastClaimAt = 0;
    }

    getDateKey() {
        return getDateKey();
    }

    markDone() {
        this.doneDateKey = this.getDateKey();
    }

    isDone() {
        return this.doneDateKey === this.getDateKey();
    }

    canCheck() {
        return Date.now() - this.lastCheckAt >= this.cooldownMs;
    }

    touchCheck() {
        this.lastCheckAt = Date.now();
    }

    touchClaim() {
        this.lastClaimAt = Date.now();
    }

    shouldSkip(force = false) {
        if (!force && this.isDone()) return true;
        if (!force && !this.canCheck()) return true;
        return false;
    }

    prepareCheck(force = false) {
        if (this.shouldSkip(force)) return false;
        this.touchCheck();
        return true;
    }

    getState() {
        return {
            key: this.key,
            doneToday: this.isDone(),
            lastCheckAt: this.lastCheckAt,
            lastClaimAt: this.lastClaimAt,
        };
    }
}

const ITEM_IDS = {
    GOLD: [1, 1001],
    EXP: [2, 1101],
    COUPON: 1002,
    NORMAL_FERTILIZER_CONTAINER: 1011,
    ORGANIC_FERTILIZER_CONTAINER: 1012,
};

const COOLDOWN_MS = {
    DEFAULT: 10 * 60 * 1000,
    SHORT: 5 * 60 * 1000,
};

function isGoldId(id) {
    return ITEM_IDS.GOLD.includes(Number(id));
}

function isExpId(id) {
    return ITEM_IDS.EXP.includes(Number(id));
}

function isCouponId(id) {
    return Number(id) === ITEM_IDS.COUPON;
}

module.exports = {
    getDateKey,
    getBeijingDateKey,
    getRewardSummary,
    DailyStateManager,
    ITEM_IDS,
    COOLDOWN_MS,
    isGoldId,
    isExpId,
    isCouponId,
};
