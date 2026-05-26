export type VehicleType = 'CAR' | 'BUS' | 'TRUCK' | 'BIKE' | 'TRAM'

export interface VehicleSpec {
  type: VehicleType
  maxSpeed: number
  length: number
  width: number
  acceleration: number
  comfortableDeceleration: number
}

export const VEHICLE_SPECS: Record<VehicleType, VehicleSpec> = {
  CAR: { type: 'CAR', maxSpeed: 60, length: 4.5, width: 1.8, acceleration: 2.5, comfortableDeceleration: 2.0 },
  BUS: { type: 'BUS', maxSpeed: 50, length: 12.0, width: 2.5, acceleration: 1.5, comfortableDeceleration: 1.5 },
  TRUCK: { type: 'TRUCK', maxSpeed: 50, length: 8.0, width: 2.5, acceleration: 1.2, comfortableDeceleration: 1.5 },
  BIKE: { type: 'BIKE', maxSpeed: 25, length: 1.8, width: 0.6, acceleration: 1.5, comfortableDeceleration: 2.0 },
  TRAM: { type: 'TRAM', maxSpeed: 40, length: 20.0, width: 2.5, acceleration: 1.0, comfortableDeceleration: 1.2 },
}

export interface RouteWaypoint {
  laneId: string
  connectorId?: string
}

export interface RoutePlan {
  waypoints: RouteWaypoint[]
  fromNodeId: string
  toNodeId: string
}

export type LaneChangeState = 'NONE' | 'PREPARING' | 'CHANGING_LEFT' | 'CHANGING_RIGHT'

export interface SimVehicle {
  id: string
  type: VehicleType
  currentLaneId: string
  progress: number
  currentSpeed: number
  lateralOffset: number
  targetLaneId: string | null
  laneChangeState: LaneChangeState
  laneChangeProgress: number
  plannedRoute: RouteWaypoint[]
  currentRouteIndex: number
  totalDistanceTraveled: number
  spawnTime: number
}

export interface ODPair {
  fromNodeId: string
  toNodeId: string
  volumePerHour: number
}

export interface ODMatrix {
  pairs: ODPair[]
}

export interface VehicleMixConfig {
  ratios: { type: VehicleType; ratio: number }[]
}

export const DEFAULT_VEHICLE_MIX: VehicleMixConfig = {
  ratios: [
    { type: 'CAR', ratio: 0.82 },
    { type: 'BUS', ratio: 0.06 },
    { type: 'TRUCK', ratio: 0.08 },
    { type: 'BIKE', ratio: 0.04 },
    { type: 'TRAM', ratio: 0 },
  ],
}

export interface MOBILParams {
  bSafe: number
  politenessFactor: number
  threshold: number
  biasRight: number
}

export const DEFAULT_MOBIL: MOBILParams = {
  bSafe: 3.0,
  politenessFactor: 0.2,
  threshold: 0.1,
  biasRight: 0.3,
}

export interface IDMParams {
  desiredSpeed: number
  safeTimeHeadway: number
  minGap: number
  maxAcceleration: number
  comfortableDeceleration: number
  delta: number
}

export const DEFAULT_IDM: IDMParams = {
  desiredSpeed: 13.9,
  safeTimeHeadway: 1.5,
  minGap: 2.0,
  maxAcceleration: 1.4,
  comfortableDeceleration: 2.0,
  delta: 4,
}

export interface SimulationStats {
  totalVehicles: number
  completedVehicles: number
  averageSpeed: number
  averageDelay: number
  maxQueueLength: number
  throughput: number
}

export type SimulationStatus = 'STOPPED' | 'RUNNING' | 'PAUSED'

export interface SimulationConfig {
  speedMultiplier: number
  timeStep: number
  maxVehicles: number
  odMatrix: ODMatrix | null
  vehicleMix: VehicleMixConfig
  mobilParams: MOBILParams
  idmParams: IDMParams
  useDefaultRandomFlow: boolean
}

export interface SimulationState {
  status: SimulationStatus
  config: SimulationConfig
  vehicleCount: number
  elapsedSimTime: number
  realFrameTime: number
}

export const VEHICLE_BUFFER_STRIDE = 16
export const MAX_VEHICLES = 1000
