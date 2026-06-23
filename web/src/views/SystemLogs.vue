<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'

const logs = ref<string[]>([])
const loading = ref(false)
const autoRefresh = ref(true)
const filterText = ref('')
let timer: ReturnType<typeof setInterval> | null = null

async function fetchLogs() {
  loading.value = true
  try {
    const res = await api.get('/api/system-logs', {
      params: { lines: 200 },
      silent: true,
    } as any)
    if (res.data?.ok) {
      logs.value = res.data.data.lines || []
    }
  } catch {
    // silent
  } finally {
    loading.value = false
  }
}

function filteredLogs() {
  if (!filterText.value) return logs.value
  const lower = filterText.value.toLowerCase()
  return logs.value.filter(l => l.toLowerCase().includes(lower))
}

function toggleAuto() {
  autoRefresh.value = !autoRefresh.value
  if (autoRefresh.value) {
    timer = setInterval(fetchLogs, 5000)
    fetchLogs()
  } else if (timer) {
    clearInterval(timer)
    timer = null
  }
}

onMounted(() => {
  fetchLogs()
  if (autoRefresh.value) {
    timer = setInterval(fetchLogs, 5000)
  }
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-4">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-foreground">📋 系统日志</h1>
        <p class="mt-1 text-sm text-foreground-muted">查看Code捕获、认领、抓包等系统运行日志</p>
      </div>
      <div class="flex items-center gap-2">
        <input
          v-model="filterText"
          type="text"
          placeholder="过滤关键词..."
          class="w-48 rounded-lg border border-border-subtle bg-elevated px-3 py-1.5 text-sm text-foreground outline-none focus:border-accent"
        />
        <BaseButton variant="outline" size="sm" :loading="loading" @click="fetchLogs">
          刷新
        </BaseButton>
        <BaseButton :variant="autoRefresh ? 'primary' : 'outline'" size="sm" @click="toggleAuto">
          {{ autoRefresh ? '自动刷新中' : '自动刷新' }}
        </BaseButton>
      </div>
    </div>

    <!-- 统计卡片 -->
    <div class="grid grid-cols-4 gap-3 text-sm">
      <div class="card p-3">
        <div class="text-foreground-muted">Code收到</div>
        <div class="text-lg font-bold text-accent">{{ logs.filter(l => l.includes('pending-code') && l.includes('收到')).length }}</div>
      </div>
      <div class="card p-3">
        <div class="text-foreground-muted">Code认领</div>
        <div class="text-lg font-bold text-green-600">{{ logs.filter(l => l.includes('认领成功')).length }}</div>
      </div>
      <div class="card p-3">
        <div class="text-foreground-muted">code-capture</div>
        <div class="text-lg font-bold text-amber-600">{{ logs.filter(l => l.includes('code-capture被调用')).length }}</div>
      </div>
      <div class="card p-3">
        <div class="text-foreground-muted">错误</div>
        <div class="text-lg font-bold text-red-600">{{ logs.filter(l => l.includes('异常') || l.includes('失败')).length }}</div>
      </div>
    </div>

    <!-- 日志列表 -->
    <div class="card p-0 overflow-hidden">
      <div class="max-h-[70vh] overflow-y-auto font-mono text-xs leading-relaxed">
        <div v-if="filteredLogs().length === 0" class="p-6 text-center text-foreground-muted">
          暂无日志
        </div>
        <div
          v-for="(line, i) in filteredLogs()"
          :key="i"
          class="border-b border-border-subtle/50 px-4 py-1 last:border-0 hover:bg-accent-m/20"
          :class="{
            'text-green-600': line.includes('认领成功') || line.includes('forwarded'),
            'text-red-600': line.includes('异常') || line.includes('失败') || line.includes('401'),
            'text-amber-600': line.includes('code-capture被调用'),
            'text-blue-600': line.includes('pending-code') && line.includes('收到'),
          }"
        >
          <span class="text-foreground-muted mr-2">{{ line.split('[')[1]?.split(']')[0] || '' }}</span>
          <span>{{ line }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
