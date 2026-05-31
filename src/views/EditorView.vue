<template>
  <div class="editor-page">
    <TopToolbar />

    <div class="editor-body">
      <LeftAssetPanel />

      <div class="editor-center">
        <div v-if="loading" class="loading-overlay">加载项目中…</div>
        <div v-else-if="loadError" class="error-overlay">
          <div class="error-icon">⚠</div>
          <div class="error-text">{{ loadError }}</div>
          <button class="back-btn" @click="backToDashboard">返回工作台</button>
        </div>
        <ThreeViewport v-else />
      </div>

      <RightPropertyPanel />
    </div>

    <BottomTimeline />

    <div
      v-if="editor.notification"
      class="toast"
      :class="editor.notification.type"
      :role="editor.notification.type === 'error' ? 'alert' : 'status'"
      @click="editor.dismissNotification(editor.notification.id)"
    >
      <span class="toast-type">{{ notificationLabel(editor.notification.type) }}</span>
      <span>{{ editor.notification.message }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import TopToolbar from '@/components/toolbar/TopToolbar.vue'
import LeftAssetPanel from '@/components/panels/LeftAssetPanel.vue'
import RightPropertyPanel from '@/components/panels/RightPropertyPanel.vue'
import BottomTimeline from '@/components/panels/BottomTimeline.vue'
import ThreeViewport from '@/components/viewport/ThreeViewport.vue'
import { useEditorStateStore, type NotificationType } from '@/stores/editorStateStore'
import { useProjectStore } from '@/stores/projectStore'
import { useRoadNetworkStore } from '@/stores/roadNetworkStore'
import { useTrafficRuleStore } from '@/stores/trafficRuleStore'
import { useSimulationStore } from '@/stores/simulationStore'
import { historyStack } from '@/commands/HistoryStack'
import { disposeWorkers } from '@/workers'

const route = useRoute()
const router = useRouter()
const editor = useEditorStateStore()
const project = useProjectStore()
const road = useRoadNetworkStore()
const rules = useTrafficRuleStore()
const sim = useSimulationStore()

const loading = ref(true)
const loadError = ref('')
let isEditorUnmounted = false

function resetHistoryState(): void {
  historyStack.clear()
  editor.updateHistoryState(-1, 0)
}

function clearHistorySession(): void {
  const sessionId = editor.historySessionId
  if (sessionId !== null) historyStack.endSession(sessionId)
  editor.setHistorySession(null)
}

onMounted(async () => {
  isEditorUnmounted = false
  clearHistorySession()
  resetHistoryState()
  const sessionId = historyStack.startSession()
  editor.setHistorySession(sessionId)
  historyStack.setOnChange((pointer, length) => editor.updateHistoryState(pointer, length))
  historyStack.setOnMutation(() => {
    if (!loading.value && project.currentProject) {
      project.markDirty()
    }
  })

  const id = route.params.projectId as string
  if (!id) {
    loadError.value = '缺少项目 ID'
    loading.value = false
    return
  }
  try {
    await project.loadProject(id)
    if (isEditorUnmounted) return
  } catch (err) {
    if (isEditorUnmounted) return
    loadError.value = err instanceof Error ? err.message : '加载失败'
  } finally {
    if (!isEditorUnmounted) loading.value = false
  }
})

onBeforeRouteLeave((_to, _from, next) => {
  if (project.isDirty) {
    if (!confirm('当前项目有未保存的修改，确认离开？')) {
      next(false)
      return
    }
  }
  next()
})

onBeforeUnmount(() => {
  isEditorUnmounted = true
  editor.dismissNotification()
  disposeWorkers()
  road.clear()
  rules.clear()
  sim.reset()
  project.setCurrentProject(null)
  clearHistorySession()
  resetHistoryState()
  historyStack.clearCallbacks()
})

function notificationLabel(type: NotificationType): string {
  const labels: Record<NotificationType, string> = {
    error: '错误',
    warning: '警告',
    info: '提示',
    success: '完成',
  }
  return labels[type]
}

function backToDashboard(): void {
  void router.push('/dashboard')
}
</script>

<style scoped>
.editor-page {
  display: flex; flex-direction: column;
  height: 100%; width: 100%;
  background: var(--color-bg-page);
  overflow: hidden;
}
.editor-body {
  flex: 1; display: flex;
  min-height: 0;
}
.editor-center {
  flex: 1; position: relative;
  display: flex;
  background: #0e1115;
  min-width: 0;
}
.loading-overlay,
.error-overlay {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  color: var(--color-text-muted);
  font-size: 14px;
  gap: 12px;
}
.error-icon { font-size: 32px; color: var(--color-warning); }
.error-text { color: #e89090; }
.back-btn {
  margin-top: 6px; padding: 6px 16px;
  background: var(--color-accent-bg); border: none; color: #fff;
  border-radius: var(--radius-md); font-size: 12px;
}
.back-btn:hover { background: #356eb0; }
.toast {
  position: fixed; bottom: 20px; left: 50%;
  display: flex; align-items: center; gap: 10px;
  transform: translateX(-50%);
  max-width: min(640px, calc(100vw - 32px));
  padding: 9px 18px;
  color: #fff; font-size: 12px;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  cursor: pointer; z-index: 1000;
  animation: slideUp var(--duration-normal) var(--ease-out);
}
.toast.error { background: rgba(161, 60, 60, 0.95); }
.toast.warning { background: rgba(194, 128, 38, 0.96); }
.toast.info { background: rgba(44, 93, 153, 0.96); }
.toast.success { background: rgba(55, 132, 91, 0.96); }
.toast-type {
  font-weight: 700;
  white-space: nowrap;
}
@keyframes slideUp {
  from { transform: translate(-50%, 20px); opacity: 0; }
  to { transform: translate(-50%, 0); opacity: 1; }
}
</style>
