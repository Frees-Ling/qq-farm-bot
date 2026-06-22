/**
 * QQ 会员每日礼包
 */

const { sendMsgAsync } = require('../utils/network');
const { types } = require('../utils/proto');
const { log } = require('../utils/utils');
const { getRewardSummary, DailyStateManager, COOLDOWN_MS } = require('../utils/common');

const DAILY_KEY = 'vip_daily_gift';
const state = new DailyStateManager(DAILY_KEY, COOLDOWN_MS.DEFAULT);

let lastResult = '';
let lastHasGift = null;
let lastCanClaim = null;

function isAlreadyClaimedError(err) {
    const msg = String((err && err.message) || '');
    return msg.includes('code=1021002') || msg.includes('今日已领取') || msg.includes('已领取');
}

async function getDailyGiftStatus() {
    const body = types.GetDailyGiftStatusRequest.encode(types.GetDailyGiftStatusRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.qqvippb.QQVipService', 'GetDailyGiftStatus', body);
    return types.GetDailyGiftStatusReply.decode(replyBody);
}

async function claimDailyGift() {
    const body = types.ClaimDailyGiftRequest.encode(types.ClaimDailyGiftRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.qqvippb.QQVipService', 'ClaimDailyGift', body);
    return types.ClaimDailyGiftReply.decode(replyBody);
}

async function performDailyVipGift(force = false) {
    if (!state.prepareCheck(force)) return false;

    try {
        const status = await getDailyGiftStatus();
        lastHasGift = !!(status && status.has_gift);
        lastCanClaim = !!(status && status.can_claim);
        if (!status || !status.can_claim) {
            state.markDone();
            lastResult = 'none';
            log('会员', '今日暂无可领取会员礼包', {
                module: 'task',
                event: DAILY_KEY,
                result: 'none',
            });
            return false;
        }
        const rep = await claimDailyGift();
        const items = Array.isArray(rep && rep.items) ? rep.items : [];
        const reward = getRewardSummary(items);
        log('会员', reward ? `领取成功 → ${reward}` : '领取成功', {
            module: 'task',
            event: DAILY_KEY,
            result: 'ok',
            count: items.length,
        });
        state.touchClaim();
        state.markDone();
        lastResult = 'ok';
        return true;
    } catch (e) {
        if (isAlreadyClaimedError(e)) {
            state.markDone();
            state.touchClaim();
            lastResult = 'ok';
            log('会员', '今日会员礼包已领取', {
                module: 'task',
                event: DAILY_KEY,
                result: 'ok',
            });
            return false;
        }
        lastResult = 'error';
        log('会员', `领取会员礼包失败: ${e.message}`, {
            module: 'task',
            event: DAILY_KEY,
            result: 'error',
        });
        return false;
    }
}

module.exports = {
    performDailyVipGift,
    getVipDailyState: () => ({
        key: DAILY_KEY,
        doneToday: state.isDone(),
        lastCheckAt: state.lastCheckAt,
        lastClaimAt: state.lastClaimAt,
        result: lastResult,
        hasGift: lastHasGift,
        canClaim: lastCanClaim,
    }),
};
