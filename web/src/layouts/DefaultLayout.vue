<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AccountModal from '@/components/AccountModal.vue'
import Sidebar from '@/components/Sidebar.vue'
import ThemeToggle from '@/components/ThemeToggle.vue'
import { menuRoutes } from '@/router/menu'
import { useAccountStore } from '@/stores/account'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'

const accountStore = useAccountStore()
const userStore = useUserStore()
const toastStore = useToastStore()
const { accounts, currentAccount } = storeToRefs(accountStore)
const route = useRoute()
const router = useRouter()

const showUserDropdown = ref(false)
const showAccountDropdown = ref(false)
const showAccountModal = ref(false)
const showRenewModal = ref(false)
const renewCardCode = ref('')
const accountToEdit = ref<any>(null)
const avatarErrorMap = ref<Record<string, number>>({})

const isAccountOpsDisabled = computed(() => !userStore.isAdmin && userStore.isExpired)
const quotaLimit = computed(() => {
  const quota = userStore.userCard?.quota
  if (quota === undefined || quota === null)
    return 3
  return quota
})
const isOverQuota = computed(() => {
  if (userStore.isAdmin)
    return false
  const limit = quotaLimit.value
  if (limit === -1)
    return false
  return accounts.value.length >= limit
})
const isAddAccountDisabled = computed(() => isAccountOpsDisabled.value || isOverQuota.value)
const addAccountDisabledReason = computed(() => {
  if (isAccountOpsDisabled.value)
    return '账号已到期，无法添加账号'
  if (isOverQuota.value)
    return '已超过配额，无法添加账号'
  return ''
})

const bottomNavItems = computed(() => {
  const mobileMenuPaths = ['', 'personal', 'friends', 'analytics', 'settings']
  const allowPaths = userStore.isAdmin
    ? [...mobileMenuPaths, 'admin']
    : mobileMenuPaths
  return menuRoutes
    .filter(item => allowPaths.includes(item.path) && (!item.adminOnly || userStore.isAdmin))
    .map(item => ({
      path: item.path ? `/${item.path}` : '/',
      label: item.label,
      icon: item.icon,
    }))
})

function isActive(path: string) {
  if (path === '/') {
    return route.path === '/'
  }
  return route.path.startsWith(path)
}

function selectAccount(acc: any) {
  accountStore.setCurrentAccount(acc)
  showAccountDropdown.value = false
}

function getAccountAvatarKey(acc: any) {
  return String(acc?.id || acc?.uin || '')
}

function getAccountAvatarCandidates(acc: any) {
  if (!acc)
    return []
  const list = [
    acc.uin ? `https://q1.qlogo.cn/g?b=qq&nk=${acc.uin}&s=100` : '',
    String(acc.avatar || '').trim(),
    String(acc.avatarUrl || '').trim(),
  ]
  return list.filter(Boolean)
}

function getAccountAvatar(acc: any) {
  const key = getAccountAvatarKey(acc)
  const index = avatarErrorMap.value[key] || 0
  return getAccountAvatarCandidates(acc)[index] || ''
}

function handleAccountAvatarError(acc: any) {
  const key = getAccountAvatarKey(acc)
  if (!key)
    return
  avatarErrorMap.value[key] = (avatarErrorMap.value[key] || 0) + 1
}

function getQuotaLabel(quota: number | undefined) {
  if (quota === undefined || quota === null)
    return '3个'
  if (quota === -1)
    return '不限量'
  return `${quota}个`
}

function getAccountMeta(acc: any) {
  const uin = String(acc?.uin || acc?.qq || '').trim()
  if (uin)
    return uin

  const gid = String(acc?.gid || '').trim()
  if (gid)
    return `GID:${gid}`

  return String(acc?.id || '未选择账号')
}

const displayName = computed(() => {
  const acc = currentAccount.value
  if (!acc)
    return '选择账号'
  if (acc.name) {
    if (acc.nick) {
      return `${acc.nick} (${acc.name})`
    }
    return acc.name
  }
  if (acc.nick)
    return acc.nick
  return acc.uin || acc.id
})

async function handleAccountSaved() {
  await accountStore.fetchAccounts()
  showAccountModal.value = false
}

async function handleLogout() {
  await userStore.logout()
  router.push('/login')
}

async function handleRenew() {
  if (!renewCardCode.value)
    return

  try {
    const result = await userStore.renew(renewCardCode.value)
    if (result.ok) {
      toastStore.success(result.message || '续费成功')
      showRenewModal.value = false
      renewCardCode.value = ''
    }
    else {
      toastStore.error(result.error || '续费失败')
    }
  }
  catch (e: any) {
    const errorMsg = e.response?.data?.error || e.message || '续费失败'
    toastStore.error(errorMsg)
  }
}

accountStore.fetchAccounts()
userStore.fetchUserInfo()
</script>

<template>
  <div class="w-screen flex overflow-hidden bg-gray-50 dark:bg-gray-900" style="height: 100dvh;">
    <div class="hidden lg:block">
      <Sidebar />
    </div>
    <main class="relative h-full min-w-0 flex flex-1 flex-col overflow-hidden">
      <header class="shrink-0 border-b border-gray-100 bg-white lg:hidden dark:border-gray-700/50 dark:bg-gray-800">
        <div class="h-15 flex items-center justify-between px-3.5">
          <div class="flex items-center gap-2">
            <div class="i-carbon-sprout text-[22px]" :style="{ color: 'var(--theme-primary)' }" />
            <span class="text-[15px] font-bold">QQ农场</span>
          </div>
          <div class="flex items-center gap-1">
            <ThemeToggle />
            <div class="relative">
              <button
                class="h-9 flex items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                @click.stop="showUserDropdown = !showUserDropdown"
              >
                <div class="i-carbon-user text-[15px]" />
                <span class="max-w-[80px] truncate">{{ userStore.username || '未登录' }}</span>
                <div
                  class="i-carbon-chevron-down text-xs transition-transform duration-200"
                  :class="{ 'rotate-180': showUserDropdown }"
                />
              </button>
              <div
                v-if="showUserDropdown"
                class="absolute right-0 top-full z-50 mt-1.5 w-56 overflow-hidden border border-gray-200 rounded-xl bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
              >
                <div class="border-b border-gray-100 px-3 py-2 dark:border-gray-700">
                  <div class="text-sm font-medium">
                    {{ userStore.username }}
                  </div>
                  <div class="text-xs text-gray-500 dark:text-gray-400">
                    {{ userStore.isAdmin ? '管理员' : '普通用户' }}
                  </div>
                  <div v-if="userStore.userCard && !userStore.isAdmin" class="mt-2 space-y-1">
                    <div class="flex items-center justify-between text-xs">
                      <span class="text-gray-500">配额:</span>
                      <span :style="{ color: 'var(--theme-primary)' }">{{ getQuotaLabel(userStore.userCard.quota) }}</span>
                    </div>
                    <div class="flex items-center justify-between text-xs">
                      <span class="text-gray-500">过期时间:</span>
                      <span :class="userStore.isExpired ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'">
                        {{ userStore.expireTimeText }}
                      </span>
                    </div>
                  </div>
                </div>
                <div v-if="!userStore.isAdmin" class="border-b border-gray-100 py-1 dark:border-gray-700">
                  <button
                    class="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
                    :style="{ color: 'var(--theme-primary)' }"
                    @click="showRenewModal = true; showUserDropdown = false"
                  >
                    <div class="i-carbon-renew" />
                    <span>续费/加配额</span>
                  </button>
                </div>
                <button
                  class="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-gray-100 dark:text-red-400 dark:hover:bg-gray-700"
                  @click="handleLogout"
                >
                  <div class="i-carbon-logout" />
                  <span>退出登录</span>
                </button>
              </div>
            </div>
          </div>
        </div>
        <div class="border-t border-gray-100 px-3.5 py-2.5 dark:border-gray-700/50">
          <div class="relative">
            <button
              class="h-10 w-full flex items-center justify-between rounded-xl bg-gray-100/50 px-3 text-sm dark:bg-gray-700/30"
              @click.stop="showAccountDropdown = !showAccountDropdown"
            >
              <div class="flex items-center gap-2 overflow-hidden">
                <div class="h-6 w-6 flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 dark:bg-gray-600">
                  <img
                    v-if="getAccountAvatar(currentAccount)"
                    :src="getAccountAvatar(currentAccount)"
                    class="h-full w-full object-cover"
                    @error="handleAccountAvatarError(currentAccount)"
                  >
                  <div v-else class="i-carbon-user text-xs text-gray-400" />
                </div>
                <div class="min-w-0 flex flex-col items-start">
                  <span class="truncate text-sm font-medium">{{ displayName }}</span>
                  <span class="truncate text-xs text-gray-500 dark:text-gray-400">
                    {{ getAccountMeta(currentAccount) }}
                  </span>
                </div>
              </div>
              <div
                class="i-carbon-chevron-down text-gray-400 transition-transform duration-200"
                :class="{ 'rotate-180': showAccountDropdown }"
              />
            </button>
            <div
              v-if="showAccountDropdown"
              class="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden border border-gray-200 rounded-xl bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
            >
              <div class="max-h-48 overflow-y-auto">
                <template v-if="accounts.length > 0">
                  <button
                    v-for="acc in accounts"
                    :key="acc.id || acc.uin"
                    class="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                    :class="{ 'bg-blue-50 dark:bg-blue-900/20': currentAccount?.id === acc.id }"
                    @click="selectAccount(acc)"
                  >
                    <div class="h-5 w-5 flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 dark:bg-gray-600">
                      <img
                        v-if="getAccountAvatar(acc)"
                        :src="getAccountAvatar(acc)"
                        class="h-full w-full object-cover"
                        @error="handleAccountAvatarError(acc)"
                      >
                      <div v-else class="i-carbon-user text-xs text-gray-400" />
                    </div>
                    <span class="truncate">
                      {{ acc.nick && acc.name ? `${acc.nick} (${acc.name})` : acc.name || acc.nick || getAccountMeta(acc) }}
                    </span>
                    <div v-if="currentAccount?.id === acc.id" class="i-carbon-checkmark ml-auto text-sm" :style="{ color: 'var(--theme-primary)' }" />
                  </button>
                </template>
                <div v-else class="px-3 py-2 text-center text-sm text-gray-400">
                  暂无账号
                </div>
              </div>
              <div class="border-t border-gray-100 pt-1 dark:border-gray-700">
                <button
                  class="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
                  :style="{ color: 'var(--theme-primary)' }"
                  :disabled="isAddAccountDisabled"
                  :title="addAccountDisabledReason"
                  :class="isAddAccountDisabled ? 'cursor-not-allowed opacity-60' : ''"
                  @click="!isAddAccountDisabled && (showAccountModal = true); showAccountDropdown = false"
                >
                  <div class="i-carbon-add" />
                  <span>添加账号</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>
      <div class="flex flex-1 flex-col overflow-hidden">
        <div class="custom-scrollbar flex flex-1 flex-col overflow-y-auto px-0 py-2.5 md:p-6 sm:p-4">
          <RouterView v-slot="{ Component, route: viewRoute }">
            <Transition name="slide-fade" mode="out-in">
              <component :is="Component" :key="viewRoute.path" />
            </Transition>
          </RouterView>
        </div>
      </div>
      <nav class="shrink-0 border-t border-gray-100 bg-white lg:hidden dark:border-gray-700/50 dark:bg-gray-800">
        <div class="safe-area-pb flex items-center justify-around">
          <div
            v-for="item in bottomNavItems"
            :key="item.path"
            class="h-14 flex flex-1 flex-col cursor-pointer items-center justify-center gap-0.5 px-1 py-1.5 transition-colors"
            :class="
              isActive(item.path)
                ? 'text-primary'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            "
            @click="router.push(item.path)"
          >
            <div class="text-[21px]" :class="[item.icon]" />
            <span class="text-[11px] font-medium leading-tight">{{ item.label }}</span>
          </div>
        </div>
      </nav>
    </main>
    <div
      v-if="showAccountDropdown || showUserDropdown"
      class="fixed inset-0 z-40 bg-transparent lg:hidden"
      @click="showAccountDropdown = false; showUserDropdown = false"
    />
    <AccountModal
      :show="showAccountModal"
      :edit-data="accountToEdit"
      @close="showAccountModal = false; accountToEdit = null"
      @saved="handleAccountSaved"
    />
    <div
      v-if="showRenewModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
      @click.self="showRenewModal = false"
    >
      <div class="mx-4 max-w-md w-full rounded-lg bg-white p-6 dark:bg-gray-800">
        <h2 class="mb-4 text-xl text-gray-900 font-bold dark:text-white">
          续费/加配额
        </h2>
        <p class="mb-4 text-sm text-gray-600 dark:text-gray-400">
          输入天数卡密可续费时长，输入配额卡密可增加配额
        </p>
        <div class="space-y-4">
          <div>
            <label class="mb-1 block text-sm text-gray-700 font-medium dark:text-gray-300">
              卡密
            </label>
            <input
              v-model="renewCardCode"
              type="text"
              class="w-full border border-gray-300 rounded-lg bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              placeholder="请输入卡密"
            >
          </div>
        </div>
        <div class="mt-6 flex justify-end space-x-3">
          <button
            class="border border-gray-300 rounded-lg bg-white px-4 py-2 text-sm text-gray-700 transition-colors dark:border-gray-600 dark:bg-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-600"
            @click="showRenewModal = false"
          >
            取消
          </button>
          <button
            class="rounded-lg px-4 py-2 text-sm text-white transition-colors"
            :style="{ backgroundColor: 'var(--theme-primary)' }"
            :disabled="!renewCardCode"
            @click="handleRenew"
          >
            确认
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.text-primary {
  color: var(--theme-primary);
}

.safe-area-pb {
  padding-bottom: max(env(safe-area-inset-bottom), 0px);
}

.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.2s ease-out;
}

.slide-fade-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.slide-fade-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.3);
  border-radius: 3px;
}
.custom-scrollbar:hover::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.5);
}
</style>
