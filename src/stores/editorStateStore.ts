import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { HistorySessionId } from '@/commands/HistoryStack'

export type ToolMode =
  | 'SELECT'
  | 'ROAD_DRAW'
  | 'ROAD_UPGRADE'
  | 'BULLDOZER'
  | 'PARALLEL_ROAD'
  | 'ROAD_EDIT'
  | 'NODE_ADJUST'
  | 'TRAFFIC_LIGHT'
  | 'LANE_CONNECTOR'
  | 'LANE_RESTRICTION'
  | 'LANE_ARROW'
  | 'TURN_RESTRICTION'
  | 'OD_MARKER'
  | 'MEASURE'
  | 'PAN'

export type ViewMode = 'EDIT' | 'SIMULATION' | 'EVALUATION' | 'TRAFFIC_VOLUME' | 'TRAFFIC_ROUTES'
export type NotificationType = 'error' | 'warning' | 'info' | 'success'

export interface EditorNotification {
  id: string
  type: NotificationType
  message: string
  durationMs?: number
}

export interface ShowNotificationInput {
  type: NotificationType
  message: string
  durationMs?: number
}

export type PanelState = {
  leftPanelOpen: boolean
  rightPanelOpen: boolean
  bottomPanelOpen: boolean
  propertiesTab: string
}

export const useEditorStateStore = defineStore('editorState', () => {
  const activeTool = ref<ToolMode>('SELECT')
  const viewMode = ref<ViewMode>('EDIT')
  const cameraPosition = ref({ x: 0, y: 500, z: 500 })
  const cameraTarget = ref({ x: 0, y: 0, z: 0 })
  const zoomLevel = ref(1)

  const panelState = ref<PanelState>({
    leftPanelOpen: true,
    rightPanelOpen: true,
    bottomPanelOpen: true,
    propertiesTab: 'geometry',
  })

  const isLoading = ref(false)
  const loadingMessage = ref('')
  const notification = ref<EditorNotification | null>(null)
  const snapToGrid = ref(true)
  const snapToRoad = ref(true)
  const gridSize = ref(1)
  const showGrid = ref(true)
  const showMeasurements = ref(false)
  const showNodeIds = ref(false)
  const continuousDrawing = ref(true)
  const activeProfileId = ref('default-2lane')
  const renderLOD = ref<'HIGH' | 'MEDIUM' | 'LOW'>('HIGH')

  const historyPointer = ref(-1)
  const historyLength = ref(0)
  const historySessionId = ref<HistorySessionId | null>(null)
  const canUndo = computed(() => historyPointer.value >= 0)
  const canRedo = computed(() => historyPointer.value < historyLength.value - 1)
  const errorMessage = computed(() => notification.value?.type === 'error' ? notification.value.message : null)

  let notificationTimer: ReturnType<typeof window.setTimeout> | null = null

  function createNotificationId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }

  function clearNotificationTimer(): void {
    if (!notificationTimer) return
    window.clearTimeout(notificationTimer)
    notificationTimer = null
  }

  function setActiveTool(tool: ToolMode): void {
    activeTool.value = tool
  }

  function setViewMode(mode: ViewMode): void {
    viewMode.value = mode
  }

  function updateCamera(pos: Partial<typeof cameraPosition.value>, target?: Partial<typeof cameraTarget.value>): void {
    cameraPosition.value = { ...cameraPosition.value, ...pos }
    if (target) cameraTarget.value = { ...cameraTarget.value, ...target }
  }

  function setZoom(level: number): void {
    zoomLevel.value = Math.max(0.1, Math.min(100, level))
  }

  function setPanelState(patch: Partial<PanelState>): void {
    panelState.value = { ...panelState.value, ...patch }
  }

  function setLoading(loading: boolean, message = ''): void {
    isLoading.value = loading
    loadingMessage.value = message
  }

  function dismissNotification(id?: string): void {
    if (id && notification.value?.id !== id) return
    notification.value = null
    clearNotificationTimer()
  }

  function showNotification(input: ShowNotificationInput): void {
    clearNotificationTimer()
    const id = createNotificationId()
    notification.value = { ...input, id }
    if (input.durationMs && input.durationMs > 0) {
      notificationTimer = window.setTimeout(() => dismissNotification(id), input.durationMs)
    }
  }

  function setError(message: string | null): void {
    if (!message) {
      dismissNotification()
      return
    }
    showNotification({ type: 'error', message })
  }

  function clearError(): void {
    dismissNotification()
  }

  function toggleSnap(): void {
    snapToGrid.value = !snapToGrid.value
  }

  function toggleRoadSnap(): void {
    snapToRoad.value = !snapToRoad.value
  }

  function setGridSize(size: number): void {
    gridSize.value = Math.max(0.1, size)
  }

  function setActiveProfile(id: string): void {
    activeProfileId.value = id
  }

  function toggleContinuousDrawing(): void {
    continuousDrawing.value = !continuousDrawing.value
  }

  function toggleGrid(): void {
    showGrid.value = !showGrid.value
  }

  function updateHistoryState(pointer: number, length: number): void {
    historyPointer.value = pointer
    historyLength.value = length
  }

  function setHistorySession(sessionId: HistorySessionId | null): void {
    historySessionId.value = sessionId
  }

  return {
    activeTool, viewMode, cameraPosition, cameraTarget, zoomLevel,
    panelState, isLoading, loadingMessage, notification, errorMessage,
    snapToGrid, snapToRoad, gridSize, showGrid, showMeasurements, showNodeIds,
    continuousDrawing, activeProfileId, renderLOD,
    historyPointer, historyLength, historySessionId, canUndo, canRedo,
    setActiveTool, setViewMode, updateCamera, setZoom, setPanelState,
    setLoading, showNotification, dismissNotification, setError, clearError,
    toggleSnap, toggleRoadSnap, setGridSize, setActiveProfile,
    toggleContinuousDrawing, toggleGrid,
    updateHistoryState, setHistorySession,
  }
})
