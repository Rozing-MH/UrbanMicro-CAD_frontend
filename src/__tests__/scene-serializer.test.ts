import { describe, it, expect } from 'vitest'
import { SceneSerializer } from '@/domain/scene-serializer/scene-serializer'
import { serializeTrafficLight, serializeLaneRestriction } from '@/domain/scene-serializer/serialize-scene'
import { normalizeTrafficLight, normalizeLaneRestriction } from '@/domain/scene-serializer/rebuild-topology'
import { isDocumentRuleData, migratePayload } from '@/domain/scene-serializer/migrate-payload'
import { SCENE_FORMAT_VERSION } from '@/domain/scene-serializer/types'
import type { ProjectPayload } from '@/domain/scene-serializer/types'
import type { RoadNetwork } from '@/types/road-network'
import type { TrafficRuleSetData, TrafficLightController, LaneRestriction } from '@/types/traffic-rule'
import type { ODMatrix, VehicleMixConfig } from '@/types/simulation'

// ============================================================
// Test Data Helpers
// ============================================================

function makeEmptyNetwork(): RoadNetwork {
  return {
    nodes: new Map(),
    segments: new Map(),
    lanes: new Map(),
    laneArrows: new Map(),
    halfEdges: new Map(),
  }
}

function makeMinimalNetwork(): RoadNetwork {
  const node1 = { id: 'n1', position: { x: 0, y: 0 }, elevation: 0, controlMode: 'NONE' as const, connectedSegmentIds: ['s1'], polygonVertices: [] }
  const node2 = { id: 'n2', position: { x: 100, y: 0 }, elevation: 0, controlMode: 'NONE' as const, connectedSegmentIds: ['s1'], polygonVertices: [] }
  const segment = {
    id: 's1', startNodeId: 'n1', endNodeId: 'n2', length: 100,
    centerLine: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
    profile: { id: 'p1', name: 'Default', lanes: [], totalWidth: 7, median: { type: 'NONE' as const, width: 0 }, sidewalk: { leftWidth: 0, rightWidth: 0, hasCurb: true } },
    elevation: { startZ: 0, endZ: 0, mode: 'GROUND' as const },
    isCurved: false,
  }
  const lane = { id: 's1:lane:0', segmentId: 's1', index: 0, direction: 'FORWARD' as const, type: 'CAR' as const, width: 3.5 }

  return {
    nodes: new Map([[node1.id, node1], [node2.id, node2]]),
    segments: new Map([[segment.id, segment]]),
    lanes: new Map([[lane.id, lane]]),
    laneArrows: new Map(),
    halfEdges: new Map(),
  }
}

function makeEmptyRuleSets(): TrafficRuleSetData[] {
  return []
}

function makeEmptyODMatrix(): ODMatrix {
  return { pairs: [] }
}

function makeDefaultVehicleMix(): VehicleMixConfig {
  return { ratios: [{ type: 'CAR' as const, ratio: 1.0 }] }
}

// ============================================================
// Traffic Light Serialization
// ============================================================

describe('normalizeTrafficLight', () => {
  it('converts FIXED_TIMING strategy to FIXED', () => {
    const light = { id: 'tl1', nodeId: 'n1', strategy: 'FIXED_TIMING' as const, steps: [], sensors: [], currentStepIndex: 0, timeInCurrentStep: 0 }
    const result = normalizeTrafficLight(light)
    expect(result.strategy).toBe('FIXED')
  })

  it('converts SENSOR_ACTUATED strategy to ACTUATED', () => {
    const light = { id: 'tl1', nodeId: 'n1', strategy: 'SENSOR_ACTUATED' as const, steps: [], sensors: [], currentStepIndex: 0, timeInCurrentStep: 0 }
    const result = normalizeTrafficLight(light)
    expect(result.strategy).toBe('ACTUATED')
  })

  it('preserves unknown strategy unchanged', () => {
    const light = { id: 'tl1', nodeId: 'n1', strategy: 'ADAPTIVE' as any, steps: [], sensors: [], currentStepIndex: 0, timeInCurrentStep: 0 }
    const result = normalizeTrafficLight(light)
    expect(result.strategy).toBe('ADAPTIVE')
  })
})

describe('serializeTrafficLight', () => {
  it('converts FIXED strategy to FIXED_TIMING', () => {
    const light = { id: 'tl1', nodeId: 'n1', strategy: 'FIXED' as const, steps: [], sensors: [], currentStepIndex: 0, timeInCurrentStep: 0 }
    const result = serializeTrafficLight(light)
    expect(result.strategy).toBe('FIXED_TIMING')
  })

  it('converts ACTUATED strategy to SENSOR_ACTUATED', () => {
    const light = { id: 'tl1', nodeId: 'n1', strategy: 'ACTUATED' as const, steps: [], sensors: [], currentStepIndex: 0, timeInCurrentStep: 0 }
    const result = serializeTrafficLight(light)
    expect(result.strategy).toBe('SENSOR_ACTUATED')
  })
})

describe('traffic light round-trip', () => {
  it('serialize then normalize returns original strategy', () => {
    const original = { id: 'tl1', nodeId: 'n1', strategy: 'FIXED' as const, steps: [], sensors: [], currentStepIndex: 0, timeInCurrentStep: 0 }
    const serialized = serializeTrafficLight(original)
    expect(serialized.strategy).toBe('FIXED_TIMING')
    const restored = normalizeTrafficLight(serialized)
    expect(restored.strategy).toBe('FIXED')
  })
})

// ============================================================
// Lane Restriction Serialization
// ============================================================

describe('normalizeLaneRestriction', () => {
  it('converts SOLID_DOUBLE_YELLOW to DOUBLE_SOLID_YELLOW', () => {
    const restriction = { laneId: 'l1', speedLimit: 60, allowedVehicleTypes: ['CAR'], markingType: 'SOLID_DOUBLE_YELLOW' as const, isBusOnly: false, allowLeftChange: true, allowRightChange: true }
    const result = normalizeLaneRestriction(restriction)
    expect(result.markingType).toBe('DOUBLE_SOLID_YELLOW')
  })

  it('preserves other marking types unchanged', () => {
    const restriction = { laneId: 'l1', speedLimit: 60, allowedVehicleTypes: ['CAR'], markingType: 'SOLID_WHITE' as const, isBusOnly: false, allowLeftChange: true, allowRightChange: true }
    const result = normalizeLaneRestriction(restriction)
    expect(result.markingType).toBe('SOLID_WHITE')
  })
})

describe('serializeLaneRestriction', () => {
  it('converts DOUBLE_SOLID_YELLOW to SOLID_DOUBLE_YELLOW', () => {
    const restriction = { laneId: 'l1', speedLimit: 60, allowedVehicleTypes: ['CAR'], markingType: 'DOUBLE_SOLID_YELLOW' as const, isBusOnly: false, allowLeftChange: true, allowRightChange: true }
    const result = serializeLaneRestriction(restriction)
    expect(result.markingType).toBe('SOLID_DOUBLE_YELLOW')
  })
})

describe('lane restriction round-trip', () => {
  it('serialize then normalize returns original marking type', () => {
    const original = { laneId: 'l1', speedLimit: 60, allowedVehicleTypes: ['CAR'], markingType: 'DOUBLE_SOLID_YELLOW' as const, isBusOnly: false, allowLeftChange: true, allowRightChange: true }
    const serialized = serializeLaneRestriction(original)
    expect(serialized.markingType).toBe('SOLID_DOUBLE_YELLOW')
    const restored = normalizeLaneRestriction(serialized)
    expect(restored.markingType).toBe('DOUBLE_SOLID_YELLOW')
  })
})

// ============================================================
// isDocumentRuleData
// ============================================================

describe('isDocumentRuleData', () => {
  it('returns true for document format with ruleSets array', () => {
    const data = { ruleSets: [], odConfig: { pairs: [], vehicleMix: makeDefaultVehicleMix() } }
    expect(isDocumentRuleData(data)).toBe(true)
  })

  it('returns false for legacy format without ruleSets', () => {
    const data = { laneRestrictions: [], laneConnectors: [] }
    expect(isDocumentRuleData(data as any)).toBe(false)
  })
})

// ============================================================
// migratePayload
// ============================================================

describe('migratePayload', () => {
  it('provides defaults for empty payload', () => {
    const result = migratePayload({})
    expect(result.topologyData.nodes).toEqual([])
    expect(result.topologyData.segments).toEqual([])
    expect(result.topologyData.lanes).toEqual([])
    expect(result.topologyData.laneArrows).toEqual([])
    expect(result.topologyData.halfEdges).toEqual([])
    expect(result.ruleData.ruleSets).toEqual([])
    expect(result.version).toBe(1)
  })

  it('preserves valid topology data', () => {
    const nodes = [{ id: 'n1', position: { x: 0, y: 0 }, elevation: 0, controlMode: 'NONE' as const, connectedSegmentIds: [], polygonVertices: [] }]
    const result = migratePayload({ topologyData: { nodes, segments: [], lanes: [], laneArrows: [], halfEdges: [] } })
    expect(result.topologyData.nodes).toEqual(nodes)
  })

  it('converts legacy rule data to document format', () => {
    const legacyData = {
      laneRestrictions: [{ laneId: 'l1', speedLimit: 60, allowedVehicleTypes: ['CAR'], markingType: 'SOLID_WHITE', isBusOnly: false, allowLeftChange: true, allowRightChange: true }],
      laneConnectors: [],
      turnRestrictions: [],
      trafficLights: [{ id: 'tl1', nodeId: 'n1', strategy: 'FIXED', steps: [], sensors: [], currentStepIndex: 0, timeInCurrentStep: 0 }],
      crosswalks: [],
    }
    const result = migratePayload({ ruleData: legacyData as any })
    expect(result.ruleData.ruleSets).toHaveLength(1)
    expect(result.ruleData.ruleSets[0].laneRestrictions).toHaveLength(1)
  })

  it('preserves document format rule data', () => {
    const documentData = {
      ruleSets: [{ nodeId: 'n1', nodeControlMode: 'NONE' as const, crosswalkEnabled: false, turnRestrictions: [], laneArrows: [], laneConnectors: [], trafficLight: null, laneRestrictions: [], crosswalks: [] }],
      odConfig: { pairs: [], vehicleMix: makeDefaultVehicleMix() },
    }
    const result = migratePayload({ ruleData: documentData })
    expect(result.ruleData.ruleSets).toHaveLength(1)
  })
})

// ============================================================
// SceneSerializer round-trip
// ============================================================

describe('SceneSerializer', () => {
  const serializer = new SceneSerializer()

  it('serializes empty network to valid payload', () => {
    const payload = serializer.serialize(
      makeEmptyNetwork(),
      makeEmptyRuleSets(),
      makeEmptyODMatrix(),
      makeDefaultVehicleMix(),
    )
    expect(payload.topologyData.nodes).toEqual([])
    expect(payload.topologyData.segments).toEqual([])
    expect(payload.version).toBe(SCENE_FORMAT_VERSION)
  })

  it('serializes and deserializes minimal network (round-trip)', () => {
    const network = makeMinimalNetwork()
    const payload = serializer.serialize(
      network,
      makeEmptyRuleSets(),
      makeEmptyODMatrix(),
      makeDefaultVehicleMix(),
    )

    // Verify serialized structure
    expect(payload.topologyData.nodes).toHaveLength(2)
    expect(payload.topologyData.segments).toHaveLength(1)
    expect(payload.topologyData.lanes).toHaveLength(1)

    // Deserialize
    const result = serializer.deserialize(payload)
    expect(result.network.nodes.size).toBe(2)
    expect(result.network.segments.size).toBe(1)
    expect(result.network.lanes.size).toBeGreaterThanOrEqual(1)
    expect(result.requiresMeshRebuild).toBe(true)
  })

  it('deserializes empty payload without errors', () => {
    const payload: ProjectPayload = {
      topologyData: { version: 1, nodes: [], segments: [], lanes: [], laneArrows: [], halfEdges: [] },
      ruleData: { ruleSets: [], odConfig: { pairs: [], vehicleMix: makeDefaultVehicleMix() } },
      version: 1,
    }
    const result = serializer.deserialize(payload)
    expect(result.network.nodes.size).toBe(0)
    expect(result.requiresMeshRebuild).toBe(false)
  })

  it('preserves SCENE_FORMAT_VERSION constant', () => {
    expect(SCENE_FORMAT_VERSION).toBe(2)
  })
})
