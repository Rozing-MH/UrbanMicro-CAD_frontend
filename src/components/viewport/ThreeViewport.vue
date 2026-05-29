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
    <Teleport to="body">
      <div v-if="trPickerVisible" class="tr-picker" :style="{ left: trPickerPosition.x + 'px', top: trPickerPosition.y + 'px' }">
        <div class="tr-picker-title">转向限制</div>
        <div class="tr-picker-row">
          <label>来向路段</label>
          <select v-model="trPickerFromSegId">
            <option v-for="s in trPickerConnectedSegs" :key="s.id" :value="s.id">{{ s.label }}</option>
          </select>
        </div>
        <div class="tr-picker-row">
          <label>去向路段</label>
          <select v-model="trPickerToSegId">
            <option v-for="s in trPickerConnectedSegs" :key="s.id" :value="s.id">{{ s.label }}</option>
          </select>
        </div>
        <div class="tr-picker-row">
          <label>限制类型</label>
          <select v-model="trPickerRestriction">
            <option v-for="opt in restrictionOpts" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
        </div>
        <div class="tr-picker-actions">
          <button @click="onTurnRestrictionApply">确认</button>
          <button @click="onTurnRestrictionCancel">取消</button>
        </div>
      </div>
    </Teleport>
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
import { useCrossSectionEditorStore } from '@/stores/crossSectionEditorStore'
import { historyStack, type HistorySessionId } from '@/commands/HistoryStack'
import {
  AddSegmentCommand,
  AddTrafficLightCommand,
  CreateParallelSegmentCommand,
  DeleteSegmentCommand,
  MoveNodeCommand,
  SetLaneArrowCommand,
  SetLaneConnectorCommand,
  SetTurnRestrictionCommand,
  UpgradeSegmentCommand,
} from '@/commands/roadCommands'
import { buildSegmentGeometry, createSegmentFromPoints, rebuildCurvedCenterLine } from '@/utils/roadGeometry'
import { getProfileById } from '@/utils/roadProfiles'
import { buildQuadraticCenterLine, approximateCurveLength } from '@/adapters/BezierJsAdapter'
import { smartSnap, buildViewTransform, type SnapResult, type GuideLine } from '@/services/snapService'
import { healOnSegmentAdd, recalculateBoundary } from '@/services/topologyHealingService'
import LaneArrowPicker from '@/components/panels/LaneArrowPicker.vue'
import type { Lane, LaneConnector, Point2D, RoadSegment, RoadNode, CrossSectionProfile, MeshData, TurnDirection, ElevationMode, DrawingMode } from '@/types'
import { SLOPE_LIMITS } from '@/types/road-network'
import type { TurnRestriction as TurnRestrictionType } from '@/types/traffic-rule'

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
const csEditor = useCrossSectionEditorStore()

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
    case 'ROAD_DRAW': {
      const ctx = roadStore.drawingContext
      if (ctx.mode === 'CURVE' && curveEndPoint.value) return '移动鼠标调整曲线弧度，左键确认，Esc 取消'
      if (ctx.mode === 'CURVE') return '左键放置曲线终点，Esc 取消'
      if (ctx.mode === 'FREE') return '左键放置道路节点（自由模式），Esc 结束'
      return '左键放置道路节点，Esc 结束，Shift 自由模式'
    }
    case 'ROAD_UPGRADE': return '点击路段，使用左侧当前断面原位升级'
    case 'PARALLEL_ROAD': return '点击路段，按当前断面宽度生成平行路'
    case 'BULLDOZER': return '点击路段删除，支持撤销/重做'
    case 'ROAD_EDIT': return '左键选择节点拖动调整'
    case 'TRAFFIC_LIGHT': return '点击交叉口添加信号灯'
    case 'LANE_CONNECTOR': return selectedLaneAnchor.value ? '点击目标车道完成连接，Esc 取消' : '点击源车道锚点开始连接'
    case 'LANE_ARROW': return '点击车道锚点设置转向箭头'
    case 'TURN_RESTRICTION': return '点击交叉口节点设置转向限制'
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
  const ctx = roadStore.drawingContext
  const cam = cameraRef.value
  const container = containerRef.value
  let viewTransform = null
  if (cam && container) {
    viewTransform = buildViewTransform(
      { position: { x: cam.position.x, y: cam.position.y, z: cam.position.z }, fov: cam.fov },
      container.clientWidth,
      container.clientHeight,
    )
  }
  const result = smartSnap(p, roadStore.nodes, roadStore.segments, {
    gridSnap: editorStore.snapToGrid,
    gridSize: editorStore.gridSize,
    roadSnap: editorStore.snapToRoad,
    startNodeId: ctx.startNodeId,
    startPoint: ctx.startPoint,
    freeMode: shiftHeld.value || roadStore.drawingContext.mode === 'FREE',
    viewTransform,
  })
  lastSnapResult.value = result
  return result.point
}

function updateSnapVisuals(result: SnapResult | null): void {
  const scene = sceneRef.value
  if (!scene) return

  // Remove old guide line
  if (guideLineMesh) {
    scene.remove(guideLineMesh)
    guideLineMesh.geometry.dispose()
    guideLineMesh = null
  }
  // Remove old snap highlight
  if (snapHighlightMesh) {
    scene.remove(snapHighlightMesh)
    snapHighlightMesh = null
  }

  if (!result) return

  // Highlight snapped node
  if (result.snappedToNode) {
    const node = roadStore.nodes.get(result.snappedToNode)
    if (node) {
      snapHighlightMesh = new THREE.Mesh(snapHighlightGeometry, snapHighlightMaterial)
      snapHighlightMesh.rotation.x = -Math.PI / 2
      snapHighlightMesh.position.set(node.position.x, 0.15, node.position.y)
      scene.add(snapHighlightMesh)
    }
  }

  // Draw guide line for angle snap
  if (result.angleSnapped && result.guideLine) {
    const gl = result.guideLine
    const pts = [new THREE.Vector3(gl.start.x, 0.1, gl.start.y), new THREE.Vector3(gl.end.x, 0.1, gl.end.y)]
    const geo = new THREE.BufferGeometry().setFromPoints(pts)
    guideLineMesh = new THREE.Line(geo, guideLineMaterial)
    guideLineMesh.computeLineDistances()
    scene.add(guideLineMesh)
  }
}

function clearSnapVisuals(): void {
  const scene = sceneRef.value
  if (guideLineMesh && scene) {
    scene.remove(guideLineMesh)
    guideLineMesh.geometry.dispose()
    guideLineMesh = null
  }
  if (snapHighlightMesh && scene) {
    scene.remove(snapHighlightMesh)
    snapHighlightMesh = null
  }
  lastSnapResult.value = null
}

interface LaneAnchor {
  segmentId: string
  laneId: string
  laneIndex: number
  point: Point2D
  elevation: number
}

let previewGroup: THREE.Group | null = null
let simTickInFlight = false
const isDragging = ref(false)
const dragNodeId = ref<string | null>(null)
const dragStartNodePos = ref<Point2D | null>(null)

// Curve drawing state: after setting start+end, mouse controls the Bezier handle
const curveEndPoint = ref<Point2D | null>(null)
const curveEndNodeId = ref<string | null>(null)
const curveEndNodeCreated = ref(false)
const curveEndNode = ref<RoadNode | null>(null)

// Smart snap state
const shiftHeld = ref(false)
const lastSnapResult = ref<SnapResult | null>(null)
let guideLineMesh: THREE.Line | null = null
let snapHighlightMesh: THREE.Mesh | null = null
const snapHighlightGeometry = new THREE.RingGeometry(0.8, 1.2, 16)
const snapHighlightMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false })
const guideLineMaterial = new THREE.LineDashedMaterial({ color: 0x00ff88, dashSize: 0.5, gapSize: 0.3, transparent: true, opacity: 0.6 })
const selectedLaneAnchor = ref<LaneAnchor | null>(null)
const laneAnchorMeshes: Map<string, THREE.Mesh> = new Map()
const laneConnectorMeshes: Map<string, THREE.Line> = new Map()
const laneAnchorGeometry = new THREE.SphereGeometry(0.3, 8, 8)
const laneAnchorMaterial = new THREE.MeshBasicMaterial({ color: 0x41c9ff })
const selectedLaneAnchorMaterial = new THREE.MeshBasicMaterial({ color: 0xffd166 })
const laneConnectorMaterial = new THREE.LineBasicMaterial({ color: 0xffb020 })

// Road preview materials (shared, not disposed per-frame)
const previewSurfaceMaterial = new THREE.MeshBasicMaterial({
  color: 0x3a7bd5,
  transparent: true,
  opacity: 0.4,
  side: THREE.DoubleSide,
  depthWrite: false,
})
const previewLaneDividerMaterial = new THREE.LineDashedMaterial({
  color: 0xffffff,
  dashSize: 0.5,
  gapSize: 0.3,
  transparent: true,
  opacity: 0.7,
})
const previewCenterLineMaterial = new THREE.LineBasicMaterial({
  color: 0xffcc00,
  transparent: true,
  opacity: 0.8,
})
const previewCenterLineDashedMaterial = new THREE.LineDashedMaterial({
  color: 0xffcc00,
  dashSize: 1,
  gapSize: 0.5,
  transparent: true,
  opacity: 0.6,
})
const previewEdgeMaterial = new THREE.LineBasicMaterial({
  color: 0x666666,
  transparent: true,
  opacity: 0.5,
})

// Lane arrow picker state
const arrowPickerVisible = ref(false)
const arrowPickerPosition = ref({ x: 0, y: 0 })
const arrowPickerLaneId = ref('')
const arrowPickerNodeId = ref('')
const arrowPickerDirections = ref<TurnDirection[]>([])
const laneArrowMeshes: Map<string, THREE.Sprite> = new Map()
const arrowSpriteMaterial = new THREE.SpriteMaterial({ color: 0xffffff, opacity: 0.9 })

// Turn restriction picker state
const trPickerVisible = ref(false)
const trPickerPosition = ref({ x: 0, y: 0 })
const trPickerNodeId = ref('')
const trPickerFromSegId = ref('')
const trPickerToSegId = ref('')
const trPickerRestriction = ref<TurnRestrictionType['restriction']>('NO_LEFT')
const trPickerConnectedSegs = ref<{ id: string; label: string }[]>([])

const RESTRICTION_OPTIONS: { value: TurnRestrictionType['restriction']; label: string }[] = [
  { value: 'NO_LEFT', label: '禁止左转' },
  { value: 'NO_RIGHT', label: '禁止右转' },
  { value: 'NO_STRAIGHT', label: '禁止直行' },
  { value: 'NO_UTURN', label: '禁止掉头' },
  { value: 'NONE', label: '无限制' },
]
const restrictionOpts = RESTRICTION_OPTIONS

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

function makePreviewLine(
  start: Point2D, end: Point2D,
  nx: number, ny: number, offset: number, elev: number,
  material: THREE.Material,
): THREE.Line {
  const geom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(start.x + nx * offset, elev, start.y + ny * offset),
    new THREE.Vector3(end.x + nx * offset, elev, end.y + ny * offset),
  ])
  return new THREE.Line(geom, material)
}

function createMeasurementSprite(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas')
  const W = 256, H = 64
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = 'rgba(0, 0, 0, 0.65)'
  ctx.beginPath()
  ctx.moveTo(8, 0)
  ctx.lineTo(W - 8, 0)
  ctx.quadraticCurveTo(W, 0, W, 8)
  ctx.lineTo(W, H - 8)
  ctx.quadraticCurveTo(W, H, W - 8, H)
  ctx.lineTo(8, H)
  ctx.quadraticCurveTo(0, H, 0, H - 8)
  ctx.lineTo(0, 8)
  ctx.quadraticCurveTo(0, 0, 8, 0)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 28px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, W / 2, H / 2)
  const texture = new THREE.CanvasTexture(canvas)
  const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })
  const sprite = new THREE.Sprite(spriteMat)
  sprite.scale.set(4, 1, 1)
  return sprite
}

function drawPreviewRoad(
  start: Point2D,
  end: Point2D,
  profile: CrossSectionProfile,
  centerLine?: Point2D[],
): void {
  const scene = sceneRef.value
  if (!scene) return
  clearPreview()

  // Use provided centerLine (curve) or fall back to straight [start, end]
  const pts = centerLine && centerLine.length >= 2 ? centerLine : [start, end]
  const length = approximateCurveLength(pts)
  if (length < 0.5) return

  const halfWidth = profile.totalWidth / 2
  const E = 0.15

  const group = new THREE.Group()

  // Semi-transparent road surface — red if slope exceeds limit
  const elevDiff = (roadStore.drawingContext.endElevation ?? 0) - (roadStore.drawingContext.startElevation ?? 0)
  const slopePct = length > 0.01 ? Math.abs(elevDiff / length * 100) : 0
  const elevationMode: ElevationMode = roadStore.drawingContext.currentElevationMode
  const slopeLimit = SLOPE_LIMITS[elevationMode]
  const slopeOverLimit = slopePct > slopeLimit
  const surfaceMat = slopeOverLimit
    ? new THREE.MeshBasicMaterial({ color: 0xcc3333, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })
    : previewSurfaceMaterial

  // Build ribbon surface from centerLine
  const leftEdge = offsetCenterLineLocal(pts, halfWidth)
  const rightEdge = offsetCenterLineLocal(pts, -halfWidth)
  if (leftEdge.length === rightEdge.length && leftEdge.length >= 2) {
    const verts: number[] = []
    const norms: number[] = []
    const idx: number[] = []
    for (let i = 0; i < leftEdge.length; i++) {
      verts.push(leftEdge[i].x, E, leftEdge[i].y)
      norms.push(0, 1, 0)
      verts.push(rightEdge[i].x, E, rightEdge[i].y)
      norms.push(0, 1, 0)
    }
    for (let i = 0; i < leftEdge.length - 1; i++) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1
      idx.push(a, b, c, c, b, d)
    }
    const surfGeom = new THREE.BufferGeometry()
    surfGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3))
    surfGeom.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(norms), 3))
    surfGeom.setIndex(idx)
    group.add(new THREE.Mesh(surfGeom, surfaceMat))
  }

  // Lane divider lines (dashed white)
  const totalLaneW = profile.lanes.reduce((s, l) => s + l.width, 0)
  let lanePos = -totalLaneW / 2
  for (let i = 0; i < profile.lanes.length - 1; i++) {
    lanePos += profile.lanes[i].width
    const divPts = offsetCenterLineLocal(pts, lanePos)
    if (divPts.length >= 2) {
      const lg = new THREE.BufferGeometry().setFromPoints(
        divPts.map(p => new THREE.Vector3(p.x, E + 0.01, p.y))
      )
      const line = new THREE.Line(lg, previewLaneDividerMaterial)
      line.computeLineDistances()
      group.add(line)
    }
  }

  // Center line (yellow — solid if median, dashed otherwise)
  const clPoints = pts.map(p => new THREE.Vector3(p.x, E + 0.01, p.y))
  const clGeom = new THREE.BufferGeometry().setFromPoints(clPoints)
  if (profile.median && profile.median.width > 0) {
    group.add(new THREE.Line(clGeom, previewCenterLineMaterial))
  } else {
    const cl = new THREE.Line(clGeom, previewCenterLineDashedMaterial)
    cl.computeLineDistances()
    group.add(cl)
  }

  // Edge lines (road surface boundary)
  for (const edge of [leftEdge, rightEdge]) {
    if (edge.length >= 2) {
      const eg = new THREE.BufferGeometry().setFromPoints(
        edge.map(p => new THREE.Vector3(p.x, E + 0.01, p.y))
      )
      group.add(new THREE.Line(eg, previewEdgeMaterial))
    }
  }

  // Measurement label (length + slope + mode)
  const midIdx = Math.floor(pts.length / 2)
  const midPt = pts[midIdx]
  const dx = end.x - start.x
  const dy = end.y - start.y
  const baseLen = Math.hypot(dx, dy) || 1
  const perpX = -dy / baseLen
  const perpY = dx / baseLen
  const slopeStr = slopePct.toFixed(1)
  const modeLabel: Record<string, string> = { GROUND: '地面', BRIDGE: '高架', TUNNEL: '隧道', ANARCHY: '自由' }
  const slopeWarning = slopeOverLimit ? ' !坡度超限' : ''
  const label = createMeasurementSprite(`${length.toFixed(1)}m | ${slopeStr}% | ${modeLabel[elevationMode] ?? elevationMode}${slopeWarning}`)
  label.position.set(midPt.x + perpX * (halfWidth + 2), E + 0.8, midPt.y + perpY * (halfWidth + 2))
  group.add(label)

  scene.add(group)
  previewGroup = group
}

function offsetCenterLineLocal(centerLine: Point2D[], offset: number): Point2D[] {
  if (centerLine.length < 2) return centerLine.map(p => ({ ...p }))
  const result: Point2D[] = []
  for (let i = 0; i < centerLine.length; i++) {
    let nx: number, ny: number
    if (i === 0) {
      nx = centerLine[1].x - centerLine[0].x
      ny = centerLine[1].y - centerLine[0].y
    } else if (i === centerLine.length - 1) {
      nx = centerLine[i].x - centerLine[i - 1].x
      ny = centerLine[i].y - centerLine[i - 1].y
    } else {
      nx = centerLine[i + 1].x - centerLine[i - 1].x
      ny = centerLine[i + 1].y - centerLine[i - 1].y
    }
    const len = Math.sqrt(nx * nx + ny * ny)
    if (len < 1e-10) { result.push({ ...centerLine[i] }); continue }
    result.push({
      x: centerLine[i].x + (-ny / len) * offset,
      y: centerLine[i].y + (nx / len) * offset,
    })
  }
  return result
}

function applyTopologyHealing(newSegment: RoadSegment): void {
  const network = { nodes: roadStore.nodes, segments: roadStore.segments, lanes: roadStore.lanes, laneArrows: roadStore.laneArrows, halfEdges: roadStore.halfEdges }
  const result = healOnSegmentAdd(newSegment, network, genId)
  // Remove old half-edges for replaced segments
  for (const heId of result.removedHalfEdgeIds) {
    roadStore.removeHalfEdge(heId)
  }
  // Remove replaced segments
  for (const segId of result.removedSegmentIds) {
    roadStore.removeSegment(segId)
    roadRenderer.removeSegment(segId)
  }
  // Add new nodes
  for (const node of result.newNodes) {
    roadStore.addNode(node)
    roadRenderer.addNode(node)
  }
  // Add new segments (addSegment auto-creates half-edges via ensureSegmentHalfEdges)
  for (const seg of result.newSegments) {
    roadStore.addSegment(seg)
    roadRenderer.addSegment(seg)
  }
  // Recalculate boundary polygons for affected nodes
  recalculateBoundaryForNode(newSegment.startNodeId)
  recalculateBoundaryForNode(newSegment.endNodeId)
  for (const node of result.newNodes) {
    recalculateBoundaryForNode(node.id)
  }
}

function recalculateBoundaryForNode(nodeId: string): void {
  const boundary = recalculateBoundary(nodeId, roadStore.nodes, roadStore.segments)
  roadStore.updateNode(nodeId, { polygonVertices: boundary })
  roadRenderer.updateIntersectionPolygon(nodeId, boundary)
}

function clearPreview(): void {
  const scene = sceneRef.value
  if (previewGroup && scene) {
    scene.remove(previewGroup)
    previewGroup.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        child.geometry.dispose()
      }
      if (child instanceof THREE.Sprite) {
        if (child.material instanceof THREE.SpriteMaterial && child.material.map) {
          child.material.map.dispose()
        }
        child.material.dispose()
      }
    })
    previewGroup = null
  }
}

function onPointerMove(event: MouseEvent): void {
  const world = screenToWorld(event)
  if (!world) return
  if (isDragging.value && dragNodeId.value) {
    roadStore.updateNode(dragNodeId.value, { position: { x: world.x, y: world.y } })
    rebuildSegmentsForNode(dragNodeId.value)
    return
  }
  const snapped = snapPoint(world)
  if (editorStore.activeTool === 'ROAD_DRAW' && roadStore.drawingContext.state === 'DRAWING') {
    roadStore.updatePreview(snapped)
    updateSnapVisuals(lastSnapResult.value)
    if (roadStore.drawingContext.startPoint) {
      const profile = getProfileById(editorStore.activeProfileId)
      // In CURVE mode with endpoint set, mouse controls the Bezier handle
      if (roadStore.drawingContext.mode === 'CURVE' && curveEndPoint.value) {
        const curveCenterLine = buildQuadraticCenterLine(
          roadStore.drawingContext.startPoint,
          snapped,
          curveEndPoint.value,
          32,
        )
        drawPreviewRoad(roadStore.drawingContext.startPoint, curveEndPoint.value, profile, curveCenterLine)
      } else {
        drawPreviewRoad(roadStore.drawingContext.startPoint, snapped, profile)
      }
    }
  } else {
    clearSnapVisuals()
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
    if (ctx.mode === 'CURVE' && !curveEndPoint.value) {
      // CURVE step 2: set endpoint, then mouse controls the Bezier handle
      const found = findOrCreateNode(point)
      if (found.id === ctx.startNodeId) return
      if (found.created) {
        roadStore.addNode(found.node)
        roadRenderer.addNode(found.node)
      }
      curveEndPoint.value = point
      curveEndNodeId.value = found.id
      curveEndNodeCreated.value = found.created
      curveEndNode.value = found.node
    } else if (ctx.mode === 'CURVE' && curveEndPoint.value) {
      // CURVE step 3: set control point and create the curved segment
      const startNode = roadStore.getNode(ctx.startNodeId)
      if (!startNode) return
      const profile = getProfileById(editorStore.activeProfileId)
      const curveCenterLine = buildQuadraticCenterLine(
        ctx.startPoint!,
        point,
        curveEndPoint.value,
        32,
      )
      const elevation = {
        startZ: ctx.startElevation,
        endZ: ctx.endElevation,
        mode: ctx.currentElevationMode,
      }
      const segment: RoadSegment = createSegmentFromPoints({
        id: genId(),
        startNodeId: ctx.startNodeId,
        endNodeId: curveEndNodeId.value!,
        centerLine: curveCenterLine,
        profile,
        elevation,
        isCurved: true,
        controlPoint: point,
        meshData: await buildRoadMesh(curveCenterLine, profile, elevation.startZ),
      })
      if (!isCurrentHistorySession(sessionId)) return
      const cmd = new AddSegmentCommand(segment, startNode, curveEndNode.value!, true, curveEndNodeCreated.value)
      await executeHistoryCommand(cmd, sessionId)
      if (!isCurrentHistorySession(sessionId)) return
      roadRenderer.addSegment(segment)
      applyTopologyHealing(segment)
      clearPreview()
      resetCurveState()
      if (editorStore.continuousDrawing) {
        roadStore.startDrawing(ctx.mode, curveEndPoint.value, curveEndNodeId.value)
      } else {
        roadStore.cancelDrawing()
      }
    } else {
      // STRAIGHT mode: two-click create segment
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
      applyTopologyHealing(segment)
      clearPreview()
      if (editorStore.continuousDrawing) {
        roadStore.startDrawing(ctx.mode, point, found.id)
      } else {
        roadStore.cancelDrawing()
      }
    }
  }
}

function resetCurveState(): void {
  curveEndPoint.value = null
  curveEndNodeId.value = null
  curveEndNodeCreated.value = false
  curveEndNode.value = null
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

function handleRoadEdit(event: MouseEvent): void {
  const picked = pickSceneObject(event)
  if (!picked?.nodeId) {
    roadStore.clearSelection()
    return
  }
  roadStore.selectNode(picked.nodeId)
  const node = roadStore.getNode(picked.nodeId)
  if (!node) return
  isDragging.value = true
  dragNodeId.value = picked.nodeId
  dragStartNodePos.value = { x: node.position.x, y: node.position.y }
  cameraControls.state.isDragging = false
  cameraControls.state.isOrbiting = false
}

function rebuildSegmentsForNode(nodeId: string): void {
  const node = roadStore.getNode(nodeId)
  if (!node) return
  const scene = sceneRef.value
  if (!scene) return
  const marker = roadRenderer.nodeMarkers.get(nodeId)
  if (marker) {
    marker.position.set(node.position.x, node.elevation + 0.1, node.position.y)
  }
  for (const segId of node.connectedSegmentIds) {
    const seg = roadStore.getSegment(segId)
    if (!seg) continue
    if (seg.isCurved && seg.controlPoint) {
      const startNode = roadStore.getNode(seg.startNodeId)
      const endNode = roadStore.getNode(seg.endNodeId)
      if (startNode && endNode) {
        const newCenterLine = rebuildCurvedCenterLine(seg, startNode.position, endNode.position)
        roadStore.updateSegment(segId, { centerLine: newCenterLine, length: approximateCurveLength(newCenterLine) })
        const updated = roadStore.getSegment(segId)
        if (updated) {
          roadRenderer.removeSegment(segId)
          roadRenderer.addSegment(updated)
        }
        continue
      }
    }
    roadRenderer.removeSegment(segId)
    roadRenderer.addSegment(seg)
  }
  // Recalculate intersection boundary after segments changed
  recalculateBoundaryForNode(nodeId)
}

function onPointerUp(): void {
  if (!isDragging.value) return
  const nodeId = dragNodeId.value
  const fromPos = dragStartNodePos.value
  if (nodeId && fromPos) {
    const node = roadStore.getNode(nodeId)
    if (node && (node.position.x !== fromPos.x || node.position.y !== fromPos.y)) {
      const from3d = { x: fromPos.x, y: fromPos.y, z: node.elevation }
      const to3d = { x: node.position.x, y: node.position.y, z: node.elevation }
      roadStore.updateNode(nodeId, { position: fromPos })
      const sessionId = editorStore.historySessionId
      if (sessionId !== null) {
        void historyStack.execute(new MoveNodeCommand(nodeId, from3d, to3d), sessionId).catch(() => {})
      }
    }
  }
  isDragging.value = false
  dragNodeId.value = null
  dragStartNodePos.value = null
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

function handleTurnRestriction(event: MouseEvent, _sessionId: HistorySessionId): void {
  const picked = pickSceneObject(event)
  if (!picked?.nodeId) return
  const node = roadStore.getNode(picked.nodeId)
  if (!node || node.connectedSegmentIds.length < 2) {
    editorStore.showNotification({ type: 'warning', message: '请选择至少连接两条路段的交叉口节点' })
    return
  }
  const segs = node.connectedSegmentIds
    .map((id) => { const s = roadStore.getSegment(id); return s ? { id: s.id, label: `${s.id.slice(0, 6)}…` } : null })
    .filter(Boolean) as { id: string; label: string }[]
  trPickerNodeId.value = node.id
  trPickerFromSegId.value = segs[0]?.id ?? ''
  trPickerToSegId.value = segs.length > 1 ? segs[1].id : segs[0]?.id ?? ''
  trPickerRestriction.value = 'NO_LEFT'
  trPickerConnectedSegs.value = segs
  trPickerPosition.value = { x: event.clientX + 12, y: event.clientY - 20 }
  trPickerVisible.value = true
}

async function onTurnRestrictionApply(): Promise<void> {
  trPickerVisible.value = false
  const sessionId = editorStore.historySessionId
  if (sessionId === null) return
  await executeHistoryCommand(
    new SetTurnRestrictionCommand({
      nodeId: trPickerNodeId.value,
      fromSegmentId: trPickerFromSegId.value,
      toSegmentId: trPickerToSegId.value,
      restriction: trPickerRestriction.value,
    }),
    sessionId,
  )
}

function onTurnRestrictionCancel(): void {
  trPickerVisible.value = false
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
  else if (editorStore.activeTool === 'TURN_RESTRICTION') handleTurnRestriction(event, sessionId)
  else if (editorStore.activeTool === 'ROAD_EDIT') handleRoadEdit(event)
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
  resetCurveState()
  clearPreview()
  clearLaneConnectorState()
}

const ELEVATION_STEP = 1

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Shift') {
    shiftHeld.value = true
    return
  }
  if (event.key === 'Escape') {
    if (isDragging.value && dragNodeId.value && dragStartNodePos.value) {
      roadStore.updateNode(dragNodeId.value, { position: dragStartNodePos.value })
      rebuildSegmentsForNode(dragNodeId.value)
      isDragging.value = false
      dragNodeId.value = null
      dragStartNodePos.value = null
    }
    roadStore.cancelDrawing()
    resetCurveState()
    clearPreview()
    clearLaneConnectorState()
    arrowPickerVisible.value = false
    trPickerVisible.value = false
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
  } else if (event.key === 'F1') {
    event.preventDefault()
    roadStore.setElevationMode('GROUND')
  } else if (event.key === 'F2') {
    event.preventDefault()
    roadStore.setElevationMode('BRIDGE')
  } else if (event.key === 'F3') {
    event.preventDefault()
    roadStore.setElevationMode('TUNNEL')
  } else if (event.ctrlKey && event.shiftKey && (event.key === 'a' || event.key === 'A')) {
    event.preventDefault()
    roadStore.setElevationMode('ANARCHY')
  } else if (event.key === 'PageUp' && editorStore.activeTool === 'ROAD_DRAW') {
    event.preventDefault()
    const ctx = roadStore.drawingContext
    const newEndZ = (ctx.endElevation ?? 0) + ELEVATION_STEP
    roadStore.updatePreview(ctx.previewEndPoint ?? ctx.startPoint ?? { x: 0, y: 0 }, ctx.controlPoint, newEndZ)
  } else if (event.key === 'PageDown' && editorStore.activeTool === 'ROAD_DRAW') {
    event.preventDefault()
    const ctx = roadStore.drawingContext
    const newEndZ = (ctx.endElevation ?? 0) - ELEVATION_STEP
    roadStore.updatePreview(ctx.previewEndPoint ?? ctx.startPoint ?? { x: 0, y: 0 }, ctx.controlPoint, newEndZ)
  } else if ((event.key === 'c' || event.key === 'C') && editorStore.activeTool === 'ROAD_DRAW') {
    event.preventDefault()
    const nextMode: Record<DrawingMode, DrawingMode> = { STRAIGHT: 'CURVE', CURVE: 'FREE', FREE: 'STRAIGHT' }
    roadStore.setDrawingMode(nextMode[roadStore.drawingContext.mode])
  }
}

function onKeyUp(event: KeyboardEvent): void {
  if (event.key === 'Shift') {
    shiftHeld.value = false
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

// Cross-section editor 3D preview: rebuild target segment mesh when profile changes
watch(
  () => [csEditor.previewDirty, csEditor.profile?.totalWidth, csEditor.targetSegmentId],
  async () => {
    const segId = csEditor.targetSegmentId
    if (!segId || !csEditor.profile) return
    const seg = roadStore.getSegment(segId)
    if (!seg) return
    const meshData = await buildSegmentGeometry(seg.centerLine, csEditor.profile, seg.elevation.startZ)
    roadStore.updateSegment(segId, { profile: csEditor.profile, meshData })
    const updated = roadStore.getSegment(segId)
    if (updated) {
      roadRenderer.removeSegment(segId)
      roadRenderer.addSegment(updated)
    }
  },
)

onMounted(() => {
  // renderer.state.value is already set by the composable's own onMounted
  vehicleRenderer.init()
  groundGrid.init()
  cameraControls.attach()
  containerRef.value?.addEventListener('pointermove', onPointerMove)
  containerRef.value?.addEventListener('pointerdown', onPointerDown)
  containerRef.value?.addEventListener('pointerup', onPointerUp)
  containerRef.value?.addEventListener('contextmenu', onContextMenu)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
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
  containerRef.value?.removeEventListener('pointerup', onPointerUp)
  containerRef.value?.removeEventListener('contextmenu', onContextMenu)
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  clearSnapVisuals()
  snapHighlightGeometry.dispose()
  snapHighlightMaterial.dispose()
  guideLineMaterial.dispose()
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
.tr-picker {
  position: fixed;
  z-index: 9999;
  background: #1f232b;
  border: 1px solid #4a8cd0;
  border-radius: 8px;
  padding: 12px 16px;
  color: #d8dde6;
  font-size: 12px;
  min-width: 200px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.5);
}
.tr-picker-title {
  font-weight: 600;
  margin-bottom: 10px;
  color: #6cb6ff;
}
.tr-picker-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.tr-picker-row label {
  color: #8e94a0;
  margin-right: 8px;
}
.tr-picker-row select {
  flex: 1;
  padding: 3px 6px;
  background: #14171c;
  border: 1px solid #2a2f3a;
  color: #d8dde6;
  border-radius: 3px;
  font-size: 12px;
}
.tr-picker-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}
.tr-picker-actions button {
  padding: 4px 14px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  color: #fff;
}
.tr-picker-actions button:first-child { background: #2c5d99; }
.tr-picker-actions button:first-child:hover { background: #3670b8; }
.tr-picker-actions button:last-child { background: #4a5160; }
.tr-picker-actions button:last-child:hover { background: #5a6270; }
</style>
