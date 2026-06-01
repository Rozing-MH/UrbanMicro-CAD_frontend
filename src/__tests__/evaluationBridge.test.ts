import { describe, it, expect } from 'vitest'
import { aggregateLaneToSegment, aggregateLaneToIntersection, computeEvaluation } from '@/services/evaluationBridge'
import type { BridgeContext } from '@/services/evaluationBridge'
import type { LaneMetricSnapshot } from '@/types/simulation'
import type { Lane, RoadSegment, RoadNode } from '@/types/road-network'

// ============================================================
// Test Data Helpers
// ============================================================

function makeLane(id: string, segmentId: string, direction: Lane['direction'] = 'FORWARD'): Lane {
  return { id, segmentId, index: 0, direction, type: 'CAR', width: 3.5 }
}

function makeSegment(id: string, startNodeId: string, endNodeId: string, length = 100): RoadSegment {
  return {
    id, startNodeId, endNodeId, length,
    centerLine: [{ x: 0, y: 0 }, { x: length, y: 0 }],
    profile: { id: 'default', name: 'Default', lanes: [], totalWidth: 7, median: { type: 'NONE', width: 0 }, sidewalk: { leftWidth: 0, rightWidth: 0, hasCurb: true } },
    elevation: { startZ: 0, endZ: 0, mode: 'GROUND' },
    isCurved: false,
  } as RoadSegment
}

function makeNode(id: string, connectedSegmentIds: string[]): RoadNode {
  return {
    id, position: { x: 0, y: 0 }, elevation: 0,
    controlMode: connectedSegmentIds.length >= 2 ? 'TRAFFIC_LIGHT' : 'NONE',
    connectedSegmentIds, polygonVertices: [],
  }
}

function makeLaneMetric(laneId: string, vehicleCount: number, avgSpeed: number, avgDelay: number, throughput = 100, currentQueueLen = 0): LaneMetricSnapshot {
  return {
    laneId, vehicleCount, avgSpeed, avgDelay, throughput,
    maxQueueLen: currentQueueLen, currentQueueLen, congestionRatio: 0.5,
  }
}

// ============================================================
// aggregateLaneToSegment
// ============================================================

describe('aggregateLaneToSegment', () => {
  it('returns empty array for empty lane metrics', () => {
    const result = aggregateLaneToSegment([], [], [])
    expect(result).toEqual([])
  })

  it('aggregates single lane into segment metric', () => {
    const lane = makeLane('seg1:lane:0', 'seg1')
    const seg = makeSegment('seg1', 'n1', 'n2', 100)
    const lm = makeLaneMetric('seg1:lane:0', 10, 15, 5)

    const result = aggregateLaneToSegment([lm], [lane], [seg])

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('seg1')
    expect(result[0].metric.segmentId).toBe('seg1')
    expect(result[0].metric.avgSpeed).toBeCloseTo(15, 1)
    expect(result[0].metric.delay).toBeCloseTo(5, 1)
    expect(result[0].metric.volume).toBe(100)
  })

  it('computes weighted average speed across multiple lanes', () => {
    const lane0 = makeLane('seg1:lane:0', 'seg1')
    const lane1 = makeLane('seg1:lane:1', 'seg1')
    const seg = makeSegment('seg1', 'n1', 'n2', 100)
    // lane0: 10 vehicles @ 20 m/s, lane1: 5 vehicles @ 10 m/s
    // weighted avg = (10*20 + 5*10) / 15 = 16.67
    const lm0 = makeLaneMetric('seg1:lane:0', 10, 20, 3)
    const lm1 = makeLaneMetric('seg1:lane:1', 5, 10, 8)

    const result = aggregateLaneToSegment([lm0, lm1], [lane0, lane1], [seg])

    expect(result).toHaveLength(1)
    expect(result[0].metric.avgSpeed).toBeCloseTo(16.67, 1)
    // weighted delay: (10*3 + 5*8) / 15 = 4.67
    expect(result[0].metric.delay).toBeCloseTo(4.67, 1)
  })

  it('sums volume across lanes', () => {
    const lane0 = makeLane('seg1:lane:0', 'seg1')
    const lane1 = makeLane('seg1:lane:1', 'seg1')
    const seg = makeSegment('seg1', 'n1', 'n2', 100)
    const lm0 = makeLaneMetric('seg1:lane:0', 5, 20, 3, 200)
    const lm1 = makeLaneMetric('seg1:lane:1', 5, 20, 3, 150)

    const result = aggregateLaneToSegment([lm0, lm1], [lane0, lane1], [seg])

    expect(result[0].metric.volume).toBe(350)
  })

  it('groups metrics by segmentId', () => {
    const lane0 = makeLane('seg1:lane:0', 'seg1')
    const lane1 = makeLane('seg2:lane:0', 'seg2')
    const seg1 = makeSegment('seg1', 'n1', 'n2')
    const seg2 = makeSegment('seg2', 'n2', 'n3')
    const lm0 = makeLaneMetric('seg1:lane:0', 10, 20, 5)
    const lm1 = makeLaneMetric('seg2:lane:0', 5, 10, 10)

    const result = aggregateLaneToSegment([lm0, lm1], [lane0, lane1], [seg1, seg2])

    expect(result).toHaveLength(2)
    const seg1Result = result.find(r => r.id === 'seg1')
    const seg2Result = result.find(r => r.id === 'seg2')
    expect(seg1Result?.metric.avgSpeed).toBeCloseTo(20, 1)
    expect(seg2Result?.metric.avgSpeed).toBeCloseTo(10, 1)
  })

  it('maps delay to LOS grade', () => {
    const lane = makeLane('seg1:lane:0', 'seg1')
    const seg = makeSegment('seg1', 'n1', 'n2')
    // delay=5 → LOS A
    const lm = makeLaneMetric('seg1:lane:0', 10, 20, 5)

    const result = aggregateLaneToSegment([lm], [lane], [seg])
    expect(result[0].metric.los).toBe('A')
  })

  it('maps high delay to LOS F', () => {
    const lane = makeLane('seg1:lane:0', 'seg1')
    const seg = makeSegment('seg1', 'n1', 'n2')
    const lm = makeLaneMetric('seg1:lane:0', 10, 5, 100)

    const result = aggregateLaneToSegment([lm], [lane], [seg])
    expect(result[0].metric.los).toBe('F')
  })

  it('accepts Map inputs', () => {
    const lane = makeLane('seg1:lane:0', 'seg1')
    const seg = makeSegment('seg1', 'n1', 'n2')
    const lm = makeLaneMetric('seg1:lane:0', 10, 20, 5)

    const lanesMap = new Map([[lane.id, lane]])
    const segsMap = new Map([[seg.id, seg]])

    const result = aggregateLaneToSegment([lm], lanesMap, segsMap)
    expect(result).toHaveLength(1)
  })

  it('skips lane metrics without matching lane', () => {
    const seg = makeSegment('seg1', 'n1', 'n2')
    const lm = makeLaneMetric('unknown-lane', 10, 20, 5)

    const result = aggregateLaneToSegment([lm], [], [seg])
    expect(result).toHaveLength(0)
  })
})

// ============================================================
// aggregateLaneToIntersection
// ============================================================

describe('aggregateLaneToIntersection', () => {
  it('returns empty array for empty metrics', () => {
    const nodeToLanes = new Map<string, string[]>()
    const result = aggregateLaneToIntersection([], nodeToLanes, [], [])
    expect(result).toEqual([])
  })

  it('computes intersection LOS from lane metrics', () => {
    const node = makeNode('n1', ['seg1', 'seg2'])
    const lane0 = makeLane('seg1:lane:0', 'seg1')
    const lane1 = makeLane('seg2:lane:0', 'seg2')
    const lm0 = makeLaneMetric('seg1:lane:0', 10, 15, 25)
    const lm1 = makeLaneMetric('seg2:lane:0', 8, 12, 30)

    const nodeToLanes = new Map([['n1', ['seg1:lane:0', 'seg2:lane:0']]])

    const result = aggregateLaneToIntersection(
      [lm0, lm1], nodeToLanes, [node], [lane0, lane1],
    )

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('n1')
    expect(result[0].result.nodeId).toBe('n1')
    // weighted delay: (10*25 + 8*30) / 18 = 27.22
    expect(result[0].result.averageDelay).toBeCloseTo(27.22, 1)
    expect(result[0].result.grade).toBe('C') // 27.22 ≤ 35
  })

  it('sums throughput and queue length', () => {
    const node = makeNode('n1', ['seg1', 'seg2'])
    const lane0 = makeLane('seg1:lane:0', 'seg1')
    const lane1 = makeLane('seg2:lane:0', 'seg2')
    const lm0 = makeLaneMetric('seg1:lane:0', 10, 15, 5, 200, 3)
    const lm1 = makeLaneMetric('seg2:lane:0', 8, 12, 5, 150, 2)

    const nodeToLanes = new Map([['n1', ['seg1:lane:0', 'seg2:lane:0']]])

    const result = aggregateLaneToIntersection(
      [lm0, lm1], nodeToLanes, [node], [lane0, lane1],
    )

    expect(result[0].result.throughput).toBe(350)
    expect(result[0].result.queueLength).toBe(5)
  })

  it('computes approach delays per segment', () => {
    const node = makeNode('n1', ['seg1', 'seg2'])
    const lane0 = makeLane('seg1:lane:0', 'seg1')
    const lane1 = makeLane('seg2:lane:0', 'seg2')
    const lm0 = makeLaneMetric('seg1:lane:0', 10, 15, 20)
    const lm1 = makeLaneMetric('seg2:lane:0', 5, 12, 40)

    const nodeToLanes = new Map([['n1', ['seg1:lane:0', 'seg2:lane:0']]])

    const result = aggregateLaneToIntersection(
      [lm0, lm1], nodeToLanes, [node], [lane0, lane1],
    )

    const approachDelays = result[0].result.approachDelays
    expect(approachDelays.length).toBeGreaterThanOrEqual(1)
    // seg1 approach: 10 vehicles @ delay 20 → avg 20
    const seg1Approach = approachDelays.find(a => a.fromSegmentId === 'seg1')
    expect(seg1Approach?.delay).toBeCloseTo(20, 1)
  })

  it('skips non-intersection nodes (<2 connected segments)', () => {
    const node = makeNode('n1', ['seg1']) // only 1 segment
    const lane = makeLane('seg1:lane:0', 'seg1')
    const lm = makeLaneMetric('seg1:lane:0', 10, 15, 5)

    const nodeToLanes = new Map([['n1', ['seg1:lane:0']]])

    const result = aggregateLaneToIntersection(
      [lm], nodeToLanes, [node], [lane],
    )

    expect(result).toHaveLength(0)
  })

  it('skips nodes with no vehicle data', () => {
    const node = makeNode('n1', ['seg1', 'seg2'])
    const nodeToLanes = new Map([['n1', ['seg1:lane:0']]])

    const result = aggregateLaneToIntersection(
      [], nodeToLanes, [node], [],
    )

    expect(result).toHaveLength(0)
  })
})

// ============================================================
// computeEvaluation (top-level bridge)
// ============================================================

describe('computeEvaluation', () => {
  it('returns empty results for empty lane metrics', () => {
    const ctx: BridgeContext = {
      lanes: [], segments: [], nodes: [], nodeToLanes: new Map(),
    }
    const result = computeEvaluation([], ctx)
    expect(result.segmentMetrics).toEqual([])
    expect(result.intersectionResults).toEqual([])
  })

  it('computes both segment and intersection results', () => {
    const lane0 = makeLane('seg1:lane:0', 'seg1')
    const lane1 = makeLane('seg2:lane:0', 'seg2')
    const seg1 = makeSegment('seg1', 'n1', 'n2')
    const seg2 = makeSegment('seg2', 'n2', 'n3')
    const node = makeNode('n2', ['seg1', 'seg2'])

    const lm0 = makeLaneMetric('seg1:lane:0', 10, 20, 5)
    const lm1 = makeLaneMetric('seg2:lane:0', 8, 15, 10)

    const ctx: BridgeContext = {
      lanes: [lane0, lane1],
      segments: [seg1, seg2],
      nodes: [node],
      nodeToLanes: new Map([['n2', ['seg1:lane:0', 'seg2:lane:0']]]),
    }

    const result = computeEvaluation([lm0, lm1], ctx)

    expect(result.segmentMetrics.length).toBeGreaterThan(0)
    expect(result.intersectionResults.length).toBeGreaterThan(0)
  })
})
