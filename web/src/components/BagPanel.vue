<script setup lang="ts">
import { useEventListener, useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import { useAccountStore } from '@/stores/account'
import { useBagStore } from '@/stores/bag'
import { useStatusStore } from '@/stores/status'
import { useToastStore } from '@/stores/toast'
import { getSafeImageUrl } from '@/utils'

const accountStore = useAccountStore()
const bagStore = useBagStore()
const statusStore = useStatusStore()
const toast = useToastStore()
const { currentAccountId } = storeToRefs(accountStore)
const { items, originalItems, loading: bagLoading } = storeToRefs(bagStore)
const { status, loading: statusLoading, error: statusError, realtimeConnected } = storeToRefs(statusStore)

const imageErrors = ref<Record<string | number, boolean>>({})
const actionLoading = ref<Record<string | number, boolean>>({})

const useModal = ref(false)
const useTarget = ref<any>(null)
const useCount = ref(1)
const useSubmitting = ref(false)

const sellMode = ref(false)
const selectedIds = ref<Set<number>>(new Set())
const sellSubmitting = ref(false)

const USABLE_INTERACTION_TYPES = new Set([
  'fertilizer',
  'fertilizerpro',
  'gift',
  'giftbox',
  'box',
  'chest',
])

function canUseItem(item: any): boolean {
  if (!item)
    return false
  const id = Number(item.id)
  if (id === 1011 || id === 1012)
    return false
  const it = String(item.interactionType || '').toLowerCase()
  if (USABLE_INTERACTION_TYPES.has(it))
    return true
  if (it === 'fertilizerbucket')
    return false
  if (item.category === 'gold' || item.category === 'exp')
    return false
  if (item.category === 'fruit' || item.category === 'seed')
    return false
  if (Number(item.itemType) === 11)
    return true
  if (it && it !== 'none' && it !== '')
    return true
  return false
}

function canSellItem(item: any): boolean {
  if (!item)
    return false
  if (item.category === 'gold' || item.category === 'exp')
    return false
  if (item.category === 'fruit' || item.category === 'seed')
    return true
  if (Number(item.price) > 0)
    return true
  return false
}

function getPriceClass(item: any) {
  const priceId = Number(item?.priceId || 0)
  if (priceId === 1005)
    return 'text-amber-500 dark:text-amber-400'
  if (priceId === 1002)
    return 'text-sky-500 dark:text-sky-400'
  return 'text-amber-600 dark:text-amber-400'
}

const sellableItems = computed(() => items.value.filter(canSellItem))

// 全选时默认排除种子（种子需要手动勾选）
const autoSelectableItems = computed(() =>
  sellableItems.value.filter(it => it.category !== 'seed'),
)

const allSellableSelected = computed(() => {
  if (autoSelectableItems.value.length === 0)
    return false
  return autoSelectableItems.value.every(it => selectedIds.value.has(Number(it.id)))
})

function toggleSelectAll() {
  if (allSellableSelected.value) {
    selectedIds.value = new Set()
  }
  else {
    // 全选时只选择非种子物品
    selectedIds.value = new Set(autoSelectableItems.value.map(it => Number(it.id)))
  }
}

function toggleSelect(id: number) {
  const next = new Set(selectedIds.value)
  if (next.has(id))
    next.delete(id)
  else
    next.add(id)
  selectedIds.value = next
}

const selectedItems = computed(() =>
  items.value.filter(it => selectedIds.value.has(Number(it.id))),
)

const sellTotalPrice = computed(() =>
  selectedItems.value.reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.count) || 0), 0),
)

const sellTotalCount = computed(() =>
  selectedItems.value.reduce((sum, it) => sum + (Number(it.count) || 0), 0),
)

function openUseModal(item: any) {
  useTarget.value = item
  useCount.value = 1
  useModal.value = true
}

function closeUseModal() {
  useModal.value = false
  useTarget.value = null
}

async function confirmUse() {
  if (!useTarget.value || !currentAccountId.value)
    return
  const itemId = Number(useTarget.value.id)
  const count = Math.max(1, Math.min(useCount.value, useTarget.value.count || 1))
  useSubmitting.value = true
  try {
    const res = await bagStore.useItem(currentAccountId.value, itemId, count)
    if (res.ok) {
      toast.success(`成功使用 ${useTarget.value.name} x${count}`)
      closeUseModal()
      await bagStore.fetchBag(currentAccountId.value)
    }
    else {
      toast.error(res.error || '使用失败')
    }
  }
  catch (e: any) {
    toast.error(e?.response?.data?.error || e?.message || '使用失败')
  }
  finally {
    useSubmitting.value = false
  }
}

function enterSellMode() {
  sellMode.value = true
  selectedIds.value = new Set()
}

function exitSellMode() {
  sellMode.value = false
  selectedIds.value = new Set()
}

async function confirmSell() {
  if (selectedItems.value.length === 0 || !currentAccountId.value)
    return
  sellSubmitting.value = true
  try {
    const payload: Array<{ id: number, count: number, uid?: number }> = []
    for (const selectedItem of selectedItems.value) {
      const itemId = Number(selectedItem.id)
      const matchingItems = originalItems.value.filter((it: any) => Number(it.id) === itemId)
      for (const it of matchingItems) {
        payload.push({
          id: Number(it.id),
          count: Number(it.count),
          uid: Number(it.uid) || 0,
        })
      }
    }
    const res = await bagStore.sellItems(currentAccountId.value, payload)
    if (res.ok) {
      toast.success(`出售成功！共 ${selectedItems.value.length} 种物品`)
      exitSellMode()
      await bagStore.fetchBag(currentAccountId.value)
    }
    else {
      toast.error(res.error || '出售失败')
    }
  }
  catch (e: any) {
    toast.error(e?.response?.data?.error || e?.message || '出售失败')
  }
  finally {
    sellSubmitting.value = false
  }
}

async function loadBag() {
  if (!currentAccountId.value)
    return
  if (!realtimeConnected.value || !status.value) {
    await statusStore.fetchStatus(currentAccountId.value)
  }
  if (status.value?.connection?.connected) {
    bagStore.fetchBag(currentAccountId.value)
  }
  imageErrors.value = {}
}

defineExpose({ loadBag })

onMounted(() => {
  loadBag()
})
watch(currentAccountId, () => {
  loadBag()
})
useEventListener(document, 'visibilitychange', () => {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible' && currentAccountId.value)
    loadBag()
})
useIntervalFn(loadBag, 60000)
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between">
      <h2 class="flex items-center gap-2 text-2xl font-bold">
        <div class="i-carbon-inventory-management" />
        背包
      </h2>
      <div class="flex items-center gap-2">
        <span v-if="items.length" class="text-sm text-gray-500">
          共 {{ items.length }} 种
        </span>
        <button
          v-if="!sellMode && sellableItems.length > 0 && status?.connection?.connected"
          class="border border-orange-200 rounded-lg bg-orange-50 px-2.5 py-1 text-xs text-orange-600 font-medium transition dark:border-orange-700/50 dark:bg-orange-900/20 hover:bg-orange-100 dark:text-orange-400 dark:hover:bg-orange-900/30"
          @click="enterSellMode"
        >
          <div class="i-carbon-shopping-cart mr-0.5 inline-block align-text-bottom text-sm" />
          出售
        </button>
        <button
          v-if="sellMode"
          class="border border-gray-200 rounded-lg bg-gray-50 px-2.5 py-1 text-xs text-gray-600 font-medium transition dark:border-gray-600 dark:bg-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-600"
          @click="exitSellMode"
        >
          取消
        </button>
      </div>
    </div>

    <div v-if="bagLoading || statusLoading" class="flex justify-center py-12">
      <div class="i-svg-spinners-90-ring-with-bg text-4xl text-blue-500" />
    </div>

    <div v-else-if="!currentAccountId" class="rounded-lg bg-white p-8 text-center text-gray-500 shadow dark:bg-gray-800">
      请选择账号后查看背包
    </div>

    <div v-else-if="statusError" class="border border-red-200 rounded-lg bg-red-50 p-8 text-center text-red-500 shadow dark:border-red-800 dark:bg-red-900/20">
      <div class="mb-2 text-lg font-bold">
        获取数据失败
      </div>
      <div class="text-sm">
        {{ statusError }}
      </div>
    </div>

    <div v-else-if="!status?.connection?.connected" class="flex flex-col items-center justify-center gap-4 rounded-lg bg-white p-12 text-center text-gray-500 shadow dark:bg-gray-800">
      <div class="i-carbon-connection-signal-off text-4xl text-gray-400" />
      <div>
        <div class="text-lg text-gray-700 font-medium dark:text-gray-300">
          账号未登录
        </div>
        <div class="mt-1 text-sm text-gray-400">
          请先运行账号或检查网络连接
        </div>
      </div>
    </div>

    <div v-else-if="items.length === 0" class="rounded-lg bg-white p-8 text-center text-gray-500 shadow dark:bg-gray-800">
      无可展示物品
    </div>

    <template v-else>
      <div v-if="sellMode" class="flex items-center justify-between border border-orange-200 rounded-lg bg-orange-50/80 px-3 py-2 dark:border-orange-800/40 dark:bg-orange-900/10">
        <label class="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            class="h-4 w-4 rounded accent-orange-500"
            :checked="allSellableSelected"
            @change="toggleSelectAll"
          >
          <span class="text-orange-700 dark:text-orange-300">全选可售物品</span>
          <span class="text-xs text-orange-500/70">({{ sellableItems.length }}种)</span>
        </label>
        <div v-if="selectedIds.size > 0" class="flex items-center gap-3 text-sm">
          <span class="text-gray-600 dark:text-gray-400">
            已选 <strong class="text-orange-600 dark:text-orange-400">{{ selectedIds.size }}</strong> 种
            / <strong class="text-orange-600 dark:text-orange-400">{{ sellTotalCount }}</strong> 个
          </span>
          <span class="text-amber-600 font-bold dark:text-amber-400">
            <div class="i-fas-coins mr-0.5 inline-block align-text-bottom text-xs text-amber-500" />
            {{ sellTotalPrice.toLocaleString() }} 金
          </span>
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <div
          v-for="item in items"
          :key="item.id"
          class="group min-w-0 flex shrink-0 items-center gap-2.5 border rounded-lg bg-white p-2 transition sm:gap-3 sm:p-2.5"
          :class="[
            sellMode && selectedIds.has(Number(item.id))
              ? 'border-orange-300 bg-orange-50/50 dark:border-orange-700/60 dark:bg-orange-900/10'
              : 'border-gray-200 dark:border-gray-700 dark:bg-gray-800 hover:shadow-sm',
          ]"
        >
          <div v-if="sellMode" class="shrink-0">
            <input
              v-if="canSellItem(item)"
              type="checkbox"
              class="h-4 w-4 cursor-pointer rounded accent-orange-500"
              :checked="selectedIds.has(Number(item.id))"
              @change="toggleSelect(Number(item.id))"
            >
            <div v-else class="h-4 w-4" />
          </div>

          <div
            class="thumb-wrap h-9 w-9 flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-50 sm:h-10 sm:w-10 dark:bg-gray-700/50"
            :data-fallback="(item.name || '物').slice(0, 1)"
          >
            <img
              v-if="item.image && !imageErrors[item.id]"
              :src="getSafeImageUrl(item.image)"
              :alt="item.name"
              class="h-full w-full object-contain"
              decoding="async"
              @error="imageErrors[item.id] = true"
            >
            <div v-else class="text-base text-gray-400 font-bold uppercase sm:text-lg">
              {{ (item.name || '物').slice(0, 1) }}
            </div>
          </div>

          <div class="min-w-0 flex-1 overflow-hidden">
            <div class="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
              <span class="truncate text-sm text-gray-800 font-medium dark:text-gray-200" :title="item.name">
                {{ item.name || `物品${item.id}` }}
              </span>
              <span
                v-if="item.category === 'fruit'"
                class="rounded bg-green-100 px-1 py-px text-[10px] text-green-700 font-medium dark:bg-green-900/30 dark:text-green-400"
              >果实</span>
              <span
                v-else-if="item.category === 'seed'"
                class="rounded bg-cyan-100 px-1 py-px text-[10px] text-cyan-700 font-medium dark:bg-cyan-900/30 dark:text-cyan-400"
              >种子</span>
            </div>
            <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
              <span v-if="item.price > 0" class="flex items-center gap-0.5" :class="getPriceClass(item)">
                <div class="i-fas-coins text-[10px]" />
                {{ item.price }}{{ item.priceUnit || '金' }}
              </span>
              <span v-if="item.level > 0">Lv{{ item.level }}</span>
            </div>
          </div>

          <div class="shrink-0 text-right text-sm font-medium" :class="item.hoursText ? 'text-blue-500 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'">
            {{ item.hoursText || `x${item.count || 0}` }}
          </div>

          <div v-if="!sellMode" class="flex shrink-0 items-center gap-1">
            <button
              v-if="canUseItem(item)"
              class="border border-blue-200 rounded-md bg-blue-50 px-2 py-0.5 text-xs text-blue-600 font-medium transition dark:border-blue-700/50 dark:bg-blue-900/20 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900/30"
              :disabled="!!actionLoading[item.id]"
              @click="openUseModal(item)"
            >
              使用
            </button>
          </div>
        </div>
      </div>

      <div
        v-if="sellMode && selectedIds.size > 0"
        class="sticky bottom-0 flex items-center justify-between gap-3 border border-orange-200 rounded-lg bg-white px-4 py-3 shadow-lg dark:border-orange-800/40 dark:bg-gray-800"
      >
        <div class="text-sm">
          <span class="text-gray-600 dark:text-gray-400">
            合计 <strong class="text-orange-600 dark:text-orange-400">{{ selectedIds.size }}</strong> 种 /
            <strong class="text-orange-600 dark:text-orange-400">{{ sellTotalCount }}</strong> 个
          </span>
          <span class="ml-2 text-base text-amber-600 font-bold dark:text-amber-400">
            <div class="i-fas-coins mr-0.5 inline-block align-text-bottom text-sm text-amber-500" />
            ≈ {{ sellTotalPrice.toLocaleString() }} 金
          </span>
        </div>
        <button
          class="rounded-lg bg-orange-500 px-4 py-1.5 text-sm text-white font-medium shadow transition disabled:cursor-not-allowed hover:bg-orange-600 disabled:opacity-50"
          :disabled="sellSubmitting"
          @click="confirmSell"
        >
          <div v-if="sellSubmitting" class="i-svg-spinners-90-ring-with-bg mr-1 inline-block align-text-bottom" />
          确认出售
        </button>
      </div>
    </template>

    <Teleport to="body">
      <div v-if="useModal && useTarget" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" @click.self="closeUseModal">
        <div class="w-80 rounded-xl bg-white p-5 shadow-2xl dark:bg-gray-800" @click.stop>
          <h3 class="mb-4 text-lg text-gray-800 font-bold dark:text-gray-200">
            使用物品
          </h3>
          <div class="mb-4 flex items-center gap-3 rounded-lg bg-gray-50 p-3 dark:bg-gray-700/50">
            <div class="h-10 w-10 flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white dark:bg-gray-600">
              <img
                v-if="useTarget.image && !imageErrors[`use-${useTarget.id}`]"
                :src="getSafeImageUrl(useTarget.image)"
                class="h-full w-full object-contain"
                decoding="async"
                @error="imageErrors[`use-${useTarget.id}`] = true"
              >
              <div v-else class="text-lg text-gray-400 font-bold">
                {{ (useTarget.name || '物').slice(0, 1) }}
              </div>
            </div>
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-medium">
                {{ useTarget.name }}
              </div>
              <div class="text-xs text-gray-500">
                拥有 {{ useTarget.count }} 个
              </div>
            </div>
          </div>

          <div class="mb-5">
            <label class="mb-1.5 block text-sm text-gray-600 dark:text-gray-400">使用数量</label>
            <div class="flex items-center gap-2">
              <button
                class="h-8 w-8 flex items-center justify-center border border-gray-200 rounded-lg text-lg transition dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700"
                :disabled="useCount <= 1"
                @click="useCount = Math.max(1, useCount - 1)"
              >
                −
              </button>
              <input
                v-model.number="useCount"
                type="number"
                :min="1"
                :max="useTarget.count || 1"
                class="h-8 w-16 border border-gray-200 rounded-lg bg-white text-center text-sm font-medium dark:border-gray-600 dark:bg-gray-700"
                @input="useCount = Math.max(1, Math.min(useCount, useTarget.count || 1))"
              >
              <button
                class="h-8 w-8 flex items-center justify-center border border-gray-200 rounded-lg text-lg transition dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700"
                :disabled="useCount >= (useTarget.count || 1)"
                @click="useCount = Math.min(useTarget.count || 1, useCount + 1)"
              >
                +
              </button>
              <button
                class="border border-gray-200 rounded-lg px-2 py-1 text-xs text-gray-500 transition dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700"
                @click="useCount = useTarget.count || 1"
              >
                全部
              </button>
            </div>
          </div>

          <div class="flex justify-end gap-2">
            <button
              class="border border-gray-200 rounded-lg px-4 py-1.5 text-sm text-gray-600 transition dark:border-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
              @click="closeUseModal"
            >
              取消
            </button>
            <button
              class="rounded-lg bg-blue-500 px-4 py-1.5 text-sm text-white font-medium shadow transition disabled:cursor-not-allowed hover:bg-blue-600 disabled:opacity-50"
              :disabled="useSubmitting || useCount < 1"
              @click="confirmUse"
            >
              <div v-if="useSubmitting" class="i-svg-spinners-90-ring-with-bg mr-1 inline-block align-text-bottom" />
              确认使用
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.thumb-wrap.fallback img {
  display: none;
}
.thumb-wrap.fallback::after {
  content: attr(data-fallback);
  font-size: 1.5rem;
  font-weight: bold;
  color: #9ca3af;
  text-transform: uppercase;
}
input[type='number']::-webkit-inner-spin-button,
input[type='number']::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
input[type='number'] {
  -moz-appearance: textfield;
}
</style>
