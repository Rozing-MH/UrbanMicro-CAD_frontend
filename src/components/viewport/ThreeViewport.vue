<template>
  <div ref="containerRef" class="three-viewport">
    <div v-if="hint" class="viewport-hint">{{ hint }}</div>
    <div v-if="evaluationStore.evalMode !== 'NONE'" class="viewport-legend">
      <div class="legend-title">{{ legendTitle }}</div>
      <div class="legend-bar"></div>
      <div class="legend-labels">
        <span>低</span><span>中</span><span>高</span>
      </div>
    </div>
    <LaneArrowPicker
      :visible="arrowPickerVisible"
      :position="arrowPickerPosition"
      :lane-id="arrowPickerLaneId"
      :node-id="arrowPickerNodeId"
      :current-directions="arrowPickerDirections"
      @apply="onArrowPickerApply"
      @cancel="onArrowPickerCancel"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, type Ref } from 'vue'
import * as THREE from 'three'
import { useThreeRenderer } from '@/composables/useThreeRenderer'
import { useRoadRenderer } from '@/composables/useRoadRenderer'
import { useVehicleRenderer } from '@/composables/useVehicleRenderer'
import { useCameraControls } from '@/composables/useCameraControls'
import { useHeatmap } from '@/composables/useHeatmap'
import { useGroundGrid } from '@/composables/useGroundGrid'
import { useRoadNetworkStore } from '@/stores/roadNetworkStore'
import { useEditorStateStore } from '@/stores/editorStateStore'
import { useSimulationStore } from '@/stores/simulationStore'
import { useEvaluationStore } from '@/stores/evaluationStore'
import { useTrafficRuleStore } from '@/stores/trafficRuleStore'
import { historyStack, type HistorySessionId } from '@/commands/HistoryStack'
import {
  AddSegmentCommand,
  AddTrafficLightCommand,
  CreateParallelSegmentCommand,
  DeleteSegmentCommand,
  SetLaneArrowCommand,
  SetLaneConnectorCommand,
  UpgradeSegmentCommand,
} from '@/commands/roadCommands'
import { buildSegmentGeometry, createSegmentFromPoints } from '@/utils/roadGeometry'
import { getProfileById } from '@/utils/roadProfiles'
import LaneArrowPicker from '@/components/panels/LaneArrowPicker.vue'
import type { Lane, LaneConnector, Point2D, RoadSegment, RoadNode, CrossSectionProfile, MeshData, TurnDirection } from '@/types'

const DEFAULT_PROFILE: CrossSectionProfile = {
  id: 'default-2lane',
  name: '默认双车道',
  lanes: [
    { id: 'l1', width: 3.5, type: 'CAR', direction: 'FORWARD' },
    { id: 'l2', width: 3.5, type: 'CAR', direction: 'BACKWARD' },
  ],
  median: { width: 0, type: 'NONE' },
  sidewalk: { leftWidth: 1.5, rightWidth: 1.5 },
  totalWidth: 8,
}

const KNOWN_PROFILES: Record<string, CrossSectionProfile> = {
  [DEFAULT_PROFILE.id]: DEFAULT_PROFILE,
  'arterial-4lane-bus': {
    id: 'arterial-4lane-bus',
    name: '四车道公交干道',
    lanes: [
      { id: 'l1', width: 3.5, type: 'BUS', direction: 'FORWARD' },
      { id: 'l2', width: 3.5, type: 'CAR', direction: 'FORWARD' },
      { id: 'l3', width: 3.5, type: 'CAR', direction: 'BACKWARD' },
      { id: 'l4', width: 3.5, type: 'BUS', direction: 'BACKWARD' },
    ],
    median: { width: 1.5, type: 'GRASS' },
    sidewalk: { leftWidth: 2, rightWidth: 2 },
    totalWidth: 19.5,
  },
}

const containerRef = ref<HTMLDivElement | null>(null)
const roadStore = useRoadNetworkStore()
const editorStore = useEditorStateStore()
const simStore = useSimulationStore()
const evaluationStore = useEvaluationStore()
const trafficRuleStore = useTrafficRuleStore()

// Pass containerRef at construction — renderer auto-inits via its own onMounted
const renderer = useThreeRenderer(containerRef)

// Derive reactive scene/camera refs from renderer state
const sceneRef = computed(() => renderer.state.value?.scene ?? null) as Ref<THREE.Scene | null>
const cameraRef = computed(() => renderer.state.value?.camera ?? null) as Ref<THREE.PerspectiveCamera | null>

// Pass scene/camera refs to all dependant composables
const roadRenderer = useRoadRenderer(sceneRef)
const vehicleRenderer = useVehicleRenderer(sceneRef)
const cameraControls = useCameraControls(cameraRef, containerRef)
const heatmap = useHeatmap(sceneRef)
const groundGrid = useGroundGrid(sceneRef)

function genId(): string {
  return Math.random().toString(36).slice(2, 11) + Date.now().toString(36)
}

function isCurrentHistorySession(sessionId: HistorySessionId): boolean {
  return editorStore.historySessionId === sessionId && historyStack.isSessionActive(sessionId)
}

async function executeHistoryCommand(
  command: Parameters<typeof historyStack.execute>[0],
  sessionId: HistorySessionId,
): Promise<void> {
  if (!isCurrentHistorySession(sessionId)) return
  await historyStack.execute(command, sessionId)
}

const hint = computed(() => {
  switch (editorStore.activeTool) {
    case 'ROAD_DRAW': return '左键放置道路节点，Esc 结束'
    case 'ROAD_UPGRADE': return '点击路段，使用左侧当前断面原位升级'
    case 'PARALLEL_ROAD': return '点击路段，按当前断面宽度生成平行路'
    case 'BULLDOZER': return '点击路段删除，支持撤销/重做'
    case 'ROAD_EDIT': return '左键选择节点拖动调整'
    case 'TRAFFIC_LIGHT': return '点击交叉口添加信号灯'
    case 'LANE_CONNECTOR': return selectedLaneAnchor.value ? '点击目标车道完成连接，Esc 取消' : '点击源车道锚点开始连接'
    case 'LANE_ARROW': return '点击车道锚点设置转向箭头'
    case 'MEASURE': return '依次点击起点和终点测量距离'
    default: return ''
  }
})

const legendTitle = computed(() => {
  switch (evaluationStore.evalMode) {
    case 'LOS': return 'LOS 服务水平'
    case 'SPEED': return '平均车速 (m/s)'
    case 'DENSITY': return '密度 (辆/km)'
    case 'DELAY': return '平均延误 (s)'
    default: return ''
  }
})

const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

function screenToWorld(event: MouseEvent): Point2D | null {
  const camera = cameraRef.value
  if (!camera || !containerRef.value) return null
  const rect = containerRef.value.getBoundingClientRect()
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)
  const target = new THREE.Vector3()
  if (raycaster.ray.intersectPlane(groundPlane, target)) {
    return { x: target.x, y: target.z }
  }
  return null
}

function snapPoint(p: Point2D): Point2D {
  if (!editorStore.snapToGrid) return p
  const grid = editorStore.gridSize
  return { x: Math.round(p.x / grid) * grid, y: Math.round(p.y / grid) * grid }
}

interface LaneAnchor {
  segmentId: string
  laneId: string
  laneIndex: number
  point: Point2D
  elevation: number
}

let previewMesh: THREE.Line | null = null
let simTickInFlight = false
const selectedLaneAnchor = ref<LaneAnchor | null>(null)
const laneAnchorMeshes: Map<string, THREE.Mesh> = new Map()
const laneConnectorMeshes: Map<string, THREE.Line> = new Map()
const laneAnchorGeometry = new THREE.SphereGeometry(0.3, 8, 8)
const laneAnchorMaterial = new THREE.MeshBasicMaterial({ color: 0x41c9ff })
const selectedLaneAnchorMaterial = new THREE.MeshBasicMaterial({ color: 0xffd166 })
const laneConnectorMaterial = new THREE.LineBasicMaterial({ color: 0xffb020 })

// Lane arrow picker state
const arrowPickerVisible = ref(false)
const arrowPickerPosition = ref({ x: 0, y: 0 })
const arrowPickerLaneId = ref('')
const arrowPickerNodeId = ref('')
const arrowPickerDirections = ref<TurnDirection[]>([])
const laneArrowMeshes: Map<string, THREE.Sprite> = new Map()
const arrowSpriteMaterial = new THREE.SpriteMaterial({ color: 0xffffff, opacity: 0.9 })

function buildFallbackRoadMesh(centerLine: Point2D[], halfWidth: number, elevation: number): MeshData {
  const start = centerLine[0]
  const end = centerLine[centerLine.length - 1]
  const dx = end.x - start.x
  const dy = end.y - start.y
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const vertices = new Float32Array([
    start.x + nx * halfWidth, elevation, start.y + ny * halfWidth,
    start.x - nx * halfWidth, elevation, start.y - ny * halfWidth,
    end.x + nx * halfWidth, elevation, end.y + ny * halfWidth,
    end.x - nx * halfWidth, elevation, end.y - ny * halfWidth,
  ])
  return {
    vertices,
    indices: new Uint32Array([0, 1, 2, 2, 1, 3]),
    uvs: new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
    normals: new Float32Array([
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
    ]),
  }
}

async function buildRoadMesh(centerLine: Point2D[], profile: CrossSectionProfile, elevation: number): Promise<MeshData> {
  return buildSegmentGeometry(centerLine, profile, elevation)
}

function drawPreviewLine(a: Point2D, b: Point2D): void {
  const scene = sceneRef.value
  if (!scene) return
  if (previewMesh) {
    scene.remove(previewMesh)
    previewMesh.geometry.dispose()
  }
  const geom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(a.x, 0.1, a.y),
    new THREE.Vector3(b.x, 0.1, b.y),
  ])
  const mat = new THREE.LineDashedMaterial({ color: 0x00aaff, dashSize: 1, gapSize: 0.5 })
  previewMesh = new THREE.Line(geom, mat)
  previewMesh.computeLineDistances()
  scene.add(previewMesh)
}

function clearPreview(): void {
  const scene = sceneRef.value
  if (previewMesh && scene) {
    scene.remove(previewMesh)
    previewMesh.geometry.dispose()
    previewMesh = null
  }
}

function onPointerMove(event: MouseEvent): void {
  const world = screenToWorld(event)
  if (!world) return
  const snapped = snapPoint(world)
  if (editorStore.activeTool === 'ROAD_DRAW' && roadStore.drawingContext.state === 'DRAWING') {
    roadStore.updatePreview(snapped)
    if (roadStore.drawingContext.startPoint) {
      drawPreviewLine(roadStore.drawingContext.startPoint, snapped)
    }
  }
}

function findOrCreateNode(point: Point2D): { id: string; created: boolean; node: RoadNode } {
  const SNAP_RADIUS = 2
  for (const node of roadStore.nodes.values()) {
    const dx = node.position.x - point.x
    const dy = node.position.y - point.y
    if (Math.sqrt(dx * dx + dy * dy) < SNAP_RADIUS) return { id: node.id, created: false, node }
  }
  const id = genId()
  return {
    id,
    created: true,
    node: {
      id,
      position: point,
      elevation: 0,
      controlMode: 'NONE',
      connectedSegmentIds: [],
      polygonVertices: [],
    },
  }
}

async function handleRoadDraw(point: Point2D, sessionId: HistorySessionId): Promise<void> {
  const ctx = roadStore.drawingContext
  if (ctx.state === 'IDLE') {
    const found = findOrCreateNode(point)
    if (found.created) {
      roadStore.addNode(found.node)
      roadRenderer.addNode(found.node)
    }
    roadStore.startDrawing(ctx.mode, point, found.id)
  } else if (ctx.state === 'DRAWING' && ctx.startNodeId) {
    const found = findOrCreateNode(point)
    if (found.id === ctx.startNodeId) return
    const startNode = roadStore.getNode(ctx.startNodeId)
    if (!startNode) return
    if (found.created) {
      roadStore.addNode(found.node)
      roadRenderer.addNode(found.node)
    }
    const profile = getProfileById(editorStore.activeProfileId)
    const centerLine = [startNode.position, point]
    const elevation = {
      startZ: roadStore.drawingContext.startElevation,
      endZ: roadStore.drawingContext.endElevation,
      mode: roadStore.drawingContext.currentElevationMode,
    }
    const segment: RoadSegment = createSegmentFromPoints({
      id: genId(),
      startNodeId: ctx.startNodeId,
      endNodeId: found.id,
      centerLine,
      profile,
      elevation,
      isCurved: false,
      meshData: await buildRoadMesh(centerLine, profile, elevation.startZ),
    })
    if (!isCurrentHistorySession(sessionId)) return
    const cmd = new AddSegmentCommand(segment, startNode, found.node, false, found.created)
    await executeHistoryCommand(cmd, sessionId)
    if (!isCurrentHistorySession(sessionId)) return
    roadRenderer.addSegment(segment)
    clearPreview()
    if (editorStore.continuousDrawing) {
      roadStore.startDrawing(ctx.mode, point, found.id)
    } else {
      roadStore.cancelDrawing()
    }
  }
}

function pickSceneObject(event: MouseEvent): { segmentId?: string; nodeId?: string } | null {
  const camera = cameraRef.value
  if (!camera || !containerRef.value) return null
  const rect = containerRef.value.getBoundingClientRect()
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)
  const meshes = [
    ...Array.from(roadRenderer.segmentMeshes.values()),
    ...Array.from(roadRenderer.nodeMarkers.values()),
  ]
  const intersects = raycaster.intersectObjects(meshes, false)
  if (intersects.length > 0) {
    const object = intersects[0].object
    return {
      segmentId: object.userData.segmentId as string | undefined,
      nodeId: object.userData.nodeId as string | undefined,
    }
  }
  return null
}

function handleSelect(event: MouseEvent): void {
  const picked = pickSceneObject(event)
  if (picked?.segmentId) roadStore.selectSegment(picked.segmentId)
  else if (picked?.nodeId) roadStore.selectNode(picked.nodeId)
  else roadStore.clearSelection()
}

async function handleBulldozer(event: MouseEvent, sessionId: HistorySessionId): Promise<void> {
  const picked = pickSceneObject(event)
  if (!picked?.segmentId) return
  await executeHistoryCommand(new DeleteSegmentCommand(picked.segmentId), sessionId)
  syncRendererWithStore()
}

async function handleRoadUpgrade(event: MouseEvent, sessionId: HistorySessionId): Promise<void> {
  const picked = pickSceneObject(event)
  if (!picked?.segmentId) return
  const segment = roadStore.getSegment(picked.segmentId)
  if (!segment) return
  const profile = getProfileById(editorStore.activeProfileId)
  let command: UpgradeSegmentCommand | null = null

  try {
    const meshData = await buildRoadMesh(segment.centerLine, profile, segment.elevation.startZ)
    if (!isCurrentHistorySession(sessionId)) return
    command = new UpgradeSegmentCommand(segment.id, profile, meshData)
    await executeHistoryCommand(command, sessionId)
    if (!isCurrentHistorySession(sessionId)) return
  } catch {
    editorStore.showNotification({
      type: command?.conflictMessage ? 'warning' : 'error',
      message: command?.conflictMessage ?? '断面升级失败，请检查当前路段与规则配置',
    })
    return
  }

  roadStore.selectSegment(segment.id)
  syncRendererWithStore()
  editorStore.clearError()
}

async function handleParallelRoad(event: MouseEvent, sessionId: HistorySessionId): Promise<void> {
  const picked = pickSceneObject(event)
  if (!picked?.segmentId) return
  const profile = getProfileById(editorStore.activeProfileId)
  const draft = roadStore.createParallelSegmentDraft({
    sourceSegmentId: picked.segmentId,
    profile,
    offsetDistance: profile.totalWidth + 2,
    segmentId: genId(),
    startNodeId: genId(),
    endNodeId: genId(),
  })
  if (!draft) return
  draft.segment.meshData = await buildRoadMesh(draft.segment.centerLine, profile, draft.segment.elevation.startZ)
  if (!isCurrentHistorySession(sessionId)) return
  await executeHistoryCommand(new CreateParallelSegmentCommand(
    draft.segment,
    draft.startNode,
    draft.endNode,
    true,
    true,
  ), sessionId)
  if (!isCurrentHistorySession(sessionId)) return
  roadStore.selectSegment(draft.segment.id)
  syncRendererWithStore()
}

function getLaneAnchorPositions(segmentId: string): LaneAnchor[] {
  const segment = roadStore.getSegment(segmentId)
  if (!segment) return []
  const lanes = roadStore.getLanesBySegment(segmentId)
  if (lanes.length === 0) return []
  const centerLine = segment.centerLine
  const start = centerLine[0]
  const end = centerLine[centerLine.length - 1]
  const dx = end.x - start.x
  const dy = end.y - start.y
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const midX = (start.x + end.x) / 2
  const midY = (start.y + end.y) / 2
  const elevation = segment.elevation.startZ
  const anchors: LaneAnchor[] = []
  let offset = -segment.profile.totalWidth / 2
  for (const lane of lanes) {
    offset += lane.width / 2
    anchors.push({
      segmentId,
      laneId: lane.id,
      laneIndex: lane.index,
      point: { x: midX + nx * offset, y: midY + ny * offset },
      elevation,
    })
    offset += lane.width / 2
  }
  return anchors
}

function updateLaneAnchorMeshes(): void {
  const scene = sceneRef.value
  if (!scene) return
  const isConnectorTool = editorStore.activeTool === 'LANE_CONNECTOR' || editorStore.activeTool === 'LANE_ARROW'
  const activeSegmentId = roadStore.selectedSegmentIds.values().next().value as string | undefined
  for (const [key, mesh] of laneAnchorMeshes) {
    scene.remove(mesh)
    laneAnchorMeshes.delete(key)
  }
  if (!isConnectorTool || !activeSegmentId) return
  const anchors = getLaneAnchorPositions(activeSegmentId)
  for (const anchor of anchors) {
    const isSelected = selectedLaneAnchor.value?.laneId === anchor.laneId
    const mat = isSelected ? selectedLaneAnchorMaterial : laneAnchorMaterial
    const mesh = new THREE.Mesh(laneAnchorGeometry, mat)
    mesh.position.set(anchor.point.x, anchor.elevation + 0.5, anchor.point.y)
    mesh.userData.laneAnchor = anchor
    scene.add(mesh)
    laneAnchorMeshes.set(anchor.laneId, mesh)
  }
}

function updateLaneConnectorMeshes(): void {
  const scene = sceneRef.value
  if (!scene) return
  for (const [id, line] of laneConnectorMeshes) {
    scene.remove(line)
    line.geometry.dispose()
    laneConnectorMeshes.delete(id)
  }
  for (const connector of trafficRuleStore.laneConnectors.values()) {
    const fromLane = roadStore.lanes.get(connector.fromLaneId)
    if (!fromLane) continue
    const geom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(connector.fromAnchor.x, 0.15, connector.fromAnchor.y),
      new THREE.Vector3(connector.toAnchor.x, 0.15, connector.toAnchor.y),
    ])
    const line = new THREE.Line(geom, laneConnectorMaterial)
    line.userData.connectorId = connector.id
    scene.add(line)
    laneConnectorMeshes.set(connector.id, line)
  }
}

function clearLaneConnectorState(): void {
  selectedLaneAnchor.value = null
  const scene = sceneRef.value
  if (scene) {
    for (const [, mesh] of laneAnchorMeshes) {
      scene.remove(mesh)
    }
  }
  laneAnchorMeshes.clear()
}

function pickLaneAnchor(event: MouseEvent): LaneAnchor | null {
  const camera = cameraRef.value
  if (!camera || !containerRef.value) return null
  const rect = containerRef.value.getBoundingClientRect()
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)
  const anchors = Array.from(laneAnchorMeshes.values())
  if (anchors.length === 0) return null
  const intersects = raycaster.intersectObjects(anchors, false)
  if (intersects.length > 0) {
    return intersects[0].object.userData.laneAnchor as LaneAnchor
  }
  return null
}

async function handleLaneConnector(event: MouseEvent, sessionId: HistorySessionId): Promise<void> {
  const anchor = pickLaneAnchor(event)
  if (!anchor) {
    const picked = pickSceneObject(event)
    if (picked?.segmentId) {
      roadStore.selectSegment(picked.segmentId)
      updateLaneAnchorMeshes()
    }
    return
  }
  if (!selectedLaneAnchor.value) {
    selectedLaneAnchor.value = anchor
    updateLaneAnchorMeshes()
    return
  }
  if (selectedLaneAnchor.value.laneId === anchor.laneId) return
  const from = selectedLaneAnchor.value
  const isDuplicate = Array.from(trafficRuleStore.laneConnectors.values()).some(
    (c) => c.fromLaneId === from.laneId && c.toLaneId === anchor.laneId,
  )
  if (isDuplicate) {
    editorStore.showNotification({ type: 'warning', message: '该车道连接已存在' })
    selectedLaneAnchor.value = null
    updateLaneAnchorMeshes()
    return
  }
  const connector: LaneConnector = {
    id: `lc_${from.laneId}_${anchor.laneId}`,
    fromLaneId: from.laneId,
    toLaneId: anchor.laneId,
    fromAnchor: { x: from.point.x, y: from.point.y },
    toAnchor: { x: anchor.point.x, y: anchor.point.y },
  }
  await executeHistoryCommand(new SetLaneConnectorCommand(connector), sessionId)
  selectedLaneAnchor.value = null
  updateLaneAnchorMeshes()
  updateLaneConnectorMeshes()
}

const ARROW_ICONS: Record<TurnDirection, string> = {
  LEFT: '↰',
  STRAIGHT: '↑',
  RIGHT: '↱',
  U_TURN: '↩',
}

function makeArrowCanvas(directions: TurnDirection[]): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, 64, 64)
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 28px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const text = directions.map((d) => ARROW_ICONS[d]).join('')
  ctx.fillText(text, 32, 32)
  return canvas
}

function updateLaneArrowMeshes(): void {
  const scene = sceneRef.value
  if (!scene) return
  for (const [key, sprite] of laneArrowMeshes) {
    scene.remove(sprite)
    sprite.material.map?.dispose()
    sprite.material.dispose()
    laneArrowMeshes.delete(key)
  }
  const isArrowTool = editorStore.activeTool === 'LANE_ARROW'
  const activeSegmentId = roadStore.selectedSegmentIds.values().next().value as string | undefined
  if (!isArrowTool || !activeSegmentId) return
  const segment = roadStore.getSegment(activeSegmentId)
  if (!segment) return
  const anchors = getLaneAnchorPositions(activeSegmentId)
  // Find nodes connected to this segment
  const nodeIds = new Set<string>()
  const startNode = roadStore.getNode(segment.startNodeId)
  const endNode = roadStore.getNode(segment.endNodeId)
  if (startNode) nodeIds.add(startNode.id)
  if (endNode) nodeIds.add(endNode.id)
  for (const anchor of anchors) {
    for (const nodeId of nodeIds) {
      const key = `${nodeId}:${anchor.laneId}`
      const arrow = roadStore.laneArrows.get(key)
      if (!arrow || arrow.allowedDirections.length === 0) continue
      const canvas = makeArrowCanvas(arrow.allowedDirections)
      const texture = new THREE.CanvasTexture(canvas)
      const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.9 })
      const sprite = new THREE.Sprite(mat)
      sprite.position.set(anchor.point.x, anchor.elevation + 1.0, anchor.point.y)
      sprite.scale.set(2, 2, 1)
      scene.add(sprite)
      laneArrowMeshes.set(key, sprite)
    }
  }
}

function handleLaneArrow(event: MouseEvent, _sessionId: HistorySessionId): void {
  const anchor = pickLaneAnchor(event)
  if (!anchor) {
    const picked = pickSceneObject(event)
    if (picked?.segmentId) {
      roadStore.selectSegment(picked.segmentId)
      updateLaneAnchorMeshes()
      updateLaneArrowMeshes()
    }
    return
  }
  // Find the node at the clicked end of the segment
  const segment = roadStore.getSegment(anchor.segmentId)
  if (!segment) return
  const startNode = roadStore.getNode(segment.startNodeId)
  const endNode = roadStore.getNode(segment.endNodeId)
  if (!startNode || !endNode) return
  // Determine which node is closer to the anchor
  const distToStart = Math.hypot(anchor.point.x - startNode.position.x, anchor.point.y - startNode.position.y)
  const distToEnd = Math.hypot(anchor.point.x - endNode.position.x, anchor.point.y - endNode.position.y)
  const nodeId = distToStart < distToEnd ? startNode.id : endNode.id
  const key = `${nodeId}:${anchor.laneId}`
  const existing = roadStore.laneArrows.get(key)
  arrowPickerLaneId.value = anchor.laneId
  arrowPickerNodeId.value = nodeId
  arrowPickerDirections.value = existing ? [...existing.allowedDirections] : []
  arrowPickerPosition.value = { x: event.clientX + 12, y: event.clientY - 20 }
  arrowPickerVisible.value = true
}

async function onArrowPickerApply(data: {
  laneId: string
  nodeId: string
  allowedDirections: TurnDirection[]
}): Promise<void> {
  arrowPickerVisible.value = false
  const sessionId = editorStore.historySessionId
  if (sessionId === null) return
  await executeHistoryCommand(
    new SetLaneArrowCommand({
      laneId: data.laneId,
      nodeId: data.nodeId,
      allowedDirections: data.allowedDirections,
      isManualOverride: true,
    }),
    sessionId,
  )
  updateLaneArrowMeshes()
}

function onArrowPickerCancel(): void {
  arrowPickerVisible.value = false
}

async function handleTrafficLight(event: MouseEvent, sessionId: HistorySessionId): Promise<void> {
  const picked = pickSceneObject(event)
  if (!picked?.nodeId) return
  const id = `tl_${picked.nodeId}`
  await executeHistoryCommand(new AddTrafficLightCommand({
    id,
    nodeId: picked.nodeId,
    strategy: 'FIXED',
    steps: [
      {
        id: `${id}:step:0`,
        greenLanes: [],
        minGreenTime: 30,
        maxGreenTime: 60,
        yellowTime: 3,
        allRedTime: 2,
        sensorBindings: [],
      },
    ],
    sensors: [],
    currentStepIndex: 0,
    timeInCurrentStep: 0,
  }), sessionId)
}

async function onPointerDown(event: MouseEvent): Promise<void> {
  if (event.button !== 0) return
  const sessionId = editorStore.historySessionId
  if (sessionId === null) return
  const world = screenToWorld(event)
  if (!world) return
  const snapped = snapPoint(world)
  if (editorStore.activeTool === 'ROAD_DRAW') await handleRoadDraw(snapped, sessionId)
  else if (editorStore.activeTool === 'SELECT') handleSelect(event)
  else if (editorStore.activeTool === 'ROAD_UPGRADE') await handleRoadUpgrade(event, sessionId)
  else if (editorStore.activeTool === 'PARALLEL_ROAD') await handleParallelRoad(event, sessionId)
  else if (editorStore.activeTool === 'BULLDOZER') await handleBulldozer(event, sessionId)
  else if (editorStore.activeTool === 'TRAFFIC_LIGHT') await handleTrafficLight(event, sessionId)
  else if (editorStore.activeTool === 'LANE_CONNECTOR') await handleLaneConnector(event, sessionId)
  else if (editorStore.activeTool === 'LANE_ARROW') handleLaneArrow(event, sessionId)
}

function syncRendererWithStore(): void {
  for (const id of Array.from(roadRenderer.segmentMeshes.keys())) {
    if (!roadStore.segments.has(id)) roadRenderer.removeSegment(id)
  }
  for (const id of Array.from(roadRenderer.nodeMarkers.keys())) {
    if (!roadStore.nodes.has(id)) roadRenderer.removeNode(id)
  }
  for (const seg of roadStore.segments.values()) roadRenderer.addSegment(seg)
  for (const node of roadStore.nodes.values()) roadRenderer.addNode(node)
}

function onContextMenu(event: MouseEvent): void {
  event.preventDefault()
  roadStore.cancelDrawing()
  clearPreview()
  clearLaneConnectorState()
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    roadStore.cancelDrawing()
    clearPreview()
    clearLaneConnectorState()
    arrowPickerVisible.value = false
  } else if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
    event.preventDefault()
    const sessionId = editorStore.historySessionId
    if (sessionId === null) return
    void historyStack.undo(sessionId).catch((err: unknown) => {
      editorStore.setError(err instanceof Error ? err.message : '撤销失败')
    })
  } else if (
    (event.ctrlKey || event.metaKey) &&
    (event.key === 'y' || (event.shiftKey && event.key === 'Z'))
  ) {
    event.preventDefault()
    const sessionId = editorStore.historySessionId
    if (sessionId === null) return
    void historyStack.redo(sessionId).catch((err: unknown) => {
      editorStore.setError(err instanceof Error ? err.message : '重做失败')
    })
  }
}

watch(
  () => evaluationStore.evalMode,
  () => {
    if (evaluationStore.evalMode === 'NONE') {
      heatmap.clearHeatmap()
      return
    }
    for (const segment of roadStore.segments.values()) {
      const metric = evaluationStore.segmentMetrics.get(segment.id)
      if (!metric) continue
      const existingMesh = roadRenderer.segmentMeshes.get(segment.id)
      heatmap.updateSegmentHeatmap(
        segment.id,
        existingMesh,
        metric,
        evaluationStore.heatmapConfig,
      )
    }
  },
)

watch(
  () => roadStore.topologyVersion,
  () => syncRendererWithStore(),
)

watch(
  () => [editorStore.activeTool, roadStore.selectedSegmentIds.size],
  () => {
    if (editorStore.activeTool !== 'LANE_CONNECTOR') clearLaneConnectorState()
    updateLaneAnchorMeshes()
    updateLaneArrowMeshes()
  },
)

watch(
  () => trafficRuleStore.ruleVersion,
  () => updateLaneConnectorMeshes(),
)

onMounted(() => {
  // renderer.state.value is already set by the composable's own onMounted
  vehicleRenderer.init()
  groundGrid.init()
  cameraControls.attach()
  containerRef.value?.addEventListener('pointermove', onPointerMove)
  containerRef.value?.addEventListener('pointerdown', onPointerDown)
  containerRef.value?.addEventListener('contextmenu', onContextMenu)
  window.addEventListener('keydown', onKeyDown)
  syncRendererWithStore()
  renderer.startRenderLoop(() => {
    if (
      ['SIMULATION', 'TRAFFIC_VOLUME', 'TRAFFIC_ROUTES'].includes(editorStore.viewMode) &&
      simStore.state === 'RUNNING'
    ) {
      if (!simTickInFlight) {
        simTickInFlight = true
        void simStore.tick().finally(() => {
          simTickInFlight = false
        })
      }
      const buf = simStore.getVehicleView()
      if (buf) {
        const lanePositions = new Map<string, THREE.Vector3[]>()
        for (const lane of roadStore.lanes.values()) {
          const seg = roadStore.getSegment(lane.segmentId)
          const pts = (seg?.centerLine ?? []).map(p => new THREE.Vector3(p.x, 0, p.y))
          lanePositions.set(lane.id, pts)
        }
        vehicleRenderer.updateFromBuffer(
          buf,
          simStore.vehicleCount,
          lanePositions,
          Array.from(roadStore.lanes.keys()),
        )
      }
    }
  })
})

onBeforeUnmount(() => {
  containerRef.value?.removeEventListener('pointermove', onPointerMove)
  containerRef.value?.removeEventListener('pointerdown', onPointerDown)
  containerRef.value?.removeEventListener('contextmenu', onContextMenu)
  window.removeEventListener('keydown', onKeyDown)
  clearLaneConnectorState()
  const scene = sceneRef.value
  if (scene) {
    for (const [, line] of laneConnectorMeshes) {
      scene.remove(line)
      line.geometry.dispose()
    }
    laneConnectorMeshes.clear()
  }
  laneAnchorGeometry.dispose()
  laneAnchorMaterial.dispose()
  selectedLaneAnchorMaterial.dispose()
  laneConnectorMaterial.dispose()
  arrowSpriteMaterial.dispose()
  for (const [, sprite] of laneArrowMeshes) {
    sprite.material.map?.dispose()
    sprite.material.dispose()
  }
  laneArrowMeshes.clear()
  cameraControls.detach()
  renderer.dispose()
})
</script>

<style scoped>
.three-viewport {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  background: #1a1d24;
  cursor: crosshair;
}
.viewport-hint {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 14px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  border-radius: 16px;
  font-size: 13px;
  pointer-events: none;
  z-index: 10;
}
.viewport-legend {
  position: absolute;
  bottom: 16px;
  right: 16px;
  width: 200px;
  padding: 10px 12px;
  background: rgba(20, 22, 28, 0.85);
  color: #eee;
  border-radius: 6px;
  font-size: 12px;
}
.legend-title { margin-bottom: 6px; font-weight: 600; }
.legend-bar {
  height: 8px;
  border-radius: 4px;
  background: linear-gradient(to right, #2ecc71, #f1c40f, #e74c3c);
}
.legend-labels {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
  font-size: 11px;
  color: #aaa;
}
</style>
