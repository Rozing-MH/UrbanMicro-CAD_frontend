/**
 * @file DecalRenderer 组合式函数 — 对齐设计文档 §4.3 DecalRenderer 类
 * 使用 Three.js DecalGeometry 将箭头/斑马线/标线投影到路面 mesh 表面
 */
import * as THREE from 'three'
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js'
import type { Ref } from 'vue'
import type { TurnDirection, Point2D } from '@/types/road-network'
import type { LaneMarkingType } from '@/types/traffic-rule'
import { useRoadNetworkStore } from '@/stores/roadNetworkStore'
import { useTrafficRuleStore } from '@/stores/trafficRuleStore'
import {
  getArrowTexture,
  getCrosswalkTexture,
  getMarkingTexture,
} from './decalTextures'

// ─── 贴花 Z-fighting 防护常量 ────────────────────────────────

/** 贴花投影器 Y 偏移量（防止 Z-fighting） */
const DECAL_Y_OFFSET = 0.05
/** 贴花投影器深度（薄盒体，仅贴表面） */
const DECAL_DEPTH = 0.3
/** 箭头贴花尺寸 */
const ARROW_SIZE = new THREE.Vector3(2.5, 2.5, DECAL_DEPTH)
/** 斑马线贴花尺寸 */
const CROSSWALK_SIZE = new THREE.Vector3(6, 3, DECAL_DEPTH)
/** 标线贴花单段最大长度 */
const MARKING_SEGMENT_LEN = 10
/** 标线贴花宽度 */
const MARKING_WIDTH = 0.2

// ─── 车道方向计算工具 ────────────────────────────────────────

/** 计算路段中心线在指定端的方向角 (弧度) */
function centerLineHeadingAtEnd(
  centerLine: Point2D[],
  atStart: boolean,
): number {
  if (centerLine.length < 2) return 0
  const i = atStart ? 0 : centerLine.length - 2
  const j = atStart ? 1 : centerLine.length - 1
  const dx = centerLine[j].x - centerLine[i].x
  const dy = centerLine[j].y - centerLine[i].y
  return Math.atan2(dy, dx)
}

/** 计算车道中心线位置（沿路段中心线偏移） */
function laneCenterPoint(
  centerLine: Point2D[],
  totalWidth: number,
  laneOffset: number,
  elevation: number,
  atEnd: boolean,
): THREE.Vector3 {
  // 使用中心线端点
  const pt = atEnd
    ? centerLine[centerLine.length - 1]
    : centerLine[0]
  // 计算法线方向
  const heading = centerLineHeadingAtEnd(centerLine, atEnd)
  const nx = -Math.sin(heading)
  const ny = Math.cos(heading)
  return new THREE.Vector3(
    pt.x + nx * laneOffset,
    elevation + DECAL_Y_OFFSET,
    pt.y + ny * laneOffset,
  )
}

/** 斑马线位置偏移方向 */
const CROSSWALK_DIR: Record<string, { dx: number; dy: number; rot: number }> = {
  NORTH: { dx: 0, dy: -1, rot: 0 },
  SOUTH: { dx: 0, dy: 1, rot: Math.PI },
  EAST: { dx: 1, dy: 0, rot: Math.PI / 2 },
  WEST: { dx: -1, dy: 0, rot: -Math.PI / 2 },
}

/** 计算车道横向偏移量（从路中心到车道中心） */
function computeLaneOffset(
  segmentId: string,
  laneIndex: number,
): number | null {
  const roadStore = useRoadNetworkStore()
  const segment = roadStore.getSegment(segmentId)
  if (!segment) return null
  const lanes = roadStore.getLanesBySegment(segmentId)
  if (lanes.length === 0) return null

  // 按方向分组计算偏移
  let offset = -segment.profile.totalWidth / 2
  for (const lane of lanes) {
    offset += lane.width / 2
    if (lane.index === laneIndex) return offset
    offset += lane.width / 2
  }
  return null
}

/** 安全获取目标 mesh 并更新矩阵 */
function getTargetMesh(
  meshMap: Map<string, THREE.Mesh>,
  id: string,
): THREE.Mesh | null {
  const mesh = meshMap.get(id)
  if (!mesh) return null
  mesh.updateMatrixWorld(true)
  return mesh
}

/** 创建贴花材质（共享参数） */
function createDecalMaterial(
  texture: THREE.CanvasTexture,
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  })
}

// ─── 组合式函数 ──────────────────────────────────────────────

export function useDecalRenderer(
  scene: Ref<THREE.Scene | null>,
  segmentMeshes: Map<string, THREE.Mesh>,
  intersectionMeshes: Map<string, THREE.Mesh>,
) {
  const decalMeshes: Map<string, THREE.Mesh> = new Map()
  const textureCache: Map<string, THREE.CanvasTexture> = new Map()
  const materialCache: Map<string, THREE.MeshBasicMaterial> = new Map()

  // ─── 工具：获取或创建材质 ──────────────────────────────

  function getOrCreateMaterial(
    cacheKey: string,
    texture: THREE.CanvasTexture,
  ): THREE.MeshBasicMaterial {
    const cached = materialCache.get(cacheKey)
    if (cached) return cached
    const mat = createDecalMaterial(texture)
    materialCache.set(cacheKey, mat)
    return mat
  }

  // ─── 工具：添加贴花 mesh ──────────────────────────────

  function addDecal(key: string, geometry: DecalGeometry, material: THREE.MeshBasicMaterial): void {
    const s = scene.value
    if (!s) return

    // 先清除同 key 的旧贴花
    removeDecal(key)

    const mesh = new THREE.Mesh(geometry, material)
    mesh.renderOrder = 1
    s.add(mesh)
    decalMeshes.set(key, mesh)
  }

  function removeDecal(key: string): void {
    const s = scene.value
    const mesh = decalMeshes.get(key)
    if (!mesh) return
    s?.remove(mesh)
    mesh.geometry.dispose()
    decalMeshes.delete(key)
  }

  // ─── renderArrow ─────────────────────────────────────

  function renderArrow(laneId: string, nodeId: string, directions: TurnDirection[]): void {
    const roadStore = useRoadNetworkStore()
    const lane = roadStore.lanes.get(laneId)
    if (!lane) return
    const segment = roadStore.getSegment(lane.segmentId)
    if (!segment) return
    const node = roadStore.getNode(nodeId)
    if (!node) return

    const targetMesh = getTargetMesh(segmentMeshes, lane.segmentId)
    if (!targetMesh) return

    // 判断车道靠近哪个节点端
    const atEnd = segment.endNodeId === nodeId
    const heading = centerLineHeadingAtEnd(segment.centerLine, atEnd)

    // 计算车道横向偏移
    const laneOffset = computeLaneOffset(lane.segmentId, lane.index)
    if (laneOffset === null) return

    const position = laneCenterPoint(
      segment.centerLine,
      segment.profile.totalWidth,
      laneOffset,
      node.elevation,
      atEnd,
    )

    // DecalGeometry 朝向：先绕 X 轴翻 -90° 使 XY 平面贴到 XZ 地面，再绕 Z 轴旋转朝向
    const euler = new THREE.Euler(-Math.PI / 2, 0, -heading)

    const geometry = new DecalGeometry(targetMesh, position, euler, ARROW_SIZE)
    const texture = getArrowTexture(textureCache, directions)
    const matKey = `arrow:${[...directions].sort().join('+')}`
    const material = getOrCreateMaterial(matKey, texture)

    const key = `arrow:${nodeId}:${laneId}`
    addDecal(key, geometry, material)
  }

  // ─── renderCrosswalk ─────────────────────────────────

  function renderCrosswalk(nodeId: string): void {
    const roadStore = useRoadNetworkStore()
    const ruleStore = useTrafficRuleStore()
    const node = roadStore.getNode(nodeId)
    if (!node) return

    const targetMesh = getTargetMesh(intersectionMeshes, nodeId)
    if (!targetMesh) return

    // 计算路口包围半径（从 polygonVertices 推断）
    const poly = node.polygonVertices
    let maxDist = 5 // 默认 fallback
    if (poly.length > 0) {
      for (const v of poly) {
        const d = Math.hypot(v.x - node.position.x, v.y - node.position.y)
        if (d > maxDist) maxDist = d
      }
    }
    const offset = maxDist * 0.6

    // 获取该节点的活跃人行横道
    const activeCrosswalks: string[] = []
    for (const cw of ruleStore.crosswalks.values()) {
      if (cw.nodeId === nodeId && cw.isActive) {
        activeCrosswalks.push(cw.position)
      }
    }

    // 先清除旧斑马线
    clearDecals(`crosswalk:${nodeId}`)

    if (activeCrosswalks.length === 0) return

    const texture = getCrosswalkTexture(textureCache)
    const material = getOrCreateMaterial('crosswalk', texture)

    for (const pos of activeCrosswalks) {
      const dir = CROSSWALK_DIR[pos]
      if (!dir) continue

      const position = new THREE.Vector3(
        node.position.x + dir.dx * offset,
        node.elevation + DECAL_Y_OFFSET,
        node.position.y + dir.dy * offset,
      )

      const euler = new THREE.Euler(-Math.PI / 2, 0, dir.rot)
      const geometry = new DecalGeometry(targetMesh, position, euler, CROSSWALK_SIZE)

      const key = `crosswalk:${nodeId}:${pos}`
      addDecal(key, geometry, material)
    }
  }

  // ─── renderMarking ───────────────────────────────────

  function renderMarking(laneId: string, markingType: LaneMarkingType): void {
    if (markingType === 'NONE') return
    const roadStore = useRoadNetworkStore()
    const lane = roadStore.lanes.get(laneId)
    if (!lane) return
    const segment = roadStore.getSegment(lane.segmentId)
    if (!segment) return

    const targetMesh = getTargetMesh(segmentMeshes, lane.segmentId)
    if (!targetMesh) return

    const centerLine = segment.centerLine
    if (centerLine.length < 2) return

    const startNode = roadStore.getNode(segment.startNodeId)
    if (!startNode) return

    // 计算车道横向偏移
    const laneOffset = computeLaneOffset(lane.segmentId, lane.index)
    if (laneOffset === null) return

    // 车道边界偏移 = 车道中心偏移 + 车道半宽
    const boundaryOffset = laneOffset + lane.width / 2

    // 先清除旧标线
    clearDecals(`marking:${lane.segmentId}:${laneId}`)

    const texture = getMarkingTexture(textureCache, markingType)
    const matKey = `marking:${markingType}`
    const material = getOrCreateMaterial(matKey, texture)

    // 沿中心线分段投影标线贴花
    const totalLen = segment.length
    const segments = Math.ceil(totalLen / MARKING_SEGMENT_LEN)

    for (let s = 0; s < segments; s++) {
      const t0 = s / segments
      const t1 = (s + 1) / segments
      const tMid = (t0 + t1) / 2

      // 插值中心点
      const idx0 = Math.min(Math.floor(t0 * (centerLine.length - 1)), centerLine.length - 1)
      const idx1 = Math.min(Math.floor(t1 * (centerLine.length - 1)), centerLine.length - 1)
      const p0 = centerLine[idx0]
      const p1 = centerLine[idx1]
      const midX = (p0.x + p1.x) / 2
      const midY = (p0.y + p1.y) / 2

      // 高程插值
      const z = startNode.elevation + (segment.elevation.endZ - segment.elevation.startZ) * tMid

      // 方向角
      const dx = p1.x - p0.x
      const dy = p1.y - p0.y
      const heading = Math.atan2(dy, dx)

      // 法线偏移
      const nx = -Math.sin(heading)
      const ny = Math.cos(heading)

      const position = new THREE.Vector3(
        midX + nx * boundaryOffset,
        z + DECAL_Y_OFFSET,
        midY + ny * boundaryOffset,
      )

      const segLen = Math.min(MARKING_SEGMENT_LEN, totalLen * (t1 - t0))
      const size = new THREE.Vector3(segLen, MARKING_WIDTH, DECAL_DEPTH)
      const euler = new THREE.Euler(-Math.PI / 2, 0, -heading)

      const geometry = new DecalGeometry(targetMesh, position, euler, size)
      const key = `marking:${lane.segmentId}:${laneId}:${s}`
      addDecal(key, geometry, material)
    }
  }

  // ─── clearDecals ─────────────────────────────────────

  function clearDecals(prefix: string): void {
    const keysToRemove: string[] = []
    for (const key of decalMeshes.keys()) {
      if (key.startsWith(prefix)) {
        keysToRemove.push(key)
      }
    }
    for (const key of keysToRemove) {
      removeDecal(key)
    }
  }

  // ─── syncAllDecals ───────────────────────────────────

  function syncAllDecals(): void {
    const roadStore = useRoadNetworkStore()
    const ruleStore = useTrafficRuleStore()

    // 清空全部旧贴花
    clearAllDecals()

    // 渲染所有车道箭头
    for (const arrow of roadStore.laneArrows.values()) {
      if (arrow.allowedDirections.length > 0) {
        renderArrow(arrow.laneId, arrow.nodeId, arrow.allowedDirections)
      }
    }

    // 渲染所有人行横道（按节点分组）
    const crosswalkNodes = new Set<string>()
    for (const cw of ruleStore.crosswalks.values()) {
      if (cw.isActive) crosswalkNodes.add(cw.nodeId)
    }
    for (const nodeId of crosswalkNodes) {
      renderCrosswalk(nodeId)
    }

    // 渲染所有车道标线
    for (const restriction of ruleStore.laneRestrictions.values()) {
      if (restriction.markingType !== 'NONE') {
        renderMarking(restriction.laneId, restriction.markingType)
      }
    }
  }

  function clearAllDecals(): void {
    const s = scene.value
    for (const [, mesh] of decalMeshes) {
      s?.remove(mesh)
      mesh.geometry.dispose()
    }
    decalMeshes.clear()
  }

  // ─── dispose ─────────────────────────────────────────

  function dispose(): void {
    clearAllDecals()
    // 释放共享材质
    for (const [, mat] of materialCache) {
      mat.dispose()
    }
    materialCache.clear()
    // 释放缓存纹理
    for (const [, tex] of textureCache) {
      tex.dispose()
    }
    textureCache.clear()
  }

  return {
    renderArrow,
    renderCrosswalk,
    renderMarking,
    clearDecals,
    syncAllDecals,
    dispose,
    decalMeshes,
  }
}
