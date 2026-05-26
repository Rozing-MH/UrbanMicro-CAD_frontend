<template>
  <aside class="right-panel" :class="{ collapsed: !editor.panelState.rightPanelOpen }">
    <div class="panel-tabs">
      <button class="collapse-btn" @click="toggleCollapse">›</button>
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="tab-btn"
        :class="{ active: editor.panelState.propertiesTab === tab.id }"
        @click="editor.setPanelState({ propertiesTab: tab.id })"
      >
        {{ tab.label }}
      </button>
    </div>

    <div class="panel-body">
      <div v-if="!selectedSegment && !selectedNode && !selectedLight" class="placeholder">
        请在视口中选择一个对象
      </div>

      <section v-else-if="selectedSegment" class="prop-group">
        <h3 class="prop-title">道路段</h3>
        <div class="prop-row">
          <label>ID</label>
          <span class="mono">{{ selectedSegment.id.slice(0, 8) }}…</span>
        </div>
        <div class="prop-row">
          <label>长度 (m)</label>
          <span>{{ selectedSegment.length.toFixed(1) }}</span>
        </div>
        <div class="prop-row">
          <label>是否曲线</label>
          <input
            type="checkbox"
            :checked="selectedSegment.isCurved"
            @change="updateSegment({ isCurved: ($event.target as HTMLInputElement).checked })"
          />
        </div>
        <div class="prop-row">
          <label>高程模式</label>
          <select :value="selectedSegment.elevation.mode" @change="onElevationModeChange">
            <option value="GROUND">地面</option>
            <option value="BRIDGE">桥梁</option>
            <option value="TUNNEL">隧道</option>
            <option value="ANARCHY">自由</option>
          </select>
        </div>
        <div class="prop-row">
          <label>起点高程</label>
          <input
            type="number"
            step="0.5"
            :value="selectedSegment.elevation.startZ"
            @change="onElevationStartChange"
          />
        </div>
        <div class="prop-row">
          <label>终点高程</label>
          <input
            type="number"
            step="0.5"
            :value="selectedSegment.elevation.endZ"
            @change="onElevationEndChange"
          />
        </div>

        <h4 class="sub-title">车道</h4>
        <ul class="lane-list">
          <li v-for="(lane, i) in selectedSegment.profile.lanes" :key="lane.id" class="lane-row">
            <span class="lane-idx">{{ i + 1 }}</span>
            <span class="lane-type">{{ lane.type }}</span>
            <span class="lane-dir">{{ directionLabel(lane.direction) }}</span>
            <span class="lane-w">{{ lane.width.toFixed(1) }} m</span>
          </li>
        </ul>

        <div class="prop-actions">
          <button class="danger-btn" @click="deleteSelected">删除该路段</button>
        </div>
      </section>

      <section v-else-if="selectedNode" class="prop-group">
        <h3 class="prop-title">节点</h3>
        <div class="prop-row">
          <label>ID</label>
          <span class="mono">{{ selectedNode.id.slice(0, 8) }}…</span>
        </div>
        <div class="prop-row">
          <label>位置</label>
          <span>({{ selectedNode.position.x.toFixed(1) }}, {{ selectedNode.position.y.toFixed(1) }})</span>
        </div>
        <div class="prop-row">
          <label>高程 (m)</label>
          <input
            type="number"
            step="0.5"
            :value="selectedNode.elevation"
            @change="onNodeElevationChange"
          />
        </div>
        <div class="prop-row">
          <label>控制方式</label>
          <select :value="selectedNode.controlMode" @change="onControlModeChange">
            <option value="NONE">无控</option>
            <option value="YIELD">让行</option>
            <option value="TRAFFIC_LIGHT">信号灯</option>
            <option value="ROUNDABOUT">环岛</option>
          </select>
        </div>
        <div class="prop-row">
          <label>连接段</label>
          <span>{{ selectedNode.connectedSegmentIds.length }} 条</span>
        </div>
      </section>

      <section v-else-if="selectedLight" class="prop-group">
        <h3 class="prop-title">信号灯控制器</h3>
        <div class="prop-row">
          <label>类型</label>
          <select :value="selectedLight.type" @change="onLightTypeChange">
            <option value="FIXED_TIME">固定时间</option>
            <option value="ADAPTIVE">自适应</option>
          </select>
        </div>
        <div class="prop-row">
          <label>周期 (s)</label>
          <input
            type="number"
            :value="selectedLight.cycleLength"
            @change="onCycleChange"
          />
        </div>
        <div class="prop-row">
          <label>阶段数</label>
          <span>{{ selectedLight.phases.length }}</span>
        </div>
      </section>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useEditorStateStore } from '@/stores/editorStateStore'
import { useRoadNetworkStore } from '@/stores/roadNetworkStore'
import { useTrafficRuleStore } from '@/stores/trafficRuleStore'
import type { ElevationMode, LaneDirection, RoadSegment } from '@/types/road-network'

const editor = useEditorStateStore()
const road = useRoadNetworkStore()
const rules = useTrafficRuleStore()

interface TabDef { id: string; label: string }
const tabs: TabDef[] = [
  { id: 'geometry', label: '几何' },
  { id: 'rules', label: '规则' },
  { id: 'simulation', label: '仿真' },
]

const selectedSegment = computed<RoadSegment | null>(() => {
  const id = Array.from(road.selectedSegmentIds)[0]
  if (!id) return null
  return road.segments.get(id) ?? null
})

const selectedNode = computed(() => {
  const id = Array.from(road.selectedNodeIds)[0]
  if (!id) return null
  return road.nodes.get(id) ?? null
})

const selectedLight = computed(() => {
  if (!rules.selectedLightId) return null
  return rules.trafficLights.get(rules.selectedLightId) ?? null
})

function toggleCollapse(): void {
  editor.setPanelState({ rightPanelOpen: !editor.panelState.rightPanelOpen })
}

function directionLabel(d: LaneDirection): string {
  return d === 'FORWARD' ? '→' : d === 'BACKWARD' ? '←' : '↔'
}

function updateSegment(patch: Partial<RoadSegment>): void {
  if (!selectedSegment.value) return
  road.updateSegment(selectedSegment.value.id, patch)
}

function onElevationModeChange(ev: Event): void {
  if (!selectedSegment.value) return
  const mode = (ev.target as HTMLSelectElement).value as ElevationMode
  road.updateSegment(selectedSegment.value.id, {
    elevation: { ...selectedSegment.value.elevation, mode },
  })
}

function onElevationStartChange(ev: Event): void {
  if (!selectedSegment.value) return
  const startZ = Number((ev.target as HTMLInputElement).value)
  road.updateSegment(selectedSegment.value.id, {
    elevation: { ...selectedSegment.value.elevation, startZ },
  })
}

function onElevationEndChange(ev: Event): void {
  if (!selectedSegment.value) return
  const endZ = Number((ev.target as HTMLInputElement).value)
  road.updateSegment(selectedSegment.value.id, {
    elevation: { ...selectedSegment.value.elevation, endZ },
  })
}

function deleteSelected(): void {
  if (!selectedSegment.value) return
  if (!confirm('确认删除选中的路段？')) return
  road.removeSegment(selectedSegment.value.id)
}

function onNodeElevationChange(ev: Event): void {
  if (!selectedNode.value) return
  const elevation = Number((ev.target as HTMLInputElement).value)
  road.updateNode(selectedNode.value.id, { elevation })
}

function onControlModeChange(ev: Event): void {
  if (!selectedNode.value) return
  const controlMode = (ev.target as HTMLSelectElement).value as 'NONE' | 'YIELD' | 'TRAFFIC_LIGHT' | 'ROUNDABOUT'
  road.updateNode(selectedNode.value.id, { controlMode })
}

function onLightTypeChange(ev: Event): void {
  if (!selectedLight.value) return
  const type = (ev.target as HTMLSelectElement).value as 'FIXED_TIME' | 'ADAPTIVE'
  rules.updateTrafficLight(selectedLight.value.id, { type })
}

function onCycleChange(ev: Event): void {
  if (!selectedLight.value) return
  const cycleLength = Number((ev.target as HTMLInputElement).value)
  rules.updateTrafficLight(selectedLight.value.id, { cycleLength })
}
</script>

<style scoped>
.right-panel {
  width: 320px;
  background: #1f232b;
  border-left: 1px solid #14171c;
  display: flex; flex-direction: column;
  color: #c8cdd5;
  transition: width 200ms ease;
  overflow: hidden;
}
.right-panel.collapsed { width: 0; border-left: none; }
.panel-tabs { display: flex; align-items: center; height: 36px; background: #181b21; border-bottom: 1px solid #14171c; }
.collapse-btn { width: 28px; height: 100%; background: transparent; border: none; color: #8e94a0; cursor: pointer; }
.tab-btn { flex: 1; padding: 8px 0; background: transparent; border: none; color: #8e94a0; cursor: pointer; font-size: 12px; }
.tab-btn.active { color: #fff; border-bottom: 2px solid #4a8cd0; }
.panel-body { flex: 1; overflow-y: auto; padding: 12px; }
.placeholder { padding: 24px 12px; color: #6a7180; text-align: center; font-size: 12px; }
.prop-group + .prop-group { margin-top: 16px; }
.prop-title { font-size: 13px; font-weight: 600; color: #6cb6ff; margin: 0 0 10px; padding-bottom: 6px; border-bottom: 1px solid #2a2f3a; }
.sub-title { font-size: 12px; color: #aab2bf; margin: 14px 0 6px; text-transform: uppercase; letter-spacing: 0.5px; }
.prop-row { display: flex; align-items: center; justify-content: space-between; padding: 4px 0; font-size: 12px; }
.prop-row label { color: #8e94a0; }
.prop-row input[type='number'], .prop-row select {
  width: 110px;
  padding: 3px 6px;
  background: #14171c; border: 1px solid #2a2f3a;
  color: #d8dde6; border-radius: 3px; font-size: 12px;
}
.lane-list { list-style: none; padding: 0; margin: 0; }
.lane-row { display: grid; grid-template-columns: 24px 1fr 30px 60px; gap: 6px; padding: 4px 0; font-size: 11px; border-bottom: 1px dashed #2a2f3a; }
.lane-idx { color: #6cb6ff; }
.lane-type { color: #d8dde6; }
.lane-dir { text-align: center; }
.lane-w { text-align: right; color: #aab2bf; }
.prop-actions { margin-top: 16px; }
.danger-btn {
  width: 100%; padding: 6px;
  background: #a13c3c; color: #fff; border: none; border-radius: 4px;
  cursor: pointer; font-size: 12px;
}
.danger-btn:hover { background: #b94a4a; }
.mono { font-family: ui-monospace, Menlo, Consolas, monospace; color: #aab2bf; }
</style>
