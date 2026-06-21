import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'

export const useQqLoginStore = defineStore('qq-login', () => {
  const isLoading = ref(false)
  const qrCode = ref<string | null>(null)
  const loginCode = ref('')
  const qrUrl = ref('')
  const status = ref<'idle' | 'loading' | 'ready' | 'scanning' | 'success' | 'error'>('idle')
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
    statusMessage.value = '正在获取二维码...'
    errorMessage.value = ''

    try {
      const res = await api.post('/api/qr/create')
      const rd = res.data
      if (rd.ok && rd.data) {
        loginCode.value = rd.data.code || ''
        qrCode.value = rd.data.image || ''
        qrUrl.value = rd.data.url || ''
        status.value = 'ready'
        statusMessage.value = '请使用手机QQ扫码登录'
        return true
      }
      else {
        status.value = 'error'
        errorMessage.value = rd.error || '获取二维码失败'
        return false
      }
    }
    catch (e: any) {
      status.value = 'error'
      errorMessage.value = `请求失败: ${e.message}`
      return false
    }
    finally {
      isLoading.value = false
    }
  }

  async function checkLogin(): Promise<{ success: boolean, ticket?: string, uin?: string, nickname?: string }> {
    if (!loginCode.value) {
      return { success: false }
    }

    status.value = 'scanning'
    statusMessage.value = '正在检查登录状态...'

    try {
      const res = await api.post('/api/qr/check', { code: loginCode.value })
      const rd = res.data

      if (rd.ok && rd.data) {
        const data = rd.data

        if (data.status === 'OK' && data.ticket) {
          status.value = 'success'
          statusMessage.value = '扫码成功！正在获取授权 Code...'
          return { success: true, ticket: data.ticket, uin: data.uin, nickname: data.nickname }
        }
        else if (data.status === 'Wait') {
          statusMessage.value = '等待扫码中...'
          return { success: false }
        }
        else if (data.status === 'Used') {
          status.value = 'error'
          errorMessage.value = '二维码已失效，请刷新'
          return { success: false }
        }
        else {
          statusMessage.value = '等待扫码中...'
          return { success: false }
        }
      }
      else {
        return { success: false }
      }
    }
    catch (e: any) {
      errorMessage.value = `检查失败: ${e.message}`
      return { success: false }
    }
  }

  async function getFarmCode(ticket: string): Promise<{ success: boolean, code?: string }> {
    isLoading.value = true

    try {
      const res = await api.post('/api/qr/auth-code', { ticket })
      const rd = res.data
      if (rd.ok && rd.data && rd.data.code) {
        return { success: true, code: rd.data.code }
      }
      else {
        errorMessage.value = rd.error || '获取 Code 失败'
        return { success: false }
      }
    }
    catch (e: any) {
      errorMessage.value = `请求失败: ${e.message}`
      return { success: false }
    }
    finally {
      isLoading.value = false
    }
  }

  return {
    isLoading, qrCode, loginCode, qrUrl,
    status, statusMessage, errorMessage,
    resetState, getQRCode, checkLogin, getFarmCode,
  }
})
