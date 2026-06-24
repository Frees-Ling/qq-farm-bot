<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useUserStore } from '@/stores/user'
import { useToastStore } from '@/stores/toast'

const userStore = useUserStore()
const toast = useToastStore()

const announcements = ref<any[]>([])
const loading = ref(false)
const previousUnread = ref(0)

// 发布/编辑公告
const showPublishModal = ref(false)
const publishTitle = ref('')
const publishContent = ref('')
const publishing = ref(false)
const editingId = ref<string | null>(null)

// 相对时间
function formatRelativeTime(ts: number) {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  const h = Math.floor(diff / 3600000)
  const d = Math.floor(diff / 86400000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m}分钟前`
  if (h < 24) return `${h}小时前`
  if (d < 7) return `${d}天前`
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}
function formatFullDate(ts: number) { return new Date(ts).toLocaleString('zh-CN') }
function isToday(ts: number) {
  const d = new Date(ts); const t = new Date()
  return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate()
}

async function fetchAnnouncements() {
  loading.value = true
  try {
    const res = await api.get('/api/announcement', { silent: true } as any)
    if (res.data?.ok) announcements.value = res.data.data.announcements || []
  } catch {} finally { loading.value = false }
}

// 轮询检测新公告
let pollTimer: ReturnType<typeof setInterval> | null = null
async function checkNewAnnouncements() {
  try {
    const res = await api.get('/api/announcement/unread', { silent: true } as any)
    if (res.data?.ok) {
      const cur = res.data.data.unread || 0
      if (cur > previousUnread.value && previousUnread.value > 0) {
        const n = cur - previousUnread.value
        toast.info(n === 1 ? '📢 有一条新公告' : `📢 有 ${n} 条新公告`, 6000)
        fetchAnnouncements()
      }
      previousUnread.value = cur
    }
  } catch {}
}

async function publishAnnouncement() {
  if (!publishTitle.value?.trim() || !publishContent.value?.trim()) { toast.warning('请填写标题和内容'); return }
  publishing.value = true
  try {
    const isEdit = editingId.value !== null
    let res
    if (isEdit) res = await api.put(`/api/announcement/${editingId.value}`, { title: publishTitle.value.trim(), content: publishContent.value.trim() })
    else res = await api.post('/api/announcement', { title: publishTitle.value.trim(), content: publishContent.value.trim() })
    if (res.data?.ok) {
      toast.success(isEdit ? '公告已更新' : '公告已发布')
      showPublishModal.value = false; editingId.value = null
      publishTitle.value = ''; publishContent.value = ''
      await fetchAnnouncements()
    } else toast.error(res.data?.error || (isEdit ? '编辑失败' : '发布失败'))
  } catch (e: any) { toast.error(e?.message || '操作失败') }
  finally { publishing.value = false }
}

function openEditModal(ann: any) {
  editingId.value = ann.id; publishTitle.value = ann.title
  publishContent.value = ann.content; showPublishModal.value = true
}
function openCreateModal() {
  editingId.value = null; publishTitle.value = ''; publishContent.value = ''; showPublishModal.value = true
}

async function deleteAnnouncement(id: string) {
  if (!confirm('确定删除此公告？')) return
  try {
    const res = await api.delete(`/api/announcement/${id}`)
    if (res.data?.ok) { toast.success('已删除'); await fetchAnnouncements() }
  } catch {}
}

onMounted(() => {
  fetchAnnouncements(); checkNewAnnouncements()
  pollTimer = setInterval(checkNewAnnouncements, 15000)
})
onUnmounted(() => { if (pollTimer) clearInterval(pollTimer) })
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
        <BaseButton v-if="userStore.isAdmin" variant="primary" size="sm" @click="openCreateModal">✏️ 发布公告</BaseButton>
      </div>
    </div>

    <!-- 标签 -->
    <div class="flex gap-1 border-b border-border-subtle pb-2">
      <span class="rounded-t-lg px-4 py-1.5 text-sm font-medium bg-elevated text-foreground border-b-2 border-accent">全部消息</span>
    </div>

    <!-- 列表 -->
    <div v-if="announcements.length === 0" class="flex flex-col items-center py-16 text-foreground-muted">
      <div class="text-5xl mb-4">📭</div>
      <p class="text-lg font-medium">暂无公告</p>
      <p class="text-sm mt-1">系统公告将会显示在这里</p>
    </div>

    <div v-for="ann in announcements" :key="ann.id" class="group rounded-xl border border-border-subtle bg-elevated shadow-sm transition-shadow hover:shadow-md">
      <!-- 头部 -->
      <div class="flex items-start gap-4 border-b border-border-subtle/50 px-5 py-3">
        <div class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full" :style="{ background: 'var(--theme-gradient)' }">
          <span class="text-sm text-white font-bold">📢</span>
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <h3 class="text-base font-semibold text-foreground">{{ ann.title }}</h3>
            <span v-if="ann.updatedAt" class="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-700 dark:text-gray-300">已编辑</span>
            <span v-if="userStore.isAdmin && ann.readBy" class="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700 dark:bg-blue-900 dark:text-blue-200">{{ ann.readBy.length }} 人已读</span>
          </div>
          <div class="mt-0.5 flex items-center gap-3 text-xs text-foreground-muted">
            <span :class="isToday(ann.createdAt) ? 'text-accent font-medium' : ''">{{ isToday(ann.createdAt) ? '今天 ' + formatRelativeTime(ann.createdAt) : formatRelativeTime(ann.createdAt) }}</span>
            <span class="text-border-subtle">|</span>
            <span>发布者: {{ ann.createdBy || '系统' }}</span>
          </div>
        </div>
        <div v-if="userStore.isAdmin" class="flex items-center gap-1 shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
          <button class="rounded px-2 py-1 text-xs text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20" title="编辑" @click="openEditModal(ann)">✏️</button>
          <button class="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" title="删除" @click="deleteAnnouncement(ann.id)">🗑️</button>
        </div>
      </div>
      <!-- 内容 -->
      <div class="px-5 py-4">
        <div class="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{{ ann.content }}</div>
      </div>
      <!-- 底部 -->
      <div class="border-t border-border-subtle/50 px-5 py-2 text-[10px] text-foreground-muted/60">
        {{ formatFullDate(ann.createdAt) }}
      </div>
    </div>

    <!-- 发布/编辑弹窗 -->
    <div v-if="showPublishModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" @click.self="showPublishModal = false">
      <div class="w-full max-w-lg mx-4 rounded-2xl bg-white shadow-2xl dark:bg-gray-800">
        <div class="flex items-center justify-between rounded-t-2xl px-6 py-4" :style="{ background: 'var(--theme-gradient)' }">
          <h2 class="text-lg text-white font-bold">{{ editingId ? '✏️ 编辑公告' : '📢 发布新公告' }}</h2>
          <button class="text-white/80 hover:text-white text-xl leading-none" @click="showPublishModal = false">&times;</button>
        </div>
        <div class="space-y-4 p-6">
          <div>
            <label class="mb-1.5 block text-sm text-gray-700 font-medium dark:text-gray-300">公告标题</label>
            <input v-model="publishTitle" type="text" placeholder="输入公告标题..." class="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 outline-none transition-all focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-700 dark:text-white">
          </div>
          <div>
            <label class="mb-1.5 block text-sm text-gray-700 font-medium dark:text-gray-300">公告内容</label>
            <textarea v-model="publishContent" rows="6" placeholder="输入公告内容..." class="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 outline-none transition-all focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-700 dark:text-white"></textarea>
          </div>
        </div>
        <div class="flex justify-end gap-3 border-t border-gray-100 px-6 py-4 dark:border-gray-700">
          <BaseButton variant="secondary" @click="showPublishModal = false">取消</BaseButton>
          <BaseButton variant="primary" :loading="publishing" @click="publishAnnouncement">{{ editingId ? '保存修改' : '📢 发布' }}</BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>
