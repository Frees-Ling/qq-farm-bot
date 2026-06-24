<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useAccountStore } from '@/stores/account'
import { useToastStore } from '@/stores/toast'
import { copyTextToClipboard } from '@/utils'

const router = useRouter()
const accountStore = useAccountStore()
const toast = useToastStore()

const status = ref<'idle' | 'waiting' | 'captured'>('idle')
const knownCount = ref(0)
const capturedAccount = ref<any>(null)
let pollTimer: ReturnType<typeof setInterval> | null = null

// 远程连接信息
const connectionInfo = ref<any>(null)
const isLoadingInfo = ref(true)
const infoError = ref('')
const isRemote = ref(false)
const copiedWsUrl = ref(false)

// 操作系统检测
const platform = computed(() => {
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('mac')) return 'macos'
  if (ua.includes('linux')) return 'linux'
  return 'windows'
})

const platformLabel = computed(() => {
  const labels: Record<string, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux' }
  return labels[platform.value] || '未知'
})


// 判断是否本机访问
function checkIsRemote() {
  const host = window.location.hostname
  return !['127.0.0.1', 'localhost', '::1', '0.0.0.0', ''].includes(host)
}

// 获取服务器连接信息
async function fetchConnectionInfo() {
  isLoadingInfo.value = true
  infoError.value = ''
  try {
    const res = await api.get('/api/pc-capture/info', { silent: true })
    if (res.data.ok) {
      connectionInfo.value = res.data.data
    } else {
      throw new Error(res.data.error || '获取信息失败')
    }
  } catch (e: any) {
    infoError.value = e?.message || '无法获取服务器连接信息'
    connectionInfo.value = null
  } finally {
    isLoadingInfo.value = false
  }
}

onMounted(() => {
  isRemote.value = checkIsRemote()
  fetchConnectionInfo()
})

async function startListening() {
  status.value = 'waiting'
  knownCount.value = accountStore.accounts.length
  await accountStore.fetchAccounts()
  knownCount.value = accountStore.accounts.length
  pollTimer = setInterval(checkForNewAccount, 3000)
}

async function checkForNewAccount() {
  try {
    await accountStore.fetchAccounts()
    const current = accountStore.accounts.length
    if (current > knownCount.value) {
      const newAccts = accountStore.accounts.filter((a: any) => !a.deletedAt)
      const likely = newAccts[0]
      if (likely) {
        capturedAccount.value = likely
        status.value = 'captured'
        stopPolling()
        toast.success('🎉 捕获成功！')
      }
    }
  } catch {}
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function startBot() {
  if (!capturedAccount.value?.id) return
  try {
    await accountStore.startAccount(capturedAccount.value.id)
    toast.success('农场账号已启动！')
    router.push('/')
  } catch (e: any) {
    toast.error(e.response?.data?.error || '启动失败')
  }
}

async function handleCopyWsUrl() {
  if (!connectionInfo.value?.wsUrl) return
  const ok = await copyTextToClipboard(connectionInfo.value.wsUrl)
  if (ok) {
    copiedWsUrl.value = true
    setTimeout(() => { copiedWsUrl.value = false }, 2000)
  }
}

async function handleDownloadScript() {
  try {
    const os = platform.value === 'macos' || platform.value === 'linux' ? platform.value : 'windows'
    const fileName = os === 'windows' ? 'qq-farm-patch.bat' : 'qq-farm-patch.sh'
    const res = await api.get(`/api/pc-capture/download-script?os=${os}`, {
      responseType: 'blob',
      silent: true,
    })
    const url = window.URL.createObjectURL(new Blob([res.data]))
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', fileName)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
    toast.success(`${platformLabel.value}一键配置脚本已下载`)
  } catch (e: any) {
    toast.error('下载失败: ' + (e?.message || '未知错误'))
  }
}

onUnmounted(() => stopPolling())
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-foreground">💻 PC QQ 监听捕获</h1>
        <p class="mt-1 text-sm text-foreground-muted">监听到PC QQ打开QQ经典农场时自动捕获Code</p>
      </div>
      <BaseButton variant="outline" @click="router.push('/accounts')">账号列表</BaseButton>
    </div>

    <!-- 远程模式：连接信息卡片 -->
    <div v-if="isRemote" class="card p-5">
      <h2 class="text-lg font-semibold text-foreground mb-2">🔗 服务器连接信息</h2>

      <!-- 加载中 -->
      <div v-if="isLoadingInfo" class="space-y-2 animate-pulse">
        <div class="h-4 w-48 rounded bg-gray-200 dark:bg-gray-700" />
        <div class="h-4 w-64 rounded bg-gray-200 dark:bg-gray-700" />
        <div class="h-4 w-56 rounded bg-gray-200 dark:bg-gray-700" />
      </div>

      <!-- 加载失败 -->
      <div v-else-if="infoError" class="rounded-lg border border-yellow-500/30 bg-yellow-50 p-3 text-sm text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200">
        ⚠️ {{ infoError }}
      </div>

      <!-- 连接信息 -->
      <div v-else-if="connectionInfo" class="space-y-3 text-sm">
        <div class="flex items-center justify-between rounded-lg bg-gray-50 p-3 dark:bg-gray-800">
          <span class="text-foreground-muted">服务器IP</span>
          <code class="font-mono font-medium">{{ connectionInfo.publicIp || '未检测到' }}</code>
        </div>

        <div class="flex items-center justify-between rounded-lg bg-gray-50 p-3 dark:bg-gray-800">
          <span class="text-foreground-muted">嗅探服务</span>
          <span v-if="connectionInfo.sniffRunning" class="flex items-center gap-1.5 text-green-600">
            <span class="inline-block h-2 w-2 rounded-full bg-green-500" />
            {{ connectionInfo.sniffHealth === 'healthy' ? '运行正常' : '端口监听中' }}
          </span>
          <span v-else class="flex items-center gap-1.5 text-red-500">
            <span class="inline-block h-2 w-2 rounded-full bg-red-500" />
            未运行
          </span>
        </div>

        <div v-if="connectionInfo.ufwActive" class="rounded-lg border p-3 text-sm" :class="connectionInfo.ufwPortAllowed ? 'border-green-500/30 bg-green-50 dark:bg-green-900/20' : 'border-yellow-500/30 bg-yellow-50 dark:bg-yellow-900/20'">
          <div class="flex items-center gap-2">
            <span>🛡️ UFW防火墙</span>
            <span :class="connectionInfo.ufwPortAllowed ? 'text-green-600' : 'text-yellow-600'">
              {{ connectionInfo.ufwPortAllowed ? '9988端口已放行' : '⚠️ 9988端口可能被阻挡' }}
            </span>
          </div>
          <p v-if="!connectionInfo.ufwPortAllowed" class="mt-1 text-xs text-foreground-muted">
            在服务器上运行: <code class="rounded bg-gray-100 px-1 dark:bg-gray-700">ufw allow 9988</code>
          </p>
        </div>

        <div class="flex items-center justify-between rounded-lg bg-gray-50 p-3 dark:bg-gray-800">
          <span class="text-foreground-muted">WebSocket地址</span>
          <div class="flex items-center gap-2">
            <code class="text-xs font-mono">{{ connectionInfo.wsUrl }}</code>
            <button class="text-xs px-2 py-1 rounded transition-colors" :class="copiedWsUrl ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' : 'bg-gray-200 text-gray-600 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'" @click="handleCopyWsUrl">
              {{ copiedWsUrl ? '已复制!' : '复制' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 远程模式：配置引导 -->
    <div v-if="isRemote && connectionInfo && !isLoadingInfo && !infoError" class="card p-5">
      <h2 class="text-lg font-semibold text-foreground mb-3">📋 远程配置步骤</h2>
      <div class="space-y-4">
        <div class="flex items-start gap-3">
          <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold" style="background: var(--theme-primary); color: white">1</span>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-foreground">下载一键配置脚本</p>
            <p class="text-xs text-foreground-muted mt-0.5">保存到你的电脑上，根据提示运行即可自动完成全栈配置（自动适配 {{ platformLabel }}）</p>
            <BaseButton variant="primary" size="sm" class="mt-2" @click="handleDownloadScript">
              ⬇️ 下载一键全栈配置脚本 ({{ platformLabel }})
            </BaseButton>
          </div>
        </div>

        <div class="flex items-start gap-3">
          <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold" style="background: var(--theme-primary); color: white">2</span>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-foreground">在你的电脑上运行</p>
            <p class="text-xs text-foreground-muted mt-0.5">根据你的操作系统运行下载的脚本：
              <span v-if="platform === 'windows'">双击运行 <code>qq-farm-patch.bat</code>（如需管理员权限请右键 → 「以管理员身份运行」）</span>
              <span v-else>终端执行: <code>chmod +x qq-farm-patch.sh && ./qq-farm-patch.sh</code></span>
            </p>
          </div>
        </div>

        <div class="flex items-start gap-3">
          <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold" style="background: var(--theme-primary); color: white">3</span>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-foreground">打开QQ经典农场</p>
            <p class="text-xs text-foreground-muted mt-0.5">在你的电脑上登录QQ，打开QQ经典农场小程序。补丁会自动拦截Code并发送到服务器。</p>
          </div>
        </div>

        <div class="flex items-start gap-3">
          <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold" style="background: var(--theme-primary); color: white">4</span>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-foreground">点击下方按钮开始监听</p>
            <p class="text-xs text-foreground-muted mt-0.5">等待服务器收到Code后自动创建账号</p>
          </div>
        </div>
      </div>
    </div>

    <!-- 本地模式：工作原理 -->
    <div v-if="!isRemote" class="card p-5">
      <h2 class="text-lg font-semibold text-foreground mb-2">⚡ 原理</h2>
      <p class="text-sm text-foreground-muted leading-relaxed">
        QQ经典农场的 game.js 已被注入捕获补丁。当你打开PC QQ上的QQ经典农场时，
        补丁会自动拦截网络连接，提取登录凭证（Code）并提交到面板，账号自动创建。
      </p>
      <div class="mt-3 space-y-1 text-sm">
        <div class="flex items-center gap-2">
          <span class="inline-block h-2 w-2 rounded-full" :class="connectionInfo?.sniffRunning ? 'bg-green-500' : 'bg-red-500'" />
          <span>Code接收服务 (端口9988):</span>
          <span :class="connectionInfo?.sniffRunning ? 'text-green-600' : 'text-red-600'" class="font-medium">
            {{ connectionInfo?.sniffRunning ? '✅ 运行中' : '❌ 未运行' }}
          </span>
        </div>
      </div>
    </div>

    <!-- 核心操作区 -->
    <div class="card p-8">
      <!-- idle -->
      <div v-if="status === 'idle'" class="flex flex-col items-center gap-4 py-8">
        <div class="i-carbon-audio-spectrum text-6xl text-foreground-muted" />
        <p class="text-lg text-foreground">准备好后，点击开始监听</p>
        <p class="text-sm text-foreground-muted">{{ isRemote ? '确保已按上述步骤配置好补丁' : '然后打开PC QQ上的QQ经典农场' }}</p>
        <BaseButton variant="primary" size="lg" @click="startListening">
          🎯 开始监听
        </BaseButton>
      </div>

      <!-- waiting -->
      <div v-if="status === 'waiting'" class="flex flex-col items-center gap-4 py-8">
        <div class="i-svg-spinners-90-ring-with-bg text-5xl" style="color: var(--theme-primary)" />
        <p class="text-lg font-medium text-foreground">正在监听...</p>
        <div class="w-full max-w-md rounded-lg border border-blue-200/60 bg-blue-50 p-4 text-sm text-blue-800 dark:border-blue-700/40 dark:bg-blue-900/20 dark:text-blue-200">
          <p class="font-medium mb-2">📋 操作步骤</p>
          <ol class="list-decimal pl-4 space-y-1 text-xs">
            <li>打开电脑上的 <strong>QQ</strong></li>
            <li>找到并打开 <strong>QQ经典农场</strong> 小程序</li>
            <li>等待几秒，补丁自动捕获Code</li>
            <li>页面会自动检测到新账号 🎉</li>
          </ol>
        </div>
        <p class="text-sm text-foreground-muted animate-pulse">等待PC QQ打开农场...</p>
        <BaseButton variant="outline" size="sm" @click="stopPolling(); status='idle'">
          取消监听
        </BaseButton>
      </div>

      <!-- captured -->
      <div v-if="status === 'captured'" class="flex flex-col items-center gap-4 py-8">
        <div class="i-carbon-checkmark-filled text-6xl text-green-500" />
        <p class="text-xl font-bold text-green-600">🎉 捕获成功！</p>
        <div class="w-full max-w-sm rounded-lg border border-green-500/30 bg-green-50 p-4 dark:bg-green-900/20">
          <div class="space-y-2 text-sm">
            <div class="flex justify-between">
              <span class="text-foreground-muted">名称:</span>
              <span class="text-foreground font-medium">{{ capturedAccount?.name }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-foreground-muted">平台:</span>
              <span class="text-foreground font-medium">{{ capturedAccount?.platform === 'qq' ? 'QQ' : '微信' }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-foreground-muted">Code:</span>
              <code class="text-xs">{{ (capturedAccount?.code || '').slice(0, 20) }}...</code>
            </div>
          </div>
        </div>
        <div class="flex gap-3">
          <BaseButton variant="primary" @click="startBot">🚀 启动农场挂机</BaseButton>
          <BaseButton variant="outline" @click="router.push('/accounts')">查看账号</BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>
