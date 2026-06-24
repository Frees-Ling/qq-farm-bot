<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'

// 标签页
type Tab = 'realtime' | 'capture' | 'runtime' | 'account' | 'errors' | 'system' | 'download'
const activeTab = ref<Tab>('capture')

// 通用状态
const logs = ref<any[]>([])
const loading = ref(false)
const autoRefresh = ref(true)
const filterText = ref('')
const totalCount = ref(0)
let timer: ReturnType<typeof setInterval> | null = null

// 运行时日志过滤
const runtimeAccounts = ref<string[]>([])
const selectedAccount = ref('')
const selectedSeverity = ref('')

// 系统信息
const systemInfo = ref<any>(null)

// ============ 数据获取 ============

async function fetchLogs() {
  loading.value = true
  try {
    const tab = activeTab.value
    if (tab === 'capture') {
      const res = await api.get('/api/system-logs', { params: { lines: 500 }, silent: true } as any)
      if (res.data?.ok) {
        logs.value = (res.data.data.lines || []).map((l: string) => ({ text: l, time: l.match(/\[([^\]]+)\]/)?.[1] || '', source: 'capture' }))
        totalCount.value = logs.value.length
      }
    } else if (tab === 'runtime' || tab === 'account' || tab === 'errors') {
      const params: any = { source: tab === 'errors' ? 'all' : tab, limit: 500 }
      if (selectedSeverity.value) params.severity = selectedSeverity.value
      if (filterText.value) params.keyword = filterText.value
      if (tab === 'runtime' && selectedAccount.value) params.keyword = selectedAccount.value
      const res = await api.get('/api/logs/all', { params, silent: true } as any)
      if (res.data?.ok) {
        logs.value = res.data.data.lines || []
        totalCount.value = res.data.data.total || logs.value.length
      }
      // 获取账户列表
      if (tab === 'runtime' && runtimeAccounts.value.length === 0) {
        try {
          const accRes = await api.get('/api/accounts', { silent: true } as any)
          if (accRes.data?.ok) {
            runtimeAccounts.value = (accRes.data.data.accounts || []).map((a: any) => a.name).filter(Boolean)
          }
        } catch {}
      }
    } else if (tab === 'system') {
      const res = await api.get('/api/system/info', { silent: true } as any)
      if (res.data?.ok) systemInfo.value = res.data.data
    }
  } catch { /* silent */ }
  finally { loading.value = false }
}

async function fetchSystemInfo() {
  try {
    const res = await api.get('/api/system/info', { silent: true } as any)
    if (res.data?.ok) systemInfo.value = res.data.data
  } catch {}
}

// ============ 实时日志 ============
const realtimeLogs = ref<any[]>([])
const realtimeConnected = ref(false)

// ============ 下载 ============
async function handleDownload(format: string) {
  try {
    const params: any = { format }
    if (activeTab.value === 'capture') params.source = 'capture'
    else if (activeTab.value === 'runtime') params.source = 'global'
    else if (activeTab.value === 'account') params.source = 'account'
    else if (activeTab.value === 'errors') params.severity = 'error'

    const res = await api.get('/api/logs/download', {
      params,
      responseType: 'blob',
      silent: true,
    } as any)
    const url = window.URL.createObjectURL(new Blob([res.data]))
    const link = document.createElement('a')
    link.href = url
    const ext = format === 'json' ? 'json' : 'txt'
    link.setAttribute('download', `qq-farm-logs-${new Date().toISOString().slice(0, 10)}.${ext}`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  } catch (e: any) {
    console.error('下载失败:', e)
  }
}

// ============ 生命周期 ============

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

function onTabChange(tab: Tab) {
  activeTab.value = tab
  filterText.value = ''
  selectedSeverity.value = ''
  logs.value = []
  fetchLogs()
}

const tabs: { key: Tab; label: string; icon: string }[] = [
  { key: 'capture', label: '📡 捕获系统', icon: '' },
  { key: 'runtime', label: '⚙️ 运行时', icon: '' },
  { key: 'account', label: '📋 账户操作', icon: '' },
  { key: 'errors', label: '❌ 错误', icon: '' },
  { key: 'realtime', label: '🖥️ 实时', icon: '' },
  { key: 'system', label: '📊 服务器', icon: '' },
  { key: 'download', label: '⬇️ 下载', icon: '' },
]

const stats = computed(() => {
  const items = activeTab.value === 'realtime' ? realtimeLogs.value : activeTab.value === 'capture' ? logs.value : logs.value
  const total = items.length
  const errors = items.filter((l: any) => l.level === 'error' || l.text?.includes('异常') || l.text?.includes('失败') || l.text?.includes('error')).length
  const warns = items.filter((l: any) => l.level === 'warn' || l.text?.includes('warn')).length
  return { total, errors, warns }
})

onMounted(() => {
  fetchLogs()
  fetchSystemInfo()
  if (autoRefresh.value) timer = setInterval(fetchLogs, 5000)
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
        <p class="mt-1 text-sm text-foreground-muted">
          {{ activeTab === 'capture' ? 'Code捕获、认领、抓包等系统运行日志' : '' }}
          {{ activeTab === 'runtime' ? '所有农场账号的自动化操作日志' : '' }}
          {{ activeTab === 'account' ? '账号添加、删除、启动、停止等操作记录' : '' }}
          {{ activeTab === 'errors' ? '系统错误和警告汇总' : '' }}
          {{ activeTab === 'realtime' ? '实时日志推送（每3秒轮询）' : '' }}
          {{ activeTab === 'system' ? '服务器运行状态和资源使用' : '' }}
          {{ activeTab === 'download' ? '导出系统日志' : '' }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <BaseButton variant="outline" size="sm" :loading="loading" @click="fetchLogs">刷新</BaseButton>
        <BaseButton :variant="autoRefresh ? 'primary' : 'outline'" size="sm" @click="toggleAuto">
          {{ autoRefresh ? '自动刷新中' : '自动刷新' }}
        </BaseButton>
      </div>
    </div>

    <!-- 标签页 -->
    <div class="flex flex-wrap gap-1 border-b border-border-subtle pb-2">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="rounded-t-lg px-3 py-1.5 text-sm font-medium transition-colors"
        :class="activeTab === t.key
          ? 'bg-elevated text-foreground border-b-2 border-accent'
          : 'text-foreground-muted hover:text-foreground hover:bg-elevated/50'"
        @click="onTabChange(t.key)"
      >
        {{ t.label }}
      </button>
    </div>

    <!-- 过滤栏 -->
    <div v-if="activeTab !== 'system' && activeTab !== 'download'" class="flex items-center gap-3">
      <input
        v-model="filterText"
        type="text"
        placeholder="关键词过滤..."
        class="flex-1 rounded-lg border border-border-subtle bg-elevated px-3 py-1.5 text-sm text-foreground outline-none focus:border-accent"
        @input="activeTab === 'runtime' || activeTab === 'account' || activeTab === 'errors' ? fetchLogs() : null"
      />
      <select
        v-if="activeTab === 'runtime' || activeTab === 'errors'"
        v-model="selectedSeverity"
        class="rounded-lg border border-border-subtle bg-elevated px-3 py-1.5 text-sm text-foreground outline-none"
        @change="fetchLogs()"
      >
        <option value="">全部级别</option>
        <option value="error">仅错误</option>
      </select>
      <select
        v-if="activeTab === 'runtime' && runtimeAccounts.length > 0"
        v-model="selectedAccount"
        class="rounded-lg border border-border-subtle bg-elevated px-3 py-1.5 text-sm text-foreground outline-none"
        @change="fetchLogs()"
      >
        <option value="">全部账号</option>
        <option v-for="name in runtimeAccounts" :key="name" :value="name">{{ name }}</option>
      </select>
    </div>

    <!-- 统计卡片 -->
    <div v-if="activeTab !== 'system' && activeTab !== 'download'" class="grid grid-cols-4 gap-3 text-sm">
      <div class="card p-3">
        <div class="text-foreground-muted">总条数</div>
        <div class="text-lg font-bold text-foreground">{{ stats.total }}</div>
      </div>
      <div class="card p-3">
        <div class="text-foreground-muted">错误</div>
        <div class="text-lg font-bold text-red-600">{{ stats.errors }}</div>
      </div>
      <div class="card p-3">
        <div class="text-foreground-muted">警告</div>
        <div class="text-lg font-bold text-amber-600">{{ stats.warns }}</div>
      </div>
      <div class="card p-3">
        <div class="text-foreground-muted">信息</div>
        <div class="text-lg font-bold text-blue-600">{{ stats.total - stats.errors - stats.warns }}</div>
      </div>
    </div>

    <!-- ===== 捕获系统 ===== -->
    <div v-if="activeTab === 'capture'" class="card p-0 overflow-hidden">
      <div class="max-h-[70vh] overflow-y-auto font-mono text-xs leading-relaxed">
        <div v-if="logs.length === 0" class="p-6 text-center text-foreground-muted">暂无日志</div>
        <div
          v-for="(line, i) in logs"
          :key="i"
          class="border-b border-border-subtle/50 px-4 py-1 last:border-0 hover:bg-accent-m/20"
          :class="{
            'text-green-600': line.text?.includes('认领成功') || line.text?.includes('forwarded'),
            'text-red-600': line.text?.includes('异常') || line.text?.includes('失败') || line.text?.includes('401'),
            'text-amber-600': line.text?.includes('code-capture被调用'),
            'text-blue-600': line.text?.includes('pending-code') && line.text?.includes('收到'),
          }"
        >
          <span v-if="line.time" class="text-foreground-muted mr-2">{{ line.time }}</span>
          <span>{{ line.text || line }}</span>
        </div>
      </div>
    </div>

    <!-- ===== 运行时 / 账户操作 / 错误 ===== -->
    <div v-if="['runtime', 'account', 'errors'].includes(activeTab)" class="card p-0 overflow-hidden">
      <div class="max-h-[70vh] overflow-y-auto font-mono text-xs leading-relaxed">
        <div v-if="logs.length === 0" class="p-6 text-center text-foreground-muted">暂无日志</div>
        <div
          v-for="(item, i) in logs"
          :key="i"
          class="border-b border-border-subtle/50 px-4 py-1 last:border-0 hover:bg-accent-m/20"
          :class="{
            'text-red-600 bg-red-50 dark:bg-red-900/10': item.level === 'error' || item.text?.includes('异常') || item.text?.includes('失败'),
            'text-amber-600': item.level === 'warn',
            'text-green-600': item.level === 'success',
          }"
        >
          <span v-if="item.time" class="text-foreground-muted mr-2">{{ item.time }}</span>
          <span v-if="item.tag" class="mr-1 rounded bg-gray-100 px-1 dark:bg-gray-800">{{ item.tag }}</span>
          <span>{{ item.text || item }}</span>
        </div>
      </div>
    </div>

    <!-- ===== 实时日志 ===== -->
    <div v-if="activeTab === 'realtime'" class="card p-0 overflow-hidden">
      <div class="flex items-center gap-2 px-4 py-2 border-b border-border-subtle/50">
        <span class="inline-block h-2 w-2 rounded-full" :class="realtimeConnected ? 'bg-green-500' : 'bg-yellow-500'" />
        <span class="text-xs text-foreground-muted">{{ realtimeConnected ? '已连接' : '连接中...' }}</span>
      </div>
      <div class="max-h-[65vh] overflow-y-auto font-mono text-xs leading-relaxed">
        <div v-if="realtimeLogs.length === 0" class="p-6 text-center text-foreground-muted">等待日志...</div>
        <div
          v-for="(item, i) in realtimeLogs"
          :key="i"
          class="border-b border-border-subtle/50 px-4 py-0.5 last:border-0"
          :class="{ 'text-red-600': item.level === 'error' }"
        >
          <span v-if="item.time" class="text-foreground-muted mr-2">{{ item.time }}</span>
          <span>{{ item.text || item }}</span>
        </div>
      </div>
    </div>

    <!-- ===== 服务器状态 ===== -->
    <div v-if="activeTab === 'system'" class="space-y-4">
      <div v-if="!systemInfo" class="card p-6 text-center text-foreground-muted">加载中...</div>
      <div v-else class="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div class="card p-4">
          <div class="text-xs text-foreground-muted">运行时长</div>
          <div class="mt-1 text-lg font-bold">{{ systemInfo.uptimeDays }}天</div>
        </div>
        <div class="card p-4">
          <div class="text-xs text-foreground-muted">Node.js</div>
          <div class="mt-1 text-lg font-bold">{{ systemInfo.nodeVersion }}</div>
        </div>
        <div class="card p-4">
          <div class="text-xs text-foreground-muted">CPU负载</div>
          <div class="mt-1 text-lg font-bold">{{ systemInfo.cpuLoad }}</div>
        </div>
        <div class="card p-4">
          <div class="text-xs text-foreground-muted">内存</div>
          <div class="mt-1 text-lg font-bold">{{ systemInfo.memory?.used }} / {{ systemInfo.memory?.total }}</div>
          <div class="mt-1 h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700">
            <div class="h-1.5 rounded-full" :class="parseInt(systemInfo.memory?.percent) > 80 ? 'bg-red-500' : 'bg-blue-500'" :style="{ width: systemInfo.memory?.percent }" />
          </div>
        </div>
        <div class="card p-4">
          <div class="text-xs text-foreground-muted">进程PID</div>
          <div class="mt-1 text-lg font-bold">{{ systemInfo.pid }}</div>
        </div>
        <div class="card p-4">
          <div class="text-xs text-foreground-muted">工作者</div>
          <div class="mt-1 text-lg font-bold">{{ systemInfo.workerCount }} / {{ systemInfo.totalAccounts }}</div>
          <div class="text-xs text-foreground-muted">运行中 / 总数</div>
        </div>
        <div class="card p-4">
          <div class="text-xs text-foreground-muted">嗅探服务</div>
          <div class="mt-1 flex items-center gap-2">
            <span class="inline-block h-2.5 w-2.5 rounded-full" :class="systemInfo.sniffRunning ? 'bg-green-500' : 'bg-red-500'" />
            <span class="text-lg font-bold" :class="systemInfo.sniffRunning ? 'text-green-600' : 'text-red-600'">
              {{ systemInfo.sniffRunning ? '运行中' : '已停止' }}
            </span>
          </div>
        </div>
        <div class="card p-4">
          <div class="text-xs text-foreground-muted">日志存量</div>
          <div class="mt-1 text-lg font-bold">{{ systemInfo.snapshot?.globalLogsCount || 0 }}条</div>
          <div class="text-xs text-foreground-muted">捕获日志: {{ systemInfo.snapshot?.captureLogFile || 0 }}B</div>
        </div>
      </div>
    </div>

    <!-- ===== 下载 ===== -->
    <div v-if="activeTab === 'download'" class="card p-6 space-y-4">
      <p class="text-sm text-foreground-muted">选择日志来源和格式，导出后可通过文本编辑器查看和分析。</p>
      <div class="grid grid-cols-2 gap-4">
        <div class="rounded-lg border border-border-subtle p-4">
          <h3 class="font-medium text-foreground mb-2">📡 捕获系统日志</h3>
          <p class="text-xs text-foreground-muted mb-3">Code捕获、认领记录</p>
          <div class="flex gap-2">
            <BaseButton variant="outline" size="sm" @click="handleDownload('txt')">下载 TXT</BaseButton>
            <BaseButton variant="outline" size="sm" @click="handleDownload('json')">下载 JSON</BaseButton>
          </div>
        </div>
        <div class="rounded-lg border border-border-subtle p-4">
          <h3 class="font-medium text-foreground mb-2">⚙️ 运行时日志</h3>
          <p class="text-xs text-foreground-muted mb-3">农场自动化操作记录</p>
          <div class="flex gap-2">
            <BaseButton variant="outline" size="sm" @click="handleDownload('txt')">下载 TXT</BaseButton>
            <BaseButton variant="outline" size="sm" @click="handleDownload('json')">下载 JSON</BaseButton>
          </div>
        </div>
        <div class="rounded-lg border border-border-subtle p-4">
          <h3 class="font-medium text-foreground mb-2">📋 账户操作日志</h3>
          <p class="text-xs text-foreground-muted mb-3">添加、删除、踢下线等事件</p>
          <div class="flex gap-2">
            <BaseButton variant="outline" size="sm" @click="handleDownload('txt')">下载 TXT</BaseButton>
            <BaseButton variant="outline" size="sm" @click="handleDownload('json')">下载 JSON</BaseButton>
          </div>
        </div>
        <div class="rounded-lg border border-border-subtle p-4">
          <h3 class="font-medium text-foreground mb-2">❌ 错误日志</h3>
          <p class="text-xs text-foreground-muted mb-3">仅错误和警告信息</p>
          <div class="flex gap-2">
            <BaseButton variant="outline" size="sm" @click="handleDownload('txt')">下载 TXT</BaseButton>
            <BaseButton variant="outline" size="sm" @click="handleDownload('json')">下载 JSON</BaseButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
