import { describe, it, expect } from 'vitest'
import { validateRules } from '@/services/ruleValidation'
import type { ValidationContext } from '@/services/ruleValidation'
import type { RoadNode, RoadSegment, Lane, LaneArrow } from '@/types/road-network'
import type {
  TrafficLightController,
  LaneRestriction,
  LaneConnector,
  TurnRestriction,
  Crosswalk,
} from '@/types/traffic-rule'

// ============================================================
// Test Data Helpers
// ============================================================

function makeNode(id: string, controlMode: RoadNode['controlMode'] = 'NONE', connectedSegmentIds: string[] = []): RoadNode {
  return {
    id, position: { x: 0, y: 0 }, elevation: 0,
    controlMode, connectedSegmentIds, polygonVertices: [],
  }
}

function makeSegment(id: string, startNodeId: string, endNodeId: string): RoadSegment {
  return {
    id, startNodeId, endNodeId, length: 100,
    centerLine: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
    profile: { id: 'default', name: 'Default', lanes: [], totalWidth: 7, median: { type: 'NONE', width: 0 }, sidewalk: { leftWidth: 0, rightWidth: 0, hasCurb: true } },
    elevation: { startZ: 0, endZ: 0, mode: 'GROUND' },
    isCurved: false,
  } as RoadSegment
}

function makeLane(id: string, segmentId: string, direction: Lane['direction'] = 'FORWARD'): Lane {
  return { id, segmentId, index: 0, direction, type: 'CAR', width: 3.5 }
}

function makeTrafficLight(id: string, nodeId: string, steps: TrafficLightController['steps'] = []): TrafficLightController {
  return { id, nodeId, strategy: 'FIXED', steps, sensors: [], currentStepIndex: 0, timeInCurrentStep: 0 }
}

function makeLaneConnector(id: string, fromLaneId: string, toLaneId: string): LaneConnector {
  return { id, fromLaneId, toLaneId } as LaneConnector
}

function makeLaneRestriction(laneId: string): LaneRestriction {
  return { laneId, speedLimit: 60, allowedVehicleTypes: ['CAR'], markingType: 'SOLID_WHITE', isBusOnly: false, allowLeftChange: true, allowRightChange: true } as LaneRestriction
}

function makeTurnRestriction(nodeId: string, fromSegId: string, toSegId: string, restriction: TurnRestriction['restriction'] = 'NO_LEFT'): TurnRestriction {
  return { nodeId, fromSegmentId: fromSegId, toSegmentId: toSegId, restriction } as TurnRestriction
}

function makeCrosswalk(id: string, nodeId: string): Crosswalk {
  return { id, nodeId, position: 'NORTH' as const, isActive: true } as Crosswalk
}

function makeContext(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    nodes: new Map(),
    segments: new Map(),
    lanes: new Map(),
    laneArrows: new Map(),
    laneConnectors: new Map(),
    laneRestrictions: new Map(),
    turnRestrictions: new Map(),
    trafficLights: new Map(),
    crosswalks: new Map(),
    ...overrides,
  }
}

// ============================================================
// Dangling References
// ============================================================

describe('checkDanglingReferences', () => {
  it('detects dangling lane reference in connector', () => {
    const ctx = makeContext({
      laneConnectors: new Map([['c1', makeLaneConnector('c1', 'missing-lane-1', 'missing-lane-2')]]),
    })
    const result = validateRules(ctx)
    expect(result.issues.length).toBeGreaterThanOrEqual(2)
    expect(result.issues.some(i => i.checkId === 'DANGLING_LANE_REF')).toBe(true)
  })

  it('detects dangling lane reference in restriction', () => {
    const ctx = makeContext({
      laneRestrictions: new Map([['r1', makeLaneRestriction('missing-lane')]]),
    })
    const result = validateRules(ctx)
    expect(result.issues.some(i => i.checkId === 'DANGLING_LANE_REF' && i.ruleType === 'LANE_RESTRICTION')).toBe(true)
  })

  it('detects dangling node reference in traffic light', () => {
    const ctx = makeContext({
      trafficLights: new Map([['tl1', makeTrafficLight('tl1', 'missing-node')]]),
    })
    const result = validateRules(ctx)
    expect(result.issues.some(i => i.checkId === 'DANGLING_NODE_REF' && i.ruleType === 'TRAFFIC_LIGHT')).toBe(true)
  })

  it('detects dangling node reference in turn restriction', () => {
    const ctx = makeContext({
      turnRestrictions: new Map([['tr1', makeTurnRestriction('missing-node', 's1', 's2')]]),
    })
    const result = validateRules(ctx)
    expect(result.issues.some(i => i.checkId === 'DANGLING_NODE_REF' && i.ruleType === 'TURN_RESTRICTION')).toBe(true)
  })

  it('detects dangling node reference in crosswalk', () => {
    const ctx = makeContext({
      crosswalks: new Map([['cw1', makeCrosswalk('cw1', 'missing-node')]]),
    })
    const result = validateRules(ctx)
    expect(result.issues.some(i => i.checkId === 'DANGLING_NODE_REF' && i.ruleType === 'CROSSWALK')).toBe(true)
  })

  it('passes with all valid references', () => {
    const node = makeNode('n1', 'TRAFFIC_LIGHT', ['s1'])
    const seg = makeSegment('s1', 'n1', 'n2')
    const lane = makeLane('s1:lane:0', 's1')

    const ctx = makeContext({
      nodes: new Map([[node.id, node]]),
      segments: new Map([[seg.id, seg]]),
      lanes: new Map([[lane.id, lane]]),
      laneConnectors: new Map([['c1', makeLaneConnector('c1', 's1:lane:0', 's1:lane:0')]]),
    })
    const result = validateRules(ctx)
    expect(result.issues.some(i => i.checkId === 'DANGLING_LANE_REF')).toBe(false)
  })
})

// ============================================================
// Cross-Node Connectors
// ============================================================

describe('checkCrossNodeConnectors', () => {
  it('detects connector spanning non-adjacent segments', () => {
    // seg1: n1→n2, seg2: n3→n4 (no shared node)
    const seg1 = makeSegment('s1', 'n1', 'n2')
    const seg2 = makeSegment('s2', 'n3', 'n4')
    const lane1 = makeLane('s1:lane:0', 's1')
    const lane2 = makeLane('s2:lane:0', 's2')

    const ctx = makeContext({
      segments: new Map([[seg1.id, seg1], [seg2.id, seg2]]),
      lanes: new Map([[lane1.id, lane1], [lane2.id, lane2]]),
      laneConnectors: new Map([['c1', makeLaneConnector('c1', 's1:lane:0', 's2:lane:0')]]),
    })
    const result = validateRules(ctx)
    expect(result.issues.some(i => i.checkId === 'CROSS_NODE_CONNECTOR')).toBe(true)
  })

  it('allows connector between adjacent segments', () => {
    // seg1: n1→n2, seg2: n2→n3 (shared node n2)
    const seg1 = makeSegment('s1', 'n1', 'n2')
    const seg2 = makeSegment('s2', 'n2', 'n3')
    const lane1 = makeLane('s1:lane:0', 's1')
    const lane2 = makeLane('s2:lane:0', 's2')

    const ctx = makeContext({
      segments: new Map([[seg1.id, seg1], [seg2.id, seg2]]),
      lanes: new Map([[lane1.id, lane1], [lane2.id, lane2]]),
      laneConnectors: new Map([['c1', makeLaneConnector('c1', 's1:lane:0', 's2:lane:0')]]),
    })
    const result = validateRules(ctx)
    expect(result.issues.some(i => i.checkId === 'CROSS_NODE_CONNECTOR')).toBe(false)
  })

  it('allows connector within same segment', () => {
    const seg = makeSegment('s1', 'n1', 'n2')
    const lane1 = makeLane('s1:lane:0', 's1')
    const lane2 = makeLane('s1:lane:1', 's1')

    const ctx = makeContext({
      segments: new Map([[seg.id, seg]]),
      lanes: new Map([[lane1.id, lane1], [lane2.id, lane2]]),
      laneConnectors: new Map([['c1', makeLaneConnector('c1', 's1:lane:0', 's1:lane:1')]]),
    })
    const result = validateRules(ctx)
    expect(result.issues.some(i => i.checkId === 'CROSS_NODE_CONNECTOR')).toBe(false)
  })
})

// ============================================================
// Dead-End Lanes
// ============================================================

describe('checkDeadEndLanes', () => {
  it('detects incoming lane with no outgoing connector', () => {
    const node = makeNode('n1', 'TRAFFIC_LIGHT', ['s1', 's2'])
    const seg1 = makeSegment('s1', 'n1', 'n2') // lane0 is outgoing from n1
    const seg2 = makeSegment('s2', 'n3', 'n1') // lane1 is incoming to n1 (FORWARD from n3→n1)
    // Actually: FORWARD lane on s2 goes n3→n1, so at n1 it's incoming
    const lane1 = makeLane('s2:lane:0', 's2', 'FORWARD') // incoming at n1
    const lane2 = makeLane('s1:lane:0', 's1', 'FORWARD') // outgoing at n1

    // No connectors from lane1 to lane2 → lane1 is dead-end incoming
    const ctx = makeContext({
      nodes: new Map([[node.id, node]]),
      segments: new Map([[seg1.id, seg1], [seg2.id, seg2]]),
      lanes: new Map([[lane1.id, lane1], [lane2.id, lane2]]),
      laneConnectors: new Map(),
    })
    const result = validateRules(ctx)
    expect(result.issues.some(i => i.checkId === 'DEAD_END_INCOMING')).toBe(true)
  })

  it('no warning when all incoming lanes have outgoing connectors', () => {
    const node = makeNode('n1', 'TRAFFIC_LIGHT', ['s1', 's2'])
    const seg1 = makeSegment('s1', 'n1', 'n2')
    const seg2 = makeSegment('s2', 'n3', 'n1')
    const lane1 = makeLane('s2:lane:0', 's2', 'FORWARD') // incoming at n1
    const lane2 = makeLane('s1:lane:0', 's1', 'FORWARD') // outgoing at n1

    const ctx = makeContext({
      nodes: new Map([[node.id, node]]),
      segments: new Map([[seg1.id, seg1], [seg2.id, seg2]]),
      lanes: new Map([[lane1.id, lane1], [lane2.id, lane2]]),
      laneConnectors: new Map([['c1', makeLaneConnector('c1', 's2:lane:0', 's1:lane:0')]]),
    })
    const result = validateRules(ctx)
    expect(result.issues.some(i => i.checkId === 'DEAD_END_INCOMING')).toBe(false)
  })
})

// ============================================================
// Signal Phase Conflicts
// ============================================================

describe('checkSignalPhaseConflicts', () => {
  it('detects duplicate green lane in different steps', () => {
    const node = makeNode('n1', 'TRAFFIC_LIGHT', ['s1'])
    const seg = makeSegment('s1', 'n1', 'n2')
    const lane = makeLane('s1:lane:0', 's1')

    const light = makeTrafficLight('tl1', 'n1', [
      { id: 'step1', greenLanes: ['s1:lane:0'], minGreenTime: 30, maxGreenTime: 60, yellowTime: 3, allRedTime: 1, sensorBindings: [] },
      { id: 'step2', greenLanes: ['s1:lane:0'], minGreenTime: 30, maxGreenTime: 60, yellowTime: 3, allRedTime: 1, sensorBindings: [] },
    ])

    const ctx = makeContext({
      nodes: new Map([[node.id, node]]),
      segments: new Map([[seg.id, seg]]),
      lanes: new Map([[lane.id, lane]]),
      trafficLights: new Map([[light.id, light]]),
    })
    const result = validateRules(ctx)
    expect(result.issues.some(i => i.checkId === 'SIGNAL_DUPLICATE_GREEN_LANE')).toBe(true)
  })

  it('warns when traffic light has no steps', () => {
    const node = makeNode('n1', 'TRAFFIC_LIGHT', ['s1'])
    const light = makeTrafficLight('tl1', 'n1', [])

    const ctx = makeContext({
      nodes: new Map([[node.id, node]]),
      trafficLights: new Map([[light.id, light]]),
    })
    const result = validateRules(ctx)
    expect(result.issues.some(i => i.checkId === 'SIGNAL_NO_STEPS')).toBe(true)
  })

  it('detects green lane not at the node', () => {
    const node = makeNode('n1', 'TRAFFIC_LIGHT', ['s1'])
    const seg = makeSegment('s1', 'n1', 'n2')
    const lane = makeLane('s1:lane:0', 's1')

    // Reference a lane from a different segment not connected to n1
    const light = makeTrafficLight('tl1', 'n1', [
      { id: 'step1', greenLanes: ['s2:lane:0'], minGreenTime: 30, maxGreenTime: 60, yellowTime: 3, allRedTime: 1, sensorBindings: [] },
    ])

    const ctx = makeContext({
      nodes: new Map([[node.id, node]]),
      segments: new Map([[seg.id, seg]]),
      lanes: new Map([[lane.id, lane]]),
      trafficLights: new Map([[light.id, light]]),
    })
    const result = validateRules(ctx)
    expect(result.issues.some(i => i.checkId === 'SIGNAL_GREEN_LANE_NOT_AT_NODE')).toBe(true)
  })
})

// ============================================================
// Turn Restriction vs Connector Conflicts
// ============================================================

describe('checkTurnVsConnectorConflicts', () => {
  it('detects conflict between turn restriction and connector', () => {
    const node = makeNode('n1', 'TRAFFIC_LIGHT', ['s1', 's2'])
    const seg1 = makeSegment('s1', 'n1', 'n2') // from s1 to n2 via n1
    const seg2 = makeSegment('s2', 'n2', 'n1') // Wait, need to share node n1
    // Actually: s1: n1→n2, s2: n1→n3 (shared node n1)
    const seg1b = makeSegment('s1', 'n1', 'n2')
    const seg2b = makeSegment('s2', 'n1', 'n3')
    const lane1 = makeLane('s1:lane:0', 's1')
    const lane2 = makeLane('s2:lane:0', 's2')

    const tr = makeTurnRestriction('n1', 's1', 's2', 'NO_LEFT')
    const conn = makeLaneConnector('c1', 's1:lane:0', 's2:lane:0')

    const ctx = makeContext({
      nodes: new Map([[node.id, node]]),
      segments: new Map([[seg1b.id, seg1b], [seg2b.id, seg2b]]),
      lanes: new Map([[lane1.id, lane1], [lane2.id, lane2]]),
      laneConnectors: new Map([[conn.id, conn]]),
      turnRestrictions: new Map([['tr1', tr]]),
    })
    const result = validateRules(ctx)
    expect(result.issues.some(i => i.checkId === 'TURN_VS_CONNECTOR_CONFLICT')).toBe(true)
  })

  it('ignores NONE restriction type', () => {
    const node = makeNode('n1', 'TRAFFIC_LIGHT', ['s1', 's2'])
    const seg1 = makeSegment('s1', 'n1', 'n2')
    const seg2 = makeSegment('s2', 'n1', 'n3')
    const lane1 = makeLane('s1:lane:0', 's1')
    const lane2 = makeLane('s2:lane:0', 's2')

    const tr = makeTurnRestriction('n1', 's1', 's2', 'NONE')
    const conn = makeLaneConnector('c1', 's1:lane:0', 's2:lane:0')

    const ctx = makeContext({
      nodes: new Map([[node.id, node]]),
      segments: new Map([[seg1.id, seg1], [seg2.id, seg2]]),
      lanes: new Map([[lane1.id, lane1], [lane2.id, lane2]]),
      laneConnectors: new Map([[conn.id, conn]]),
      turnRestrictions: new Map([['tr1', tr]]),
    })
    const result = validateRules(ctx)
    expect(result.issues.some(i => i.checkId === 'TURN_VS_CONNECTOR_CONFLICT')).toBe(false)
  })
})

// ============================================================
// Empty context
// ============================================================

describe('validateRules with empty context', () => {
  it('returns no issues for empty validation context', () => {
    const ctx = makeContext()
    const result = validateRules(ctx)
    expect(result.issues).toEqual([])
    expect(result.timestamp).toBeGreaterThan(0)
  })
})
