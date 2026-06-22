<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()

const isLogin = ref(true)
const username = ref('')
const password = ref('')
const cardCode = ref('')
const error = ref('')
const success = ref('')
const loading = ref(false)
const oauthLoading = ref(false)
const oauthEnabled = ref(false)

onMounted(async () => {
  const oauthToken = route.query.oauth_token as string
  const oauthUser = route.query.oauth_user as string
  const errorParam = route.query.error as string

  if (errorParam) {
    error.value = decodeURIComponent(errorParam)
    window.history.replaceState({}, '', '/login')
    return
  }

  if (oauthToken && oauthUser) {
    try {
      loading.value = true
      const res = await api.post('/api/oauth/token-login', { token: oauthToken }, { silent: true })
      if (res.data.ok) {
        userStore.token = res.data.data.token
        userStore.userInfo = res.data.data.user
        router.push('/')
      }
      else {
        error.value = res.data.error || 'OAuth登录失败'
      }
    }
    catch (e: any) {
      error.value = e.response?.data?.error || e.message || 'OAuth登录异常'
    }
    finally {
      loading.value = false
      window.history.replaceState({}, '', '/login')
    }
  }

  try {
    const res = await api.get('/api/admin/oauth', { silent: true })
    if (res.data.ok) {
      oauthEnabled.value = res.data.data.enabled
    }
  }
  catch {
    // ignore
  }
})

async function handleSubmit() {
  loading.value = true
  error.value = ''
  success.value = ''

  // 验证账号密码必须同时输入或同时不输入
  const hasUsername = username.value.trim()
  const hasPassword = password.value.trim()
  if ((hasUsername && !hasPassword) || (!hasUsername && hasPassword)) {
    error.value = '账号和密码必须同时输入'
    loading.value = false
    return
  }

  try {
    if (isLogin.value) {
      const result = await userStore.login(username.value, password.value)
      if (result.ok) {
        router.push('/')
      }
      else {
        error.value = result.error || '登录失败'
      }
    }
    else {
      if (!cardCode.value) {
        error.value = '请输入卡密'
        loading.value = false
        return
      }
      const result = await userStore.register(username.value, password.value, cardCode.value)
      if (result.ok) {
        success.value = '注册成功，请登录'
        isLogin.value = true
        cardCode.value = ''
      }
      else {
        error.value = result.error || '注册失败'
      }
    }
  }
  catch (e: any) {
    error.value = e.response?.data?.error || e.message || '操作异常'
  }
  finally {
    loading.value = false
  }
}

function toggleMode() {
  isLogin.value = !isLogin.value
  error.value = ''
  success.value = ''
}

async function handleOAuthLogin(type: string) {
  oauthLoading.value = true
  error.value = ''

  try {
    const res = await api.post('/api/oauth/login', { type }, { silent: true })
    if (res.data.ok && res.data.data.url) {
      window.location.href = res.data.data.url
    }
    else {
      error.value = res.data.error || '获取登录链接失败'
      oauthLoading.value = false
    }
  }
  catch (e: any) {
    error.value = e.response?.data?.error || e.message || 'OAuth登录异常'
    oauthLoading.value = false
  }
}
</script>

<template>
  <div class="h-screen w-screen flex items-center justify-center" :style="{ background: 'var(--theme-bg)' }">
    <div class="max-w-md w-full rounded-xl p-8 shadow-lg space-y-6" :style="{ background: 'color-mix(in srgb, var(--theme-bg) 95%, white)' }">
      <div class="mb-8 py-4 text-center">
        <h1 class="text-3xl font-bold tracking-tight" :style="{ color: 'var(--theme-text)' }">
          QQ农场智能助手
        </h1>
        <p class="mt-3 text-sm tracking-widest uppercase" :style="{ color: 'var(--theme-primary)' }">
          {{ isLogin ? '管理面板' : '用户注册' }}
        </p>
      </div>

      <form class="space-y-4" @submit.prevent="handleSubmit">
        <div>
          <label class="mb-1 block text-sm font-medium" :style="{ color: 'var(--theme-text)' }">
            用户名
          </label>
          <BaseInput
            id="username"
            v-model="username"
            type="text"
            placeholder="请输入用户名"
            required
          />
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium" :style="{ color: 'var(--theme-text)' }">
            密码
          </label>
          <BaseInput
            id="password"
            v-model="password"
            type="password"
            placeholder="请输入密码"
            required
          />
        </div>

        <div v-if="!isLogin">
          <label class="mb-1 block text-sm font-medium" :style="{ color: 'var(--theme-text)' }">
            卡密
          </label>
          <BaseInput
            id="cardCode"
            v-model="cardCode"
            type="text"
            placeholder="请输入卡密"
            :required="!isLogin"
          />
          <p class="mt-1 text-xs" :style="{ color: 'var(--theme-primary)' }">
            请输入有效的卡密进行注册
          </p>
        </div>

        <div v-if="error" class="rounded bg-red-50 p-2 text-sm text-red-600 dark:bg-red-900/20">
          {{ error }}
        </div>

        <div v-if="success" class="rounded bg-green-50 p-2 text-sm text-green-600 dark:bg-green-900/20">
          {{ success }}
        </div>

        <BaseButton
          type="submit"
          variant="primary"
          block
          :loading="loading"
        >
          {{ isLogin ? '登录' : '注册' }}
        </BaseButton>
      </form>

      <div class="text-center">
        <button
          type="button"
          class="text-sm hover:opacity-80"
          :style="{ color: 'var(--theme-primary)' }"
          @click="toggleMode"
        >
          {{ isLogin ? '没有账号？立即注册' : '已有账号？立即登录' }}
        </button>
      </div>

      <div v-if="isLogin && oauthEnabled" class="mt-6 border-t border-gray-200 pt-6 dark:border-gray-700">
        <div class="mb-4 text-center">
          <span class="text-sm" :style="{ color: 'var(--theme-text)' }">其他登录方式</span>
        </div>
        <div class="flex justify-center gap-4">
          <button
            type="button"
            class="h-12 w-12 flex items-center justify-center rounded-full bg-blue-500 text-white transition-colors hover:bg-blue-600"
            :disabled="oauthLoading"
            title="QQ登录"
            @click="handleOAuthLogin('qq')"
          >
            <svg v-if="!oauthLoading" class="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 13.19c-.18.61-.83 1.17-1.46 1.25-.56.07-1.12.14-2.18.14-1.06 0-1.62-.07-2.18-.14-.63-.08-1.28-.64-1.46-1.25-.12-.41-.12-.85 0-1.26.18-.61.83-1.17 1.46-1.25.56-.07 1.12-.14 2.18-.14 1.06 0 1.62.07 2.18.14.63.08 1.28.64 1.46 1.25.12.41.12.85 0 1.26zm.86-4.19c-.24.79-.98 1.43-1.77 1.43h-.01c-.79 0-1.53-.64-1.77-1.43-.14-.46-.14-.95 0-1.41.24-.79.98-1.43 1.77-1.43h.01c.79 0 1.53.64 1.77 1.43.14.46.14.95 0 1.41zm-6.5 0c-.24.79-.98 1.43-1.77 1.43h-.01c-.79 0-1.53-.64-1.77-1.43-.14-.46-.14-.95 0-1.41.24-.79.98-1.43 1.77-1.43h.01c.79 0 1.53.64 1.77 1.43.14.46.14.95 0 1.41z" />
            </svg>
            <svg v-else class="h-6 w-6 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
