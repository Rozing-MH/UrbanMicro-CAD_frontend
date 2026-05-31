<template>
  <div class="top-toolbar">
    <div class="toolbar-section brand">
      <div class="logo"><MapIcon :size="18" /> UrbanMicro-CAD</div>
      <div v-if="project.currentProject" class="project-name">
        {{ project.currentProject.name }}
        <span v-if="project.isDirty" class="dirty-dot" title="未保存修改">●</span>
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
        <component :is="tool.icon" :size="16" class="tool-icon" />
        <span class="label">{{ tool.label }}</span>
      </button>
    </div>

    <div class="toolbar-section history">
      <button class="icon-btn" :disabled="!editor.canUndo" title="撤销 (Ctrl+Z)" @click="onUndo">
        <Undo2Icon :size="16" />
      </button>
      <button class="icon-btn" :disabled="!editor.canRedo" title="重做 (Ctrl+Y)" @click="onRedo">
        <Redo2Icon :size="16" />
      </button>
    </div>

    <div class="toolbar-section snap">
      <label class="snap-toggle">
        <input type="checkbox" :checked="editor.snapToGrid" @change="editor.toggleSnap()" />
        网格吸附
      </label>
      <label class="snap-toggle">
        <input type="checkbox" :checked="editor.snapToRoad" @change="editor.toggleRoadSnap()" />
        道路吸附
      </label>
      <label class="snap-toggle">
        <input type="checkbox" :checked="editor.showGrid" @change="editor.toggleGrid()" />
        显示网格
      </label>
      <label class="snap-toggle">
        <input type="checkbox" :checked="editor.continuousDrawing" @change="editor.toggleContinuousDrawing()" />
        连续绘制
      </label>
      <div v-if="editor.activeTool === 'ROAD_DRAW'" class="draw-mode-group">
        <button
          v-for="m in drawModes"
          :key="m.id"
          class="draw-mode-btn"
          :class="{ active: roadStore.drawingContext.mode === m.id }"
          :title="m.title"
          @click="roadStore.setDrawingMode(m.id)"
        >{{ m.label }}</button>
      </div>
      <div v-if="editor.activeTool === 'NODE_ADJUST'" class="draw-mode-group">
        <button
          v-for="m in gizmoModes"
          :key="m.id"
          class="draw-mode-btn"
          :class="{ active: nodeAdjustStore.gizmoMode === m.id }"
          :title="m.title"
          @click="nodeAdjustStore.setGizmoMode(m.id)"
        >
          <component :is="m.icon" :size="13" />
          {{ m.label }}
        </button>
      </div>
    </div>

    <div class="toolbar-section view-mode">
      <button
        v-for="mode in viewModes"
        :key="mode.id"
        class="mode-btn"
        :class="{ active: editor.viewMode === mode.id }"
        @click="editor.setViewMode(mode.id)"
      >
        <component :is="mode.icon" :size="14" />
        {{ mode.label }}
      </button>
    </div>

    <div class="toolbar-section actions">
      <button class="action-btn validate-btn" @click="onValidateRules">
        <ShieldCheckIcon :size="14" /> 检查规则
      </button>
      <button class="action-btn" :disabled="saving" @click="onSave">
        <SaveIcon :size="14" />
        {{ saving ? '保存中…' : '保存' }}
      </button>
      <button class="action-btn secondary" @click="showSnapshotDialog = true">
        <HistoryIcon :size="14" /> 历史版本
      </button>
      <button class="action-btn secondary" @click="onImport">
        <UploadIcon :size="14" /> 导入
      </button>
      <button class="action-btn secondary" @click="onExport">
        <DownloadIcon :size="14" /> 导出
      </button>
      <button class="action-btn" @click="onExit">
        <LogOutIcon :size="14" /> 退出
      </button>
    </div>

    <SnapshotListDialog
      :visible="showSnapshotDialog"
      @close="showSnapshotDialog = false"
      @rolled-back="showSnapshotDialog = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, type Component } from 'vue'
import { useRouter } from 'vue-router'
import {
  MapIcon,
  MousePointer2Icon,
  PencilIcon,
  ArrowUpIcon,
  GitForkIcon,
  Trash2Icon,
  Edit3Icon,
  HexagonIcon,
  TrafficConeIcon,
  RouteIcon,
  BanIcon,
  CornerUpRightIcon,
  NavigationIcon,
  MapPinIcon,
  RulerIcon,
  HandIcon,
  Undo2Icon,
  Redo2Icon,
  MoveIcon,
  RotateCwIcon,
  Maximize2Icon,
  PenToolIcon,
  PlayIcon,
  BarChart3Icon,
  ShieldCheckIcon,
  SaveIcon,
  HistoryIcon,
  UploadIcon,
  DownloadIcon,
  LogOutIcon,
} from '@lucide/vue'
import { useEditorStateStore, type ToolMode, type ViewMode } from '@/stores/editorStateStore'
import { useNodeAdjustmentStore, type GizmoMode } from '@/stores/nodeAdjustmentStore'
import { useProjectStore } from '@/stores/projectStore'
import { useRoadNetworkStore } from '@/stores/roadNetworkStore'
import { useTrafficRuleStore } from '@/stores/trafficRuleStore'
import { useSimulationStore } from '@/stores/simulationStore'
import { historyStack } from '@/commands/HistoryStack'
import { projectApi } from '@/api/projectApi'
import { useRuleValidation } from '@/composables/useRuleValidation'
import SnapshotListDialog from '@/components/panels/SnapshotListDialog.vue'

const router = useRouter()
const editor = useEditorStateStore()
const project = useProjectStore()
const roadStore = useRoadNetworkStore()
const ruleStore = useTrafficRuleStore()
const simStore = useSimulationStore()
const nodeAdjustStore = useNodeAdjustmentStore()
const { runValidation } = useRuleValidation()

const saving = ref(false)
const showSnapshotDialog = ref(false)

interface ToolDef { id: ToolMode; icon: Component; label: string; title: string }
const toolList: ToolDef[] = [
  { id: 'SELECT',           icon: MousePointer2Icon,    label: '选择',   title: '选择工具 (V)' },
  { id: 'ROAD_DRAW',        icon: PencilIcon,           label: '画路',   title: '绘制道路 (D)' },
  { id: 'ROAD_UPGRADE',     icon: ArrowUpIcon,          label: '升级',   title: '道路升级刷 (U)' },
  { id: 'PARALLEL_ROAD',    icon: GitForkIcon,          label: '平行',   title: '平行路 (P)' },
  { id: 'BULLDOZER',        icon: Trash2Icon,           label: '删除',   title: '推土机 (B)' },
  { id: 'ROAD_EDIT',        icon: Edit3Icon,            label: '编辑',   title: '编辑节点 (E)' },
  { id: 'NODE_ADJUST',      icon: HexagonIcon,          label: '边界',   title: '路口边界编辑 (N)' },
  { id: 'TRAFFIC_LIGHT',    icon: TrafficConeIcon,  label: '信号灯', title: '放置信号灯 (T)' },
  { id: 'LANE_CONNECTOR',   icon: RouteIcon,            label: '车道',   title: '车道连接 (L)' },
  { id: 'LANE_RESTRICTION', icon: BanIcon,              label: '限制',   title: '车道限制与标线 (R)' },
  { id: 'LANE_ARROW',       icon: CornerUpRightIcon,    label: '箭头',   title: '车道转向箭头 (A)' },
  { id: 'TURN_RESTRICTION', icon: NavigationIcon,       label: '转向',   title: '转向限制' },
  { id: 'OD_MARKER',        icon: MapPinIcon,           label: 'OD',     title: 'OD 标记 (O)' },
  { id: 'MEASURE',          icon: RulerIcon,            label: '测量',   title: '距离测量 (M)' },
  { id: 'PAN',              icon: HandIcon,             label: '平移',   title: '平移视图 (H)' },
]

interface ViewModeDef { id: ViewMode; icon: Component; label: string }
const viewModes: ViewModeDef[] = [
  { id: 'EDIT',       icon: PenToolIcon,   label: '编辑' },
  { id: 'SIMULATION', icon: PlayIcon,      label: '仿真' },
  { id: 'EVALUATION', icon: BarChart3Icon, label: '评估' },
]

interface DrawModeDef { id: 'STRAIGHT' | 'CURVE' | 'FREE'; label: string; title: string }
const drawModes: DrawModeDef[] = [
  { id: 'STRAIGHT', label: '直线', title: '直线绘路' },
  { id: 'CURVE', label: '曲线', title: '二次贝塞尔曲线绘路 (C)' },
  { id: 'FREE', label: '自由', title: '自由绘路（无角度约束）' },
]

interface GizmoModeDef { id: GizmoMode; icon: Component; label: string; title: string }
const gizmoModes: GizmoModeDef[] = [
  { id: 'TRANSLATE', icon: MoveIcon,      label: '平移', title: '平移模式' },
  { id: 'ROTATE',    icon: RotateCwIcon,  label: '旋转', title: '旋转模式' },
  { id: 'SCALE',     icon: Maximize2Icon, label: '缩放', title: '缩放模式' },
]

async function onUndo(): Promise<void> {
  const sessionId = editor.historySessionId
  if (sessionId === null) return
  try {
    await historyStack.undo(sessionId)
  } catch (err) {
    editor.setError(err instanceof Error ? err.message : '撤销失败')
  }
}

async function onRedo(): Promise<void> {
  const sessionId = editor.historySessionId
  if (sessionId === null) return
  try {
    await historyStack.redo(sessionId)
  } catch (err) {
    editor.setError(err instanceof Error ? err.message : '重做失败')
  }
}

const topology = computed(() => ({
  nodes: Array.from(roadStore.nodes.values()),
  segments: Array.from(roadStore.segments.values()),
  lanes: Array.from(roadStore.lanes.values()),
  laneArrows: Array.from(roadStore.laneArrows.values()),
  halfEdges: Array.from(roadStore.halfEdges.values()),
  version: roadStore.topologyVersion,
}))

function onValidateRules(): void {
  const result = runValidation()
  if (result.issues.length === 0) {
    editor.showNotification({ type: 'success', message: '所有规则验证通过', durationMs: 3000 })
  } else {
    const e = result.issues.filter(i => i.severity === 'error').length
    const w = result.issues.filter(i => i.severity === 'warning').length
    editor.showNotification({
      type: e > 0 ? 'error' : 'warning',
      message: `发现 ${e} 个错误，${w} 个警告`,
      durationMs: 4000,
    })
  }
}

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
    editor.showNotification({ type: 'success', message: '项目已保存', durationMs: 2500 })
  } catch (err) {
    editor.setError(err instanceof Error ? err.message : '保存失败')
  } finally {
    saving.value = false
  }
}

function onExport(): void {
  if (!project.currentProject) return
  try {
    const jsonStr = project.exportToJson()
    const blob = new Blob([jsonStr], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const now = new Date()
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    a.download = `${project.currentProject.name}_${dateStr}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    editor.showNotification({ type: 'success', message: '已导出工程文件', durationMs: 2500 })
  } catch (err) {
    editor.setError(err instanceof Error ? err.message : '导出失败')
  }
}

function onImport(): void {
  if (!project.currentProject) return
  if (project.isDirty && !confirm('导入将覆盖当前所有数据，未保存的修改将丢失。确认继续？')) return
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const jsonStr = reader.result as string
        project.importFromJson(jsonStr)
        editor.showNotification({ type: 'success', message: '已导入工程数据', durationMs: 3000 })
      } catch (err) {
        editor.setError(err instanceof Error ? err.message : '导入失败：文件格式无效')
      }
    }
    reader.onerror = () => {
      editor.setError('读取文件失败')
    }
    reader.readAsText(file)
    document.body.removeChild(input)
  }
  document.body.appendChild(input)
  input.click()
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
.brand .logo { display: flex; align-items: center; gap: 6px; font-weight: 700; letter-spacing: 0.5px; color: #6cb6ff; }
.project-name { margin-left: 12px; font-size: 13px; color: #aab2bf; }
.dirty-dot { color: #e3a857; margin-left: 4px; font-size: 10px; }
.tool-btn {
  display: flex; align-items: center; gap: 4px;
  padding: 4px 9px; border-radius: 5px;
  background: transparent; border: 1px solid transparent;
  color: #c8cdd5; cursor: pointer; font-size: 12px;
  white-space: nowrap;
}
.tool-btn:hover { background: #313847; }
.tool-btn.active { background: #2c5d99; border-color: #4a8cd0; color: #fff; }
.tool-btn .tool-icon { flex-shrink: 0; }
.icon-btn {
  display: flex; align-items: center; justify-content: center;
  width: 30px; height: 30px;
  background: transparent; border: 1px solid #383e4a; border-radius: 4px;
  color: #c8cdd5; cursor: pointer; padding: 0;
}
.icon-btn:hover:not(:disabled) { background: #313847; }
.icon-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.snap-toggle { display: flex; align-items: center; gap: 4px; font-size: 12px; color: #aab2bf; cursor: pointer; }
.draw-mode-group { display: flex; gap: 0; }
.draw-mode-btn {
  display: flex; align-items: center; gap: 3px;
  padding: 3px 8px; font-size: 11px;
  background: #1d2129; border: 1px solid #383e4a;
  color: #aab2bf; cursor: pointer;
}
.draw-mode-btn:first-child { border-radius: 3px 0 0 3px; }
.draw-mode-btn:last-child { border-radius: 0 3px 3px 0; }
.draw-mode-btn.active { background: #2c5d99; color: #fff; border-color: #4a8cd0; }
.mode-btn {
  display: flex; align-items: center; gap: 4px;
  padding: 5px 12px;
  background: #1d2129; border: 1px solid #383e4a; color: #c8cdd5;
  cursor: pointer; font-size: 12px;
}
.mode-btn:first-child { border-radius: 5px 0 0 5px; }
.mode-btn:last-child { border-radius: 0 5px 5px 0; }
.mode-btn.active { background: #2c5d99; color: #fff; border-color: #4a8cd0; }
.actions { margin-left: auto; }
.action-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 5px 14px; border-radius: 4px;
  background: #2c5d99; border: none; color: #fff;
  cursor: pointer; font-size: 12px; white-space: nowrap;
}
.action-btn + .action-btn { background: #4a5160; margin-left: 6px; }
.action-btn.secondary { background: #4a5160; }
.action-btn.secondary:hover { background: #5a6170; }
.validate-btn { background: #3a6e45; }
.validate-btn:hover { background: #468352; }
.action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
