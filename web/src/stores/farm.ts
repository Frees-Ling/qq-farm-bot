import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'

export interface Land {
  id: number
  plantName?: string
  phaseName?: string
  seedImage?: string
  status: 'locked' | 'empty' | 'growing' | 'harvestable' | 'dead'
  matureInSec: number
  needWater?: boolean
  needWeed?: boolean
  needBug?: boolean
  level?: number
  maxLevel?: number
  seedId?: number
  stealable?: boolean
}

export interface FarmSummary {
  harvestable: number
  growing: number
  empty: number
  dead: number
  needWater: number
  needWeed: number
  needBug: number
}

export interface Seed {
  seedId: number
  goodsId: number
  name: string
  price: number | null
  requiredLevel: number | null
  locked: boolean
  soldOut: boolean
  unknownMeta?: boolean
}

interface ApiResponse<T> {
  ok: boolean
  data: T
}

interface LandsData {
  lands: Land[]
  summary: FarmSummary
}

const DEFAULT_SUMMARY: FarmSummary = {
  harvestable: 0,
  growing: 0,
  empty: 0,
  dead: 0,
  needWater: 0,
  needWeed: 0,
  needBug: 0,
}

export const useFarmStore = defineStore('farm', () => {
  const lands = ref<Land[]>([])
  const seeds = ref<Seed[]>([])
  const summary = ref<FarmSummary>({ ...DEFAULT_SUMMARY })
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchLands(accountId: string) {
    if (!accountId)
      return
    loading.value = true
    error.value = null
    try {
      const { data } = await api.get<ApiResponse<LandsData>>('/api/lands', {
        headers: { 'x-account-id': accountId },
      })
      if (data?.ok && data.data) {
        lands.value = data.data.lands || []
        summary.value = { ...DEFAULT_SUMMARY, ...data.data.summary }
      }
    }
    catch (e) {
      error.value = e instanceof Error ? e.message : '获取土地数据失败'
      console.error('获取土地数据失败', e)
    }
    finally {
      loading.value = false
    }
  }

  async function fetchSeeds(accountId: string) {
    if (!accountId)
      return
    try {
      const { data } = await api.get<ApiResponse<Seed[]>>('/api/seeds', {
        headers: { 'x-account-id': accountId },
      })
      if (data?.ok) {
        seeds.value = data.data || []
      }
    }
    catch (e) {
      console.error('获取种子数据失败', e)
    }
  }

  async function operate(accountId: string, opType: string) {
    if (!accountId)
      return
    loading.value = true
    error.value = null
    try {
      await api.post('/api/farm/operate', { opType }, {
        headers: { 'x-account-id': accountId },
      })
      await fetchLands(accountId)
    }
    catch (e) {
      error.value = e instanceof Error ? e.message : '操作失败'
      throw e
    }
    finally {
      loading.value = false
    }
  }

  function reset() {
    lands.value = []
    seeds.value = []
    summary.value = { ...DEFAULT_SUMMARY }
    error.value = null
  }

  return {
    lands,
    seeds,
    summary,
    loading,
    error,
    fetchLands,
    fetchSeeds,
    operate,
    reset,
  }
})
