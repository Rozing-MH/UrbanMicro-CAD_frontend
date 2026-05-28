<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="arrow-picker"
      :style="{ left: `${position.x}px`, top: `${position.y}px` }"
    >
      <div class="picker-title">转向箭头</div>
      <div class="picker-lane">{{ laneLabel }}</div>
      <div class="picker-options">
        <label v-for="dir in directions" :key="dir.value" class="picker-option">
          <input
            type="checkbox"
            :checked="selected.has(dir.value)"
            @change="toggle(dir.value)"
          />
          <span class="dir-icon">{{ dir.icon }}</span>
          <span class="dir-label">{{ dir.label }}</span>
        </label>
      </div>
      <div class="picker-actions">
        <button class="apply-btn" @click="apply">确定</button>
        <button class="cancel-btn" @click="cancel">取消</button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { TurnDirection } from '@/types/road-network'

const props = defineProps<{
  visible: boolean
  position: { x: number; y: number }
  laneId: string
  nodeId: string
  currentDirections: TurnDirection[]
}>()

const emit = defineEmits<{
  apply: [arrow: { laneId: string; nodeId: string; allowedDirections: TurnDirection[] }]
  cancel: []
}>()

const directions: { value: TurnDirection; icon: string; label: string }[] = [
  { value: 'LEFT', icon: '↰', label: '左转' },
  { value: 'STRAIGHT', icon: '↑', label: '直行' },
  { value: 'RIGHT', icon: '↱', label: '右转' },
  { value: 'U_TURN', icon: '↩', label: '掉头' },
]

const selected = ref<Set<TurnDirection>>(new Set(props.currentDirections))

const laneLabel = computed(() => {
  if (!props.laneId) return ''
  return props.laneId.replace(/.*:lane:(\d+)/, '车道 $1')
})

function toggle(dir: TurnDirection): void {
  const next = new Set(selected.value)
  if (next.has(dir)) next.delete(dir)
  else next.add(dir)
  selected.value = next
}

function apply(): void {
  emit('apply', {
    laneId: props.laneId,
    nodeId: props.nodeId,
    allowedDirections: Array.from(selected.value),
  })
  selected.value = new Set()
}

function cancel(): void {
  emit('cancel')
  selected.value = new Set()
}
</script>

<style scoped>
.arrow-picker {
  position: fixed;
  min-width: 140px;
  padding: 10px;
  background: #1f232b;
  border: 1px solid #3a4050;
  border-radius: 6px;
  color: #c8cdd5;
  font-size: 12px;
  z-index: 9999;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}
.picker-title {
  font-weight: 600;
  color: #6cb6ff;
  margin-bottom: 4px;
  font-size: 13px;
}
.picker-lane {
  color: #aab2bf;
  margin-bottom: 8px;
  font-size: 11px;
}
.picker-options {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.picker-option {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 3px;
  cursor: pointer;
}
.picker-option:hover {
  background: #2a2f3a;
}
.picker-option input {
  accent-color: #4a8cd0;
}
.dir-icon {
  font-size: 16px;
  width: 20px;
  text-align: center;
}
.dir-label {
  color: #d8dde6;
}
.picker-actions {
  display: flex;
  gap: 6px;
  margin-top: 10px;
}
.apply-btn,
.cancel-btn {
  flex: 1;
  padding: 5px;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font-size: 11px;
  color: #fff;
}
.apply-btn {
  background: #2c5d99;
}
.apply-btn:hover {
  background: #3670b8;
}
.cancel-btn {
  background: #444;
}
.cancel-btn:hover {
  background: #555;
}
</style>
