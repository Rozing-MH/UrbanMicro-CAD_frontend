import type { Point2D, RoadNode, RoadSegment, RoadNetwork } from '@/types/road-network'
import { buildRoadPolygon, unionPolygons } from '@/adapters/Clipper2DAdapter'

// ============================================================
// Topology Healing Service
// Per detailed design: TopologyHealingService class
//   +healOnSegmentAdd(network, newSegment): void
//   +healOnSegmentRemove(network, segmentId): void
//   +splitIntersections(network): void
//   +mergeDegenerateNodes(network): void
// All methods are pure functions returning mutation descriptors.
// ============================================================

export interface SplitResult {
  newNodes: RoadNode[]
  newSegments: RoadSegment[]
  removedSegmentIds: string[]
  // Half-edges that need to be created for new segments
  halfEdgeDefs: Array<{ id: string; originNodeId: string; twinId: string; nextId: string; segmentId: string }>
  // Half-edge IDs that should be removed (for replaced segments)
  removedHalfEdgeIds: string[]
}

export interface RemoveHealResult {
  orphanNodeIds: string[]
  // Nodes whose connectedSegmentIds need updating after removal
  updatedNodes: Array<{ id: string; connectedSegmentIds: string[] }>
  // Half-edge IDs that should be removed for the deleted segment
  removedHalfEdgeIds: string[]
}

// ============================================================
// healOnSegmentAdd — detect intersections, auto-split
// ============================================================

export function healOnSegmentAdd(
  newSegment: RoadSegment,
  network: RoadNetwork,
  genId: () => string,
): SplitResult {
  const result: SplitResult = { newNodes: [], newSegments: [], removedSegmentIds: [], halfEdgeDefs: [], removedHalfEdgeIds: [] }
  const allIntersections: { point: Point2D; segmentId: string }[] = []

  for (const [id, seg] of network.segments) {
    if (id === newSegment.id) continue
    if (seg.startNodeId === newSegment.startNodeId || seg.endNodeId === newSegment.startNodeId) continue
    if (seg.startNodeId === newSegment.endNodeId || seg.endNodeId === newSegment.endNodeId) continue
    const pts = findIntersections(newSegment.centerLine, seg.centerLine)
    for (const pt of pts) {
      allIntersections.push({ point: pt, segmentId: id })
    }
  }

  if (allIntersections.length === 0) return result

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
    // Old half-edges for the replaced segment
    result.removedHalfEdgeIds.push(`${segmentId}:he:forward`, `${segmentId}:he:backward`)
    // New half-edges for the two sub-segments
    for (const seg of [split.seg1, split.seg2]) {
      result.halfEdgeDefs.push(
        { id: `${seg.id}:he:forward`, originNodeId: seg.startNodeId, twinId: `${seg.id}:he:backward`, nextId: '', segmentId: seg.id },
        { id: `${seg.id}:he:backward`, originNodeId: seg.endNodeId, twinId: `${seg.id}:he:forward`, nextId: '', segmentId: seg.id },
      )
    }
  }

  return result
}

// ============================================================
// healOnSegmentRemove — recalculate topology after segment delete
// Cross intersection → T intersection degradation, orphan node cleanup
// ============================================================

export function healOnSegmentRemove(
  segmentId: string,
  network: RoadNetwork,
): RemoveHealResult {
  const result: RemoveHealResult = { orphanNodeIds: [], updatedNodes: [], removedHalfEdgeIds: [] }

  // Half-edges for the removed segment
  result.removedHalfEdgeIds.push(`${segmentId}:he:forward`, `${segmentId}:he:backward`)

  const seg = network.segments.get(segmentId)
  if (!seg) return result

  // Check endpoint nodes for degradation
  for (const nodeId of [seg.startNodeId, seg.endNodeId]) {
    const node = network.nodes.get(nodeId)
    if (!node) continue
    const remaining = node.connectedSegmentIds.filter(id => id !== segmentId)
    if (remaining.length === 0) {
      result.orphanNodeIds.push(nodeId)
    } else {
      result.updatedNodes.push({ id: nodeId, connectedSegmentIds: remaining })
    }
  }

  return result
}

// ============================================================
// splitIntersections — scan all segments for pairwise intersections
// ============================================================

export function splitIntersections(
  network: RoadNetwork,
  genId: () => string,
): SplitResult {
  const result: SplitResult = { newNodes: [], newSegments: [], removedSegmentIds: [], halfEdgeDefs: [], removedHalfEdgeIds: [] }
  const segList = Array.from(network.segments.values())
  const processed = new Set<string>()

  for (let i = 0; i < segList.length; i++) {
    for (let j = i + 1; j < segList.length; j++) {
      const a = segList[i]
      const b = segList[j]
      // Skip if sharing a node
      if (a.startNodeId === b.startNodeId || a.endNodeId === b.startNodeId ||
          a.startNodeId === b.endNodeId || a.endNodeId === b.endNodeId) continue
      // Skip already-replaced segments
      if (processed.has(a.id) || processed.has(b.id)) continue

      const pts = findIntersections(a.centerLine, b.centerLine)
      for (const pt of pts) {
        // Split segment a
        if (!processed.has(a.id)) {
          const splitA = splitSegmentAtPoint(a, pt, network.nodes, genId)
          if (splitA) {
            processed.add(a.id)
            result.newNodes.push(splitA.node)
            result.newSegments.push(splitA.seg1, splitA.seg2)
            result.removedSegmentIds.push(a.id)
            result.removedHalfEdgeIds.push(`${a.id}:he:forward`, `${a.id}:he:backward`)
            for (const seg of [splitA.seg1, splitA.seg2]) {
              result.halfEdgeDefs.push(
                { id: `${seg.id}:he:forward`, originNodeId: seg.startNodeId, twinId: `${seg.id}:he:backward`, nextId: '', segmentId: seg.id },
                { id: `${seg.id}:he:backward`, originNodeId: seg.endNodeId, twinId: `${seg.id}:he:forward`, nextId: '', segmentId: seg.id },
              )
            }
          }
        }
        // Split segment b
        if (!processed.has(b.id)) {
          const splitB = splitSegmentAtPoint(b, pt, network.nodes, genId)
          if (splitB) {
            processed.add(b.id)
            result.newNodes.push(splitB.node)
            result.newSegments.push(splitB.seg1, splitB.seg2)
            result.removedSegmentIds.push(b.id)
            result.removedHalfEdgeIds.push(`${b.id}:he:forward`, `${b.id}:he:backward`)
            for (const seg of [splitB.seg1, splitB.seg2]) {
              result.halfEdgeDefs.push(
                { id: `${seg.id}:he:forward`, originNodeId: seg.startNodeId, twinId: `${seg.id}:he:backward`, nextId: '', segmentId: seg.id },
                { id: `${seg.id}:he:backward`, originNodeId: seg.endNodeId, twinId: `${seg.id}:he:forward`, nextId: '', segmentId: seg.id },
              )
            }
          }
        }
      }
    }
  }

  return result
}

// ============================================================
// mergeDegenerateNodes — merge orphan nodes and co-located nodes
// ============================================================

export function mergeDegenerateNodes(network: RoadNetwork): string[] {
  const orphans: string[] = []
  for (const [id, node] of network.nodes) {
    if (node.connectedSegmentIds.length === 0) {
      orphans.push(id)
    }
  }
  return orphans
}

// ============================================================
// recalculateBoundary — compute intersection polygon for a node
// Offsets each connected segment's centerLine by half-width,
// unions the resulting polygons to get the intersection boundary.
// ============================================================

export function recalculateBoundary(
  nodeId: string,
  nodes: Map<string, RoadNode>,
  segments: Map<string, RoadSegment>,
): Point2D[] {
  const node = nodes.get(nodeId)
  if (!node || node.connectedSegmentIds.length < 2) return []

  const roadPolygons: Point2D[][] = []
  for (const segId of node.connectedSegmentIds) {
    const seg = segments.get(segId)
    if (!seg) continue
    const halfWidth = seg.profile.totalWidth / 2
    if (seg.centerLine.length < 2) continue
    const polygon = buildRoadPolygon(seg.centerLine, halfWidth)
    if (polygon.length >= 3) {
      roadPolygons.push(polygon)
    }
  }

  if (roadPolygons.length < 2) return []

  // Iteratively union all road polygons
  let merged = roadPolygons[0]
  for (let i = 1; i < roadPolygons.length; i++) {
    const result = unionPolygons([merged], [roadPolygons[i]])
    if (result.length > 0) {
      merged = result.reduce((a, b) => a.length >= b.length ? a : b)
    }
  }

  return merged
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

  const totalLen = approximatePolylineLength(cl)
  let accumLen = 0
  for (let i = 0; i < bestIdx; i++) {
    accumLen += dist2D(cl[i], cl[i + 1])
  }
  accumLen += dist2D(cl[bestIdx], cl[bestIdx + 1]) * bestT
  if (accumLen < 1 || accumLen > totalLen - 1) return null

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
    elevation: { startZ: segment.elevation.startZ, endZ: newNode.elevation, mode: segment.elevation.mode },
  }
  const seg2: RoadSegment = {
    ...segment,
    id: seg2Id,
    startNodeId: newNodeId,
    centerLine: cl2,
    length: len2,
    elevation: { startZ: newNode.elevation, endZ: segment.elevation.endZ, mode: segment.elevation.mode },
  }

  return { node: newNode, seg1, seg2 }
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
