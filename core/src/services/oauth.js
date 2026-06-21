const fetch = require('node-fetch');
const { createModuleLogger } = require('./logger');

const oauthLogger = createModuleLogger('oauth');

class OauthService {
    constructor(apiUrl, appId, appKey, callbackUrl) {
        this.apiUrl = apiUrl;
        this.appId = appId;
        this.appKey = appKey;
        this.callbackUrl = callbackUrl;
    }

    async login(type) {
        const state = this.generateState();
        const params = new URLSearchParams({
            act: 'login',
            appid: this.appId,
            appkey: this.appKey,
            type,
            redirect_uri: this.callbackUrl,
            state
        });

        const url = `${this.apiUrl}connect.php?${params.toString()}`;
        oauthLogger.info('oauth login request', { type, url: this.apiUrl });

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            const text = await response.text();
            let data;
            try {
                data = JSON.parse(text);
            } catch {
                oauthLogger.error('oauth login parse error', { text: text.substring(0, 200) });
                return { code: -1, msg: '解析响应失败' };
            }

            oauthLogger.info('oauth login response', { code: data.code, msg: data.msg });
            return data;
        } catch (error) {
            oauthLogger.error('oauth login error', { error: error.message });
            return { code: -1, msg: error.message };
        }
    }

    async callback(code, type='') {
        const params = new URLSearchParams({
            act: 'callback',
            appid: this.appId,
            appkey: this.appKey,
            type,
            code
        });

        const url = `${this.apiUrl}connect.php?${params.toString()}`;
        oauthLogger.info('oauth callback request', { url: this.apiUrl });

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            const text = await response.text();
            let data;
            try {
                data = JSON.parse(text);
            } catch {
                oauthLogger.error('oauth callback parse error', { text: text.substring(0, 200) });
                return { code: -1, msg: '解析响应失败' };
            }

            oauthLogger.info('oauth callback response', { 
                code: data.code, 
                social_uid: data.social_uid,
                nickname: data.nickname
            });
            return data;
        } catch (error) {
            oauthLogger.error('oauth callback error', { error: error.message });
            return { code: -1, msg: error.message };
        }
    }

    generateState() {
        const crypto = require('crypto');
        return crypto.randomBytes(16).toString('hex');
    }
}

module.exports = {
    OauthService
};
