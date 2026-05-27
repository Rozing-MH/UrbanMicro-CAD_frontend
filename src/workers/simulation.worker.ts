import { expose } from 'comlink'
import type { SimVehicle, IDMParams, MOBILParams, SimulationStats, VehicleMixConfig, VehicleType } from '@/types/simulation'
import type { Lane, TopologyData } from '@/types/road-network'
import type { RuleData } from '@/types/traffic-rule'
import type { ODMatrix } from '@/types/simulation'
import { DEFAULT_VEHICLE_MIX, VEHICLE_BUFFER_OFFSETS, VEHICLE_BUFFER_STRIDE, MAX_VEHICLES } from '@/types/simulation'

interface SimContext {
  topology: TopologyData | null
  rules: RuleData | null
  odMatrix: ODMatrix | null
  idmParams: IDMParams | null
  mobilParams: MOBILParams | null
  vehicleMix: VehicleMixConfig
  vehicleBuffer: Float32Array | null
  vehicles: Map<string, SimVehicle>
  laneIds: string[]
  completedVehicles: number
  time: number
  running: boolean
  onStats?: (stats: SimulationStats) => void
}

const ctx: SimContext = {
  topology: null,
  rules: null,
  odMatrix: null,
  idmParams: null,
  mobilParams: null,
  vehicleMix: DEFAULT_VEHICLE_MIX,
  vehicleBuffer: null,
  vehicles: new Map(),
  laneIds: [],
  completedVehicles: 0,
  time: 0,
  running: false,
}

const VEHICLE_TYPES: VehicleType[] = ['CAR', 'BUS', 'TRUCK', 'BIKE', 'TRAM']

function idmAcceleration(
  v: number,
  v0: number,
  deltaV: number,
  s: number,
  T: number,
  a: number,
  b: number,
  s0: number,
): number {
  if (!ctx.idmParams) return 0
  const { safeTimeHeadway, maxAcceleration, comfortableDeceleration, minGap, delta } =
    ctx.idmParams as IDMParams
  const T_ = T || safeTimeHeadway
  const a_ = a || maxAcceleration
  const b_ = b || comfortableDeceleration
  const s0_ = s0 || minGap
  const sStar = s0_ + Math.max(0, v * T_ + (v * deltaV) / (2 * Math.sqrt(a_ * b_)))
  const freeRoad = 1 - Math.pow(v / v0, delta)
  const interaction = Math.pow(sStar / Math.max(s, 0.1), 2)
  return a_ * (freeRoad - interaction)
}

function flushToBuffer(): void {
  if (!ctx.vehicleBuffer) return
  let i = 0
  for (const veh of ctx.vehicles.values()) {
    if (i >= MAX_VEHICLES) break
    const base = i * VEHICLE_BUFFER_STRIDE
    ctx.vehicleBuffer[base + VEHICLE_BUFFER_OFFSETS.progress] = veh.progress
    ctx.vehicleBuffer[base + VEHICLE_BUFFER_OFFSETS.speed] = veh.currentSpeed
    ctx.vehicleBuffer[base + VEHICLE_BUFFER_OFFSETS.lateralOffset] = veh.lateralOffset
    ctx.vehicleBuffer[base + VEHICLE_BUFFER_OFFSETS.laneChangeActive] = veh.laneChangeState === 'NONE' ? 0 : 1
    ctx.vehicleBuffer[base + VEHICLE_BUFFER_OFFSETS.laneIndex] = Math.max(0, ctx.laneIds.indexOf(veh.currentLaneId))
    ctx.vehicleBuffer[base + VEHICLE_BUFFER_OFFSETS.typeIndex] = Math.max(0, VEHICLE_TYPES.indexOf(veh.type))
    i++
  }
}

function sampleVehicleType(): VehicleType {
  const r = Math.random()
  let acc = 0
  for (const item of ctx.vehicleMix.ratios) {
    acc += item.ratio
    if (r <= acc) return item.type
  }
  return 'CAR'
}

function laneForOriginNode(fromNodeId: string): Lane | null {
  if (!ctx.topology) return null
  const originSegment = ctx.topology.segments.find(
    (segment) => segment.startNodeId === fromNodeId || segment.endNodeId === fromNodeId,
  )
  if (!originSegment) return null
  return ctx.topology.lanes.find((lane) => lane.segmentId === originSegment.id) ?? null
}

function spawnVehicles(dt: number): void {
  if (!ctx.odMatrix || !ctx.topology) return
  for (const entry of ctx.odMatrix.pairs) {
    const rate = entry.volumePerHour / 3600
    if (Math.random() < rate * dt) {
      const originLane = laneForOriginNode(entry.fromNodeId)
      if (!originLane) continue
      const vehicleId = `v_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      const type = sampleVehicleType()
      const newVehicle: SimVehicle = {
        id: vehicleId,
        type,
        currentLaneId: originLane.id,
        progress: 0,
        currentSpeed: 10,
        lateralOffset: 0,
        targetLaneId: null,
        laneChangeState: 'NONE',
        laneChangeProgress: 0,
        plannedRoute: [{ laneId: originLane.id }],
        currentRouteIndex: 0,
        totalDistanceTraveled: 0,
        spawnTime: ctx.time,
      }
      ctx.vehicles.set(vehicleId, newVehicle)
    }
  }
}

function stepVehicles(dt: number): void {
  if (!ctx.idmParams) return
  const toRemove: string[] = []
  for (const [id, veh] of ctx.vehicles) {
    const v0 = ctx.idmParams.desiredSpeed
    const acc = idmAcceleration(veh.currentSpeed, v0, 0, 50, 0, 0, 0, 0)
    const newSpeed = Math.max(0, veh.currentSpeed + acc * dt)
    const newProgress = veh.progress + (newSpeed * dt) / 100
    const newVeh: SimVehicle = { ...veh, currentSpeed: newSpeed, progress: newProgress }
    if (newProgress > 1) {
      toRemove.push(id)
    } else {
      ctx.vehicles.set(id, newVeh)
    }
  }
  for (const id of toRemove) {
    ctx.vehicles.delete(id)
    ctx.completedVehicles++
  }
}

const simApi = {
  init(
    topology: TopologyData,
    rules: RuleData,
    odMatrix: ODMatrix,
    idmParams: IDMParams,
    mobilParams: MOBILParams,
    vehicleMix: VehicleMixConfig,
    sharedBuffer: SharedArrayBuffer,
  ): void {
    ctx.topology = topology
    ctx.rules = rules
    ctx.odMatrix = odMatrix
    ctx.idmParams = idmParams
    ctx.mobilParams = mobilParams
    ctx.vehicleMix = vehicleMix
    ctx.laneIds = topology.lanes.map((lane) => lane.id)
    ctx.vehicleBuffer = new Float32Array(sharedBuffer)
    ctx.vehicles.clear()
    ctx.completedVehicles = 0
    ctx.time = 0
    ctx.running = false
  },

  start(): void {
    ctx.running = true
  },

  pause(): void {
    ctx.running = false
  },

  reset(): void {
    ctx.running = false
    ctx.time = 0
    ctx.vehicles.clear()
    ctx.completedVehicles = 0
    if (ctx.vehicleBuffer) ctx.vehicleBuffer.fill(0)
  },

  tick(dt: number): { time: number; vehicleCount: number; stats: SimulationStats } {
    if (!ctx.running) {
      return {
        time: ctx.time,
        vehicleCount: ctx.vehicles.size,
        stats: {
          totalVehicles: ctx.vehicles.size + ctx.completedVehicles,
          completedVehicles: ctx.completedVehicles,
          averageSpeed: 0,
          averageDelay: 0,
          maxQueueLength: 0,
          throughput: ctx.completedVehicles,
        },
      }
    }
    ctx.time += dt
    spawnVehicles(dt)
    stepVehicles(dt)
    flushToBuffer()

    let totalSpeed = 0
    for (const veh of ctx.vehicles.values()) {
      totalSpeed += veh.currentSpeed
    }
    const count = ctx.vehicles.size
    const avgSpeed = count > 0 ? totalSpeed / count : 0

    return {
      time: ctx.time,
      vehicleCount: count,
      stats: {
        totalVehicles: count + ctx.completedVehicles,
        completedVehicles: ctx.completedVehicles,
        averageSpeed: avgSpeed,
        averageDelay: 0,
        maxQueueLength: 0,
        throughput: ctx.completedVehicles,
      },
    }
  },

  getVehicleCount(): number {
    return ctx.vehicles.size
  },
}

expose(simApi)

export type SimulationWorkerApi = typeof simApi
