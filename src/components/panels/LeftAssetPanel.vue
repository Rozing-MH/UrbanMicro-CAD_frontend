<template>
  <aside class="left-panel" :class="{ collapsed: !editor.panelState.leftPanelOpen }">
    <div class="panel-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="tab-btn"
        :class="{ active: activeTab === tab.id }"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </button>
      <button class="collapse-btn" @click="toggleCollapse">‹</button>
    </div>

    <div class="panel-search">
      <input v-model="search" type="text" placeholder="搜索…" />
    </div>

    <div v-if="activeTab === 'sections'" class="panel-content">
      <div v-if="loading" class="placeholder">加载中…</div>
      <div v-else-if="filteredProfiles.length === 0" class="placeholder">暂无横断面模板</div>
      <ul v-else class="asset-list">
        <li
          v-for="profile in filteredProfiles"
          :key="profile.id"
          class="asset-item"
          :class="{ active: editor.activeProfileId === profile.id }"
          draggable="true"
          @click="onSelectProfile(profile)"
          @dragstart="onDragStart($event, profile.id)"
        >
          <div class="asset-thumb">
            <div class="section-preview">
              <div
                v-for="(lane, i) in profile.lanes"
                :key="i"
                class="lane-strip"
                :style="laneStyle(lane)"
              ></div>
            </div>
          </div>
          <div class="asset-info">
            <div class="asset-name">{{ profile.name }}</div>
            <div class="asset-meta">{{ profile.totalWidth.toFixed(1) }} m · {{ profile.lanes.length }} 车道</div>
          </div>
        </li>
      </ul>
    </div>

    <div v-else-if="activeTab === 'assets'" class="panel-content">
      <div v-if="loadingAssets" class="placeholder">加载中…</div>
      <ul v-else class="asset-grid">
        <li v-for="a in filteredAssets" :key="a.id" class="asset-card" draggable="true" @dragstart="onAssetDrag($event, a.id)">
          <div class="asset-card-thumb">{{ a.category[0]?.toUpperCase() ?? '?' }}</div>
          <div class="asset-card-name">{{ a.name }}</div>
        </li>
      </ul>
    </div>

    <div v-else-if="activeTab === 'layers'" class="panel-content">
      <ul class="layer-list">
        <li v-for="layer in layers" :key="layer.id" class="layer-row">
          <label>
            <input type="checkbox" :checked="layer.visible" @change="toggleLayer(layer.id)" />
            {{ layer.label }}
          </label>
        </li>
      </ul>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useEditorStateStore } from '@/stores/editorStateStore'
import { templateApi } from '@/api/templateApi'
import type { CrossSectionProfile, LaneDef } from '@/types/road-network'

const editor = useEditorStateStore() as ReturnType<typeof useEditorStateStore> & { activeProfileId?: string }

type TabId = 'sections' | 'assets' | 'layers'
interface TabDef { id: TabId; label: string }
const tabs: TabDef[] = [
  { id: 'sections', label: '横断面' },
  { id: 'assets', label: '资源' },
  { id: 'layers', label: '图层' },
]
const activeTab = ref<TabId>('sections')
const search = ref('')

const profiles = ref<CrossSectionProfile[]>([])
const loading = ref(false)
const assets = ref<Array<{ id: string; name: string; category: string; thumbnail: string }>>([])
const loadingAssets = ref(false)

interface LayerToggle { id: string; label: string; visible: boolean }
const layers = ref<LayerToggle[]>([
  { id: 'roads', label: '道路网络', visible: true },
  { id: 'lanes', label: '车道分隔线', visible: true },
  { id: 'signals', label: '信号灯', visible: true },
  { id: 'labels', label: '标签 / ID', visible: false },
  { id: 'grid', label: '辅助网格', visible: true },
  { id: 'heatmap', label: '热力图', visible: true },
])

function toggleLayer(id: string): void {
  const layer = layers.value.find(l => l.id === id)
  if (layer) layer.visible = !layer.visible
}

const filteredProfiles = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return profiles.value
  return profiles.value.filter(p => p.name.toLowerCase().includes(q))
})

const filteredAssets = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return assets.value
  return assets.value.filter(a => a.name.toLowerCase().includes(q))
})

function laneStyle(lane: LaneDef): Record<string, string> {
  const palette: Record<string, string> = {
    CAR: '#4a5160',
    BIKE: '#3b8d56',
    BUS: '#a13c3c',
    TRAM: '#5c5750',
  }
  const color = palette[lane.type] ?? '#4a5160'
  return {
    flex: String(lane.width),
    background: color,
  }
}

function onSelectProfile(profile: CrossSectionProfile): void {
  (editor as unknown as { activeProfileId: string }).activeProfileId = profile.id
}

function onDragStart(ev: DragEvent, id: string): void {
  ev.dataTransfer?.setData('application/x-cross-section', id)
}

function onAssetDrag(ev: DragEvent, id: string): void {
  ev.dataTransfer?.setData('application/x-asset', id)
}

function toggleCollapse(): void {
  editor.setPanelState({ leftPanelOpen: !editor.panelState.leftPanelOpen })
}

onMounted(async () => {
  loading.value = true
  try {
    profiles.value = await templateApi.listCrossSections()
  } catch {
    profiles.value = []
  } finally {
    loading.value = false
  }
  loadingAssets.value = true
  try {
    assets.value = await templateApi.listAssets()
  } catch {
    assets.value = []
  } finally {
    loadingAssets.value = false
  }
})
</script>

<style scoped>
.left-panel {
  width: 280px;
  background: #1f232b;
  border-right: 1px solid #14171c;
  display: flex; flex-direction: column;
  color: #c8cdd5;
  transition: width 200ms ease;
  overflow: hidden;
}
.left-panel.collapsed { width: 0; border-right: none; }
.panel-tabs { display: flex; align-items: center; height: 36px; background: #181b21; border-bottom: 1px solid #14171c; }
.tab-btn { flex: 1; padding: 8px 0; background: transparent; border: none; color: #8e94a0; cursor: pointer; font-size: 12px; }
.tab-btn.active { color: #fff; border-bottom: 2px solid #4a8cd0; }
.collapse-btn { width: 28px; height: 100%; background: transparent; border: none; color: #8e94a0; cursor: pointer; }
.panel-search { padding: 8px; }
.panel-search input {
  width: 100%; box-sizing: border-box;
  padding: 5px 8px; background: #14171c; border: 1px solid #2a2f3a;
  border-radius: 4px; color: #d8dde6; font-size: 12px;
}
.panel-content { flex: 1; overflow-y: auto; padding: 4px 8px 12px; }
.placeholder { padding: 20px 8px; color: #6a7180; text-align: center; font-size: 12px; }
.asset-list { list-style: none; padding: 0; margin: 0; }
.asset-item {
  display: flex; gap: 8px; padding: 6px;
  border-radius: 5px; cursor: pointer;
  margin-bottom: 4px;
  border: 1px solid transparent;
}
.asset-item:hover { background: #262b35; }
.asset-item.active { background: #2c5d99; border-color: #4a8cd0; color: #fff; }
.asset-thumb { width: 70px; height: 40px; background: #14171c; border-radius: 3px; overflow: hidden; }
.section-preview { display: flex; height: 100%; }
.lane-strip { height: 100%; }
.asset-info { flex: 1; display: flex; flex-direction: column; justify-content: center; }
.asset-name { font-size: 13px; font-weight: 600; }
.asset-meta { font-size: 11px; color: #8e94a0; }
.asset-grid { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.asset-card { background: #262b35; border-radius: 5px; padding: 8px; text-align: center; cursor: pointer; }
.asset-card:hover { background: #313847; }
.asset-card-thumb { width: 100%; height: 50px; background: #1a1d24; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: #6cb6ff; font-weight: 700; }
.asset-card-name { margin-top: 6px; font-size: 11px; }
.layer-list { list-style: none; padding: 0; margin: 0; }
.layer-row { padding: 6px 4px; font-size: 13px; }
.layer-row label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
</style>
