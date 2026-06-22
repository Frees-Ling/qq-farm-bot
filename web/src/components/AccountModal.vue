<script setup lang="ts">
import type { ApiResult } from '@/api/result'
import { useIntervalFn } from '@vueuse/core'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import api from '@/api'
import { getErrorMessage } from '@/api/error'
import { unwrapOk } from '@/api/result'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseTextarea from '@/components/ui/BaseTextarea.vue'
import { useWxLoginStore } from '@/stores/wx-login'

const props = defineProps<{
  show: boolean
  editData?: any
}>()

const emit = defineEmits(['close', 'saved'])

const wxLoginStore = useWxLoginStore()

// 标签页：manual-手动填码, wx-微信扫码, qq-QQ扫码, wx-config-微信配置
const activeTab = ref<'wx' | 'qq' | 'wx-config' | 'manual'>('manual')
const loading = ref(false)
const errorMessage = ref('')

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

// 微信扫码相关
const wxAccountName = ref('')
// QQ 扫码相关
const qqAccountName = ref('')

// 表单数据
const form = reactive({
  name: '',
  code: '',
  platform: 'qq' as 'qq' | 'wx',
})

// 微信扫码轮询
const { pause: stopWxCheck, resume: startWxCheck } = useIntervalFn(async () => {
  if (wxLoginStore.status !== 'qr_ready' && wxLoginStore.status !== 'confirming') {
    return
  }
  const result = await wxLoginStore.checkLogin()
  if (result.success && result.wxid) {
    stopWxCheck()
    // 获取Code并添加账号
    const codeResult = await wxLoginStore.getFarmCode()
    if (codeResult.success && codeResult.code) {
      const name = wxAccountName.value.trim() || result.nickname || `微信账号${Date.now()}`
      await addAccount({
        id: props.editData?.id,
        name: props.editData ? (props.editData.name || name) : name,
        code: codeResult.code,
        platform: 'wx',
        loginType: 'wx_qr',
        wxid: result.wxid,
      })
    }
  }
}, 2000, { immediate: false })

// 获取微信二维码
async function loadWxQRCode() {
  if (activeTab.value !== 'wx')
    return
  wxLoginStore.resetState()
  const success = await wxLoginStore.getQRCode()
  if (success) {
    startWxCheck()
  }
}

const qqCaptureHttpUrl = computed(() => {
  const host = window.location.hostname || 'SERVER_IP'
  return `http://${host}:9988/admin`
})

function openQqCapturePage() {
  window.open(qqCaptureHttpUrl.value, '_blank', 'noopener,noreferrer')
}

// 保存微信配置
function saveWxConfig() {
  wxLoginStore.updateConfig({
    apiBase: wxLoginStore.config.apiBase,
    apiKey: wxLoginStore.config.apiKey,
    proxyApiUrl: wxLoginStore.config.proxyApiUrl,
  })
  activeTab.value = 'wx'
  loadWxQRCode()
}

// 添加账号
async function addAccount(data: any) {
  loading.value = true
  errorMessage.value = ''
  try {
    const res = await api.post('/api/accounts', data)
    unwrapOk(res.data as ApiResult<any>, '保存失败')
    emit('saved')
    close()
  }
  catch (e: any) {
    errorMessage.value = `保存失败: ${getErrorMessage(e, '保存失败')}`
  }
  finally {
    loading.value = false
  }
}

// 手动提交
async function submitManual() {
  errorMessage.value = ''
  if (!form.code) {
    errorMessage.value = '请输入Code'
    return
  }

  let code = form.code.trim()
  const match = code.match(/[?&]code=([^&]+)/i)
  if (match && match[1]) {
    code = decodeURIComponent(match[1])
    form.code = code
  }

  let payload: any = {}
  if (props.editData) {
    const onlyNameChanged = form.name !== props.editData.name
      && form.code === (props.editData.code || '')
      && form.platform === (props.editData.platform || 'qq')

    if (onlyNameChanged) {
      payload = { id: props.editData.id, name: form.name }
    }
    else {
      payload = {
        id: props.editData.id,
        name: form.name,
        code,
        platform: form.platform,
        loginType: 'manual',
      }
    }
  }
  else {
    payload = {
      name: form.name,
      code,
      platform: form.platform,
      loginType: 'manual',
    }
  }

  await addAccount(payload)
}

// 微信二维码图片
const wxQrImageSrc = computed(() => {
  if (!wxLoginStore.qrCode)
    return ''
  if (wxLoginStore.qrCode.startsWith('data:'))
    return wxLoginStore.qrCode
  if (wxLoginStore.qrCode.startsWith('http'))
    return wxLoginStore.qrCode
  return `data:image/png;base64,${wxLoginStore.qrCode}`
})

function close() {
  stopWxCheck()
  wxLoginStore.resetState()
  emit('close')
}

watch(() => props.show, (newVal) => {
  if (newVal) {
    errorMessage.value = ''
    if (props.editData) {
      activeTab.value = 'manual'
      form.name = props.editData.name || ''
      form.code = props.editData.code || ''
      form.platform = props.editData.platform || 'qq'
      wxAccountName.value = props.editData.name || ''
      qqAccountName.value = props.editData.name || ''
    }
    else {
      activeTab.value = 'manual'
      form.name = ''
      form.code = ''
      form.platform = 'qq'
      wxAccountName.value = ''
      qqAccountName.value = ''
    }
  }
  else {
    stopWxCheck()
    wxLoginStore.resetState()
  }
})

watch(activeTab, (tab) => {
  if (tab === 'wx') {
    loadWxQRCode()
  }
  else {
    stopWxCheck()
    wxLoginStore.resetState()
  }
})
</script>

<template>
  <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
    <div class="max-h-[90vh] max-w-md w-full overflow-hidden rounded-lg shadow-xl" :style="{ background: 'var(--theme-bg)' }">
      <!-- Header -->
      <div class="flex items-center justify-between border-b p-4" :style="{ borderColor: 'color-mix(in srgb, var(--theme-text) 10%, transparent)' }">
        <h3 class="text-lg font-semibold" :style="{ color: 'var(--theme-text)' }">
          {{ editData ? '编辑账号' : '添加账号' }}
        </h3>
        <BaseButton variant="ghost" class="!p-1" @click="close">
          <div class="i-carbon-close text-xl" :style="{ color: 'var(--theme-text)' }" />
        </BaseButton>
      </div>

      <div class="max-h-[calc(90vh-80px)] overflow-y-auto p-4">
        <!-- 错误信息 -->
        <div v-if="errorMessage" class="mb-4 rounded p-3 text-sm" :style="{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }">
          {{ errorMessage }}
        </div>

        <!-- Tabs -->
        <div class="mb-4 flex border-b" :style="{ borderColor: 'color-mix(in srgb, var(--theme-text) 10%, transparent)' }">
          <button
            class="flex-1 py-2 text-center text-sm font-medium transition-colors"
            :class="activeTab === 'manual' ? 'border-b-2' : 'opacity-60'"
            :style="{
              color: activeTab === 'manual' ? 'var(--theme-primary)' : 'var(--theme-text)',
              borderColor: 'var(--theme-primary)',
            }"
            @click="activeTab = 'manual'"
          >
            手动填码
          </button>
          <button
            v-if="adminWxConfig.showWxLoginTab"
            class="flex-1 py-2 text-center text-sm font-medium transition-colors"
            :class="activeTab === 'wx' ? 'border-b-2' : 'opacity-60'"
            :style="{
              color: activeTab === 'wx' ? 'var(--theme-primary)' : 'var(--theme-text)',
              borderColor: 'var(--theme-primary)',
            }"
            @click="activeTab = 'wx'"
          >
            微信扫码
          </button>
          <button
            class="flex-1 py-2 text-center text-sm font-medium transition-colors"
            :class="activeTab === 'qq' ? 'border-b-2' : 'opacity-60'"
            :style="{
              color: activeTab === 'qq' ? 'var(--theme-primary)' : 'var(--theme-text)',
              borderColor: 'var(--theme-primary)',
            }"
            @click="activeTab = 'qq'"
          >
            QQ扫码
          </button>
          <button
            v-if="adminWxConfig.showWxConfigTab"
            class="flex-1 py-2 text-center text-sm font-medium transition-colors"
            :class="activeTab === 'wx-config' ? 'border-b-2' : 'opacity-60'"
            :style="{
              color: activeTab === 'wx-config' ? 'var(--theme-primary)' : 'var(--theme-text)',
              borderColor: 'var(--theme-primary)',
            }"
            @click="activeTab = 'wx-config'"
          >
            微信配置
          </button>
        </div>

        <!-- 微信扫码 Tab -->
        <div v-if="activeTab === 'wx'" class="space-y-4">
          <BaseInput
            v-model="wxAccountName"
            label="账号备注（可选）"
            placeholder="留空使用微信昵称"
          />

          <div class="flex flex-col items-center justify-center py-4 space-y-4">
            <div
              v-if="wxQrImageSrc"
              class="border rounded-lg p-2"
              :style="{ borderColor: 'color-mix(in srgb, var(--theme-text) 20%, transparent)', background: '#fff' }"
            >
              <img :src="wxQrImageSrc" class="h-48 w-48">
            </div>
            <div
              v-else
              class="h-48 w-48 flex items-center justify-center rounded-lg"
              :style="{ background: 'color-mix(in srgb, var(--theme-bg) 90%, var(--theme-text))' }"
            >
              <div v-if="wxLoginStore.isLoading" i-svg-spinners-90-ring-with-bg class="text-3xl" :style="{ color: 'var(--theme-primary)' }" />
              <span v-else class="text-sm" :style="{ color: 'var(--theme-text)' }">点击获取二维码</span>
            </div>

            <p class="text-center text-sm" :style="{ color: 'var(--theme-text)' }">
              {{ wxLoginStore.statusMessage }}
            </p>

            <p v-if="wxLoginStore.errorMessage" class="text-center text-sm text-red-600">
              {{ wxLoginStore.errorMessage }}
            </p>

            <BaseButton variant="secondary" size="sm" :loading="wxLoginStore.isLoading" @click="loadWxQRCode">
              刷新二维码
            </BaseButton>
          </div>

          <div class="text-center text-xs opacity-60" :style="{ color: 'var(--theme-text)' }">
            使用微信扫描二维码登录，登录成功后将自动添加账号
          </div>
        </div>

        <!-- QQ 客户端捕获 Tab -->
        <div v-if="activeTab === 'qq'" class="space-y-4">
          <BaseInput
            v-model="qqAccountName"
            label="账号备注（可选）"
            placeholder="捕获成功后可在账号列表修改"
          />

          <div class="space-y-3 py-2">
            <div class="rounded-lg p-3 text-sm leading-6" :style="{ background: 'color-mix(in srgb, var(--theme-primary) 10%, transparent)', color: 'var(--theme-text)' }">
              <div class="font-medium">
                QQ 网页扫码接口已不可用，请使用服务器 QQ 客户端捕获。
              </div>
              <div class="mt-2 opacity-80">
                在服务器桌面或 VNC 里打开 QQ，让用户扫码登录 QQ 客户端，然后打开 QQ经典农场。捕获服务会自动读取真实农场 code，并创建/启动账号。
              </div>
            </div>

            <div class="rounded-lg p-3 text-xs leading-6" :style="{ background: 'color-mix(in srgb, var(--theme-bg) 88%, var(--theme-text))', color: 'var(--theme-text)' }">
              <div>1. 服务器运行面板、捕获服务和 patch watcher。</div>
              <div>2. 服务器 QQ 客户端扫码登录一次。</div>
              <div>3. 打开 QQ经典农场，关闭后再打开一次。</div>
              <div>4. 捕获成功后账号会自动出现并开始农场脚本。</div>
            </div>

            <BaseButton variant="primary" size="sm" @click="openQqCapturePage">
              打开捕获入口
            </BaseButton>

            <p class="break-all text-xs opacity-70" :style="{ color: 'var(--theme-text)' }">
              {{ qqCaptureHttpUrl }}
            </p>
          </div>

          <div class="text-center text-xs opacity-60" :style="{ color: 'var(--theme-text)' }">
            不要再扫旧 QQ 网页授权二维码；它会返回 code=-3000。
          </div>
        </div>

        <!-- 微信配置 Tab -->
        <div v-if="activeTab === 'wx-config'" class="space-y-4">
          <BaseInput
            v-model="wxLoginStore.config.apiBase"
            label="后端API地址"
            placeholder="http://127.0.0.1:8059/api"
          />
          <p class="text-xs opacity-60" :style="{ color: 'var(--theme-text)' }">
            当前项目后端地址，默认：http://127.0.0.1:8059/api
          </p>

          <BaseInput
            v-model="wxLoginStore.config.apiKey"
            label="API Key（可选）"
            placeholder="留空使用本地API，填写则使用代理模式"
          />

          <BaseInput
            v-if="wxLoginStore.useProxyMode"
            v-model="wxLoginStore.config.proxyApiUrl"
            label="第三方API地址"
            placeholder="https://api.aineishe.com/api/wxnc"
          />

          <div v-if="wxLoginStore.useProxyMode" class="rounded bg-blue-50 p-2 text-xs text-blue-600">
            当前使用代理模式，请求将通过后端转发到第三方API
          </div>
          <div v-else class="rounded bg-gray-50 p-2 text-xs text-gray-500">
            当前使用本地API模式，直接请求本地服务
          </div>

          <div class="flex justify-end pt-4">
            <BaseButton variant="primary" @click="saveWxConfig">
              保存并返回
            </BaseButton>
          </div>
        </div>

        <!-- 手动填码 Tab -->
        <div v-if="activeTab === 'manual'" class="space-y-4">
          <BaseInput
            v-model="form.name"
            label="账号备注（可选）"
            placeholder="留空默认账号X"
          />

          <BaseTextarea
            v-model="form.code"
            label="Code"
            placeholder="请输入登录 Code"
            :rows="3"
          />

          <div v-if="!editData" class="flex gap-4">
            <label class="flex cursor-pointer items-center gap-2">
              <input
                v-model="form.platform"
                type="radio"
                value="qq"
                class="h-4 w-4"
                :style="{ accentColor: 'var(--theme-primary)' }"
              >
              <span class="text-sm" :style="{ color: 'var(--theme-text)' }">QQ小程序</span>
            </label>
            <label class="flex cursor-pointer items-center gap-2">
              <input
                v-model="form.platform"
                type="radio"
                value="wx"
                class="h-4 w-4"
                :style="{ accentColor: 'var(--theme-primary)' }"
              >
              <span class="text-sm" :style="{ color: 'var(--theme-text)' }">微信小程序</span>
            </label>
          </div>

          <div class="flex justify-end gap-2 pt-4">
            <BaseButton variant="outline" @click="close">
              取消
            </BaseButton>
            <BaseButton variant="primary" :loading="loading" @click="submitManual">
              {{ editData ? '保存' : '添加' }}
            </BaseButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
