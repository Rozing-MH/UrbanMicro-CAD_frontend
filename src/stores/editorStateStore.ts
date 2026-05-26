import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type ToolMode =
  | 'SELECT'
  | 'ROAD_DRAW'
  | 'ROAD_EDIT'
  | 'TRAFFIC_LIGHT'
  | 'LANE_CONNECTOR'
  | 'OD_MARKER'
  | 'MEASURE'
  | 'PAN'

export type ViewMode = 'EDIT' | 'SIMULATION' | 'EVALUATION'

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
  const errorMessage = ref<string | null>(null)
  const snapToGrid = ref(true)
  const snapToRoad = ref(true)
  const gridSize = ref(1)
  const showGrid = ref(true)
  const showMeasurements = ref(false)
  const showNodeIds = ref(false)
  const renderLOD = ref<'HIGH' | 'MEDIUM' | 'LOW'>('HIGH')

  const historyPointer = ref(-1)
  const historyLength = ref(0)
  const canUndo = computed(() => historyPointer.value >= 0)
  const canRedo = computed(() => historyPointer.value < historyLength.value - 1)

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

  function setError(message: string | null): void {
    errorMessage.value = message
  }

  function clearError(): void {
    errorMessage.value = null
  }

  function toggleSnap(): void {
    snapToGrid.value = !snapToGrid.value
  }

  function setGridSize(size: number): void {
    gridSize.value = Math.max(0.1, size)
  }

  function toggleGrid(): void {
    showGrid.value = !showGrid.value
  }

  function updateHistoryState(pointer: number, length: number): void {
    historyPointer.value = pointer
    historyLength.value = length
  }

  return {
    activeTool, viewMode, cameraPosition, cameraTarget, zoomLevel,
    panelState, isLoading, loadingMessage, errorMessage,
    snapToGrid, snapToRoad, gridSize, showGrid, showMeasurements, showNodeIds, renderLOD,
    historyPointer, historyLength, canUndo, canRedo,
    setActiveTool, setViewMode, updateCamera, setZoom, setPanelState,
    setLoading, setError, clearError, toggleSnap, setGridSize, toggleGrid,
    updateHistoryState,
  }
})
