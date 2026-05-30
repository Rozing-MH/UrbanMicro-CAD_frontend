<template>
  <footer class="bottom-timeline" :class="{ collapsed: !editor.panelState.bottomPanelOpen }">
    <div class="timeline-header">
      <button class="collapse-btn" @click="toggleCollapse">{{ editor.panelState.bottomPanelOpen ? '▼' : '▲' }}</button>
      <div class="title">仿真控制</div>
      <div class="state-badge" :class="stateClass">{{ stateLabel }}</div>

      <div class="controls">
        <button class="ctrl-btn" :disabled="sim.state === 'RUNNING'" @click="onPlay">▶</button>
        <button class="ctrl-btn" :disabled="sim.state !== 'RUNNING'" @click="onPause">❚❚</button>
        <button class="ctrl-btn" @click="onReset">⟲</button>
      </div>

      <div class="speed-control">
        <label>速率</label>
        <select :value="sim.timeScale" @change="onSpeedChange">
          <option :value="0.5">0.5×</option>
          <option :value="1">1×</option>
          <option :value="2">2×</option>
          <option :value="4">4×</option>
          <option :value="8">8×</option>
        </select>
      </div>

      <div class="view-switch">
        <button class="view-btn" :class="{ active: evalStore.evalMode === 'DENSITY' }" @click="setEvalDensity">流量</button>
        <button class="view-btn" :class="{ active: evalStore.evalMode === 'SPEED' }" @click="setEvalSpeed">速度</button>
        <button class="view-btn" :class="{ active: evalStore.evalMode === 'DELAY' }" @click="setEvalDelay">延误</button>
        <button class="view-btn" :class="{ active: evalStore.evalMode === 'LOS' }" @click="setEvalLOS">LOS</button>
        <button class="view-btn" :class="{ active: evalStore.evalMode === 'NONE' }" @click="setHiddenView">隐藏</button>
      </div>

      <div class="time-display">
        <span class="mono">{{ formatTime(sim.currentTime) }}</span>
        <span class="sep">/</span>
        <span class="mono dim">{{ formatTime(sim.simulatedDuration) }}</span>
      </div>
    </div>

    <div class="timeline-track" @click="onSeek">
      <div class="track-bg"></div>
      <div class="track-fill" :style="{ width: `${sim.progress * 100}%` }"></div>
      <div class="track-marker" :style="{ left: `${sim.progress * 100}%` }"></div>
    </div>

    <div v-show="editor.panelState.bottomPanelOpen" class="stats-row">
      <div class="stat">
        <div class="stat-label">在线车辆</div>
        <div class="stat-value">{{ sim.vehicleCount }}</div>
      </div>
      <div class="stat">
        <div class="stat-label">已完成</div>
        <div class="stat-value">{{ sim.stats.completedVehicles }}</div>
      </div>
      <div class="stat">
        <div class="stat-label">平均车速 (m/s)</div>
        <div class="stat-value">{{ sim.stats.averageSpeed.toFixed(2) }}</div>
      </div>
      <div class="stat">
        <div class="stat-label">平均延误 (s)</div>
        <div class="stat-value">{{ sim.stats.averageDelay.toFixed(1) }}</div>
      </div>
      <div class="stat">
        <div class="stat-label">最大排队</div>
        <div class="stat-value">{{ sim.stats.maxQueueLength }}</div>
      </div>
      <div class="stat">
        <div class="stat-label">吞吐量</div>
        <div class="stat-value">{{ sim.stats.throughput.toFixed(0) }}</div>
      </div>
      <div v-if="evalStore.networkLOS" class="stat los">
        <div class="stat-label">路网 LOS</div>
        <div class="stat-value los-grade" :data-grade="evalStore.networkLOS">{{ evalStore.networkLOS }}</div>
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useSimulationStore } from '@/stores/simulationStore'
import { useEditorStateStore } from '@/stores/editorStateStore'
import { useEvaluationStore } from '@/stores/evaluationStore'
import { useRoadNetworkStore } from '@/stores/roadNetworkStore'
import { useTrafficRuleStore } from '@/stores/trafficRuleStore'

const sim = useSimulationStore()
const editor = useEditorStateStore()
const evalStore = useEvaluationStore()
const road = useRoadNetworkStore()
const rules = useTrafficRuleStore()

const stateLabel = computed(() => {
  switch (sim.state) {
    case 'IDLE': return '空闲'
    case 'RUNNING': return '运行中'
    case 'PAUSED': return '已暂停'
    case 'FINISHED': return '已结束'
    default: return ''
  }
})

const stateClass = computed(() => ({
  idle: sim.state === 'IDLE',
  running: sim.state === 'RUNNING',
  paused: sim.state === 'PAUSED',
  finished: sim.state === 'FINISHED',
}))

function formatTime(seconds: number): string {
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

function toggleCollapse(): void {
  editor.setPanelState({ bottomPanelOpen: !editor.panelState.bottomPanelOpen })
}

async function onPlay(): Promise<void> {
  await sim.start(road.serialize(), rules.serialize(sim.odMatrix, sim.vehicleMix))
}

async function onPause(): Promise<void> {
  await sim.pause()
}

async function onReset(): Promise<void> {
  await sim.stop()
}

function onSpeedChange(ev: Event): void {
  const v = Number((ev.target as HTMLSelectElement).value)
  sim.setTimeScale(v)
}

function onSeek(ev: MouseEvent): void {
  const target = ev.currentTarget as HTMLDivElement
  const rect = target.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width))
  sim.setCurrentTime(ratio * sim.simulatedDuration)
}

function setEvalDensity(): void {
  editor.setViewMode('TRAFFIC_VOLUME')
  evalStore.setEvalMode('DENSITY')
  evalStore.setHeatmapConfig({ mode: 'CONGESTION' })
}

function setEvalSpeed(): void {
  editor.setViewMode('TRAFFIC_VOLUME')
  evalStore.setEvalMode('SPEED')
  evalStore.setHeatmapConfig({ mode: 'SPEED' })
}

function setEvalDelay(): void {
  editor.setViewMode('TRAFFIC_VOLUME')
  evalStore.setEvalMode('DELAY')
  evalStore.setHeatmapConfig({ mode: 'CONGESTION' })
}

function setEvalLOS(): void {
  editor.setViewMode('TRAFFIC_VOLUME')
  evalStore.setEvalMode('LOS')
}

function setHiddenView(): void {
  editor.setViewMode('EDIT')
  evalStore.setEvalMode('NONE')
  evalStore.setHeatmapConfig({ mode: 'OFF' })
}
</script>

<style scoped>
.bottom-timeline {
  background: #1f232b;
  border-top: 1px solid #14171c;
  color: #c8cdd5;
  display: flex; flex-direction: column;
  transition: height 200ms ease;
}
.bottom-timeline.collapsed .timeline-track { display: none; }
.timeline-header {
  display: flex; align-items: center; gap: 14px;
  padding: 6px 14px; height: 36px;
  background: #181b21; border-bottom: 1px solid #14171c;
}
.collapse-btn { width: 24px; height: 24px; background: transparent; border: none; color: #8e94a0; cursor: pointer; font-size: 11px; }
.title { font-size: 13px; font-weight: 600; color: #d8dde6; }
.state-badge {
  padding: 2px 8px; border-radius: 10px;
  font-size: 11px; font-weight: 600;
  background: #2a2f3a; color: #aab2bf;
}
.state-badge.running { background: #2b7d4f; color: #fff; }
.state-badge.paused { background: #b07d2c; color: #fff; }
.state-badge.finished { background: #4a5160; color: #fff; }
.controls { display: flex; gap: 4px; }
.ctrl-btn {
  width: 30px; height: 26px;
  background: #2a2f3a; border: 1px solid #383e4a;
  color: #d8dde6; border-radius: 4px; cursor: pointer; font-size: 12px;
}
.ctrl-btn:hover:not(:disabled) { background: #313847; }
.ctrl-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.speed-control { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #8e94a0; }
.speed-control select {
  background: #14171c; border: 1px solid #2a2f3a; color: #d8dde6;
  padding: 3px 6px; border-radius: 3px; font-size: 12px;
}
.view-switch { display: flex; align-items: center; gap: 4px; }
.view-btn {
  padding: 4px 8px;
  background: #1d2129; border: 1px solid #383e4a; color: #c8cdd5;
  border-radius: 3px; cursor: pointer; font-size: 11px;
}
.view-btn.active { background: #2c5d99; color: #fff; border-color: #4a8cd0; }
.time-display { margin-left: auto; font-size: 13px; }
.mono { font-family: ui-monospace, Menlo, Consolas, monospace; }
.dim { color: #6a7180; }
.sep { margin: 0 6px; color: #6a7180; }
.timeline-track {
  position: relative; height: 16px;
  background: transparent; cursor: pointer;
}
.track-bg, .track-fill {
  position: absolute; top: 7px; left: 0; height: 2px; border-radius: 2px;
}
.track-bg { width: 100%; background: #2a2f3a; }
.track-fill { background: #4a8cd0; }
.track-marker {
  position: absolute; top: 4px; width: 8px; height: 8px;
  background: #6cb6ff; border-radius: 50%;
  transform: translateX(-4px);
}
.stats-row {
  display: flex; gap: 24px;
  padding: 10px 14px;
  background: #14171c;
  overflow-x: auto;
}
.stat { min-width: 70px; }
.stat-label { font-size: 11px; color: #8e94a0; }
.stat-value { font-size: 16px; font-weight: 600; color: #d8dde6; margin-top: 2px; }
.los-grade { font-family: ui-monospace, Menlo, Consolas, monospace; padding: 1px 6px; border-radius: 3px; display: inline-block; }
.los-grade[data-grade='A'] { background: #2ecc71; color: #fff; }
.los-grade[data-grade='B'] { background: #58c177; color: #fff; }
.los-grade[data-grade='C'] { background: #f1c40f; color: #1f232b; }
.los-grade[data-grade='D'] { background: #e67e22; color: #fff; }
.los-grade[data-grade='E'] { background: #e74c3c; color: #fff; }
.los-grade[data-grade='F'] { background: #c0392b; color: #fff; }
</style>
