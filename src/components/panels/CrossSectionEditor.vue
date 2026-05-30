<template>
  <div class="cross-section-editor">
    <div class="editor-header">
      <span class="editor-title">自定义断面</span>
      <button class="icon-btn" title="收起" @click="$emit('close')">✕</button>
    </div>

    <div class="editor-preview">
      <div class="section-preview">
        <div
          v-for="(lane, i) in workingLanes"
          :key="i"
          class="lane-strip"
          :class="{ selected: selectedIndex === i }"
          :style="laneStyle(lane)"
          :title="`${lane.direction} ${lane.type} ${lane.width}m`"
          @click="onSelectLane(i)"
        ></div>
      </div>
      <div class="width-label">总宽 {{ totalWidth.toFixed(1) }} m · {{ workingLanes.length }} 车道 · 正向{{ editorStore.getForwardLaneCount() }} 反向{{ editorStore.getBackwardLaneCount() }}</div>
    </div>

    <div class="lane-editor" v-if="selectedIndex >= 0 && selectedIndex < workingLanes.length">
      <div class="section-title">车道 #{{ selectedIndex + 1 }}</div>
      <label class="param-row">
        <span>方向</span>
        <select :value="workingLanes[selectedIndex].direction" @change="onLaneField('direction', ($event.target as HTMLSelectElement).value)">
          <option value="FORWARD">正向</option>
          <option value="BACKWARD">反向</option>
          <option value="BOTH">双向</option>
        </select>
      </label>
      <label class="param-row">
        <span>类型</span>
        <select :value="workingLanes[selectedIndex].type" @change="onLaneField('type', ($event.target as HTMLSelectElement).value)">
          <option value="CAR">机动车</option>
          <option value="BUS">公交</option>
          <option value="BIKE">自行车</option>
          <option value="TRAM">有轨电车</option>
        </select>
      </label>
      <label class="param-row">
        <span>宽度</span>
        <input
          type="number"
          :value="workingLanes[selectedIndex].width"
          min="2.5" max="4.5" step="0.1"
          @change="onLaneField('width', Number(($event.target as HTMLInputElement).value))"
        />
        <span class="unit">m</span>
      </label>
    </div>

    <div class="lane-actions">
      <button class="action-btn" @click="onAddLane">添加车道</button>
      <button class="action-btn danger" :disabled="!canRemoveLane" @click="onRemoveLane">删除车道</button>
    </div>

    <div class="median-editor">
      <div class="section-title">中央隔离带</div>
      <label class="param-row">
        <span>类型</span>
        <select :value="workingMedian.type" @change="onMedianField('type', ($event.target as HTMLSelectElement).value)">
          <option value="NONE">无</option>
          <option value="GRASS">绿化带</option>
          <option value="BARRIER">护栏</option>
        </select>
      </label>
      <label class="param-row" v-if="workingMedian.type !== 'NONE'">
        <span>宽度</span>
        <input
          type="number"
          :value="workingMedian.width"
          min="0.5" max="5" step="0.5"
          @change="onMedianField('width', Number(($event.target as HTMLInputElement).value))"
        />
        <span class="unit">m</span>
      </label>
    </div>

    <div class="sidewalk-editor">
      <div class="section-title">人行道</div>
      <label class="param-row">
        <span>左侧</span>
        <input type="number" :value="workingSidewalk.leftWidth" min="0" max="5" step="0.5" @change="onSidewalkField('leftWidth', Number(($event.target as HTMLInputElement).value))" />
        <span class="unit">m</span>
      </label>
      <label class="param-row">
        <span>右侧</span>
        <input type="number" :value="workingSidewalk.rightWidth" min="0" max="5" step="0.5" @change="onSidewalkField('rightWidth', Number(($event.target as HTMLInputElement).value))" />
        <span class="unit">m</span>
      </label>
    </div>

    <div class="save-row">
      <input :value="editorStore.profileName" @input="editorStore.setProfileName(($event.target as HTMLInputElement).value)" type="text" placeholder="模板名称" class="name-input" />
      <button class="save-btn" :disabled="!editorStore.profileName.trim()" @click="onSave">保存模板</button>
    </div>

    <div class="apply-row">
      <button class="apply-btn" :disabled="!canApply" @click="onApply">应用到选中路段</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { LaneDef, MedianDef, SidewalkDef, LaneType, LaneDirection } from '@/types/road-network'
import { useCrossSectionEditorStore } from '@/stores/crossSectionEditorStore'
import { useRoadNetworkStore } from '@/stores/roadNetworkStore'
import { useEditorStateStore } from '@/stores/editorStateStore'

const editorState = useEditorStateStore()
const roadStore = useRoadNetworkStore()
const editorStore = useCrossSectionEditorStore()

const emit = defineEmits<{
  close: []
  save: [profile: CrossSectionProfile]
}>()

import type { CrossSectionProfile } from '@/types/road-network'

const selectedIndex = ref(0)

const workingLanes = computed(() => editorStore.profile?.lanes ?? [])
const workingMedian = computed(() => editorStore.profile?.median ?? { width: 0, type: 'NONE' as const })
const workingSidewalk = computed(() => editorStore.profile?.sidewalk ?? { leftWidth: 1.5, rightWidth: 1.5, hasCurb: true })

const totalWidth = computed(() => editorStore.profile?.totalWidth ?? 0)

const canRemoveLane = computed(() => {
  if (!editorStore.profile || editorStore.profile.lanes.length <= 2) return false
  const remaining = editorStore.profile.lanes.filter((_, i) => i !== selectedIndex.value)
  const fwd = remaining.filter(l => l.direction === 'FORWARD' || l.direction === 'BOTH').length
  const bwd = remaining.filter(l => l.direction === 'BACKWARD' || l.direction === 'BOTH').length
  return fwd >= 1 && bwd >= 1
})

const canApply = computed(() => workingLanes.value.length >= 2 && editorStore.getForwardLaneCount() >= 1 && editorStore.getBackwardLaneCount() >= 1)

function laneStyle(lane: LaneDef): Record<string, string> {
  const palette: Record<string, string> = { CAR: '#4a5160', BIKE: '#3b8d56', BUS: '#a13c3c', TRAM: '#5c5750' }
  return { flex: String(lane.width), background: palette[lane.type] ?? '#4a5160' }
}

function onSelectLane(index: number): void {
  selectedIndex.value = index
}

function onLaneField(field: keyof LaneDef, value: string | number): void {
  if (selectedIndex.value < 0 || selectedIndex.value >= workingLanes.value.length) return
  const patch: Partial<LaneDef> = {}
  if (field === 'width') patch.width = Math.max(2.5, Math.min(4.5, value as number))
  else if (field === 'direction') patch.direction = value as LaneDirection
  else if (field === 'type') patch.type = value as LaneType
  editorStore.updateLane(selectedIndex.value, patch)
}

function onAddLane(): void {
  editorStore.addLane('BACKWARD', 'CAR', 3.5)
  selectedIndex.value = workingLanes.value.length - 1
}

function onRemoveLane(): void {
  try {
    editorStore.removeLane(selectedIndex.value)
    if (selectedIndex.value >= workingLanes.value.length) {
      selectedIndex.value = workingLanes.value.length - 1
    }
  } catch (err: unknown) {
    editorState.setError(err instanceof Error ? err.message : '无法删除车道')
  }
}

function onMedianField(field: keyof MedianDef, value: string | number): void {
  const patch: Partial<MedianDef> = {}
  if (field === 'type') patch.type = value as MedianDef['type']
  else if (field === 'width') patch.width = Math.max(0.5, value as number)
  editorStore.updateMedian(patch)
}

function onSidewalkField(field: keyof SidewalkDef, value: number): void {
  const patch: Partial<SidewalkDef> = {}
  if (field === 'leftWidth') patch.leftWidth = Math.max(0, value)
  else if (field === 'rightWidth') patch.rightWidth = Math.max(0, value)
  editorStore.updateSidewalk(patch)
}

async function onApply(): Promise<void> {
  const segId = roadStore.selectedSegmentIds.size > 0 ? Array.from(roadStore.selectedSegmentIds)[0] : null
  if (!segId) {
    editorState.setError('请先选中一个路段')
    return
  }
  try {
    editorStore.applyToSegment(segId)
  } catch (err: unknown) {
    editorState.setError(err instanceof Error ? err.message : '应用断面失败')
  }
}

async function onSave(): Promise<void> {
  if (!editorStore.profileName.trim()) return
  try {
    await editorStore.saveAsTemplate(editorStore.profileName)
  } catch (err: unknown) {
    editorState.setError(err instanceof Error ? err.message : '保存模板失败')
  }
}
</script>

<style scoped>
.cross-section-editor {
  background: #181b21;
  border: 1px solid #2a2f3a;
  border-radius: 5px;
  padding: 8px;
  margin-bottom: 8px;
}
.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.editor-title { font-size: 13px; font-weight: 600; color: #6cb6ff; }
.icon-btn { background: transparent; border: none; color: #8e94a0; cursor: pointer; font-size: 14px; }
.icon-btn:hover { color: #d8dde6; }
.editor-preview { margin-bottom: 8px; }
.section-preview {
  display: flex; height: 36px; border-radius: 3px; overflow: hidden;
  border: 1px solid #2a2f3a;
}
.lane-strip { height: 100%; cursor: pointer; transition: opacity 0.1s; }
.lane-strip:hover { opacity: 0.85; }
.lane-strip.selected { outline: 2px solid #6cb6ff; outline-offset: -2px; }
.width-label { font-size: 11px; color: #8e94a0; margin-top: 4px; }
.section-title { margin: 8px 0 4px; color: #6cb6ff; font-size: 11px; font-weight: 600; }
.lane-editor { margin-bottom: 6px; }
.param-row {
  display: flex; justify-content: space-between; align-items: center;
  gap: 6px; margin-bottom: 4px; font-size: 12px; color: #aab2bf;
}
.param-row input, .param-row select {
  width: 90px; padding: 3px 6px; background: #14171c; border: 1px solid #2a2f3a;
  color: #d8dde6; border-radius: 3px; font-size: 11px;
}
.param-row select { width: 90px; }
.unit { font-size: 11px; color: #6a7180; min-width: 16px; }
.lane-actions { display: flex; gap: 6px; margin: 6px 0; }
.action-btn {
  flex: 1; padding: 5px; background: #2a2f3a; border: 1px solid #383e4a;
  color: #d8dde6; border-radius: 3px; cursor: pointer; font-size: 11px;
}
.action-btn:hover { background: #313847; }
.action-btn.danger { color: #e06c75; }
.action-btn.danger:hover { background: #3a2020; }
.action-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.median-editor, .sidewalk-editor { margin-bottom: 6px; }
.save-row { display: flex; gap: 6px; margin-top: 8px; }
.name-input {
  flex: 1; padding: 5px 8px; background: #14171c; border: 1px solid #2a2f3a;
  border-radius: 3px; color: #d8dde6; font-size: 12px;
}
.save-btn {
  padding: 5px 12px; background: #2c5d99; border: none;
  color: #fff; border-radius: 3px; cursor: pointer; font-size: 11px;
}
.save-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.apply-row { margin-top: 6px; }
.apply-btn {
  width: 100%; padding: 6px; background: #3a6e45; border: none;
  color: #fff; border-radius: 3px; cursor: pointer; font-size: 12px;
}
.apply-btn:hover { background: #468352; }
.apply-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
