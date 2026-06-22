import type { ApiResult } from '@/api/result'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'
import { getErrorMessage } from '@/api/error'
import { unwrapOk } from '@/api/result'

type QqLoginStatus = 'idle' | 'loading' | 'ready' | 'scanning' | 'confirming' | 'success' | 'error'

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

  function resetState() {
    qrCode.value = null
    loginCode.value = ''
    qrUrl.value = ''
    status.value = 'idle'
    statusMessage.value = ''
    errorMessage.value = ''
  }

  async function getQRCode(): Promise<boolean> {
    isLoading.value = true
    status.value = 'loading'
    statusMessage.value = '正在生成 QQ 登录二维码...'
    errorMessage.value = ''

    try {
      const res = await api.post('/api/qr/create', {}, { silent: true })
      const data = unwrapOk<{ code: string, image: string, url: string }>(res.data as ApiResult<any>, '获取 QQ 登录二维码失败')
      loginCode.value = data.code || ''
      qrCode.value = data.image || ''
      qrUrl.value = data.url || ''
      status.value = 'ready'
      statusMessage.value = '请使用手机 QQ 扫码并确认登录'
      return true
    }
    catch (e: any) {
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

    status.value = status.value === 'confirming' ? 'confirming' : 'scanning'
    statusMessage.value = status.value === 'confirming' ? '已扫码，请在手机 QQ 确认登录' : '正在等待扫码...'

    try {
      const res = await api.post('/api/qr/check', { code: loginCode.value }, { silent: true })
      const data = unwrapOk<any>(res.data as ApiResult<any>, '检查 QQ 扫码状态失败')
      const remoteStatus = String(data.status || '')

      if (remoteStatus === 'OK' && data.ticket) {
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
        status.value = 'error'
        errorMessage.value = '二维码已使用或已过期，请刷新二维码'
        return { success: false, status: remoteStatus }
      }

      if (remoteStatus === 'Error') {
        status.value = 'error'
        errorMessage.value = data.msg || 'QQ 扫码状态异常，请刷新二维码'
        return { success: false, status: remoteStatus }
      }

      status.value = 'confirming'
      statusMessage.value = '等待手机 QQ 扫码确认'
      return { success: false, status: remoteStatus || 'Wait' }
    }
    catch (e: any) {
      status.value = 'error'
      errorMessage.value = getErrorMessage(e, '检查 QQ 扫码状态失败')
      return { success: false }
    }
  }

  async function getFarmCode(ticket: string): Promise<{ success: boolean, code?: string }> {
    if (!ticket)
      return { success: false }

    isLoading.value = true
    statusMessage.value = '正在换取 QQ 农场 code...'
    errorMessage.value = ''

    try {
      const res = await api.post('/api/qr/auth-code', { ticket, appid: '1112386029' }, { silent: true })
      const data = unwrapOk<{ code: string }>(res.data as ApiResult<any>, '换取 QQ 农场 code 失败')
      if (!data.code) {
        status.value = 'error'
        errorMessage.value = 'QQ 授权成功，但没有返回农场 code'
        return { success: false }
      }
      status.value = 'success'
      statusMessage.value = '已获取 QQ 农场 code，正在创建账号...'
      return { success: true, code: data.code }
    }
    catch (e: any) {
      status.value = 'error'
      errorMessage.value = getErrorMessage(e, '换取 QQ 农场 code 失败')
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
    resetState,
    getQRCode,
    checkLogin,
    getFarmCode,
  }
})
