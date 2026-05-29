import type { Point2D, RoadNode, RoadSegment } from '@/types/road-network'

// ============================================================
// Smart Snap Types
// ============================================================

export interface SnapResult {
  point: Point2D
  snappedToNode: string | null
  snappedToRoad: string | null
  angleSnapped: boolean
  originalAngle: number
  snappedAngle: number
  guideLine: GuideLine | null
}

export interface GuideLine {
  start: Point2D
  end: Point2D
  type: 'PARALLEL' | 'PERPENDICULAR' | 'ANGLE'
}

// ============================================================
// Constants
// ============================================================

const NODE_SNAP_RADIUS = 2
const ROAD_SNAP_RADIUS = 3
const ANGLE_STEP = 15
const ANGLE_SNAP_THRESHOLD = 5

// ============================================================
// Snap Service (pure functions, no Vue dependency)
// ============================================================

export function snapToNodes(
  point: Point2D,
  nodes: Map<string, RoadNode>,
  radius: number = NODE_SNAP_RADIUS,
): { point: Point2D; nodeId: string | null } {
  let closestId: string | null = null
  let closestDist = radius
  for (const node of nodes.values()) {
    const dx = node.position.x - point.x
    const dy = node.position.y - point.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist < closestDist) {
      closestDist = dist
      closestId = node.id
    }
  }
  if (closestId) {
    const node = nodes.get(closestId)!
    return { point: { x: node.position.x, y: node.position.y }, nodeId: closestId }
  }
  return { point, nodeId: null }
}

export function snapToNearestRoad(
  point: Point2D,
  segments: Map<string, RoadSegment>,
  nodes: Map<string, RoadNode>,
  radius: number = ROAD_SNAP_RADIUS,
): { point: Point2D; segmentId: string | null } {
  let closestId: string | null = null
  let closestDist = radius
  let closestProj: Point2D = point

  for (const seg of segments.values()) {
    const centerLine = seg.centerLine
    for (let i = 0; i < centerLine.length - 1; i++) {
      const a = centerLine[i]
      const b = centerLine[i + 1]
      const proj = projectPointOnSegment(point, a, b)
      const dx = proj.x - point.x
      const dy = proj.y - point.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < closestDist) {
        closestDist = dist
        closestId = seg.id
        closestProj = proj
      }
    }
  }
  return { point: closestId ? closestProj : point, segmentId: closestId }
}

export function snapAngle(
  startPoint: Point2D,
  endPoint: Point2D,
  segments: Map<string, RoadSegment>,
  nodes: Map<string, RoadNode>,
  startNodeId: string | null,
  freeMode: boolean = false,
): { end: Point2D; snappedAngle: number; originalAngle: number; guideLine: GuideLine | null } {
  const dx = endPoint.x - startPoint.x
  const dy = endPoint.y - startPoint.y
  const length = Math.sqrt(dx * dx + dy * dy)
  if (length < 1e-6) {
    return { end: endPoint, snappedAngle: 0, originalAngle: 0, guideLine: null }
  }
  const originalAngle = Math.atan2(dy, dx) * (180 / Math.PI)

  if (freeMode) {
    return { end: endPoint, snappedAngle: originalAngle, originalAngle, guideLine: null }
  }

  // Check parallel/perpendicular to connected segments at start node
  const anchorAngles = getAnchorAngles(startNodeId, segments, nodes, startPoint)
  for (const anchorAngle of anchorAngles) {
    for (const offset of [0, 90, -90, 180, -180]) {
      const targetAngle = normalizeAngle(anchorAngle + offset)
      const diff = angleDiff(originalAngle, targetAngle)
      if (Math.abs(diff) < ANGLE_SNAP_THRESHOLD) {
        const rad = targetAngle * (Math.PI / 180)
        const snapped = {
          x: startPoint.x + Math.cos(rad) * length,
          y: startPoint.y + Math.sin(rad) * length,
        }
        const type: GuideLine['type'] = offset === 0 || Math.abs(offset) === 180 ? 'PARALLEL' : 'PERPENDICULAR'
        return {
          end: snapped,
          snappedAngle: targetAngle,
          originalAngle,
          guideLine: {
            start: { ...startPoint },
            end: { x: startPoint.x + Math.cos(rad) * length * 1.5, y: startPoint.y + Math.sin(rad) * length * 1.5 },
            type,
          },
        }
      }
    }
  }

  // 15-degree angle snapping
  const step = ANGLE_STEP
  const nearestStep = Math.round(originalAngle / step) * step
  const diff = angleDiff(originalAngle, nearestStep)
  if (Math.abs(diff) < ANGLE_SNAP_THRESHOLD) {
    const rad = nearestStep * (Math.PI / 180)
    const snapped = {
      x: startPoint.x + Math.cos(rad) * length,
      y: startPoint.y + Math.sin(rad) * length,
    }
    return {
      end: snapped,
      snappedAngle: nearestStep,
      originalAngle,
      guideLine: {
        start: { ...startPoint },
        end: { x: startPoint.x + Math.cos(rad) * length * 1.5, y: startPoint.y + Math.sin(rad) * length * 1.5 },
        type: 'ANGLE',
      },
    }
  }

  return { end: endPoint, snappedAngle: originalAngle, originalAngle, guideLine: null }
}

export function smartSnap(
  rawPoint: Point2D,
  nodes: Map<string, RoadNode>,
  segments: Map<string, RoadSegment>,
  options: {
    gridSnap: boolean
    gridSize: number
    roadSnap: boolean
    startNodeId: string | null
    startPoint: Point2D | null
    freeMode: boolean
  },
): SnapResult {
  let point = rawPoint

  // 1. Grid snap
  if (options.gridSnap) {
    const g = options.gridSize
    point = { x: Math.round(point.x / g) * g, y: Math.round(point.y / g) * g }
  }

  // 2. Node snap (highest priority)
  const nodeResult = snapToNodes(point, nodes)
  if (nodeResult.nodeId) {
    return {
      point: nodeResult.point,
      snappedToNode: nodeResult.nodeId,
      snappedToRoad: null,
      angleSnapped: false,
      originalAngle: 0,
      snappedAngle: 0,
      guideLine: null,
    }
  }

  // 3. Angle snap (before road snap, so angle constraint applies to cursor position)
  let guideLine: GuideLine | null = null
  if (options.startPoint) {
    const angleResult = snapAngle(point, options.startPoint, segments, nodes, options.startNodeId, options.freeMode)
    // Note: snapAngle uses startPoint→endPoint direction, but we called with point as endPoint
    // The returned end is the angle-snapped version
    point = angleResult.end
    guideLine = angleResult.guideLine
  }

  // 4. Road snap (only if no angle snap happened)
  let snappedToRoad: string | null = null
  if (options.roadSnap && !guideLine) {
    const roadResult = snapToNearestRoad(point, segments, nodes)
    if (roadResult.segmentId) {
      point = roadResult.point
      snappedToRoad = roadResult.segmentId
    }
  }

  return {
    point,
    snappedToNode: null,
    snappedToRoad: snappedToRoad,
    angleSnapped: guideLine !== null,
    originalAngle: 0,
    snappedAngle: 0,
    guideLine,
  }
}

// ============================================================
// Helpers
// ============================================================

function projectPointOnSegment(p: Point2D, a: Point2D, b: Point2D): Point2D {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const apx = p.x - a.x
  const apy = p.y - a.y
  const abLen2 = abx * abx + aby * aby
  if (abLen2 < 1e-10) return { x: a.x, y: a.y }
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLen2))
  return { x: a.x + t * abx, y: a.y + t * aby }
}

function getAnchorAngles(
  startNodeId: string | null,
  segments: Map<string, RoadSegment>,
  nodes: Map<string, RoadNode>,
  startPoint: Point2D,
): number[] {
  const angles: number[] = []
  if (!startNodeId) return angles
  const node = nodes.get(startNodeId)
  if (!node) return angles
  for (const segId of node.connectedSegmentIds) {
    const seg = segments.get(segId)
    if (!seg) continue
    const cl = seg.centerLine
    if (cl.length < 2) continue
    // Direction away from this node
    const isStart = seg.startNodeId === startNodeId
    const a = isStart ? cl[0] : cl[cl.length - 1]
    const b = isStart ? cl[Math.min(1, cl.length - 1)] : cl[Math.max(0, cl.length - 2)]
    const dx = b.x - a.x
    const dy = b.y - a.y
    if (dx * dx + dy * dy < 1e-10) continue
    angles.push(Math.atan2(dy, dx) * (180 / Math.PI))
  }
  return angles
}

function normalizeAngle(angle: number): number {
  let a = angle % 360
  if (a > 180) a -= 360
  if (a <= -180) a += 360
  return a
}

function angleDiff(a: number, b: number): number {
  let d = (a - b) % 360
  if (d > 180) d -= 360
  if (d < -180) d += 360
  return d
}
