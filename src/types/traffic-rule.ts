import type { TurnDirection } from './road-network'

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
  strategy: 'FIXED' | 'ACTUATED'
  steps: SignalStep[]
  sensors: VirtualSensor[]
  currentStepIndex: number
  timeInCurrentStep: number
}

// ============================================================
// Lane Restrictions
// ============================================================

export type MarkingType =
  | 'SOLID_WHITE'
  | 'DASHED_WHITE'
  | 'SOLID_YELLOW'
  | 'DASHED_YELLOW'
  | 'DOUBLE_SOLID_YELLOW'

export interface LaneRestriction {
  laneId: string
  speedLimit: number          // km/h
  allowedVehicleTypes: string[]
  allowLeftChange: boolean
  allowRightChange: boolean
  markingType: MarkingType
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

export interface RuleData {
  version: string
  laneRestrictions: LaneRestriction[]
  laneConnectors: LaneConnector[]
  trafficLights: TrafficLightController[]
  turnRestrictions: TurnRestriction[]
  crosswalks: Crosswalk[]
}
