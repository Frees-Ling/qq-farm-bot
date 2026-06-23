import type { ApiResult } from '@/api/result'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'
import { getErrorMessage } from '@/api/error'
import { unwrapOk } from '@/api/result'

type QqLoginStatus = 'idle' | 'loading' | 'ready' | 'scanning' | 'confirming' | 'farm_waiting' | 'success' | 'error'

export interface QqCheckResult {
  success: boolean
  ticket?: string
  uin?: string
  nickname?: string
  status?: string
}

export const useQqLoginStore = defineStore('qq-login', () => {
  const isLoading = ref(false)
  const qrCode = ref<string | null>(null)
  const loginCode = ref('')
  const qrUrl = ref('')
  const status = ref<QqLoginStatus>('idle')
  const statusMessage = ref('')
  const errorMessage = ref('')
  const diagnosticMessage = ref('')
  const captureSessionId = ref('')
  const captureStatus = ref('')

  function setDiagnostic(stage: string, detail: Record<string, any>) {
    const safeDetail = { ...detail }
    if (safeDetail.ticket) {
      const ticket = String(safeDetail.ticket)
      safeDetail.ticket = ticket ? `present...${ticket.slice(-6)}` : ''
    }
    diagnosticMessage.value = `${stage}: ${JSON.stringify(safeDetail)}`
  }

  function resetState() {
    qrCode.value = null
    loginCode.value = ''
    qrUrl.value = ''
    status.value = 'idle'
    statusMessage.value = ''
    errorMessage.value = ''
    diagnosticMessage.value = ''
    captureSessionId.value = ''
    captureStatus.value = ''
  }

  async function getQRCode(): Promise<boolean> {
    isLoading.value = true
    status.value = 'loading'
    statusMessage.value = '正在生成 QQ 登录二维码...'
    errorMessage.value = ''

    try {
      const res = await api.post('/api/qr/create', {}, { silent: true })
      console.log('[QQ扫码] getQRCode 返回:', res.data)
      const data = unwrapOk<{ code: string, image: string, url: string }>(res.data as ApiResult<any>, '获取 QQ 登录二维码失败')
      loginCode.value = data.code || ''
      qrCode.value = data.image || ''
      qrUrl.value = data.url || ''
      console.log('[QQ扫码] loginCode:', loginCode.value ? '已获取' : '空')
      console.log('[QQ扫码] QR图片:', qrCode.value ? qrCode.value.substring(0, 50) + '...' : '空')
      setDiagnostic('create', {
        loginCode: loginCode.value ? `${loginCode.value.substring(0, 10)}...` : '空',
        hasQR: !!qrCode.value,
        qrUrl: qrUrl.value,
      })
      status.value = 'ready'
      statusMessage.value = '请使用手机 QQ 扫码登录'
      return true
    }
    catch (e: any) {
      console.log('[QQ扫码] ❌ 生成二维码失败:', e.message)
      status.value = 'error'
      errorMessage.value = getErrorMessage(e, '获取 QQ 登录二维码失败')
      return false
    }
    finally {
      isLoading.value = false
    }
  }

  async function checkLogin(): Promise<QqCheckResult> {
    if (!loginCode.value)
      return { success: false }

    // 不改变 status，保持当前状态（ready 表示等待扫码）
    // 仅在 API 明确返回已扫码时才改变状态

    try {
      const res = await api.post('/api/qr/check', { code: loginCode.value }, { silent: true })
      const data = unwrapOk<any>(res.data as ApiResult<any>, '检查 QQ 扫码状态失败')
      const remoteStatus = String(data.status || '')
      console.log(`[QQ扫码] checkLogin -> status=${remoteStatus}, qqCode=${data.qqCode}, hasTicket=${!!data.ticket}`)
      setDiagnostic('check', {
        status: remoteStatus || 'Wait',
        qqCode: data.qqCode,
        ok: data.ok,
        hasTicket: data.hasTicket || !!data.ticket,
        uin: data.uin || '',
        msg: data.msg || '',
      })

      if (remoteStatus === 'OK' && data.ticket) {
        console.log('[QQ扫码] ✅ 扫码成功! ticket, uin:', data.uin)
        status.value = 'success'
        statusMessage.value = 'QQ 扫码成功，正在换取农场 code...'
        return {
          success: true,
          ticket: String(data.ticket),
          uin: data.uin ? String(data.uin) : '',
          nickname: data.nickname || '',
          status: remoteStatus,
        }
      }

      if (remoteStatus === 'Used') {
        console.log('[QQ扫码] ⚠️ 二维码已过期')
        status.value = 'error'
        errorMessage.value = '二维码已使用或已过期，请刷新二维码'
        return { success: false, status: remoteStatus }
      }

      if (remoteStatus === 'Error') {
        // -1001 正常（未扫码），不做任何提示
        console.log('[QQ扫码] 等待扫码中... (api:', data.qqCode || 'no code', ')')
        // 状态保持 'ready'，不显示错误
        status.value = 'ready'
        statusMessage.value = '等待手机 QQ 扫码...'
        return { success: false, status: remoteStatus }
      }

      status.value = 'ready'
      statusMessage.value = '等待手机 QQ 扫码确认'
      return { success: false, status: remoteStatus || 'Wait' }
    }
    catch (e: any) {
      console.log('[QQ扫码] ❌ 请求失败:', e.message)
      status.value = 'ready'
      statusMessage.value = '等待扫码中...'
      return { success: false }
    }
  }

  async function startPhoneCapture(accountName = '') {
    captureSessionId.value = ''
    captureStatus.value = ''
    try {
      const res = await api.post('/api/qq-phone-capture/start', { name: accountName }, { silent: true })
      const data = unwrapOk<any>(res.data as ApiResult<any>, '启动 QQ 农场监听失败')
      captureSessionId.value = String(data.sessionId || '')
      captureStatus.value = String(data.status || '')
      return true
    }
    catch (e: any) {
      // 抓包服务不可用是正常的（没装mitmdump），不报错只记录
      setDiagnostic('phone-capture-start-not-available', {
        info: '抓包服务不可用，扫码后需要手动打开QQ农场',
      })
      return false
    }
  }

  async function checkPhoneCapture(): Promise<{ success: boolean, accountId?: string, status?: string }> {
    if (!captureSessionId.value)
      return { success: false }
    try {
      const res = await api.get('/api/qq-phone-capture/status', {
        params: { sessionId: captureSessionId.value },
        silent: true,
      })
      const data = unwrapOk<any>(res.data as ApiResult<any>, '查询 QQ 农场监听失败')
      captureStatus.value = String(data.status || '')
      if (data.status === 'complete') {
        status.value = 'success'
        statusMessage.value = '账号已创建'
        errorMessage.value = ''
        return { success: true, accountId: data.accountId || '', status: data.status }
      }
      if (data.status === 'error') {
        status.value = 'error'
        errorMessage.value = data.message || '服务器监听异常，请联系管理员'
      }
      return { success: false, status: data.status || '' }
    }
    catch (e: any) {
      setDiagnostic('phone-capture-status-error', {
        error: getErrorMessage(e, '查询监听状态失败'),
      })
      return { success: false }
    }
  }

  async function stopPhoneCapture() {
    if (!captureSessionId.value)
      return
    try {
      await api.post('/api/qq-phone-capture/stop', { sessionId: captureSessionId.value }, { silent: true })
    }
    catch {
      // ignore cleanup failures
    }
  }

  function waitForFarmOpen() {
    status.value = 'farm_waiting'
    statusMessage.value = '扫码确认成功，现在打开手机 QQ 经典农场一次'
    errorMessage.value = ''
  }

  async function getFarmCode(ticket: string, options: { quietFailure?: boolean } = {}): Promise<{ success: boolean, code?: string, uin?: string, authOnly?: boolean }> {
    if (!ticket)
      return { success: false }

    isLoading.value = true
    statusMessage.value = '正在换取 QQ 农场 code...'
    errorMessage.value = ''

    try {
      const res = await api.post('/api/qr/auth-code', { ticket, appid: '1112386029' }, { silent: true })
      const data = unwrapOk<any>(res.data as ApiResult<any>, '换取 QQ 农场 code 失败')
      setDiagnostic('auth-code', {
        returnedCode: data.code ? 'present' : '',
        authOnly: !!data.authOnly,
        uin: data.uin || '',
      })
      if (data.authOnly) {
        // 验证成功但没拿到农场code（-3000），通知用户
        console.log('[QQ扫码] ✅ QQ验证成功, uin:', data.uin, '但未获取农场code')
        status.value = 'farm_waiting'
        statusMessage.value = `QQ验证成功 (${data.uin})！请在手机QQ打开QQ经典农场，然后手动输入Code`
        return { success: true, code: '', uin: data.uin || '', authOnly: true }
      }
      if (!data.code) {
        status.value = 'error'
        errorMessage.value = 'QQ 授权成功，但没有返回农场 code'
        return { success: false }
      }
      console.log('[QQ扫码] ✅ 获取到农场code')
      status.value = 'success'
      statusMessage.value = '已获取 QQ 农场 code，正在创建账号...'
      return { success: true, code: data.code }
    }
    catch (e: any) {
      if (options.quietFailure) {
        waitForFarmOpen()
      }
      else {
        status.value = 'error'
        errorMessage.value = getErrorMessage(e, '换取 QQ 农场 code 失败')
      }
      const payload = e?.response?.data
      const detail = payload?.data || payload || {}
      setDiagnostic('auth-code-error', {
        error: payload?.error || e?.message || '',
        authCode: detail.authCode || detail.raw?.code || '',
        reason: detail.reason || detail.raw?.msg || detail.raw?.message || '',
      })
      return { success: false }
    }
    finally {
      isLoading.value = false
    }
  }

  return {
    isLoading,
    qrCode,
    loginCode,
    qrUrl,
    status,
    statusMessage,
    errorMessage,
    diagnosticMessage,
    captureSessionId,
    captureStatus,
    resetState,
    getQRCode,
    checkLogin,
    startPhoneCapture,
    checkPhoneCapture,
    stopPhoneCapture,
    waitForFarmOpen,
    getFarmCode,
  }
})
