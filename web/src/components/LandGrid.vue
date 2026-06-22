<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import LandCard from '@/components/LandCard.vue'

const props = defineProps<{
  lands: any[]
}>()

const windowWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1024)

function updateWidth() {
  windowWidth.value = window.innerWidth
}

onMounted(() => {
  window.addEventListener('resize', updateWidth)
})

onUnmounted(() => {
  window.removeEventListener('resize', updateWidth)
})

const isMobile = computed(() => windowWidth.value < 768)

const TOTAL_LANDS = 24

function getLandById(lands: any[], id: number): any {
  return lands.find(l => Number(l.id) === id)
}

function is2x2Master(land: any): boolean {
  return Number(land?.plantSize) === 2 && !land?.occupiedByMaster
}

function get2x2SlaveIds(land: any): number[] {
  if (!is2x2Master(land))
    return []
  return land?.occupiedLandIds || []
}

function buildMobileLayout(lands: any[]): any[] {
  const cells: any[] = []
  const slaveIds = new Set<number>()
  for (const land of lands) {
    if (is2x2Master(land)) {
      for (const id of get2x2SlaveIds(land))
        slaveIds.add(Number(id))
    }
  }

  for (let row = 0; row < 6; row++) {
    for (let col = 3; col >= 0; col--) {
      const landId = (row * 4) + (col + 1)
      if (landId > TOTAL_LANDS)
        continue
      if (slaveIds.has(landId))
        continue

      const land = getLandById(lands, landId)
      if (!land) {
        cells.push({ type: 'empty', id: landId })
        continue
      }

      if (is2x2Master(land)) {
        const occupiedIds = get2x2SlaveIds(land)
        cells.push({ type: '2x2', land, slaveIds: occupiedIds })
      }
      else if (land?.occupiedByMaster) {
        continue
      }
      else {
        cells.push({ type: 'normal', land })
      }
    }
  }

  return cells
}

function buildDesktopLayout(lands: any[]): any[] {
  const cells: any[] = []
  const skipIds = new Set<number>()

  for (let row = 0; row < 4; row++) {
    for (let col = 5; col >= 0; col--) {
      const landId = (col * 4) + (row + 1)

      if (skipIds.has(landId))
        continue

      const land = getLandById(lands, landId)
      if (!land) {
        cells.push({ type: 'empty', id: landId })
        continue
      }

      if (is2x2Master(land)) {
        const slaveIds = get2x2SlaveIds(land)
        slaveIds.forEach(id => skipIds.add(id))
        cells.push({ type: '2x2', land, slaveIds })
      }
      else if (land?.occupiedByMaster) {
        continue
      }
      else {
        cells.push({ type: 'normal', land })
      }
    }
  }

  return cells
}

const layoutCells = computed(() => {
  const lands = props.lands || []
  if (isMobile.value) {
    return buildMobileLayout(lands)
  }
  return buildDesktopLayout(lands)
})
</script>

<template>
  <div class="land-grid">
    <template v-for="(cell, index) in layoutCells" :key="index">
      <div v-if="cell.type === '2x2'" class="land-2x2">
        <LandCard :land="cell.land" class="h-full" />
      </div>
      <div v-else-if="cell.type === 'normal'" class="land-1x1">
        <LandCard :land="cell.land" />
      </div>
      <div v-else-if="cell.type === 'empty'" class="land-1x1 land-empty">
        <div class="h-full min-h-[140px] flex items-center justify-center border border-gray-300 rounded-lg border-dashed text-gray-400 dark:border-gray-600 dark:text-gray-500">
          #{{ cell.id }}
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.land-grid {
  display: grid;
  gap: 0.5rem;
}

@media (max-width: 767px) {
  .land-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}

@media (min-width: 768px) {
  .land-grid {
    grid-template-columns: repeat(6, 1fr);
  }
}

.land-1x1 {
  min-height: 140px;
}

.land-2x2 {
  grid-column: span 2;
  grid-row: span 2;
  min-height: 290px;
}

.land-empty {
  opacity: 0.5;
}
</style>
