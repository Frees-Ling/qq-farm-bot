<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { useToastStore } from '@/stores/toast'

const router = useRouter()
const toast = useToastStore()

// 抓包状态
const clientType = ref<'qq' | 'wx'>('qq')
const captureEnabled = ref(false)
const captureStatus = ref<'idle' | 'starting' | 'waiting' | 'ready' | 'error'>('idle')
const sessionId = ref('')
const proxyHost = ref('')
const proxyPort = ref(0)
const captureCode = ref('')
const captureFriends = ref<string[]>([])
const errorMsg = ref('')
const note = ref('')
const autoStart = ref(true)
const creating = ref(false)
const downloading = ref(false)

// 手动输入
const manualCode = ref('')
const manualNote = ref('')
const manualPlatform = ref('qq')
const manualCreating = ref(false)

let pollTimer: ReturnType<typeof setInterval> | null = null

async function checkCaptureEnabled() {
  try {
    const res = await api.get('/api/capture-proxy/info')
    captureEnabled.value = !!res.data?.data?.enabled
  } catch { captureEnabled.value = false }
}

async function startCapture() {
  captureStatus.value = 'starting'
  errorMsg.value = ''
  try {
    const res = await api.post('/api/capture-proxy/start', { clientType: clientType.value })
    const data = res.data?.data
    sessionId.value = data.sessionId
    proxyHost.value = data.bindUrlHttp || window.location.hostname
    proxyPort.value = data.port || 8899
    captureStatus.value = 'waiting'
    startPolling()
  } catch (e: any) {
    errorMsg.value = e.response?.data?.error || '启动抓包失败'
    captureStatus.value = 'error'
  }
}

function startPolling() {
  stopPolling()
  pollTimer = setInterval(checkCaptureStatus, 2000)
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

async function checkCaptureStatus() {
  if (!sessionId.value) return
  try {
    const res = await api.get('/api/capture-proxy/status', { params: { sessionId: sessionId.value } })
    const data = res.data?.data
    if (data?.code) {
      captureCode.value = data.code
      if (data.friends?.length) captureFriends.value = data.friends
      captureStatus.value = 'ready'
      stopPolling()
      toast.success('抓包成功！Code 已获取')
    }
  } catch {}
}

function stopCapture() {
  stopPolling()
  if (sessionId.value) api.post('/api/capture-proxy/stop', { sessionId: sessionId.value }).catch(() => {})
  captureStatus.value = 'idle'
  sessionId.value = ''
  captureCode.value = ''
  captureFriends.value = []
}

async function downloadCert() {
  downloading.value = true
  try {
    const res = await api.get('/api/capture-proxy/cert', { responseType: 'blob' })
    const blob = new Blob([res.data], { type: res.headers['content-type'] || 'application/x-x509-ca-cert' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'mitmproxy-ca.cer'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    toast.success('证书已开始下载')
  } catch (e: any) {
    toast.error(e.response?.data?.error || '证书下载失败')
  } finally { downloading.value = false }
}

async function createFromCapture() {
  if (!captureCode.value) { toast.warning('请先完成抓包'); return }
  creating.value = true
  try {
    const res = await api.post('/api/accounts', {
      name: note.value.trim(),
      code: captureCode.value,
      platform: clientType.value === 'wx' ? 'wx' : 'qq',
      loginType: 'manual',
      autoStart: autoStart.value,
    })
    if (res.data?.ok) {
      toast.success('账号已创建' + (autoStart.value ? '，正在启动' : ''))
      stopCapture()
      router.push('/accounts')
    } else toast.error(res.data?.error || '创建失败')
  } catch (e: any) {
    toast.error(e.response?.data?.error || '创建失败')
  } finally { creating.value = false }
}

async function createManual() {
  if (!manualCode.value) { toast.warning('请先填写 Code'); return }
  manualCreating.value = true
  try {
    const res = await api.post('/api/accounts', {
      name: manualNote.value.trim(),
      code: manualCode.value,
      platform: manualPlatform.value,
      loginType: 'manual',
      autoStart: autoStart.value,
    })
    if (res.data?.ok) {
      toast.success('账号已创建' + (autoStart.value ? '，正在启动' : ''))
      manualCode.value = ''
      manualNote.value = ''
      router.push('/accounts')
    } else toast.error(res.data?.error || '创建失败')
  } catch (e: any) {
    toast.error(e.response?.data?.error || '创建失败')
  } finally { manualCreating.value = false }
}

onMounted(() => { checkCaptureEnabled() })
onUnmounted(() => { stopPolling() })
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-foreground">抓包添加账号</h1>
        <p class="mt-1 text-sm text-foreground-muted">通过手机代理抓包或手动填写 Code 添加账号</p>
      </div>
      <div class="flex gap-2">
        <BaseButton variant="outline" @click="router.push('/wechat')">微信扫码</BaseButton>
        <BaseButton variant="outline" @click="router.push('/accounts')">返回账号列表</BaseButton>
      </div>
    </div>

    <!-- 抓包区域 -->
    <div v-if="captureEnabled" class="card p-5">
      <h2 class="mb-3 text-lg font-semibold text-foreground">📱 手机代理抓包</h2>
      <div class="mb-3 rounded-lg border border-blue-200/60 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-700/40 dark:bg-blue-900/20 dark:text-blue-200">
        <p class="mb-1 font-medium">使用说明</p>
        <ol class="list-decimal pl-4 text-xs space-y-1">
          <li>选择客户端类型（QQ/微信）</li>
          <li>点击「开始抓包」获取代理地址</li>
          <li>手机 WiFi 设置 HTTP 代理（服务器 + 端口）</li>
          <li>下载并安装 CA 证书（信任证书）</li>
          <li>打开小程序进入农场，自动捕获 Code</li>
        </ol>
      </div>

      <!-- idle/error -->
      <div v-if="captureStatus === 'idle' || captureStatus === 'error'" class="space-y-3">
        <div class="flex gap-3">
          <label class="flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-colors"
            :class="clientType === 'qq' ? 'border-blue-500 bg-blue-500/10' : 'border-border-subtle'">
            <input v-model="clientType" type="radio" value="qq" class="accent-accent" />
            QQ 小程序
          </label>
          <label class="flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-colors"
            :class="clientType === 'wx' ? 'border-blue-500 bg-blue-500/10' : 'border-border-subtle'">
            <input v-model="clientType" type="radio" value="wx" class="accent-accent" />
            微信 小程序
          </label>
        </div>
        <BaseButton variant="primary" :loading="captureStatus === 'starting'" @click="startCapture">
          开始抓包
        </BaseButton>
        <p v-if="errorMsg" class="text-sm text-red-500">{{ errorMsg }}</p>
      </div>

      <!-- waiting -->
      <div v-if="captureStatus === 'waiting'" class="space-y-3">
        <div class="rounded-lg border divide-y divide-border-subtle">
          <div class="flex items-center justify-between px-4 py-3">
            <span class="text-sm text-foreground-muted">代理服务器</span>
            <code class="text-sm font-mono">{{ proxyHost }}:{{ proxyPort }}</code>
          </div>
        </div>
        <div class="flex items-center gap-2 py-2">
          <span class="inline-block h-2 w-2 animate-pulse rounded-full bg-green-500"></span>
          <span class="text-sm text-foreground-muted">等待抓包中…设好代理后进农场即可</span>
        </div>
        <div class="flex gap-2">
          <BaseButton variant="outline" @click="downloadCert" :loading="downloading">下载 CA 证书</BaseButton>
          <BaseButton variant="outline" @click="stopCapture">停止抓包</BaseButton>
        </div>
      </div>

      <!-- ready -->
      <div v-if="captureStatus === 'ready'" class="space-y-3">
        <div class="rounded-lg border border-green-500/30 bg-green-50 p-4 dark:bg-green-900/20">
          <p class="text-sm font-medium text-green-700 dark:text-green-300">✅ 抓包成功！Code 已获取</p>
          <code class="mt-1 block break-all text-xs text-foreground-muted">{{ captureCode.slice(0, 40) }}...</code>
        </div>
        <BaseInput v-model="note" label="备注名称" placeholder="例如：QQ大号" />
        <label class="flex items-center gap-2 text-sm text-foreground">
          <input v-model="autoStart" type="checkbox" class="accent-accent" />
          创建后立即启动
        </label>
        <div class="flex gap-2">
          <BaseButton variant="primary" :loading="creating" @click="createFromCapture">创建账号</BaseButton>
          <BaseButton variant="outline" @click="stopCapture">重新抓包</BaseButton>
        </div>
      </div>
    </div>

    <!-- 手动输入区域 -->
    <div class="card p-5">
      <h2 class="mb-3 text-lg font-semibold text-foreground">✏️ 手动填写 Code</h2>
      <div class="space-y-3">
        <BaseInput v-model="manualCode" label="Code" placeholder="粘贴登录 Code 或包含 code 参数的 URL" />
        <BaseInput v-model="manualNote" label="备注名称" placeholder="例如：大号" />
        <BaseSelect v-model="manualPlatform" label="平台" :options="[
          { label: 'QQ小程序', value: 'qq' },
          { label: '微信小程序', value: 'wx' }
        ]" />
        <label class="flex items-center gap-2 text-sm text-foreground">
          <input v-model="autoStart" type="checkbox" class="accent-accent" />
          创建后立即启动
        </label>
        <BaseButton variant="primary" :loading="manualCreating" @click="createManual">创建账号</BaseButton>
      </div>
    </div>
  </div>
</template>
