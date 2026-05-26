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
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue'
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
import { historyStack } from '@/commands/HistoryStack'
import { AddSegmentCommand } from '@/commands/roadCommands'
import { triangulateRibbon } from '@/adapters/DelaunayTriangulator'
import type { Point2D, RoadSegment, RoadNode, CrossSectionProfile } from '@/types'

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

const containerRef = ref<HTMLDivElement | null>(null)
const roadStore = useRoadNetworkStore()
const editorStore = useEditorStateStore()
const simStore = useSimulationStore()
const evaluationStore = useEvaluationStore()
const renderer = useThreeRenderer()
const roadRenderer = useRoadRenderer()
const vehicleRenderer = useVehicleRenderer()
const cameraControls = useCameraControls()
const heatmap = useHeatmap()
const groundGrid = useGroundGrid()

function genId(): string {
  return Math.random().toString(36).slice(2, 11) + Date.now().toString(36)
}

const hint = computed(() => {
  switch (editorStore.activeTool) {
    case 'ROAD_DRAW': return '左键放置道路节点，Esc 结束'
    case 'ROAD_EDIT': return '左键选择节点拖动调整'
    case 'TRAFFIC_LIGHT': return '点击交叉口添加信号灯'
    case 'LANE_CONNECTOR': return '依次点击进入车道与目标车道'
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
  const { container, camera } = renderer.state
  if (!container || !camera) return null
  const rect = container.getBoundingClientRect()
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

function buildSegmentMesh(start: Point2D, end: Point2D, width: number) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 0.001) {
    return { positions: new Float32Array(), indices: new Uint32Array(), uvs: new Float32Array() }
  }
  const nx = -dy / len
  const ny = dx / len
  const half = width / 2
  const left: Point2D[] = [
    { x: start.x + nx * half, y: start.y + ny * half },
    { x: end.x + nx * half, y: end.y + ny * half }
  ]
  const right: Point2D[] = [
    { x: start.x - nx * half, y: start.y - ny * half },
    { x: end.x - nx * half, y: end.y - ny * half }
  ]
  return triangulateRibbon(left, right)
}

let previewMesh: THREE.Line | null = null

function drawPreviewLine(a: Point2D, b: Point2D) {
  const { scene } = renderer.state
  if (!scene) return
  if (previewMesh) { scene.remove(previewMesh); previewMesh.geometry.dispose() }
  const geom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(a.x, 0.1, a.y),
    new THREE.Vector3(b.x, 0.1, b.y)
  ])
  const mat = new THREE.LineDashedMaterial({ color: 0x00aaff, dashSize: 1, gapSize: 0.5 })
  previewMesh = new THREE.Line(geom, mat)
  previewMesh.computeLineDistances()
  scene.add(previewMesh)
}

function clearPreview() {
  const { scene } = renderer.state
  if (previewMesh && scene) {
    scene.remove(previewMesh)
    previewMesh.geometry.dispose()
    previewMesh = null
  }
}

function onPointerMove(event: MouseEvent) {
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
    node: { id, position: point, elevation: 0, controlMode: 'NONE', connectedSegmentIds: [], polygonVertices: [] },
  }
}

async function handleRoadDraw(point: Point2D) {
  const ctx = roadStore.drawingContext
  if (ctx.state === 'IDLE') {
    const found = findOrCreateNode(point)
    if (found.created) { roadStore.addNode(found.node); roadRenderer.addNode(found.node) }
    roadStore.startDrawing(roadStore.drawingContext.mode, point, found.id)
  } else if (ctx.state === 'DRAWING' && ctx.startNodeId) {
    const found = findOrCreateNode(point)
    if (found.id === ctx.startNodeId) return
    const startNode = roadStore.getNode(ctx.startNodeId)
    if (!startNode) return
    if (found.created) { roadStore.addNode(found.node); roadRenderer.addNode(found.node) }
    const dx = point.x - startNode.position.x
    const dy = point.y - startNode.position.y
    const segment: RoadSegment = {
      id: genId(),
      startNodeId: ctx.startNodeId,
      endNodeId: found.id,
      centerLine: [startNode.position, point],
      profile: DEFAULT_PROFILE,
      elevation: { startZ: 0, endZ: 0, mode: 'GROUND' },
      isCurved: false,
      length: Math.sqrt(dx * dx + dy * dy),
    }
    const cmd = new AddSegmentCommand(segment, null, null)
    await historyStack.execute(cmd)
    roadRenderer.addSegment(segment)
    clearPreview()
    roadStore.startDrawing(roadStore.drawingContext.mode, point, found.id)
  }
}

function handleSelect(event: MouseEvent) {
  const { scene, camera, container } = renderer.state
  if (!scene || !camera || !container) return
  const rect = container.getBoundingClientRect()
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)
  const intersects = raycaster.intersectObjects(roadRenderer.getSegmentMeshes(), false)
  if (intersects.length > 0) {
    const id = intersects[0].object.userData.segmentId
    if (id) roadStore.selectSegment(id)
  } else {
    roadStore.clearSelection()
  }
}

async function onPointerDown(event: MouseEvent) {
  if (event.button !== 0) return
  const world = screenToWorld(event)
  if (!world) return
  const snapped = snapPoint(world)
  if (editorStore.activeTool === 'ROAD_DRAW') await handleRoadDraw(snapped)
  else if (editorStore.activeTool === 'SELECT') handleSelect(event)
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    roadStore.cancelDrawing()
    clearPreview()
  } else if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
    event.preventDefault()
    historyStack.undo()
  } else if ((event.ctrlKey || event.metaKey) && (event.key === 'y' || (event.shiftKey && event.key === 'Z'))) {
    event.preventDefault()
    historyStack.redo()
  }
}

watch(() => evaluationStore.evalMode, () => {
  if (evaluationStore.evalMode === 'NONE') {
    heatmap.clearHeatmap()
    return
  }
  for (const segment of roadStore.segments.values()) {
    const metric = evaluationStore.segmentMetrics.get(segment.id)
    if (!metric || !segment.meshData) continue
    let value = 0
    switch (evaluationStore.evalMode) {
      case 'SPEED': value = metric.avgSpeed / 30; break
      case 'DENSITY': value = metric.density / 100; break
      case 'DELAY': value = metric.delay / 60; break
      case 'LOS': value = 'ABCDEF'.indexOf(metric.los) / 5; break
    }
    heatmap.updateSegmentHeatmap(segment.id, segment.meshData, value)
  }
})

onMounted(() => {
  if (!containerRef.value) return
  renderer.init(containerRef.value)
  roadRenderer.attach(renderer.state.scene!)
  vehicleRenderer.attach(renderer.state.scene!)
  heatmap.attach(renderer.state.scene!)
  groundGrid.attach(renderer.state.scene!)
  cameraControls.attach(renderer.state.camera!, renderer.state.container!)
  containerRef.value.addEventListener('pointermove', onPointerMove)
  containerRef.value.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('keydown', onKeyDown)
  for (const seg of roadStore.segments.values()) roadRenderer.addSegment(seg)
  for (const node of roadStore.nodes.values()) roadRenderer.addNode(node)
  renderer.startRenderLoop(() => {
    if (editorStore.viewMode === 'SIMULATION' && simStore.state === 'RUNNING') {
      const buf = simStore.getVehicleView()
      if (buf) {
        const lanePositions = new Map<string, THREE.Vector3[]>()
        for (const lane of roadStore.lanes.values()) {
          const seg = roadStore.getSegment(lane.segmentId)
          const pts = (seg?.centerLine ?? []).map(p => new THREE.Vector3(p.x, 0, p.y))
          lanePositions.set(lane.id, pts)
        }
        vehicleRenderer.updateFromBuffer(buf, simStore.vehicleCount, lanePositions, Array.from(roadStore.lanes.keys()))
      }
    }
  })
})

onBeforeUnmount(() => {
  containerRef.value?.removeEventListener('pointermove', onPointerMove)
  containerRef.value?.removeEventListener('pointerdown', onPointerDown)
  window.removeEventListener('keydown', onKeyDown)
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
