/**
 * @file 夹角标注计算服务 (FR1.9)
 * 纯函数实现：选中交叉口节点时，计算相邻路段间的夹角
 * 算法：向量点积 acos((v1·v2) / (|v1|·|v2|)) → 度数
 */

import type { Point2D, RoadNode, RoadSegment, AngleAnnotation, AnglePair } from '@/types/road-network'

// ============================================================
// 向量工具
// ============================================================

/** 计算两点向量 from→to */
function vec(from: Point2D, to: Point2D): Point2D {
  return { x: to.x - from.x, y: to.y - from.y }
}

/** 向量点积 */
function dot(a: Point2D, b: Point2D): number {
  return a.x * b.x + a.y * b.y
}

/** 向量模长 */
function magnitude(v: Point2D): number {
  return Math.sqrt(v.x * v.x + v.y * v.y)
}

// ============================================================
// 路段方向向量
// ============================================================

/**
 * 获取路段在指定节点端的方向向量（从节点指向路段另一端）
 * 用于计算两条路段在该节点处的夹角
 */
export function segmentDirectionAtNode(
  segment: RoadSegment,
  nodeId: string,
): Point2D | null {
  const { startNodeId, endNodeId, centerLine } = segment

  if (centerLine.length < 2) return null

  // 路段起点靠近 node → 方向从起点指向终点
  if (startNodeId === nodeId) {
    // 从 centerLine 的起点方向取前几个点确定方向
    const near = centerLine[0]
    // 取距离起点稍远的点以获得更稳定的方向
    const farIdx = Math.min(centerLine.length - 1, Math.max(1, Math.floor(centerLine.length * 0.3)))
    const far = centerLine[farIdx]
    return vec(near, far)
  }

  // 路段终点靠近 node → 方向从终点指向起点
  if (endNodeId === nodeId) {
    const near = centerLine[centerLine.length - 1]
    const farIdx = Math.max(0, centerLine.length - 1 - Math.max(1, Math.floor(centerLine.length * 0.3)))
    const far = centerLine[farIdx]
    return vec(near, far)
  }

  return null
}

// ============================================================
// 夹角计算
// ============================================================

/**
 * 计算两个向量之间的夹角（度数）
 * 使用 acos((v1·v2) / (|v1|·|v2|)) 算法
 */
export function angleBetweenVectors(v1: Point2D, v2: Point2D): number {
  const d = dot(v1, v2)
  const m1 = magnitude(v1)
  const m2 = magnitude(v2)

  if (m1 < 1e-9 || m2 < 1e-9) return 0

  // 限制在 [-1, 1] 范围内避免浮点误差导致 NaN
  const cosAngle = Math.max(-1, Math.min(1, d / (m1 * m2)))
  const rad = Math.acos(cosAngle)
  return (rad * 180) / Math.PI
}

/**
 * 计算指定节点处所有相邻路段对之间的夹角
 * 返回 AngleAnnotation，包含所有路段对的夹角
 */
export function calculateAngleAnnotation(
  node: RoadNode,
  segments: Map<string, RoadSegment>,
): AngleAnnotation {
  const connectedIds = node.connectedSegmentIds
  const pairs: AnglePair[] = []

  if (connectedIds.length < 2) {
    return { nodeId: node.id, pairs }
  }

  // 收集每条路段的方向向量
  const directions: { segmentId: string; dir: Point2D }[] = []
  for (const segId of connectedIds) {
    const seg = segments.get(segId)
    if (!seg) continue
    const dir = segmentDirectionAtNode(seg, node.id)
    if (dir && magnitude(dir) > 1e-9) {
      directions.push({ segmentId: segId, dir })
    }
  }

  // 对所有路段对计算夹角（过滤 180° 直线标注）
  for (let i = 0; i < directions.length; i++) {
    for (let j = i + 1; j < directions.length; j++) {
      const angleDeg = angleBetweenVectors(directions[i].dir, directions[j].dir)
      // 跳过近似 180° 的直线对（无需标注）
      if (angleDeg >= 179.0) continue
      pairs.push({
        fromSegmentId: directions[i].segmentId,
        toSegmentId: directions[j].segmentId,
        angleDeg: Math.round(angleDeg * 10) / 10, // 保留1位小数
      })
    }
  }

  return { nodeId: node.id, pairs }
}
