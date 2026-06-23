<script setup lang="ts">
import type { ApiResult } from '@/api/result'
import { useIntervalFn } from '@vueuse/core'
import { computed, onMounted, ref, watch } from 'vue'
import api from '@/api'
import { unwrapOk } from '@/api/result'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { useToastStore } from '@/stores/toast'
import { useWxLoginStore } from '@/stores/wx-login'

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits(['close', 'saved'])

const wxLoginStore = useWxLoginStore()
const toast = useToastStore()

const loginPlatform = ref<'wx' | 'qq'>('qq')
const activeTab = ref<'login' | 'settings'>('login')
const accountName = ref('')

// OAuth QR状态
const qrUuid = ref('')
const qrImageUrl = ref('')
const qrStatus = ref<'idle' | 'loading' | 'waiting' | 'scanned' | 'ok' | 'error'>('idle')
const qrMessage = ref('')
const qrError = ref('')

// QQ扫码后 - 开始抓包
const captureStarted = ref(false)
const proxyHost = ref('')
const proxyPort = ref(0)
const captureCode = ref('')
const captureWaiting = ref(false)

// 管理员配置
const adminWxConfig = ref({
  showWxConfigTab: true,
  showWxLoginTab: true,
})

async function loadAdminWxConfigPublic() {
  try {
    const { data } = await api.get('/api/wx-config/public')
    const cfg = unwrapOk<Record<string, any>>(data as ApiResult<Record<string, any>>, '加载管理员微信配置失败')
    adminWxConfig.value = { ...adminWxConfig.value, ...cfg }
  }
  catch (e) {
    console.error('加载管理员微信配置失败:', e)
  }
}

onMounted(() => {
  loadAdminWxConfigPublic()
})

// 获取OAuth二维码（QQ/微信）
async function loadOAuthQR() {
  qrStatus.value = 'loading'
  qrMessage.value = '正在获取二维码...'
  qrError.value = ''
  qrUuid.value = ''
  qrImageUrl.value = ''

  try {
    const res = await api.post('/api/oauth/qr-create', { type: loginPlatform.value })
    if (res.data?.ok && res.data?.data) {
      qrUuid.value = res.data.data.uuid
      qrImageUrl.value = res.data.data.qrImageUrl
      qrStatus.value = 'waiting'
      qrMessage.value = loginPlatform.value === 'qq' ? '请使用手机QQ扫码登录' : '请使用微信扫码登录'
      startCheck()
    }
    else {
      qrStatus.value = 'error'
      qrError.value = res.data?.error || '获取二维码失败'
    }
  }
  catch (e: any) {
    qrStatus.value = 'error'
    qrError.value = e.response?.data?.error || e.message || '获取二维码失败'
  }
}

// 轮询检查扫码状态
const { pause: stopCheck, resume: startCheck } = useIntervalFn(async () => {
  if (qrStatus.value !== 'waiting' && qrStatus.value !== 'scanned') return
  if (!qrUuid.value) return

  try {
    const res = await api.post('/api/oauth/qr-status', { code: qrUuid.value })
    const data = res.data?.data
    if (data?.status === 'ok') {
      qrStatus.value = 'ok'
      qrMessage.value = `登录成功！${data.nickname || ''}`
      stopCheck()
      toast.success('扫码登录成功！')
      // 登录成功后，启动抓包
      await startCaptureForFarm()
    }
    else if (data?.status === 'scanned') {
      qrStatus.value = 'scanned'
      qrMessage.value = '已扫码，请在手机确认'
    }
  }
  catch {
    // continue polling
  }
}, 2000, { immediate: false })

// 扫码成功后启动抓包
async function startCaptureForFarm() {
  captureStarted.value = true
  qrMessage.value = '正在准备抓包服务...'

  try {
    const res = await api.post('/api/capture-proxy/start', { clientType: loginPlatform.value })
    const data = res.data?.data
    proxyHost.value = data?.bindUrlHttp || window.location.hostname
    proxyPort.value = data?.port || 8899
    qrMessage.value = `请在手机QQ打开QQ经典农场，自动捕获Code`
    captureWaiting.value = true
    startCapturePolling()
  }
  catch (e: any) {
    qrMessage.value = '抓包服务未启动，请在手机上打开QQ经典农场后手动添加Code'
    toast.warning('抓包服务不可用，请手动添加Code')
    captureWaiting.value = false
  }
}

// 轮询抓包结果
const { pause: stopCapturePoll, resume: startCapturePolling } = useIntervalFn(async () => {
  if (!captureWaiting.value) return
  try {
    const res = await api.get('/api/capture-proxy/status', { params: {} })
    const data = res.data?.data
    if (data?.code) {
      captureCode.value = data.code
      captureWaiting.value = false
      stopCapturePoll()
      // 自动创建账号
      await createAccountWithCode(data.code)
    }
  }
  catch {}
}, 3000, { immediate: false })

// 用捕获的Code创建账号
async function createAccountWithCode(code: string) {
  try {
    const name = accountName.value.trim() || `${loginPlatform.value === 'qq' ? 'QQ' : '微信'}账号${Date.now()}`
    const res = await api.post('/api/accounts', {
      name,
      code,
      platform: loginPlatform.value === 'qq' ? 'qq' : 'wx',
      loginType: 'oauth_qr',
      autoStart: true,
    })
    if (res.data?.ok) {
      toast.success('账号已创建，正在启动')
      emit('saved')
      close()
    }
    else {
      toast.error(res.data?.error || '创建账号失败')
    }
  }
  catch (e: any) {
    qrError.value = e.response?.data?.error || '创建账号失败'
    toast.error(`创建账号失败: ${e.response?.data?.error || e.message}`)
  }
}

// 手动创建账号（当抓包不可用时）
async function createAccountManually() {
  if (!captureCode.value) { toast.warning('请先在手机上打开QQ经典农场'); return }
  await createAccountWithCode(captureCode.value)
}

// 保存配置
function saveConfig() {
  wxLoginStore.updateConfig({
    apiBase: wxLoginStore.config.apiBase,
    apiKey: wxLoginStore.config.apiKey,
    proxyApiUrl: wxLoginStore.config.proxyApiUrl,
  })
  activeTab.value = 'login'
}

// 关闭弹窗
function close() {
  stopCheck()
  stopCapturePoll()
  wxLoginStore.resetState()
  accountName.value = ''
  qrStatus.value = 'idle'
  qrUuid.value = ''
  qrImageUrl.value = ''
  captureStarted.value = false
  captureWaiting.value = false
  captureCode.value = ''
  emit('close')
}

// 切换平台（QQ/微信）
function switchPlatform(platform: 'qq' | 'wx') {
  loginPlatform.value = platform
  qrStatus.value = 'idle'
  qrError.value = ''
  captureStarted.value = false
  if (props.show) loadOAuthQR()
}

// 二维码图片地址
const qrImageSrc = computed(() => {
  if (qrImageUrl.value) return qrImageUrl.value
  if (!wxLoginStore.qrCode) return ''
  if (wxLoginStore.qrCode.startsWith('data:')) return wxLoginStore.qrCode
  if (wxLoginStore.qrCode.startsWith('http')) return wxLoginStore.qrCode
  return `data:image/png;base64,${wxLoginStore.qrCode}`
})

// 状态样式
const statusClass = computed(() => {
  if (qrStatus.value === 'ok') return 'text-green-600'
  if (qrStatus.value === 'error') return 'text-red-600'
  if (qrStatus.value === 'loading') return 'text-blue-600'
  return 'text-gray-600'
})

watch(() => props.show, (newVal) => {
  if (newVal) {
    activeTab.value = 'login'
    qrStatus.value = 'idle'
    captureStarted.value = false
    loadOAuthQR()
  }
  else {
    stopCheck()
    stopCapturePoll()
  }
})
</script>

<template>
  <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
    <div class="max-w-md w-full overflow-hidden rounded-lg shadow-xl" :style="{ background: 'var(--theme-bg)' }">
      <!-- Header -->
      <div class="flex items-center justify-between border-b p-4" :style="{ borderColor: 'color-mix(in srgb, var(--theme-text) 10%, transparent)' }">
        <h3 class="text-lg font-semibold" :style="{ color: 'var(--theme-text)' }">
          {{ loginPlatform === 'qq' ? 'QQ扫码登录' : '微信扫码登录' }}
        </h3>
        <BaseButton variant="ghost" class="!p-1" @click="close">
          <div class="i-carbon-close text-xl" :style="{ color: 'var(--theme-text)' }" />
        </BaseButton>
      </div>

      <!-- Platform Switcher -->
      <div class="flex border-b" :style="{ borderColor: 'color-mix(in srgb, var(--theme-text) 10%, transparent)' }">
        <button
          class="flex-1 py-2 text-center text-sm font-medium transition-colors"
          :class="loginPlatform === 'qq' ? 'border-b-2 font-semibold' : 'opacity-60 hover:opacity-80'"
          :style="{
            color: loginPlatform === 'qq' ? 'var(--theme-primary)' : 'var(--theme-text)',
            borderColor: loginPlatform === 'qq' ? 'var(--theme-primary)' : 'transparent',
          }"
          @click="switchPlatform('qq')"
        >
          QQ登录
        </button>
        <button
          class="flex-1 py-2 text-center text-sm font-medium transition-colors"
          :class="loginPlatform === 'wx' ? 'border-b-2 font-semibold' : 'opacity-60 hover:opacity-80'"
          :style="{
            color: loginPlatform === 'wx' ? 'var(--theme-primary)' : 'var(--theme-text)',
            borderColor: loginPlatform === 'wx' ? 'var(--theme-primary)' : 'transparent',
          }"
          @click="switchPlatform('wx')"
        >
          微信登录
        </button>
        <button
          v-if="adminWxConfig.showWxConfigTab"
          class="flex-1 py-2 text-center text-sm font-medium transition-colors"
          :class="activeTab === 'settings' ? 'border-b-2' : 'opacity-60 hover:opacity-80'"
          :style="{
            color: activeTab === 'settings' ? 'var(--theme-primary)' : 'var(--theme-text)',
            borderColor: activeTab === 'settings' ? 'var(--theme-primary)' : 'transparent',
          }"
          @click="activeTab = 'settings'"
        >
          设置
        </button>
      </div>

      <!-- Login Tab -->
      <div v-if="activeTab === 'login'" class="p-4 space-y-4">
        <!-- 账号名称输入 -->
        <BaseInput
          v-model="accountName"
          label="账号备注（可选）"
          :placeholder="loginPlatform === 'qq' ? '留空使用QQ昵称' : '留空使用微信昵称'"
        />

        <!-- 二维码区域 -->
        <div class="flex flex-col items-center justify-center py-4 space-y-4">
          <!-- Show QR code -->
          <div
            v-if="qrImageSrc && (qrStatus === 'waiting' || qrStatus === 'scanned')"
            class="border rounded-lg p-2"
            :style="{ borderColor: 'color-mix(in srgb, var(--theme-text) 20%, transparent)', background: '#fff' }"
          >
            <img :src="qrImageSrc" class="h-48 w-48">
          </div>
          <!-- Show success/capture info -->
          <div v-else-if="qrStatus === 'ok' && captureStarted" class="w-full space-y-3">
            <div v-if="captureWaiting" class="text-center">
              <div class="i-svg-spinners-90-ring-with-bg text-3xl mx-auto mb-2" :style="{ color: 'var(--theme-primary)' }" />
              <p class="text-sm">等待手机打开QQ经典农场...</p>
              <p v-if="proxyHost" class="text-xs mt-1 text-foreground-muted">代理: {{ proxyHost }}:{{ proxyPort }}</p>
              <div class="mt-3 rounded-lg bg-blue-50 p-3 text-xs text-left text-blue-800 dark:bg-blue-900/20 dark:text-blue-200">
                <p class="font-medium mb-1">操作步骤:</p>
                <ol class="list-decimal pl-4 space-y-1">
                  <li>打开手机QQ → 进入QQ经典农场小程序</li>
                  <li>系统会自动捕获Code并创建账号</li>
                  <li>等待几秒钟，页面会自动更新</li>
                </ol>
              </div>
            </div>
            <div v-else-if="captureCode" class="text-center">
              <div class="i-carbon-checkmark-filled text-3xl mx-auto mb-2 text-green-500" />
              <p class="text-sm text-green-600">Code 已获取！</p>
              <BaseButton variant="primary" size="sm" class="mt-2" @click="createAccountManually">创建账号</BaseButton>
            </div>
            <div v-else class="text-center">
              <p class="text-sm text-amber-600">抓包不可用</p>
              <p class="text-xs mt-1 text-foreground-muted">请在手机上打开QQ经典农场，然后手动粘贴Code</p>
            </div>
          </div>
          <!-- Show loading/placeholder -->
          <div
            v-else
            class="h-48 w-48 flex items-center justify-center rounded-lg"
            :style="{ background: 'color-mix(in srgb, var(--theme-bg) 90%, var(--theme-text))' }"
          >
            <div v-if="qrStatus === 'loading'" i-svg-spinners-90-ring-with-bg class="text-3xl" :style="{ color: 'var(--theme-primary)' }" />
            <span v-else class="text-sm" :style="{ color: 'var(--theme-text)' }">
              {{ qrError ? '点击重新获取' : '点击获取二维码' }}
            </span>
          </div>

          <!-- 状态信息 -->
          <p v-if="qrMessage" class="text-center text-sm" :class="statusClass">
            {{ qrMessage }}
          </p>

          <!-- 错误信息 -->
          <p v-if="qrError" class="text-center text-sm text-red-600">
            {{ qrError }}
          </p>

          <!-- 操作按钮 -->
          <div class="flex gap-2">
            <BaseButton
              v-if="qrStatus === 'idle' || qrStatus === 'error'"
              variant="primary"
              size="sm"
              @click="loadOAuthQR"
            >
              获取二维码
            </BaseButton>
            <BaseButton
              v-if="qrStatus === 'waiting' || qrStatus === 'scanned'"
              variant="secondary"
              size="sm"
              @click="loadOAuthQR"
            >
              刷新二维码
            </BaseButton>
            <BaseButton
              v-if="captureCode"
              variant="outline"
              size="sm"
              @click="close"
            >
              完成
            </BaseButton>
          </div>
        </div>

        <!-- 说明文字 -->
        <div class="text-center text-xs opacity-60" :style="{ color: 'var(--theme-text)' }">
          <template v-if="loginPlatform === 'qq'">
            使用手机QQ扫码登录，确认后在手机QQ打开QQ经典农场自动添加账号
          </template>
          <template v-else>
            使用微信扫描二维码登录
          </template>
        </div>
      </div>

      <!-- Settings Tab -->
      <div v-else class="p-4 space-y-4">
        <div class="space-y-4">
          <BaseInput
            v-model="wxLoginStore.config.apiBase"
            label="API地址"
            placeholder="http://127.0.0.1:8059/api"
          />
          <BaseInput
            v-model="wxLoginStore.config.apiKey"
            label="API Key（可选）"
            placeholder="留空使用本地登录，填写则使用代理登录"
          />
          <BaseInput
            v-model="wxLoginStore.config.proxyApiUrl"
            label="代理API地址"
            placeholder="https://api.aineishe.com/api/wxnc"
          />
        </div>

        <div class="flex justify-end pt-4">
          <BaseButton variant="primary" @click="saveConfig">
            保存设置
          </BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>
