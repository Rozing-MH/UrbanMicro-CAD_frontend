import { describe, it, expect } from 'vitest'
import { healOnSegmentAdd, healOnSegmentRemove, splitIntersections, mergeDegenerateNodes } from '@/services/topologyHealingService'
import type { RoadNode, RoadSegment, RoadNetwork, Point2D } from '@/types/road-network'

// ============================================================
// Test Data Helpers
// ============================================================

let idCounter = 0
function genId(): string {
  return `gen_${++idCounter}`
}

function resetIdCounter(): void {
  idCounter = 0
}

function makeNode(id: string, position: Point2D, connectedSegmentIds: string[] = []): RoadNode {
  return {
    id, position, elevation: 0,
    controlMode: 'NONE', connectedSegmentIds, polygonVertices: [],
  }
}

function makeSegment(
  id: string, startNodeId: string, endNodeId: string,
  start: Point2D, end: Point2D,
  startZ = 0, endZ = 0,
): RoadSegment {
  const centerLine = [start, end]
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.sqrt(dx * dx + dy * dy)
  return {
    id, startNodeId, endNodeId, length,
    centerLine,
    profile: { id: 'default', name: 'Default', lanes: [], totalWidth: 7, median: { type: 'NONE', width: 0 }, sidewalk: { leftWidth: 0, rightWidth: 0, hasCurb: true } },
    elevation: { startZ, endZ, mode: 'GROUND' },
    isCurved: false,
  } as RoadSegment
}

function makeNetwork(nodes: RoadNode[] = [], segments: RoadSegment[] = []): RoadNetwork {
  return {
    nodes: new Map(nodes.map(n => [n.id, n])),
    segments: new Map(segments.map(s => [s.id, s])),
    lanes: new Map(),
    laneArrows: new Map(),
    halfEdges: new Map(),
  }
}

// ============================================================
// healOnSegmentAdd
// ============================================================

describe('healOnSegmentAdd', () => {
  beforeEach(resetIdCounter)

  it('returns empty result when no intersections', () => {
    const n1 = makeNode('n1', { x: 0, y: 0 })
    const n2 = makeNode('n2', { x: 100, y: 0 })
    const n3 = makeNode('n3', { x: 0, y: 100 })
    const n4 = makeNode('n4', { x: 100, y: 100 })
    const existingSeg = makeSegment('s1', 'n1', 'n2', { x: 0, y: 0 }, { x: 100, y: 0 })
    const newSeg = makeSegment('s2', 'n3', 'n4', { x: 0, y: 100 }, { x: 100, y: 100 })
    const network = makeNetwork([n1, n2, n3, n4], [existingSeg])

    const result = healOnSegmentAdd(newSeg, network, genId)
    expect(result.newNodes).toHaveLength(0)
    expect(result.newSegments).toHaveLength(0)
    expect(result.removedSegmentIds).toHaveLength(0)
  })

  it('detects intersection and splits the existing segment', () => {
    const n1 = makeNode('n1', { x: 0, y: 50 })
    const n2 = makeNode('n2', { x: 100, y: 50 })
    const n3 = makeNode('n3', { x: 50, y: 0 })
    const n4 = makeNode('n4', { x: 50, y: 100 })
    // Horizontal segment
    const existingSeg = makeSegment('s1', 'n1', 'n2', { x: 0, y: 50 }, { x: 100, y: 50 })
    // Vertical segment (crosses horizontal at x=50, y=50)
    const newSeg = makeSegment('s2', 'n3', 'n4', { x: 50, y: 0 }, { x: 50, y: 100 })
    const network = makeNetwork([n1, n2, n3, n4], [existingSeg])

    const result = healOnSegmentAdd(newSeg, network, genId)

    // The existing segment should be split into two sub-segments
    expect(result.newNodes.length).toBeGreaterThanOrEqual(1)
    expect(result.newSegments.length).toBeGreaterThanOrEqual(2)
    expect(result.removedSegmentIds).toContain('s1')
  })

  it('skips segments sharing endpoint nodes', () => {
    const n1 = makeNode('n1', { x: 0, y: 0 })
    const n2 = makeNode('n2', { x: 100, y: 0 })
    const n3 = makeNode('n3', { x: 100, y: 100 })
    const seg1 = makeSegment('s1', 'n1', 'n2', { x: 0, y: 0 }, { x: 100, y: 0 })
    const seg2 = makeSegment('s2', 'n2', 'n3', { x: 100, y: 0 }, { x: 100, y: 100 }) // shares n2
    const network = makeNetwork([n1, n2, n3], [seg1])

    const result = healOnSegmentAdd(seg2, network, genId)
    // Segments sharing an endpoint should NOT be considered intersecting
    expect(result.newNodes).toHaveLength(0)
    expect(result.newSegments).toHaveLength(0)
  })

  it('generates half-edge definitions for new segments', () => {
    const n1 = makeNode('n1', { x: 0, y: 50 })
    const n2 = makeNode('n2', { x: 100, y: 50 })
    const n3 = makeNode('n3', { x: 50, y: 0 })
    const n4 = makeNode('n4', { x: 50, y: 100 })
    const existingSeg = makeSegment('s1', 'n1', 'n2', { x: 0, y: 50 }, { x: 100, y: 50 })
    const newSeg = makeSegment('s2', 'n3', 'n4', { x: 50, y: 0 }, { x: 50, y: 100 })
    const network = makeNetwork([n1, n2, n3, n4], [existingSeg])

    const result = healOnSegmentAdd(newSeg, network, genId)

    // Should have half-edge definitions for each new segment
    expect(result.halfEdgeDefs.length).toBeGreaterThanOrEqual(4) // 2 segments × 2 directions
    expect(result.removedHalfEdgeIds).toContain('s1:he:forward')
    expect(result.removedHalfEdgeIds).toContain('s1:he:backward')
  })
})

// ============================================================
// healOnSegmentRemove
// ============================================================

describe('healOnSegmentRemove', () => {
  it('identifies orphan nodes after segment removal', () => {
    const n1 = makeNode('n1', { x: 0, y: 0 }, ['s1'])
    const n2 = makeNode('n2', { x: 100, y: 0 }, ['s1'])
    const seg = makeSegment('s1', 'n1', 'n2', { x: 0, y: 0 }, { x: 100, y: 0 })
    const network = makeNetwork([n1, n2], [seg])

    const result = healOnSegmentRemove('s1', network)
    expect(result.orphanNodeIds).toHaveLength(2)
    expect(result.orphanNodeIds).toContain('n1')
    expect(result.orphanNodeIds).toContain('n2')
  })

  it('updates connectedSegmentIds for non-orphan nodes', () => {
    const n1 = makeNode('n1', { x: 0, y: 0 }, ['s1', 's2'])
    const n2 = makeNode('n2', { x: 100, y: 0 }, ['s1'])
    const seg1 = makeSegment('s1', 'n1', 'n2', { x: 0, y: 0 }, { x: 100, y: 0 })
    const seg2 = makeSegment('s2', 'n1', 'n3', { x: 0, y: 0 }, { x: 0, y: 100 })
    const network = makeNetwork([n1, n2], [seg1, seg2])

    const result = healOnSegmentRemove('s1', network)
    // n1 should be updated (still has s2), n2 should be orphan
    expect(result.orphanNodeIds).toContain('n2')
    expect(result.updatedNodes.some(u => u.id === 'n1' && u.connectedSegmentIds.includes('s2'))).toBe(true)
  })

  it('includes half-edge IDs for the removed segment', () => {
    const seg = makeSegment('s1', 'n1', 'n2', { x: 0, y: 0 }, { x: 100, y: 0 })
    const network = makeNetwork([], [seg])

    const result = healOnSegmentRemove('s1', network)
    expect(result.removedHalfEdgeIds).toContain('s1:he:forward')
    expect(result.removedHalfEdgeIds).toContain('s1:he:backward')
  })

  it('handles missing segment gracefully', () => {
    const network = makeNetwork()
    const result = healOnSegmentRemove('nonexistent', network)
    expect(result.removedHalfEdgeIds).toHaveLength(2) // always generates these
    expect(result.orphanNodeIds).toHaveLength(0)
  })
})

// ============================================================
// mergeDegenerateNodes
// ============================================================

describe('mergeDegenerateNodes', () => {
  it('finds nodes with zero connected segments', () => {
    const n1 = makeNode('n1', { x: 0, y: 0 }, [])
    const n2 = makeNode('n2', { x: 100, y: 0 }, ['s1'])
    const network = makeNetwork([n1, n2])

    const orphans = mergeDegenerateNodes(network)
    expect(orphans).toContain('n1')
    expect(orphans).not.toContain('n2')
  })

  it('returns empty for network with no orphans', () => {
    const n1 = makeNode('n1', { x: 0, y: 0 }, ['s1'])
    const network = makeNetwork([n1])

    const orphans = mergeDegenerateNodes(network)
    expect(orphans).toHaveLength(0)
  })
})

// ============================================================
// splitIntersections
// ============================================================

describe('splitIntersections', () => {
  beforeEach(resetIdCounter)

  it('finds no intersections for non-crossing segments', () => {
    const n1 = makeNode('n1', { x: 0, y: 0 })
    const n2 = makeNode('n2', { x: 100, y: 0 })
    const n3 = makeNode('n3', { x: 0, y: 100 })
    const n4 = makeNode('n4', { x: 100, y: 100 })
    const seg1 = makeSegment('s1', 'n1', 'n2', { x: 0, y: 0 }, { x: 100, y: 0 })
    const seg2 = makeSegment('s2', 'n3', 'n4', { x: 0, y: 100 }, { x: 100, y: 100 })
    const network = makeNetwork([n1, n2, n3, n4], [seg1, seg2])

    const result = splitIntersections(network, genId)
    expect(result.newNodes).toHaveLength(0)
    expect(result.newSegments).toHaveLength(0)
  })

  it('detects crossing segments and splits them', () => {
    const n1 = makeNode('n1', { x: 0, y: 50 })
    const n2 = makeNode('n2', { x: 100, y: 50 })
    const n3 = makeNode('n3', { x: 50, y: 0 })
    const n4 = makeNode('n4', { x: 50, y: 100 })
    const seg1 = makeSegment('s1', 'n1', 'n2', { x: 0, y: 50 }, { x: 100, y: 50 })
    const seg2 = makeSegment('s2', 'n3', 'n4', { x: 50, y: 0 }, { x: 50, y: 100 })
    const network = makeNetwork([n1, n2, n3, n4], [seg1, seg2])

    const result = splitIntersections(network, genId)

    // Both segments should be split at the crossing point
    expect(result.newNodes.length).toBeGreaterThanOrEqual(2)
    expect(result.newSegments.length).toBeGreaterThanOrEqual(4)
    expect(result.removedSegmentIds).toContain('s1')
    expect(result.removedSegmentIds).toContain('s2')
  })
})
