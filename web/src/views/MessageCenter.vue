<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useUserStore } from '@/stores/user'
import { useToastStore } from '@/stores/toast'

const userStore = useUserStore()
const toast = useToastStore()

const announcements = ref<any[]>([])
const loading = ref(false)

// 管理员发布公告
const showPublishModal = ref(false)
const publishTitle = ref('')
const publishContent = ref('')
const publishing = ref(false)

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
      toast.success('公告发布成功')
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

function formatDate(ts: number) {
  return new Date(ts).toLocaleString('zh-CN')
}

onMounted(fetchAnnouncements)
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-4">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-foreground">📢 消息中心</h1>
        <p class="mt-1 text-sm text-foreground-muted">查看系统公告和历史通知</p>
      </div>
      <div class="flex items-center gap-2">
        <BaseButton variant="outline" size="sm" :loading="loading" @click="fetchAnnouncements">刷新</BaseButton>
        <BaseButton v-if="userStore.isAdmin" variant="primary" size="sm" @click="showPublishModal = true">发布公告</BaseButton>
      </div>
    </div>

    <!-- 公告列表 -->
    <div v-if="announcements.length === 0" class="card p-8 text-center text-foreground-muted">
      <div class="text-3xl mb-2">📭</div>
      <p>暂无公告</p>
    </div>

    <div v-for="ann in announcements" :key="ann.id" class="card p-5 space-y-2">
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0 flex-1">
          <h3 class="text-base font-semibold text-foreground">{{ ann.title }}</h3>
          <div class="mt-1 flex items-center gap-3 text-xs text-foreground-muted">
            <span>{{ formatDate(ann.createdAt) }}</span>
            <span v-if="ann.createdBy">by {{ ann.createdBy }}</span>
            <span v-if="userStore.isAdmin && ann.readBy" class="text-blue-500">{{ ann.readBy.length }} 人已读</span>
          </div>
        </div>
        <button
          v-if="userStore.isAdmin"
          class="shrink-0 text-xs text-red-500 hover:text-red-700"
          @click="deleteAnnouncement(ann.id)"
        >删除</button>
      </div>
      <div class="text-sm text-foreground-muted whitespace-pre-wrap leading-relaxed">{{ ann.content }}</div>
    </div>

    <!-- 发布公告弹窗 -->
    <div v-if="showPublishModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" @click.self="showPublishModal = false">
      <div class="max-w-lg w-full rounded-lg bg-white p-6 dark:bg-gray-800">
        <h2 class="mb-4 text-xl text-gray-900 font-bold dark:text-white">发布公告</h2>
        <div class="space-y-4">
          <div>
            <label class="mb-1 block text-sm text-gray-700 font-medium dark:text-gray-300">标题</label>
            <input v-model="publishTitle" type="text" placeholder="公告标题" class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white">
          </div>
          <div>
            <label class="mb-1 block text-sm text-gray-700 font-medium dark:text-gray-300">内容</label>
            <textarea v-model="publishContent" rows="5" placeholder="公告内容..." class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"></textarea>
          </div>
        </div>
        <div class="mt-6 flex justify-end gap-3">
          <BaseButton variant="secondary" @click="showPublishModal = false">取消</BaseButton>
          <BaseButton variant="primary" :loading="publishing" @click="publishAnnouncement">发布</BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>
