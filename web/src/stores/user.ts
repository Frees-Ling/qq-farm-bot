import type { ApiResult } from '@/api/result'
import { useStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed } from 'vue'
import api from '@/api'
import { unwrapOk } from '@/api/result'

export interface UserCard {
  code: string
  description: string
  type?: 'days' | 'quota'
  days: number
  quota?: number
  expiresAt: number | null
  enabled: boolean
}

export interface User {
  username: string
  role: 'admin' | 'user'
  card: UserCard | null
}

export interface Card {
  code: string
  description: string
  type?: 'days' | 'quota'
  days: number
  quota?: number
  enabled: boolean
  usedBy: string | null
  usedAt: number | null
  createdAt: number
}

export const useUserStore = defineStore('user', () => {
  const token = useStorage('admin_token', '')
  const userInfo = useStorage<User | null>('user_info', null)
  const isLoggedIn = computed(() => !!token.value)
  const isAdmin = computed(() => userInfo.value?.role === 'admin')
  const username = computed(() => userInfo.value?.username || '')
  const userCard = computed(() => userInfo.value?.card)

  // 检查用户是否过期
  const isExpired = computed(() => {
    if (!userInfo.value?.card?.expiresAt)
      return false
    return Date.now() > userInfo.value.card.expiresAt
  })

  // 获取过期时间显示
  const expireTimeText = computed(() => {
    if (!userInfo.value?.card)
      return '无卡密'
    if (userInfo.value.card.days === -1)
      return '永久有效'
    if (!userInfo.value.card.expiresAt)
      return '未激活'
    const date = new Date(userInfo.value.card.expiresAt)
    return date.toLocaleString('zh-CN')
  })

  async function login(username: string, password: string) {
    const res = await api.post('/api/login', { username, password }, { silent: true })
    const data = unwrapOk<{ token: string, user: User }>(res.data as ApiResult<{ token: string, user: User }>, '登录失败')
    token.value = data.token
    userInfo.value = data.user
    // 登录成功后加载微信配置
    const { useWxLoginStore } = await import('./wx-login')
    const wxLoginStore = useWxLoginStore()
    await wxLoginStore.loadConfigFromServer()
    return res.data
  }

  async function register(username: string, password: string, cardCode: string) {
    const res = await api.post('/api/register', { username, password, cardCode }, { silent: true })
    return res.data
  }

  async function logout() {
    try {
      await api.post('/api/logout')
    }
    finally {
      token.value = ''
      userInfo.value = null
    }
  }

  async function fetchUserInfo() {
    try {
      const res = await api.get('/api/user/me')
      const data = unwrapOk<User>(res.data as ApiResult<User>, '获取用户信息失败')
      userInfo.value = data
      return res.data
    }
    catch {
      return { ok: false }
    }
  }

  async function renew(cardCode: string) {
    const res = await api.post('/api/user/renew', { cardCode })
    if (res.data.ok) {
      // 更新本地用户信息
      await fetchUserInfo()
    }
    return res.data
  }

  async function changePassword(oldPassword: string, newPassword: string) {
    const res = await api.post('/api/user/change-password', { oldPassword, newPassword })
    return res.data
  }

  // 管理员功能
  async function getAllUsers() {
    const res = await api.get('/api/admin/users')
    return res.data
  }

  async function getAllUsersWithPassword() {
    const res = await api.get('/api/admin/users-with-password')
    return res.data
  }

  async function updateUser(username: string, updates: Partial<UserCard>) {
    const res = await api.post(`/api/admin/users/${username}`, updates)
    return res.data
  }

  async function deleteUser(username: string) {
    const res = await api.delete(`/api/admin/users/${username}`)
    return res.data
  }

  async function renewUser(username: string, cardCode: string) {
    const res = await api.post(`/api/admin/users/${username}/renew`, { cardCode })
    return res.data
  }

  async function getAllCards() {
    const res = await api.get('/api/admin/cards')
    return res.data
  }

  async function createCard(description: string, days: number, count?: number, type?: 'days' | 'quota', quota?: number) {
    const res = await api.post('/api/admin/cards', { description, days, count, type, quota })
    return res.data
  }

  async function updateCard(code: string, updates: Partial<Card>) {
    const res = await api.post(`/api/admin/cards/${code}`, updates)
    return res.data
  }

  async function deleteCard(code: string) {
    const res = await api.delete(`/api/admin/cards/${code}`)
    return res.data
  }

  async function deleteCardsBatch(codes: string[]) {
    const res = await api.post('/api/admin/cards/batch-delete', { codes })
    return res.data
  }

  return {
    token,
    userInfo,
    isLoggedIn,
    isAdmin,
    username,
    userCard,
    isExpired,
    expireTimeText,
    login,
    register,
    logout,
    fetchUserInfo,
    renew,
    changePassword,
    getAllUsers,
    getAllUsersWithPassword,
    updateUser,
    deleteUser,
    renewUser,
    getAllCards,
    createCard,
    updateCard,
    deleteCard,
    deleteCardsBatch,
  }
})
