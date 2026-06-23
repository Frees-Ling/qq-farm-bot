<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { useToastStore } from '@/stores/toast'

const router = useRouter()
const toast = useToastStore()

const qrStatus = ref<'idle' | 'starting' | 'waiting' | 'scanned' | 'ready' | 'error'>('idle')
const qrUuid = ref('')
const qrImageUrl = ref('')
const farmCode = ref('')
const openId = ref('')
const errorMsg = ref('')
const note = ref('')
const autoStart = ref(true)
const creating = ref(false)

let pollTimer: ReturnType<typeof setInterval> | null = null

async function createQR() {
  qrStatus.value = 'starting'
  errorMsg.value = ''
  try {
    const res = await api.post('/api/wx-qr/create')
    const data = res.data?.data
    qrUuid.value = data.uuid
    qrImageUrl.value = data.qrImageUrl
    qrStatus.value = 'waiting'
    startPolling()
  } catch (e: any) {
    errorMsg.value = e.response?.data?.error || '生成二维码失败'
    qrStatus.value = 'error'
  }
}

function startPolling() {
  stopPolling()
  pollTimer = setInterval(checkStatus, 2000)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function checkStatus() {
  if (!qrUuid.value) return
  try {
    const res = await api.post('/api/wx-qr/check', { code: qrUuid.value })
    const data = res.data?.data
    const status = String(data?.status || '').toLowerCase()

    if (status === 'ok' && data?.code) {
      farmCode.value = data.code
      openId.value = data.openId || ''
      qrStatus.value = 'ready'
      stopPolling()
      toast.success('微信扫码成功，Code 已获取')
      return
    }
    if (status === 'scanned') {
      qrStatus.value = 'scanned'
    }
  } catch {
    // continue polling
  }
}

async function createAccount() {
  if (!farmCode.value) { toast.warning('请先完成微信扫码'); return }
  creating.value = true
  try {
    const res = await api.post('/api/accounts', {
      name: note.value.trim(),
      code: farmCode.value,
      platform: 'wx',
      openId: openId.value || undefined,
      loginType: 'qr',
      autoStart: autoStart.value,
    })
    if (res.data?.ok) {
      toast.success('微信账号已创建' + (autoStart.value ? '，正在启动' : ''))
      resetForm()
      router.push('/accounts')
    } else {
      toast.error(res.data?.error || '创建失败')
    }
  } catch (e: any) {
    toast.error(e.response?.data?.error || e.message || '创建失败')
  } finally {
    creating.value = false
  }
}

function resetForm() {
  stopPolling()
  if (qrUuid.value) api.post('/api/wx-qr/reset', { code: qrUuid.value }).catch(() => {})
  qrStatus.value = 'idle'
  qrUuid.value = ''
  qrImageUrl.value = ''
  farmCode.value = ''
  openId.value = ''
  note.value = ''
}

onUnmounted(() => { stopPolling() })

const statusText = computed(() => {
  switch (qrStatus.value) {
    case 'starting': return '正在生成二维码...'
    case 'waiting': return '等待微信扫码...'
    case 'scanned': return '已扫码，等待确认...'
    case 'ready': return '扫码成功，Code 已获取'
    case 'error': return '扫码失败'
    default: return '未开始'
  }
})
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-foreground">微信扫码添加账号</h1>
        <p class="mt-1 text-sm text-foreground-muted">通过微信扫码快速添加农场账号</p>
      </div>
      <div class="flex gap-2">
        <BaseButton variant="outline" @click="router.push('/capture')">抓包添加</BaseButton>
        <BaseButton variant="outline" @click="router.push('/accounts')">返回账号列表</BaseButton>
      </div>
    </div>

    <div class="card p-5">
      <div class="mb-4 flex items-center justify-between gap-3">
        <h2 class="text-lg font-semibold text-foreground">微信扫码</h2>
        <span class="rounded-full bg-green-500/10 px-2 py-1 text-xs font-medium text-green-600 dark:text-green-400">微信</span>
      </div>

      <!-- idle/starting/error -->
      <div v-if="qrStatus === 'idle' || qrStatus === 'starting' || qrStatus === 'error'" class="space-y-3">
        <BaseButton variant="primary" :loading="qrStatus === 'starting'" @click="createQR">
          生成二维码
        </BaseButton>
        <p v-if="errorMsg" class="text-sm text-red-500">{{ errorMsg }}</p>
      </div>

      <!-- waiting/scanned -->
      <div v-else-if="qrStatus === 'waiting' || qrStatus === 'scanned'" class="space-y-4">
        <div class="flex flex-col items-center gap-3">
          <img :src="qrImageUrl" alt="微信扫码二维码" class="h-56 w-56 rounded-lg bg-white object-contain p-2" />
          <div class="flex items-center gap-2 text-sm text-foreground-muted">
            <span class="inline-block h-2 w-2 animate-pulse rounded-full bg-green-500"></span>
            <span>{{ statusText }}</span>
          </div>
        </div>
        <div class="flex justify-center">
          <BaseButton variant="outline" @click="resetForm">取消扫码</BaseButton>
        </div>
      </div>

      <!-- ready -->
      <div v-else-if="qrStatus === 'ready'" class="space-y-3">
        <div class="rounded-lg border border-green-500/30 bg-green-50 p-4 dark:bg-green-900/20">
          <p class="text-sm font-medium text-green-700 dark:text-green-300">✅ Code 已获取</p>
          <code class="mt-1 block break-all text-xs text-foreground-muted">{{ farmCode.slice(0, 40) }}...</code>
        </div>
        <BaseInput v-model="note" label="备注名称" placeholder="例如：微信大号" />
        <label class="flex items-center gap-2 text-sm text-foreground">
          <input v-model="autoStart" type="checkbox" class="accent-accent" />
          创建后立即启动
        </label>
        <div class="flex gap-2">
          <BaseButton variant="primary" :loading="creating" @click="createAccount">创建微信账号</BaseButton>
          <BaseButton variant="outline" @click="resetForm">重新扫码</BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>
