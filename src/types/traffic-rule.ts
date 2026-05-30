import type { TurnDirection } from './road-network'
import type { ODMatrix, VehicleMixConfig } from './simulation'

// ============================================================
// Traffic Light / Signal Control
// ============================================================

export interface VirtualSensor {
  id: string
  laneId: string
  detectionZoneLength: number  // meters
}

export interface SensorBinding {
  sensorId: string
  extensionSeconds: number
}

export interface SignalStep {
  id: string
  greenLanes: string[]        // lane IDs that are green
  minGreenTime: number        // seconds
  maxGreenTime: number        // seconds
  yellowTime: number          // seconds
  allRedTime: number          // seconds
  sensorBindings: SensorBinding[]
}

export interface TrafficLightController {
  id: string
  nodeId: string
  strategy: 'FIXED' | 'ACTUATED' | 'FIXED_TIMING' | 'SENSOR_ACTUATED'
  steps: SignalStep[]
  sensors: VirtualSensor[]
  currentStepIndex: number
  timeInCurrentStep: number
}

// ============================================================
// Lane Restrictions
// ============================================================

export type LaneMarkingType =
  | 'SOLID_WHITE'
  | 'DASHED_WHITE'
  | 'SOLID_YELLOW'
  | 'DASHED_YELLOW'
  | 'DOUBLE_SOLID_YELLOW'
  | 'SOLID_DOUBLE_YELLOW'
  | 'NONE'

/** @deprecated Use LaneMarkingType */
export type MarkingType = LaneMarkingType

export interface LaneRestriction {
  laneId: string
  speedLimit: number          // km/h
  allowedVehicleTypes: string[]
  allowLeftChange: boolean
  allowRightChange: boolean
  markingType: LaneMarkingType
  isBusOnly: boolean
}

// ============================================================
// Lane Connectors
// ============================================================

export interface LaneConnector {
  id: string
  fromLaneId: string
  toLaneId: string
  fromAnchor: { x: number; y: number }
  toAnchor: { x: number; y: number }
  // guideCurve is runtime-reconstructed, not persisted
}

// ============================================================
// Turn Restrictions (node-level)
// ============================================================

export interface TurnRestriction {
  nodeId: string
  fromSegmentId: string
  toSegmentId: string
  restriction: 'NO_LEFT' | 'NO_RIGHT' | 'NO_STRAIGHT' | 'NO_UTURN' | 'NONE'
  direction?: TurnDirection
}

// ============================================================
// Crosswalk
// ============================================================

export interface Crosswalk {
  id: string
  nodeId: string
  position: 'NORTH' | 'SOUTH' | 'EAST' | 'WEST'
  isActive: boolean
}

// ============================================================
// Rule Data (serialized)
// ============================================================

export interface LaneArrowRule {
  laneId: string
  nodeId: string
  allowedDirections: TurnDirection[]
}

export interface RuleSetLaneRestriction {
  laneId: string
  restriction: LaneRestriction
}

export interface TrafficRuleSetData {
  nodeId: string
  nodeControlMode: 'YIELD' | 'TRAFFIC_LIGHT' | 'ROUNDABOUT' | 'NONE'
  crosswalkEnabled: boolean
  turnRestrictions: TurnRestriction[]
  laneArrows: LaneArrowRule[]
  laneConnectors: LaneConnector[]
  trafficLight: TrafficLightController | null
  laneRestrictions: RuleSetLaneRestriction[]
  crosswalks?: Crosswalk[]
}

export interface RuleODConfig {
  pairs: ODMatrix['pairs']
  vehicleMix: VehicleMixConfig
}

export interface RuleData {
  ruleSets: TrafficRuleSetData[]
  odConfig: RuleODConfig
}

export interface LegacyRuleData {
  version?: number
  laneRestrictions: LaneRestriction[]
  laneConnectors: LaneConnector[]
  trafficLights: TrafficLightController[]
  turnRestrictions: TurnRestriction[]
  crosswalks: Crosswalk[]
}
