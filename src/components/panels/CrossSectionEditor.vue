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
          :class="{ selected: selectedLaneIndex === i }"
          :style="laneStyle(lane)"
          :title="`${lane.direction} ${lane.type} ${lane.width}m`"
          @click="selectedLaneIndex = i"
        ></div>
      </div>
      <div class="width-label">总宽 {{ totalWidth.toFixed(1) }} m · {{ workingLanes.length }} 车道</div>
    </div>

    <div class="lane-editor" v-if="selectedLaneIndex >= 0 && selectedLaneIndex < workingLanes.length">
      <div class="section-title">车道 #{{ selectedLaneIndex + 1 }}</div>
      <label class="param-row">
        <span>方向</span>
        <select :value="workingLanes[selectedLaneIndex].direction" @change="onLaneField('direction', ($event.target as HTMLSelectElement).value)">
          <option value="FORWARD">正向</option>
          <option value="BACKWARD">反向</option>
          <option value="BOTH">双向</option>
        </select>
      </label>
      <label class="param-row">
        <span>类型</span>
        <select :value="workingLanes[selectedLaneIndex].type" @change="onLaneField('type', ($event.target as HTMLSelectElement).value)">
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
          :value="workingLanes[selectedLaneIndex].width"
          min="2.5" max="4.5" step="0.1"
          @change="onLaneField('width', Number(($event.target as HTMLInputElement).value))"
        />
        <span class="unit">m</span>
      </label>
    </div>

    <div class="lane-actions">
      <button class="action-btn" @click="addLane">添加车道</button>
      <button class="action-btn danger" :disabled="workingLanes.length <= 1" @click="removeLane">删除车道</button>
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
      <input v-model="profileName" type="text" placeholder="模板名称" class="name-input" />
      <button class="save-btn" :disabled="!profileName.trim()" @click="onSave">保存模板</button>
    </div>

    <div class="apply-row">
      <button class="apply-btn" :disabled="!canApply" @click="$emit('apply', builtProfile)">应用到选中路段</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive } from 'vue'
import type { CrossSectionProfile, LaneDef, MedianDef, SidewalkDef, LaneType, LaneDirection } from '@/types/road-network'

const props = defineProps<{
  initialProfile?: CrossSectionProfile | null
}>()

const emit = defineEmits<{
  close: []
  save: [profile: CrossSectionProfile]
  apply: [profile: CrossSectionProfile]
}>()

const profileName = ref('')
const selectedLaneIndex = ref(0)

const workingLanes = reactive<LaneDef[]>(
  props.initialProfile
    ? props.initialProfile.lanes.map(l => ({ ...l }))
    : [
        { id: 'cl1', width: 3.5, type: 'CAR' as LaneType, direction: 'FORWARD' as LaneDirection },
        { id: 'cl2', width: 3.5, type: 'CAR' as LaneType, direction: 'BACKWARD' as LaneDirection },
      ],
)

const workingMedian = reactive<MedianDef>(
  props.initialProfile ? { ...props.initialProfile.median } : { width: 0, type: 'NONE' },
)

const workingSidewalk = reactive<SidewalkDef>(
  props.initialProfile ? { ...props.initialProfile.sidewalk } : { leftWidth: 1.5, rightWidth: 1.5 },
)

const totalWidth = computed(() => {
  let w = workingLanes.reduce((sum, l) => sum + l.width, 0)
  if (workingMedian.type !== 'NONE') w += workingMedian.width
  w += workingSidewalk.leftWidth + workingSidewalk.rightWidth
  return w
})

const canApply = computed(() => workingLanes.length >= 1)

const builtProfile = computed<CrossSectionProfile>(() => ({
  id: `custom-${Date.now().toString(36)}`,
  name: profileName.value.trim() || '自定义断面',
  lanes: workingLanes.map((l, i) => ({ ...l, id: `cl${i}` })),
  median: { ...workingMedian },
  sidewalk: { ...workingSidewalk },
  totalWidth: totalWidth.value,
}))

let laneCounter = workingLanes.length

function laneStyle(lane: LaneDef): Record<string, string> {
  const palette: Record<string, string> = { CAR: '#4a5160', BIKE: '#3b8d56', BUS: '#a13c3c', TRAM: '#5c5750' }
  return { flex: String(lane.width), background: palette[lane.type] ?? '#4a5160' }
}

function onLaneField(field: keyof LaneDef, value: string | number): void {
  if (selectedLaneIndex.value < 0 || selectedLaneIndex.value >= workingLanes.length) return
  const lane = workingLanes[selectedLaneIndex.value]
  if (field === 'width') {
    lane.width = Math.max(2.5, Math.min(4.5, value as number))
  } else if (field === 'direction') {
    lane.direction = value as LaneDirection
  } else if (field === 'type') {
    lane.type = value as LaneType
  }
}

function addLane(): void {
  laneCounter++
  workingLanes.push({ id: `cl${laneCounter}`, width: 3.5, type: 'CAR', direction: 'BACKWARD' })
  selectedLaneIndex.value = workingLanes.length - 1
}

function removeLane(): void {
  if (workingLanes.length <= 1) return
  workingLanes.splice(selectedLaneIndex.value, 1)
  if (selectedLaneIndex.value >= workingLanes.length) {
    selectedLaneIndex.value = workingLanes.length - 1
  }
}

function onMedianField(field: keyof MedianDef, value: string | number): void {
  if (field === 'type') workingMedian.type = value as MedianDef['type']
  else if (field === 'width') workingMedian.width = Math.max(0.5, value as number)
}

function onSidewalkField(field: keyof SidewalkDef, value: number): void {
  if (field === 'leftWidth') workingSidewalk.leftWidth = Math.max(0, value)
  else if (field === 'rightWidth') workingSidewalk.rightWidth = Math.max(0, value)
}

function onSave(): void {
  if (!profileName.value.trim()) return
  const profile: CrossSectionProfile = {
    ...builtProfile.value,
    id: `user-${Date.now().toString(36)}`,
    name: profileName.value.trim(),
  }
  emit('save', profile)
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
