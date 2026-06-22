import { defineStore } from 'pinia'
import { ref } from 'vue'

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
    statusMessage.value = 'QQ 网页扫码接口已不可用'
    errorMessage.value = ''

    status.value = 'error'
    errorMessage.value = '请使用服务器 QQ 客户端扫码登录并打开 QQ经典农场，由 code-capture 自动捕获真实 code。'
    isLoading.value = false
    return false
  }

  async function checkLogin(): Promise<{ success: boolean, ticket?: string, uin?: string, nickname?: string }> {
    if (!loginCode.value) {
      return { success: false }
    }

    status.value = 'scanning'
    statusMessage.value = '正在检查登录状态...'

    status.value = 'error'
    errorMessage.value = 'QQ 网页扫码授权接口已不可用，请使用服务器 QQ 客户端捕获流程。'
    return { success: false }
  }

  async function getFarmCode(ticket: string): Promise<{ success: boolean, code?: string }> {
    void ticket
    errorMessage.value = 'QQ 网页扫码授权接口已不可用，请使用服务器 QQ 客户端捕获流程。'
    return { success: false }
  }

  return {
    isLoading, qrCode, loginCode, qrUrl,
    status, statusMessage, errorMessage,
    resetState, getQRCode, checkLogin, getFarmCode,
  }
})
