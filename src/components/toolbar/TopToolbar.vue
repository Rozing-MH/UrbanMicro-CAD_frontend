<template>
  <div class="top-toolbar">
    <div class="toolbar-section brand">
      <div class="logo">UrbanMicro-CAD</div>
      <div v-if="project.currentProject" class="project-name">
        {{ project.currentProject.name }}
        <span v-if="project.isDirty" class="dirty-dot" title="未保存修改">•</span>
      </div>
    </div>

    <div class="toolbar-section tools">
      <button
        v-for="tool in toolList"
        :key="tool.id"
        class="tool-btn"
        :class="{ active: editor.activeTool === tool.id }"
        :title="tool.title"
        @click="editor.setActiveTool(tool.id)"
      >
        <span class="icon">{{ tool.icon }}</span>
        <span class="label">{{ tool.label }}</span>
      </button>
    </div>

    <div class="toolbar-section history">
      <button class="icon-btn" :disabled="!editor.canUndo" title="撤销 (Ctrl+Z)" @click="onUndo">↶</button>
      <button class="icon-btn" :disabled="!editor.canRedo" title="重做 (Ctrl+Y)" @click="onRedo">↷</button>
    </div>

    <div class="toolbar-section snap">
      <label class="snap-toggle">
        <input type="checkbox" :checked="editor.snapToGrid" @change="editor.toggleSnap()" />
        网格吸附
      </label>
      <label class="snap-toggle">
        <input type="checkbox" :checked="editor.showGrid" @change="editor.toggleGrid()" />
        显示网格
      </label>
      <label class="snap-toggle">
        <input type="checkbox" :checked="editor.continuousDrawing" @change="editor.toggleContinuousDrawing()" />
        连续绘制
      </label>
    </div>

    <div class="toolbar-section view-mode">
      <button
        v-for="mode in viewModes"
        :key="mode.id"
        class="mode-btn"
        :class="{ active: editor.viewMode === mode.id }"
        @click="editor.setViewMode(mode.id)"
      >
        {{ mode.label }}
      </button>
    </div>

    <div class="toolbar-section actions">
      <button class="action-btn" :disabled="saving" @click="onSave">
        {{ saving ? '保存中…' : '保存' }}
      </button>
      <button class="action-btn" @click="onExit">退出</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useEditorStateStore, type ToolMode, type ViewMode } from '@/stores/editorStateStore'
import { useProjectStore } from '@/stores/projectStore'
import { useRoadNetworkStore } from '@/stores/roadNetworkStore'
import { useTrafficRuleStore } from '@/stores/trafficRuleStore'
import { useSimulationStore } from '@/stores/simulationStore'
import { historyStack } from '@/commands/HistoryStack'
import { projectApi } from '@/api/projectApi'

const router = useRouter()
const editor = useEditorStateStore()
const project = useProjectStore()
const roadStore = useRoadNetworkStore()
const ruleStore = useTrafficRuleStore()
const simStore = useSimulationStore()

const saving = ref(false)

interface ToolDef { id: ToolMode; icon: string; label: string; title: string }
const toolList: ToolDef[] = [
  { id: 'SELECT',          icon: '⬚', label: '选择',   title: '选择工具' },
  { id: 'ROAD_DRAW',       icon: '✎', label: '画路',   title: '绘制道路' },
  { id: 'ROAD_UPGRADE',    icon: '⇧', label: '升级',   title: '道路升级刷' },
  { id: 'PARALLEL_ROAD',   icon: '∥', label: '平行',   title: '平行路' },
  { id: 'BULLDOZER',       icon: '⌫', label: '删除',   title: '推土机' },
  { id: 'ROAD_EDIT',       icon: '◆', label: '编辑',   title: '编辑节点' },
  { id: 'TRAFFIC_LIGHT',   icon: '🚦', label: '信号灯', title: '放置信号灯' },
  { id: 'LANE_CONNECTOR',  icon: '↪', label: '车道',   title: '车道连接' },
  { id: 'LANE_RESTRICTION', icon: '⊘', label: '限制',   title: '车道限制与标线' },
  { id: 'LANE_ARROW',      icon: '↱', label: '箭头',   title: '车道转向箭头' },
  { id: 'OD_MARKER',       icon: '⊕', label: 'OD',     title: 'OD 标记' },
  { id: 'MEASURE',         icon: '📏', label: '测量',   title: '距离测量' },
  { id: 'PAN',             icon: '✋', label: '平移',   title: '平移视图' },
]

interface ViewModeDef { id: ViewMode; label: string }
const viewModes: ViewModeDef[] = [
  { id: 'EDIT', label: '编辑' },
  { id: 'SIMULATION', label: '仿真' },
  { id: 'EVALUATION', label: '评估' },
]

async function onUndo(): Promise<void> {
  await historyStack.undo()
}

async function onRedo(): Promise<void> {
  await historyStack.redo()
}

const topology = computed(() => ({
  nodes: Array.from(roadStore.nodes.values()),
  segments: Array.from(roadStore.segments.values()),
  lanes: Array.from(roadStore.lanes.values()),
  laneArrows: Array.from(roadStore.laneArrows.values()),
  halfEdges: Array.from(roadStore.halfEdges.values()),
  version: roadStore.topologyVersion,
}))

async function onSave(): Promise<void> {
  if (!project.currentProject || saving.value) return
  saving.value = true
  try {
    await projectApi.save(project.currentProject.id, {
      meta: project.currentProject,
      topology: topology.value,
      rules: ruleStore.serialize(simStore.odMatrix, simStore.vehicleMix),
      odMatrix: simStore.odMatrix,
    })
    project.markSaved()
  } catch (err) {
    editor.setError(err instanceof Error ? err.message : '保存失败')
  } finally {
    saving.value = false
  }
}

function onExit(): void {
  if (project.isDirty) {
    if (!confirm('当前项目有未保存的修改，确认退出？')) return
  }
  void router.push('/dashboard')
}
</script>

<style scoped>
.top-toolbar {
  display: flex;
  align-items: center;
  height: 48px;
  padding: 0 12px;
  background: linear-gradient(180deg, #2a2f3a 0%, #232831 100%);
  border-bottom: 1px solid #14171c;
  color: #d8dde6;
  gap: 16px;
  user-select: none;
}
.toolbar-section { display: flex; align-items: center; gap: 6px; }
.toolbar-section + .toolbar-section { border-left: 1px solid #383e4a; padding-left: 12px; }
.brand .logo { font-weight: 700; letter-spacing: 0.5px; color: #6cb6ff; }
.project-name { margin-left: 12px; font-size: 13px; color: #aab2bf; }
.dirty-dot { color: #e3a857; margin-left: 4px; }
.tool-btn {
  display: flex; align-items: center; gap: 4px;
  padding: 4px 9px; border-radius: 5px;
  background: transparent; border: 1px solid transparent;
  color: #c8cdd5; cursor: pointer; font-size: 12px;
}
.tool-btn:hover { background: #313847; }
.tool-btn.active { background: #2c5d99; border-color: #4a8cd0; color: #fff; }
.tool-btn .icon { font-size: 15px; }
.icon-btn {
  width: 30px; height: 30px;
  background: transparent; border: 1px solid #383e4a; border-radius: 4px;
  color: #c8cdd5; cursor: pointer; font-size: 16px;
}
.icon-btn:hover:not(:disabled) { background: #313847; }
.icon-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.snap-toggle { display: flex; align-items: center; gap: 4px; font-size: 12px; color: #aab2bf; cursor: pointer; }
.mode-btn {
  padding: 5px 12px;
  background: #1d2129; border: 1px solid #383e4a; color: #c8cdd5;
  cursor: pointer; font-size: 12px;
}
.mode-btn:first-child { border-radius: 5px 0 0 5px; }
.mode-btn:last-child { border-radius: 0 5px 5px 0; }
.mode-btn.active { background: #2c5d99; color: #fff; border-color: #4a8cd0; }
.actions { margin-left: auto; }
.action-btn {
  padding: 5px 14px; border-radius: 4px;
  background: #2c5d99; border: none; color: #fff;
  cursor: pointer; font-size: 12px;
}
.action-btn + .action-btn { background: #4a5160; margin-left: 6px; }
.action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
