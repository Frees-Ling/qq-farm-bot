<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useUserStore } from '@/stores/user'
import { useToastStore } from '@/stores/toast'

const userStore = useUserStore()
const toast = useToastStore()

const announcements = ref<any[]>([])
const loading = ref(false)
const activeTab = ref<'unread' | 'all'>('all')
const previousUnread = ref(0)

// 管理员发布公告
const showPublishModal = ref(false)
const publishTitle = ref('')
const publishContent = ref('')
const publishing = ref(false)

// 格式化为相对时间
function formatRelativeTime(ts: number) {
  const now = Date.now()
  const diff = now - ts
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  if (hours < 24) return `${hours}小时前`
  if (days < 7) return `${days}天前`
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

function formatFullDate(ts: number) {
  return new Date(ts).toLocaleString('zh-CN')
}

// 判断是否为今天
function isToday(ts: number) {
  const d = new Date(ts)
  const t = new Date()
  return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate()
}

async function fetchAnnouncements() {
  loading.value = true
  try {
    const res = await api.get('/api/announcement', { silent: true } as any)
    if (res.data?.ok) {
      announcements.value = res.data.data.announcements || []
    }
  } catch {}
  finally { loading.value = false }
}

const unreadCount = computed(() => {
  // 前端无法知道哪些已读（因为GET标记了全部已读）
  // 通过sidebar的unread接口获取
  return 0
})

const filteredAnnouncements = computed(() => {
  if (activeTab.value === 'unread') {
    // 对于已登录用户，只要知道是否有未读即可
    // 这里靠服务端标记已读，所以前端展示全部
    return announcements.value
  }
  return announcements.value
})

// 轮询检测新公告并弹窗提醒
let pollTimer: ReturnType<typeof setInterval> | null = null
async function checkNewAnnouncements() {
  try {
    const res = await api.get('/api/announcement/unread', { silent: true } as any)
    if (res.data?.ok) {
      const current = res.data.data.unread || 0
      if (current > previousUnread.value && previousUnread.value > 0) {
        // 有新公告！
        const newCount = current - previousUnread.value
        const msg = newCount === 1 ? '📢 有一条新公告' : `📢 有 ${newCount} 条新公告`
        toast.info(msg, 6000)
        // 刷新公告列表
        fetchAnnouncements()
      }
      previousUnread.value = current
    }
  } catch {}
}

async function publishAnnouncement() {
  if (!publishTitle.value?.trim() || !publishContent.value?.trim()) {
    toast.warning('请填写标题和内容')
    return
  }
  publishing.value = true
  try {
    const res = await api.post('/api/announcement', {
      title: publishTitle.value.trim(),
      content: publishContent.value.trim(),
    })
    if (res.data?.ok) {
      toast.success('公告已发布，所有用户将收到通知')
      showPublishModal.value = false
      publishTitle.value = ''
      publishContent.value = ''
      await fetchAnnouncements()
    } else {
      toast.error(res.data?.error || '发布失败')
    }
  } catch (e: any) {
    toast.error(e?.message || '发布失败')
  }
  finally { publishing.value = false }
}

async function deleteAnnouncement(id: string) {
  if (!confirm('确定删除此公告？')) return
  try {
    const res = await api.delete(`/api/announcement/${id}`)
    if (res.data?.ok) {
      toast.success('已删除')
      await fetchAnnouncements()
    }
  } catch {}
}

onMounted(() => {
  fetchAnnouncements()
  checkNewAnnouncements()
  pollTimer = setInterval(checkNewAnnouncements, 15000)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-5">
    <!-- 头部 -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-foreground">📢 消息中心</h1>
        <p class="mt-1 text-sm text-foreground-muted">系统公告与通知</p>
      </div>
      <div class="flex items-center gap-2">
        <BaseButton variant="outline" size="sm" :loading="loading" @click="fetchAnnouncements">刷新</BaseButton>
        <BaseButton v-if="userStore.isAdmin" variant="primary" size="sm" @click="showPublishModal = true">✏️ 发布公告</BaseButton>
      </div>
    </div>

    <!-- 标签页：未读 / 全部 -->
    <div class="flex gap-1 border-b border-border-subtle pb-2">
      <button
        class="relative rounded-t-lg px-4 py-1.5 text-sm font-medium transition-colors"
        :class="activeTab === 'all'
          ? 'bg-elevated text-foreground border-b-2 border-accent'
          : 'text-foreground-muted hover:text-foreground'"
        @click="activeTab = 'all'"
      >
        全部消息
      </button>
    </div>

    <!-- 公告列表 -->
    <div v-if="announcements.length === 0" class="card flex flex-col items-center py-16 text-foreground-muted">
      <div class="text-5xl mb-4">📭</div>
      <p class="text-lg font-medium">暂无公告</p>
      <p class="text-sm mt-1">系统公告将会显示在这里</p>
    </div>

    <div v-for="ann in announcements" :key="ann.id" class="card overflow-hidden transition-shadow hover:shadow-md">
      <!-- 头部 -->
      <div class="flex items-start gap-4 border-b border-border-subtle/50 bg-elevated/30 px-5 py-3">
        <div class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full" :style="{ background: 'var(--theme-gradient)' }">
          <span class="text-sm text-white font-bold">📢</span>
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <h3 class="text-base font-semibold text-foreground">{{ ann.title }}</h3>
            <span v-if="userStore.isAdmin && ann.readBy" class="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700 dark:bg-blue-900 dark:text-blue-200">{{ ann.readBy.length }} 人已读</span>
          </div>
          <div class="mt-0.5 flex items-center gap-3 text-xs text-foreground-muted">
            <span :class="isToday(ann.createdAt) ? 'text-accent font-medium' : ''">{{ isToday(ann.createdAt) ? '今天 ' + formatRelativeTime(ann.createdAt) : formatRelativeTime(ann.createdAt) }}</span>
            <span class="text-border-subtle">|</span>
            <span>发布者: {{ ann.createdBy || '系统' }}</span>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button
            v-if="userStore.isAdmin"
            class="rounded px-2 py-1 text-xs text-red-500 opacity-0 transition-opacity hover:bg-red-50 group-hover:opacity-100 dark:hover:bg-red-900/20"
            title="删除"
            @click="deleteAnnouncement(ann.id)"
          >🗑️</button>
        </div>
      </div>
      <!-- 内容 -->
      <div class="px-5 py-4">
        <div class="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{{ ann.content }}</div>
      </div>
      <!-- 底部时间 -->
      <div class="border-t border-border-subtle/50 px-5 py-2 text-[10px] text-foreground-muted/60">
        {{ formatFullDate(ann.createdAt) }}
      </div>
    </div>

    <!-- 发布公告弹窗 -->
    <div v-if="showPublishModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" @click.self="showPublishModal = false">
      <div class="w-full max-w-lg mx-4 rounded-2xl bg-white shadow-2xl dark:bg-gray-800">
        <!-- 弹窗头部 -->
        <div class="flex items-center justify-between rounded-t-2xl px-6 py-4" :style="{ background: 'var(--theme-gradient)' }">
          <h2 class="text-lg text-white font-bold">📢 发布新公告</h2>
          <button class="text-white/80 hover:text-white text-xl leading-none" @click="showPublishModal = false">&times;</button>
        </div>
        <!-- 弹窗内容 -->
        <div class="space-y-4 p-6">
          <div>
            <label class="mb-1.5 block text-sm text-gray-700 font-medium dark:text-gray-300">公告标题</label>
            <input v-model="publishTitle" type="text" placeholder="输入公告标题..." class="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 outline-none transition-all focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:focus:border-blue-500">
          </div>
          <div>
            <label class="mb-1.5 block text-sm text-gray-700 font-medium dark:text-gray-300">公告内容</label>
            <textarea v-model="publishContent" rows="6" placeholder="输入公告内容..." class="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 outline-none transition-all focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:focus:border-blue-500"></textarea>
          </div>
        </div>
        <!-- 弹窗底部 -->
        <div class="flex justify-end gap-3 border-t border-gray-100 px-6 py-4 dark:border-gray-700">
          <BaseButton variant="secondary" @click="showPublishModal = false">取消</BaseButton>
          <BaseButton variant="primary" :loading="publishing" @click="publishAnnouncement">📢 发布</BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>
