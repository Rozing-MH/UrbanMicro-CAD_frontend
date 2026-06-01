/**
 * 切线手柄计算服务 — 对齐设计文档 §4.2.2 TangentHandle / CoonsPatch
 *
 * 纯函数服务，无 Vue/Pinia 依赖。
 * 提供默认切线方向计算、Bezier 控制点生成、手柄世界坐标获取。
 */

import type { Point2D, Point3D, RoadNode, RoadSegment, TangentHandleData } from '@/types/road-network'
import type { SubPatchCurves } from '@/services/coonsPatchBuilder'

// ============================================================
// 默认切线方向计算
// ============================================================

/**
 * 为节点的每个 polygonVertices 顶点计算默认切线方向。
 * 算法：沿相邻边方向的均值，长度 = 相邻边长均值 × 1/3。
 *
 * @param node         目标节点（须有 polygonVertices）
 * @param segments     与节点相连的路段（用于辅助方向计算）
 * @returns 切线手柄数组，与 polygonVertices 等长
 */
export function computeDefaultTangentHandles(
  node: RoadNode,
  segments: RoadSegment[],
): TangentHandleData[] {
  const vertices = node.polygonVertices
  if (vertices.length < 3) return []

  const handles: TangentHandleData[] = []
  const n = vertices.length

  for (let i = 0; i < n; i++) {
    const prev = vertices[(i - 1 + n) % n]
    const curr = vertices[i]
    const next = vertices[(i + 1) % n]

    // 计算入边和出边方向
    const inDir = normalize2D({ x: curr.x - prev.x, y: curr.y - prev.y })
    const outDir = normalize2D({ x: next.x - curr.x, y: next.y - curr.y })

    // 切线方向 = 入边与出边的平均方向
    const tangent = normalize2D({ x: inDir.x + outDir.x, y: inDir.y + outDir.y })

    // 如果平均方向为零（180° 折返），使用出边方向
    const finalDir =
      Math.abs(tangent.x) < 1e-6 && Math.abs(tangent.y) < 1e-6 ? outDir : tangent

    // 默认长度 = 相邻边长均值 × 1/3
    const inLen = dist2D(prev, curr)
    const outLen = dist2D(curr, next)
    const defaultLen = ((inLen + outLen) / 2) * (1 / 3)

    handles.push({
      index: i,
      direction: { x: finalDir.x, y: node.elevation, z: finalDir.y },
      length: defaultLen,
      elevation: node.elevation,
    })
  }

  return handles
}

// ============================================================
// Bezier 控制点生成
// ============================================================

/** 三次 Bezier 曲线的 4 个控制点 */
export interface CubicBezierCurve {
  p0: Point3D
  p1: Point3D
  p2: Point3D
  p3: Point3D
}

/**
 * 根据顶点位置和切线手柄计算三次 Bezier 曲线的 4 个控制点。
 *
 * @param startVertex  起始顶点位置
 * @param startHandle  起始顶点的切线手柄
 * @param endVertex    终止顶点位置
 * @param endHandle    终止顶点的切线手柄
 * @returns 三次 Bezier 曲线的 4 个控制点
 */
export function buildBezierControlPoints(
  startVertex: Point2D,
  startHandle: TangentHandleData,
  endVertex: Point2D,
  endHandle: TangentHandleData,
): CubicBezierCurve {
  const p0: Point3D = {
    x: startVertex.x,
    y: startHandle.elevation,
    z: startVertex.y,
  }
  const p3: Point3D = {
    x: endVertex.x,
    y: endHandle.elevation,
    z: endVertex.y,
  }

  // P1 = P0 + direction × length
  const p1: Point3D = {
    x: p0.x + startHandle.direction.x * startHandle.length,
    y: p0.y + startHandle.direction.y * startHandle.length,
    z: p0.z + startHandle.direction.z * startHandle.length,
  }

  // P2 = P3 - direction × length（手柄方向指向前方，反向即指向 P3）
  const p2: Point3D = {
    x: p3.x - endHandle.direction.x * endHandle.length,
    y: p3.y - endHandle.direction.y * endHandle.length,
    z: p3.z - endHandle.direction.z * endHandle.length,
  }

  return { p0, p1, p2, p3 }
}

// ============================================================
// 手柄世界坐标
// ============================================================

/**
 * 获取切线手柄在 3D 场景中的世界坐标。
 * 手柄位置 = 顶点位置 + 方向 × 长度
 *
 * @param node        目标节点
 * @param handleIndex 手柄索引
 * @returns 手柄端点的 3D 世界坐标
 */
export function getTangentHandleWorldPosition(
  node: RoadNode,
  handleIndex: number,
): Point3D {
  const vertex = node.polygonVertices[handleIndex]
  const handle = node.tangentHandles?.[handleIndex]

  if (!vertex || !handle) {
    return { x: 0, y: 0, z: 0 }
  }

  return {
    x: vertex.x + handle.direction.x * handle.length,
    y: handle.elevation + handle.direction.y * handle.length,
    z: vertex.y + handle.direction.z * handle.length,
  }
}

// ============================================================
// N-gon 子 Patch 边界曲线构造
// ============================================================

/**
 * 为 N-gon 的每个子三角区域（扇形分割）构造 4 条边界曲线。
 * 以质心为公共顶点，将 N 边形扇形分割为 (N-2) 个子四边形区域。
 *
 * 对于每对相邻边 (edge_i, edge_{i+1})，子 Patch 的 4 条边界为：
 * - C0(u): 顶点 i → 顶点 i+1 的边（外边界）
 * - C1(u): 质心 → 质心（内边界，退化为点）
 * - D0(v): 顶点 i → 质心（左侧）
 * - D1(v): 顶点 i+1 → 质心（右侧）
 *
 * @param node  目标节点（须有 polygonVertices + tangentHandles）
 * @returns 子 Patch 的边界曲线数组
 */
export function buildSubPatchCurves(
  node: RoadNode,
): SubPatchCurves[] {
  const vertices = node.polygonVertices
  const handles = node.tangentHandles
  if (vertices.length < 3 || !handles) return []

  // 计算质心
  const centroid = computeCentroid(vertices)
  const n = vertices.length
  const subPatches: SubPatchCurves[] = []

  for (let i = 0; i < n; i++) {
    const nextIdx = (i + 1) % n

    // C0: 顶点 i → 顶点 i+1 的外边界曲线
    const c0 = buildBezierControlPoints(
      vertices[i],
      handles[i],
      vertices[nextIdx],
      handles[nextIdx],
    )

    // D0: 顶点 i → 质心（左侧曲线）
    const d0 = buildLinearCurve(
      vertices[i],
      handles[i].elevation,
      centroid,
      node.elevation,
    )

    // D1: 顶点 i+1 → 质心（右侧曲线）
    const d1 = buildLinearCurve(
      vertices[nextIdx],
      handles[nextIdx].elevation,
      centroid,
      node.elevation,
    )

    // C1: 质心 → 质心（内边界，退化为点）
    const c1 = buildDegenerateCurve(centroid, node.elevation)

    subPatches.push([c0, c1, d0, d1] as SubPatchCurves)
  }

  return subPatches
}

// ============================================================
// 辅助函数
// ============================================================

function normalize2D(v: Point2D): Point2D {
  const len = Math.sqrt(v.x * v.x + v.y * v.y)
  if (len < 1e-10) return { x: 0, y: 0 }
  return { x: v.x / len, y: v.y / len }
}

function dist2D(a: Point2D, b: Point2D): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.sqrt(dx * dx + dy * dy)
}

function computeCentroid(vertices: Point2D[]): Point2D {
  let sx = 0
  let sy = 0
  for (const v of vertices) {
    sx += v.x
    sy += v.y
  }
  return { x: sx / vertices.length, y: sy / vertices.length }
}

/** 构造线性 Bezier 曲线（两个端点 + 两个 1/3 位置控制点） */
function buildLinearCurve(
  from: Point2D,
  fromElev: number,
  to: Point2D,
  toElev: number,
): CubicBezierCurve {
  const p0: Point3D = { x: from.x, y: fromElev, z: from.y }
  const p3: Point3D = { x: to.x, y: toElev, z: to.y }
  // 1/3 和 2/3 位置的线性插值控制点
  const p1: Point3D = {
    x: p0.x + (p3.x - p0.x) / 3,
    y: p0.y + (p3.y - p0.y) / 3,
    z: p0.z + (p3.z - p0.z) / 3,
  }
  const p2: Point3D = {
    x: p0.x + (2 * (p3.x - p0.x)) / 3,
    y: p0.y + (2 * (p3.y - p0.y)) / 3,
    z: p0.z + (2 * (p3.z - p0.z)) / 3,
  }
  return { p0, p1, p2, p3 }
}

/** 构造退化曲线（所有控制点相同 = 单点） */
function buildDegenerateCurve(point: Point2D, elevation: number): CubicBezierCurve {
  const p: Point3D = { x: point.x, y: elevation, z: point.y }
  return { p0: p, p1: p, p2: p, p3: p }
}
