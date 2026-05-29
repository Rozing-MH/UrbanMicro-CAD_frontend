import type { Point2D, RoadNode, RoadSegment, RoadNetwork } from '@/types/road-network'

// ============================================================
// Topology Healing Service
// Pure functions for dynamic topology self-healing.
// ============================================================

export interface SplitResult {
  newNodes: RoadNode[]
  newSegments: RoadSegment[]
  removedSegmentIds: string[]
}

// ============================================================
// Segment Intersection
// ============================================================

function lineSegmentIntersection(
  p1: Point2D, p2: Point2D,
  p3: Point2D, p4: Point2D,
): Point2D | null {
  const d1x = p2.x - p1.x
  const d1y = p2.y - p1.y
  const d2x = p4.x - p3.x
  const d2y = p4.y - p3.y
  const cross = d1x * d2y - d1y * d2x
  if (Math.abs(cross) < 1e-10) return null
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / cross
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / cross
  const EPS = 0.02
  if (t > EPS && t < 1 - EPS && u > EPS && u < 1 - EPS) {
    return { x: p1.x + t * d1x, y: p1.y + t * d1y }
  }
  return null
}

function findIntersections(
  newCenterLine: Point2D[],
  existingCenterLine: Point2D[],
): Point2D[] {
  const results: Point2D[] = []
  for (let i = 0; i < newCenterLine.length - 1; i++) {
    for (let j = 0; j < existingCenterLine.length - 1; j++) {
      const pt = lineSegmentIntersection(
        newCenterLine[i], newCenterLine[i + 1],
        existingCenterLine[j], existingCenterLine[j + 1],
      )
      if (pt) results.push(pt)
    }
  }
  return results
}

// ============================================================
// Split Segment at Point
// ============================================================

function splitSegmentAtPoint(
  segment: RoadSegment,
  point: Point2D,
  nodes: Map<string, RoadNode>,
  genId: () => string,
): { node: RoadNode; seg1: RoadSegment; seg2: RoadSegment } | null {
  const cl = segment.centerLine
  if (cl.length < 2) return null

  // Find closest centerLine segment
  let bestIdx = 0
  let bestDist = Infinity
  let bestT = 0
  for (let i = 0; i < cl.length - 1; i++) {
    const t = projectTOnSegment(point, cl[i], cl[i + 1])
    const proj = { x: cl[i].x + t * (cl[i + 1].x - cl[i].x), y: cl[i].y + t * (cl[i + 1].y - cl[i].y) }
    const dx = proj.x - point.x
    const dy = proj.y - point.y
    const dist = dx * dx + dy * dy
    if (dist < bestDist) {
      bestDist = dist
      bestIdx = i
      bestT = t
    }
  }

  // Don't split too close to existing endpoints
  const totalLen = approximatePolylineLength(cl)
  let accumLen = 0
  for (let i = 0; i < bestIdx; i++) {
    accumLen += dist2D(cl[i], cl[i + 1])
  }
  accumLen += dist2D(cl[bestIdx], cl[bestIdx + 1]) * bestT
  if (accumLen < 1 || accumLen > totalLen - 1) return null

  // Split centerLine
  const cl1: Point2D[] = []
  for (let i = 0; i <= bestIdx; i++) cl1.push({ ...cl[i] })
  cl1.push({ ...point })
  const cl2: Point2D[] = [{ ...point }]
  for (let i = bestIdx + 1; i < cl.length; i++) cl2.push({ ...cl[i] })

  const newNodeId = genId()
  const newNode: RoadNode = {
    id: newNodeId,
    position: { ...point },
    elevation: segment.elevation.startZ + (segment.elevation.endZ - segment.elevation.startZ) * (accumLen / totalLen),
    controlMode: 'NONE',
    connectedSegmentIds: [],
    polygonVertices: [],
  }

  const seg1Id = genId()
  const seg2Id = genId()
  const len1 = approximatePolylineLength(cl1)
  const len2 = approximatePolylineLength(cl2)

  const seg1: RoadSegment = {
    ...segment,
    id: seg1Id,
    endNodeId: newNodeId,
    centerLine: cl1,
    length: len1,
    elevation: {
      startZ: segment.elevation.startZ,
      endZ: newNode.elevation,
      mode: segment.elevation.mode,
    },
  }
  const seg2: RoadSegment = {
    ...segment,
    id: seg2Id,
    startNodeId: newNodeId,
    centerLine: cl2,
    length: len2,
    elevation: {
      startZ: newNode.elevation,
      endZ: segment.elevation.endZ,
      mode: segment.elevation.mode,
    },
  }

  return { node: newNode, seg1, seg2 }
}

// ============================================================
// healOnSegmentAdd — detect intersections, auto-split
// ============================================================

export function healOnSegmentAdd(
  newSegment: RoadSegment,
  network: RoadNetwork,
  genId: () => string,
): SplitResult {
  const result: SplitResult = { newNodes: [], newSegments: [], removedSegmentIds: [] }
  const allIntersections: { point: Point2D; segmentId: string }[] = []

  for (const [id, seg] of network.segments) {
    if (id === newSegment.id) continue
    // Skip segments sharing a node with the new segment
    if (seg.startNodeId === newSegment.startNodeId || seg.endNodeId === newSegment.startNodeId) continue
    if (seg.startNodeId === newSegment.endNodeId || seg.endNodeId === newSegment.endNodeId) continue
    const pts = findIntersections(newSegment.centerLine, seg.centerLine)
    for (const pt of pts) {
      allIntersections.push({ point: pt, segmentId: id })
    }
  }

  if (allIntersections.length === 0) return result

  // Split each intersected existing segment
  const processed = new Set<string>()
  for (const { point, segmentId } of allIntersections) {
    if (processed.has(segmentId)) continue
    processed.add(segmentId)
    const existingSeg = network.segments.get(segmentId)
    if (!existingSeg) continue
    const split = splitSegmentAtPoint(existingSeg, point, network.nodes, genId)
    if (!split) continue
    result.newNodes.push(split.node)
    result.newSegments.push(split.seg1, split.seg2)
    result.removedSegmentIds.push(segmentId)
  }

  return result
}

// ============================================================
// mergeDegenerateNodes — remove orphan nodes with 0 connections
// ============================================================

export function findOrphanNodes(network: RoadNetwork): string[] {
  const orphans: string[] = []
  for (const [id, node] of network.nodes) {
    if (node.connectedSegmentIds.length === 0) {
      orphans.push(id)
    }
  }
  return orphans
}

// ============================================================
// Helpers
// ============================================================

function projectTOnSegment(p: Point2D, a: Point2D, b: Point2D): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const apx = p.x - a.x
  const apy = p.y - a.y
  const abLen2 = abx * abx + aby * aby
  if (abLen2 < 1e-10) return 0
  return Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLen2))
}

function approximatePolylineLength(pts: Point2D[]): number {
  let len = 0
  for (let i = 1; i < pts.length; i++) {
    len += dist2D(pts[i - 1], pts[i])
  }
  return len
}

function dist2D(a: Point2D, b: Point2D): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}
