<template>
  <aside class="left-panel" :class="{ collapsed: !editor.panelState.leftPanelOpen }">
    <div class="panel-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="tab-btn"
        :class="{ active: activeTab === tab.id }"
        :title="tab.title"
        @click="activeTab = tab.id"
      >
        <component :is="tab.icon" :size="14" />
        <span class="tab-label">{{ tab.label }}</span>
      </button>
      <button class="collapse-btn" @click="toggleCollapse" title="收起面板">
        <ChevronLeftIcon :size="14" />
      </button>
    </div>

    <div class="panel-search">
      <SearchIcon :size="14" class="search-icon" />
      <input v-model="search" type="text" placeholder="搜索…" />
    </div>

    <div v-if="activeTab === 'sections'" class="panel-content">
      <div class="editor-toggle-row">
        <button class="toggle-editor-btn" @click="toggleEditor">
          <component :is="csEditor.isEditing ? ChevronUpIcon : PlusCircleIcon" :size="14" />
          {{ csEditor.isEditing ? '收起编辑器' : '自定义断面' }}
        </button>
      </div>
      <CrossSectionEditor
        v-if="csEditor.isEditing"
        @close="csEditor.reset()"
      />
      <div v-if="loading" class="placeholder">
        <LoaderIcon :size="20" class="spin" />
        <span>加载中…</span>
      </div>
      <div v-else-if="filteredProfiles.length === 0" class="placeholder">
        <LayersIcon :size="20" />
        <span>暂无横断面模板</span>
      </div>
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
      <!-- Category filter -->
      <div v-if="assetCategories.length > 1" class="category-filter">
        <select v-model="selectedCategory" class="category-select">
          <option value="">全部分类</option>
          <option v-for="cat in assetCategories" :key="cat" :value="cat">{{ cat }}</option>
        </select>
      </div>
      <div v-if="loadingAssets" class="placeholder">
        <LoaderIcon :size="20" class="spin" />
        <span>加载中…</span>
      </div>
      <div v-else-if="filteredAssets.length === 0" class="placeholder">
        <PackageIcon :size="20" />
        <span>暂无资产</span>
      </div>
      <ul v-else class="asset-grid">
        <li v-for="a in filteredAssets" :key="a.id" class="asset-card" draggable="true" @dragstart="onAssetDrag($event, a.id)">
          <div class="asset-card-thumb">{{ a.category[0]?.toUpperCase() ?? '?' }}</div>
          <div class="asset-card-info">
            <div class="asset-card-name">{{ a.name }}</div>
            <div class="asset-card-meta">{{ a.category }}</div>
          </div>
          <button class="asset-load-btn" title="加载到当前工程" @click.stop="onLoadAsset(a.id, a.name)">
            <PlusIcon :size="14" />
          </button>
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

    <div v-else-if="activeTab === 'simulation'" class="panel-content">
      <div class="section-title"><MapPinIcon :size="13" /> OD 矩阵</div>
      <div v-if="sim.odMatrix.pairs.length === 0" class="placeholder small">
        <MapPinIcon :size="16" />
        <span>暂无 OD，点击添加</span>
      </div>
      <div v-for="(pair, index) in sim.odMatrix.pairs" :key="index" class="od-row">
        <input :value="pair.fromNodeId" placeholder="起点节点" @change="onODChange(index, 'fromNodeId', $event)" />
        <input :value="pair.toNodeId" placeholder="终点节点" @change="onODChange(index, 'toNodeId', $event)" />
        <input :value="pair.volumePerHour" type="number" min="0" step="10" @change="onODChange(index, 'volumePerHour', $event)" />
        <button class="od-remove-btn" title="删除" @click="sim.removeODPair(index)">
          <Trash2Icon :size="12" />
        </button>
      </div>
      <button class="wide-btn" @click="sim.addODPair()">
        <PlusIcon :size="14" /> 添加 OD
      </button>

      <div class="section-title"><SettingsIcon :size="13" /> IDM / MOBIL</div>
      <label class="param-row">
        <span>期望速度</span>
        <input type="number" step="0.5" :value="sim.idmParams.desiredSpeed" @change="onIDMChange('desiredSpeed', $event)" />
      </label>
      <label class="param-row">
        <span>安全时距</span>
        <input type="number" step="0.1" :value="sim.idmParams.safeTimeHeadway" @change="onIDMChange('safeTimeHeadway', $event)" />
      </label>
      <label class="param-row">
        <span>MOBIL 礼让</span>
        <input type="number" step="0.05" :value="sim.mobilParams.politenessFactor" @change="onMOBILChange('politenessFactor', $event)" />
      </label>
      <label class="param-row">
        <span>安全减速度</span>
        <input type="number" step="0.1" :value="sim.mobilParams.bSafe" @change="onMOBILChange('bSafe', $event)" />
      </label>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, type Component } from 'vue'
import {
  ChevronLeftIcon,
  ChevronUpIcon,
  SearchIcon,
  PlusCircleIcon,
  PlusIcon,
  LoaderIcon,
  LayersIcon,
  PackageIcon,
  MapPinIcon,
  SettingsIcon,
  Trash2Icon,
  RoadIcon,
  BoxIcon,
  EyeIcon,
  GaugeIcon,
} from '@lucide/vue'
import { useEditorStateStore } from '@/stores/editorStateStore'
import { useRoadNetworkStore } from '@/stores/roadNetworkStore'
import { useSimulationStore } from '@/stores/simulationStore'
import { useCrossSectionEditorStore } from '@/stores/crossSectionEditorStore'
import { templateApi } from '@/api/templateApi'
import { storeEventBus } from '@/stores/storeEventBus'
import { useProjectStore } from '@/stores/projectStore'
import { registerCrossSectionProfiles, getProfileById } from '@/utils/roadProfiles'
import type { CrossSectionProfile, LaneDef } from '@/types/road-network'
import CrossSectionEditor from './CrossSectionEditor.vue'
import type { IDMParams, MOBILParams, ODPair } from '@/types/simulation'

const editor = useEditorStateStore()
const road = useRoadNetworkStore()
const sim = useSimulationStore()
const csEditor = useCrossSectionEditorStore()

type TabId = 'sections' | 'assets' | 'layers' | 'simulation'
interface TabDef { id: TabId; icon: Component; label: string; title: string }
const tabs: TabDef[] = [
  { id: 'sections',   icon: RoadIcon,   label: '横断面', title: '横断面模板' },
  { id: 'assets',     icon: BoxIcon,    label: '资源',   title: '项目资源' },
  { id: 'layers',     icon: EyeIcon,    label: '图层',   title: '图层可见性' },
  { id: 'simulation', icon: GaugeIcon,  label: '仿真',   title: '仿真参数' },
]
const activeTab = ref<TabId>('sections')
const search = ref('')

const profiles = ref<CrossSectionProfile[]>([])
const loading = ref(false)
const assets = ref<Array<{ id: string; name: string; category: string; thumbnail: string }>>([])
const loadingAssets = ref(false)
const assetCategories = ref<string[]>([])
const selectedCategory = ref('')

const defaultProfiles: CrossSectionProfile[] = [
  {
    id: 'default-2lane',
    name: '默认双车道',
    lanes: [
      { id: 'l1', width: 3.5, type: 'CAR', direction: 'FORWARD' },
      { id: 'l2', width: 3.5, type: 'CAR', direction: 'BACKWARD' },
    ],
    median: { width: 0, type: 'NONE' },
    sidewalk: { leftWidth: 1.5, rightWidth: 1.5, hasCurb: true },
    totalWidth: 8,
  },
  {
    id: 'arterial-4lane-bus',
    name: '四车道公交干道',
    lanes: [
      { id: 'l1', width: 3.5, type: 'BUS', direction: 'FORWARD' },
      { id: 'l2', width: 3.5, type: 'CAR', direction: 'FORWARD' },
      { id: 'l3', width: 3.5, type: 'CAR', direction: 'BACKWARD' },
      { id: 'l4', width: 3.5, type: 'BUS', direction: 'BACKWARD' },
    ],
    median: { width: 1.5, type: 'GRASS' },
    sidewalk: { leftWidth: 2, rightWidth: 2, hasCurb: true },
    totalWidth: 19.5,
  },
]

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
  return assets.value.filter(a => {
    const matchSearch = !q || a.name.toLowerCase().includes(q)
    const matchCategory = !selectedCategory.value || a.category === selectedCategory.value
    return matchSearch && matchCategory
  })
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

function toggleEditor(): void {
  if (csEditor.isEditing) {
    csEditor.reset()
  } else {
    csEditor.startEditing(editor.activeProfileId ? getProfileById(editor.activeProfileId) : null)
  }
}

function onSelectProfile(profile: CrossSectionProfile): void {
  editor.setActiveProfile(profile.id)
  road.setActiveCrossSection(profile.id)
}

function onDragStart(ev: DragEvent, id: string): void {
  ev.dataTransfer?.setData('application/x-cross-section', id)
}

function onAssetDrag(ev: DragEvent, id: string): void {
  ev.dataTransfer?.setData('application/x-asset', id)
}

const projectStore = useProjectStore()

async function onLoadAsset(templateId: string, templateName: string): Promise<void> {
  const confirmed = window.confirm(`加载模板「${templateName}」将替换当前场景，未保存的修改将丢失。是否继续？`)
  if (!confirmed) return
  try {
    await projectStore.loadFromTemplate(templateId)
    editor.showNotification({ type: 'success', message: `已加载模板「${templateName}」` })
  } catch (err) {
    editor.showNotification({ type: 'error', message: err instanceof Error ? err.message : '模板加载失败' })
  }
}

function toggleCollapse(): void {
  editor.setPanelState({ leftPanelOpen: !editor.panelState.leftPanelOpen })
}

function eventNumber(ev: Event): number {
  return Number((ev.target as HTMLInputElement).value)
}

function eventString(ev: Event): string {
  return (ev.target as HTMLInputElement).value
}

function onODChange(index: number, field: keyof ODPair, ev: Event): void {
  const value = field === 'volumePerHour' ? eventNumber(ev) : eventString(ev)
  sim.updateODPair(index, { [field]: value } as Partial<ODPair>)
}

function onIDMChange(field: keyof IDMParams, ev: Event): void {
  sim.setIDMParams({ [field]: eventNumber(ev) } as Partial<IDMParams>)
}

function onMOBILChange(field: keyof MOBILParams, ev: Event): void {
  sim.setMOBILParams({ [field]: eventNumber(ev) } as Partial<MOBILParams>)
}

async function refreshProfiles(): Promise<void> {
  try {
    const list = await templateApi.listCrossSections()
    if (list.length > 0) {
      profiles.value = list
      registerCrossSectionProfiles(list)
    }
  } catch {
    // keep existing profiles on refresh failure
  }
}

function onTemplateSaved(): void {
  void refreshProfiles()
}

onMounted(async () => {
  loading.value = true
  try {
    profiles.value = await templateApi.listCrossSections()
  } catch {
    profiles.value = []
  } finally {
    if (profiles.value.length === 0) profiles.value = defaultProfiles
    registerCrossSectionProfiles(profiles.value)
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

  // Extract distinct categories from loaded assets
  const cats = new Set(assets.value.map(a => a.category).filter(Boolean))
  assetCategories.value = [...cats]

  // Subscribe to template-saved events to auto-refresh the list
  storeEventBus.on('cross-section:template-saved', onTemplateSaved)
})

onBeforeUnmount(() => {
  storeEventBus.off('cross-section:template-saved', onTemplateSaved)
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
.tab-btn {
  display: flex; align-items: center; justify-content: center; gap: 3px;
  flex: 1; padding: 8px 0; background: transparent; border: none;
  color: #8e94a0; cursor: pointer; font-size: 12px;
}
.tab-btn.active { color: #fff; border-bottom: 2px solid #4a8cd0; }
.tab-label { font-size: 11px; }
.collapse-btn {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 100%; background: transparent; border: none;
  color: #8e94a0; cursor: pointer; padding: 0;
}
.panel-search { position: relative; padding: 8px; }
.search-icon { position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: #6a7180; pointer-events: none; }
.panel-search input {
  width: 100%; box-sizing: border-box;
  padding: 5px 8px 5px 28px; background: #14171c; border: 1px solid #2a2f3a;
  border-radius: 4px; color: #d8dde6; font-size: 12px;
}
.panel-content { flex: 1; overflow-y: auto; padding: 4px 8px 12px; }
.placeholder {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 20px 8px; color: #6a7180; text-align: center; font-size: 12px;
}
.placeholder.small { flex-direction: row; gap: 4px; padding: 8px; }
.section-title {
  display: flex; align-items: center; gap: 5px;
  margin: 10px 0 6px; color: #6cb6ff; font-size: 12px; font-weight: 600;
}
.od-row { display: grid; grid-template-columns: 1fr 1fr 70px 24px; gap: 4px; margin-bottom: 5px; }
.od-row input,
.param-row input {
  min-width: 0;
  padding: 4px 6px; background: #14171c; border: 1px solid #2a2f3a;
  color: #d8dde6; border-radius: 3px; font-size: 11px;
}
.od-remove-btn {
  display: flex; align-items: center; justify-content: center;
  background: #2a2f3a; border: 1px solid #383e4a; color: #e06c6c;
  border-radius: 3px; cursor: pointer; padding: 0;
}
.od-remove-btn:hover { background: #3a1f1f; }
.wide-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  width: 100%; padding: 6px; margin: 4px 0 10px;
  background: #2a2f3a; border: 1px solid #383e4a; color: #d8dde6;
  border-radius: 3px; cursor: pointer; font-size: 11px;
}
.wide-btn:hover { background: #313847; }
.param-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 12px; color: #aab2bf; }
.param-row input { width: 90px; }
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
.asset-card { background: #262b35; border-radius: 5px; padding: 8px; cursor: pointer; display: flex; align-items: center; gap: 8px; position: relative; }
.asset-card:hover { background: #313847; }
.asset-card-thumb { width: 36px; height: 36px; min-width: 36px; background: #1a1d24; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: #6cb6ff; font-weight: 700; font-size: 14px; }
.asset-card-info { flex: 1; min-width: 0; }
.asset-card-name { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.asset-card-meta { font-size: 10px; color: #8892a4; margin-top: 2px; }
.asset-load-btn { background: none; border: 1px solid #3d4455; border-radius: 4px; color: #6cb6ff; cursor: pointer; padding: 3px 5px; display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.15s; }
.asset-card:hover .asset-load-btn { opacity: 1; }
.asset-load-btn:hover { background: #2d3548; border-color: #6cb6ff; }
.category-filter { margin-bottom: 8px; }
.category-select { width: 100%; background: #262b35; color: #c8cdd5; border: 1px solid #3d4455; border-radius: 4px; padding: 5px 8px; font-size: 12px; outline: none; }
.category-select:focus { border-color: #6cb6ff; }
.layer-list { list-style: none; padding: 0; margin: 0; }
.layer-row { padding: 6px 4px; font-size: 13px; }
.layer-row label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.editor-toggle-row { margin-bottom: 6px; }
.toggle-editor-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  width: 100%; padding: 6px; background: #2c5d99; border: none;
  color: #fff; border-radius: 3px; cursor: pointer; font-size: 12px;
}
.toggle-editor-btn:hover { background: #3a6eaa; }
@keyframes spin { to { transform: rotate(360deg); } }
.spin { animation: spin 1s linear infinite; }
</style>
