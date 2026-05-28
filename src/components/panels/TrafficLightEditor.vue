<template>
  <div class="light-editor">
    <div class="prop-row">
      <label>策略</label>
      <select :value="light.strategy" @change="onStrategyChange">
        <option value="FIXED">固定时间</option>
        <option value="ACTUATED">感应控制</option>
      </select>
    </div>
    <div class="prop-row">
      <label>周期 (s)</label>
      <span>{{ cycleLength.toFixed(1) }}</span>
    </div>

    <div class="steps-header">
      <h4 class="sub-title">步阶列表</h4>
      <button class="add-step-btn" @click="addStep">+ 添加步阶</button>
    </div>

    <div v-if="light.steps.length === 0" class="no-steps">暂无步阶</div>

    <div v-for="(step, i) in light.steps" :key="step.id" class="step-card">
      <div class="step-header">
        <span class="step-idx">步阶 {{ i + 1 }}</span>
        <button v-if="light.steps.length > 1" class="step-remove" @click="removeStep(step.id)">✕</button>
      </div>

      <div class="step-field">
        <label>绿灯车道</label>
        <div class="lane-chips">
          <label v-for="lane in nodeLanes" :key="lane.id" class="lane-chip" :class="{ active: step.greenLanes.includes(lane.id) }">
            <input
              type="checkbox"
              :checked="step.greenLanes.includes(lane.id)"
              @change="toggleGreenLane(step, lane.id)"
            />
            {{ lane.index + 1 }}
          </label>
          <span v-if="nodeLanes.length === 0" class="no-lanes">无车道</span>
        </div>
      </div>

      <div class="step-row">
        <div class="step-field compact">
          <label>最小绿灯 (s)</label>
          <input type="number" min="5" max="120" step="1" :value="step.minGreenTime" @change="onStepTimeChange(step, 'minGreenTime', $event)" />
        </div>
        <div class="step-field compact">
          <label>最大绿灯 (s)</label>
          <input type="number" min="5" max="180" step="1" :value="step.maxGreenTime" @change="onStepTimeChange(step, 'maxGreenTime', $event)" />
        </div>
      </div>
      <div class="step-row">
        <div class="step-field compact">
          <label>黄灯 (s)</label>
          <input type="number" min="1" max="10" step="0.5" :value="step.yellowTime" @change="onStepTimeChange(step, 'yellowTime', $event)" />
        </div>
        <div class="step-field compact">
          <label>全红 (s)</label>
          <input type="number" min="0" max="5" step="0.5" :value="step.allRedTime" @change="onStepTimeChange(step, 'allRedTime', $event)" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoadNetworkStore } from '@/stores/roadNetworkStore'
import { useEditorStateStore } from '@/stores/editorStateStore'
import { historyStack, type HistorySessionId } from '@/commands/HistoryStack'
import {
  AddSignalStepCommand,
  RemoveSignalStepCommand,
  UpdateTrafficLightCommand,
} from '@/commands/roadCommands'
import type { SignalStep, TrafficLightController } from '@/types/traffic-rule'
import type { Lane } from '@/types/road-network'

const props = defineProps<{
  light: TrafficLightController
}>()

const road = useRoadNetworkStore()
const editor = useEditorStateStore()

const cycleLength = computed(() =>
  props.light.steps.reduce((sum, s) => sum + s.minGreenTime + s.yellowTime + s.allRedTime, 0),
)

const nodeLanes = computed<Lane[]>(() => {
  const node = road.getNode(props.light.nodeId)
  if (!node) return []
  const laneIds = new Set<string>()
  for (const segId of node.connectedSegmentIds) {
    for (const id of road.getSegmentLaneIds(segId)) laneIds.add(id)
  }
  return Array.from(road.lanes.values()).filter((l) => laneIds.has(l.id))
})

function isCurrentSession(sessionId: HistorySessionId): boolean {
  return editor.historySessionId === sessionId && historyStack.isSessionActive(sessionId)
}

async function exec(cmd: Parameters<typeof historyStack.execute>[0]): Promise<void> {
  const sid = editor.historySessionId
  if (sid === null || !isCurrentSession(sid)) return
  try {
    await historyStack.execute(cmd, sid)
  } catch (err) {
    editor.showNotification({ type: 'error', message: err instanceof Error ? err.message : '操作失败' })
  }
}

function onStrategyChange(ev: Event): void {
  const strategy = (ev.target as HTMLSelectElement).value as 'FIXED' | 'ACTUATED'
  void exec(new UpdateTrafficLightCommand(props.light.id, { strategy }))
}

function genId(): string {
  return `step_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

function addStep(): void {
  void exec(new AddSignalStepCommand(props.light.id, {
    id: `${props.light.id}:${genId()}`,
    greenLanes: [],
    minGreenTime: 30,
    maxGreenTime: 60,
    yellowTime: 3,
    allRedTime: 2,
    sensorBindings: [],
  }))
}

function removeStep(stepId: string): void {
  void exec(new RemoveSignalStepCommand(props.light.id, stepId))
}

function toggleGreenLane(step: SignalStep, laneId: string): void {
  const greenLanes = step.greenLanes.includes(laneId)
    ? step.greenLanes.filter((id) => id !== laneId)
    : [...step.greenLanes, laneId]
  const updatedSteps = props.light.steps.map((s) =>
    s.id === step.id ? { ...s, greenLanes } : s,
  )
  void exec(new UpdateTrafficLightCommand(props.light.id, { steps: updatedSteps }))
}

function onStepTimeChange(
  step: SignalStep,
  field: 'minGreenTime' | 'maxGreenTime' | 'yellowTime' | 'allRedTime',
  ev: Event,
): void {
  const raw = (ev.target as HTMLInputElement).value.trim()
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) {
    editor.showNotification({ type: 'warning', message: '请输入有效正数' })
    return
  }
  const updatedSteps = props.light.steps.map((s) =>
    s.id === step.id ? { ...s, [field]: value } : s,
  )
  void exec(new UpdateTrafficLightCommand(props.light.id, { steps: updatedSteps }))
}
</script>

<style scoped>
.light-editor { display: flex; flex-direction: column; gap: 8px; }
.prop-row { display: flex; align-items: center; justify-content: space-between; padding: 4px 0; font-size: 12px; }
.prop-row label { color: #8e94a0; }
.prop-row select, .prop-row span { color: #d8dde6; font-size: 12px; }
.prop-row select {
  width: 110px; padding: 3px 6px;
  background: #14171c; border: 1px solid #2a2f3a;
  color: #d8dde6; border-radius: 3px; font-size: 12px;
}
.steps-header { display: flex; align-items: center; justify-content: space-between; }
.sub-title { font-size: 12px; color: #aab2bf; margin: 10px 0 6px; text-transform: uppercase; letter-spacing: 0.5px; }
.add-step-btn {
  padding: 3px 10px; background: #2c5d99; border: none; border-radius: 3px;
  color: #fff; font-size: 11px; cursor: pointer;
}
.add-step-btn:hover { background: #3670b8; }
.no-steps { font-size: 11px; color: #6a7180; margin: 4px 0; }
.step-card {
  background: #181b21; border: 1px solid #2a2f3a; border-radius: 4px;
  padding: 8px; margin-bottom: 6px;
}
.step-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.step-idx { font-size: 12px; font-weight: 600; color: #6cb6ff; }
.step-remove { background: transparent; border: none; color: #a13c3c; cursor: pointer; font-size: 12px; padding: 0 4px; }
.step-remove:hover { color: #e05050; }
.step-field { margin-bottom: 4px; }
.step-field label { display: block; font-size: 11px; color: #8e94a0; margin-bottom: 2px; }
.step-field input[type='number'] {
  width: 100%; padding: 3px 6px;
  background: #14171c; border: 1px solid #2a2f3a;
  color: #d8dde6; border-radius: 3px; font-size: 11px;
  box-sizing: border-box;
}
.step-row { display: flex; gap: 6px; }
.step-row .compact { flex: 1; }
.lane-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.lane-chip {
  display: flex; align-items: center; gap: 2px;
  padding: 2px 6px; border-radius: 3px; font-size: 11px;
  background: #14171c; border: 1px solid #2a2f3a;
  color: #8e94a0; cursor: pointer;
}
.lane-chip.active { background: #1a3a5c; border-color: #4a8cd0; color: #6cb6ff; }
.lane-chip input { display: none; }
.no-lanes { font-size: 11px; color: #6a7180; }
</style>
