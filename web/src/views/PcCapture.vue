<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useAccountStore } from '@/stores/account'
import { useToastStore } from '@/stores/toast'

const router = useRouter()
const accountStore = useAccountStore()
const toast = useToastStore()

const status = ref<'idle' | 'waiting' | 'captured'>('idle')
const knownCount = ref(0)
const capturedAccount = ref<any>(null)
let pollTimer: ReturnType<typeof setInterval> | null = null

async function startListening() {
  status.value = 'waiting'
  knownCount.value = accountStore.accounts.length
  // 立即刷新一次
  await accountStore.fetchAccounts()
  knownCount.value = accountStore.accounts.length
  // 开始轮询
  pollTimer = setInterval(checkForNewAccount, 3000)
}

async function checkForNewAccount() {
  try {
    await accountStore.fetchAccounts()
    const current = accountStore.accounts.length
    if (current > knownCount.value) {
      // 发现新账号！
      const newAccts = accountStore.accounts.filter(a => !a.deletedAt)
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

    <!-- 工作原理 -->
    <div class="card p-5">
      <h2 class="text-lg font-semibold text-foreground mb-2">⚡ 原理</h2>
      <p class="text-sm text-foreground-muted leading-relaxed">
        QQ经典农场的 game.js 已被注入捕获补丁。当你打开PC QQ上的QQ经典农场时，
        补丁会自动拦截网络连接，提取登录凭证（Code）并提交到面板，账号自动创建。
      </p>
      <div class="mt-3 space-y-1 text-sm">
        <div class="flex items-center gap-2">
          <span class="inline-block h-2 w-2 rounded-full bg-green-500"></span>
          <span>game.js 补丁:</span>
          <span class="text-green-600 font-medium">✅ 已注入</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="inline-block h-2 w-2 rounded-full bg-green-500"></span>
          <span>Code接收服务 (端口9988):</span>
          <span class="text-green-600 font-medium">✅ 运行中</span>
        </div>
      </div>
    </div>

    <!-- 核心操作区 -->
    <div class="card p-8">
      <!-- idle -->
      <div v-if="status === 'idle'" class="flex flex-col items-center gap-4 py-8">
        <div class="i-carbon-audio-spectrum text-6xl text-foreground-muted" />
        <p class="text-lg text-foreground">准备好后，点击开始监听</p>
        <p class="text-sm text-foreground-muted">然后打开PC QQ上的QQ经典农场</p>
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
