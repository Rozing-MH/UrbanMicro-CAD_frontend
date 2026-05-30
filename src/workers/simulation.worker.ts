import { expose } from 'comlink'
import type {
  SimVehicle,
  IDMParams,
  MOBILParams,
  SimulationStats,
  VehicleMixConfig,
  VehicleType,
  VehicleSpec,
  RouteWaypoint,
} from '@/types/simulation'
import type { Lane, RoadSegment, RoadNode, TopologyData } from '@/types/road-network'
import type { RuleData, TrafficLightController, LaneRestriction, LaneConnector } from '@/types/traffic-rule'
import type { ODMatrix } from '@/types/simulation'
import {
  DEFAULT_VEHICLE_MIX,
  VEHICLE_BUFFER_OFFSETS,
  VEHICLE_BUFFER_STRIDE,
  MAX_VEHICLES,
  VEHICLE_SPECS,
} from '@/types/simulation'

// ============================================================
// Lane Geometry Index
// ============================================================

interface LaneGeo {
  id: string
  segmentId: string
  length: number
  index: number
  direction: string
  type: string
  width: number
  startNodeId: string
  endNodeId: string
  /** Adjacent lane IDs in same segment (left/right for MOBIL) */
  leftLaneId: string | null
  rightLaneId: string | null
}

// ============================================================
// Signal State
// ============================================================

interface SignalState {
  controllerId: string
  nodeId: string
  currentStepIndex: number
  timeInCurrentStep: number
  /** Lane IDs that are currently green */
  greenLanes: Set<string>
  /** Is currently in yellow phase */
  isYellow: boolean
  /** Is currently in all-red phase */
  isAllRed: boolean
}

// ============================================================
// Simulation Context
// ============================================================

interface SimContext {
  topology: TopologyData | null
  rules: RuleData | null
  odMatrix: ODMatrix | null
  idmParams: IDMParams | null
  mobilParams: MOBILParams | null
  vehicleMix: VehicleMixConfig

  // Indexed data
  laneGeoMap: Map<string, LaneGeo>
  nodeMap: Map<string, RoadNode>
  segmentMap: Map<string, RoadSegment>
  /** node ID → connected lane IDs */
  nodeToLanes: Map<string, string[]>
  /** node ID → traffic light controllers */
  signalControllers: Map<string, TrafficLightController>
  /** lane ID → lane restriction */
  laneRestrictions: Map<string, LaneRestriction>
  /** from-lane ID → lane connectors */
  laneConnectorsByFrom: Map<string, LaneConnector[]>
  /** to-lane ID → lane connectors */
  laneConnectorsByTo: Map<string, LaneConnector[]>

  // Signal states
  signalStates: Map<string, SignalState>

  // Vehicle data
  vehicleBuffer: Float32Array | null
  vehicles: Map<string, SimVehicle>
  /** lane ID → vehicle IDs sorted by progress descending (leader first) */
  laneVehicleIndex: Map<string, string[]>
  laneIds: string[]
  completedVehicles: number
  time: number
  running: boolean

  // A* route cache: "fromLaneId:toLaneId" → RouteWaypoint[]
  routeCache: Map<string, RouteWaypoint[]>

  // PID tracker state per vehicle: vehicleId → { integral, prevError }
  pidState: Map<string, { integral: number; prevError: number }>

  // Lane-level rolling statistics
  laneStats: Map<string, {
    vehicleCount: number
    totalSpeed: number
    maxQueueLen: number
    currentQueueLen: number
    throughput: number
    totalDelay: number
  }>
  statsInterval: number
  statsAccumulator: number
}

const ctx: SimContext = {
  topology: null,
  rules: null,
  odMatrix: null,
  idmParams: null,
  mobilParams: null,
  vehicleMix: DEFAULT_VEHICLE_MIX,

  laneGeoMap: new Map(),
  nodeMap: new Map(),
  segmentMap: new Map(),
  nodeToLanes: new Map(),
  signalControllers: new Map(),
  laneRestrictions: new Map(),
  laneConnectorsByFrom: new Map(),
  laneConnectorsByTo: new Map(),
  signalStates: new Map(),

  vehicleBuffer: null,
  vehicles: new Map(),
  laneVehicleIndex: new Map(),
  laneIds: [],
  routeCache: new Map(),
  pidState: new Map(),
  laneStats: new Map(),
  statsInterval: 5, // compute stats every 5 sim-seconds
  statsAccumulator: 0,
  completedVehicles: 0,
  time: 0,
  running: false,
}

const VEHICLE_TYPES: VehicleType[] = ['CAR', 'BUS', 'TRUCK', 'BIKE', 'TRAM']

// ============================================================
// Index Building
// ============================================================

function buildIndices(topology: TopologyData, rules: RuleData): void {
  ctx.laneGeoMap.clear()
  ctx.nodeMap.clear()
  ctx.segmentMap.clear()
  ctx.nodeToLanes.clear()
  ctx.signalControllers.clear()
  ctx.laneRestrictions.clear()
  ctx.laneConnectorsByFrom.clear()
  ctx.laneConnectorsByTo.clear()
  ctx.signalStates.clear()

  // Node map
  for (const node of topology.nodes) {
    ctx.nodeMap.set(node.id, node)
  }

  // Segment map
  for (const seg of topology.segments) {
    ctx.segmentMap.set(seg.id, seg)
  }

  // Lane geometry with adjacent lane detection
  const segmentLanes: Map<string, Lane[]> = new Map()
  for (const lane of topology.lanes) {
    const list = segmentLanes.get(lane.segmentId) ?? []
    list.push(lane)
    segmentLanes.set(lane.segmentId, list)
  }

  for (const [segId, lanes] of segmentLanes) {
    const seg = ctx.segmentMap.get(segId)
    if (!seg) continue

    // Sort by index for adjacency
    const sorted = [...lanes].sort((a, b) => a.index - b.index)

    for (let i = 0; i < sorted.length; i++) {
      const lane = sorted[i]
      const geo: LaneGeo = {
        id: lane.id,
        segmentId: seg.id,
        length: seg.length,
        index: lane.index,
        direction: lane.direction,
        type: lane.type,
        width: lane.width,
        startNodeId: seg.startNodeId,
        endNodeId: seg.endNodeId,
        leftLaneId: i > 0 ? sorted[i - 1].id : null,
        rightLaneId: i < sorted.length - 1 ? sorted[i + 1].id : null,
      }
      ctx.laneGeoMap.set(lane.id, geo)
    }
  }

  // Node to lanes mapping
  for (const lane of topology.lanes) {
    const geo = ctx.laneGeoMap.get(lane.id)
    if (!geo) continue
    const startLanes = ctx.nodeToLanes.get(geo.startNodeId) ?? []
    startLanes.push(lane.id)
    ctx.nodeToLanes.set(geo.startNodeId, startLanes)
    const endLanes = ctx.nodeToLanes.get(geo.endNodeId) ?? []
    endLanes.push(lane.id)
    ctx.nodeToLanes.set(geo.endNodeId, endLanes)
  }

  // Extract from ruleSets (current format: RuleData.ruleSets)
  for (const ruleSet of rules.ruleSets) {
    // Traffic light controller
    if (ruleSet.trafficLight) {
      ctx.signalControllers.set(ruleSet.nodeId, ruleSet.trafficLight)
    }

    // Lane restrictions (RuleSetLaneRestriction has { laneId, restriction })
    for (const lr of ruleSet.laneRestrictions) {
      ctx.laneRestrictions.set(lr.laneId, lr.restriction)
    }

    // Lane connectors
    for (const lc of ruleSet.laneConnectors) {
      const fromList = ctx.laneConnectorsByFrom.get(lc.fromLaneId) ?? []
      fromList.push(lc)
      ctx.laneConnectorsByFrom.set(lc.fromLaneId, fromList)
      const toList = ctx.laneConnectorsByTo.get(lc.toLaneId) ?? []
      toList.push(lc)
      ctx.laneConnectorsByTo.set(lc.toLaneId, toList)
    }
  }

  // Initialize signal states from collected controllers
  for (const [nodeId, tlc] of ctx.signalControllers) {
    const step = tlc.steps[tlc.currentStepIndex]
    const greenLanes = new Set<string>(step?.greenLanes ?? [])
    ctx.signalStates.set(nodeId, {
      controllerId: tlc.id,
      nodeId,
      currentStepIndex: tlc.currentStepIndex,
      timeInCurrentStep: 0,
      greenLanes,
      isYellow: false,
      isAllRed: false,
    })
  }
}

// ============================================================
// Lane Vehicle Index
// ============================================================

function addToLaneIndex(laneId: string, vehicleId: string): void {
  const list = ctx.laneVehicleIndex.get(laneId)
  if (!list) {
    ctx.laneVehicleIndex.set(laneId, [vehicleId])
    return
  }
  // Insert sorted by progress descending (leader first)
  const veh = ctx.vehicles.get(vehicleId)
  if (!veh) { list.push(vehicleId); return }
  let inserted = false
  for (let i = 0; i < list.length; i++) {
    const other = ctx.vehicles.get(list[i])
    if (other && other.progress < veh.progress) {
      list.splice(i, 0, vehicleId)
      inserted = true
      break
    }
  }
  if (!inserted) list.push(vehicleId)
}

function removeFromLaneIndex(laneId: string, vehicleId: string): void {
  const list = ctx.laneVehicleIndex.get(laneId)
  if (!list) return
  const idx = list.indexOf(vehicleId)
  if (idx >= 0) list.splice(idx, 1)
}

function findLeader(vehicle: SimVehicle): SimVehicle | null {
  const list = ctx.laneVehicleIndex.get(vehicle.currentLaneId)
  if (!list) return null
  // List is sorted by progress descending; find the first vehicle ahead
  for (const vid of list) {
    if (vid === vehicle.id) continue
    const other = ctx.vehicles.get(vid)
    if (other && other.progress > vehicle.progress) return other
  }
  return null
}

function findFollower(vehicle: SimVehicle, laneId: string): SimVehicle | null {
  const list = ctx.laneVehicleIndex.get(laneId)
  if (!list) return null
  let closest: SimVehicle | null = null
  let closestProgress = Infinity
  for (const vid of list) {
    if (vid === vehicle.id) continue
    const other = ctx.vehicles.get(vid)
    if (other && other.progress < vehicle.progress && other.progress < closestProgress) {
      closest = other
      closestProgress = other.progress
    }
  }
  return closest
}

// ============================================================
// IDM Car-Following Model
// ============================================================

function idmAcceleration(
  speed: number,
  desiredSpeed: number,
  leaderSpeed: number | null,
  gap: number | null,
  params: IDMParams,
  vehicleSpec: VehicleSpec,
): number {
  const v0 = desiredSpeed
  const v = speed
  const a = vehicleSpec.acceleration
  const b = vehicleSpec.comfortableDeceleration
  const s0 = params.minGap
  const T = params.safeTimeHeadway
  const delta = params.delta

  if (leaderSpeed === null || gap === null) {
    // Free driving: no leader
    const sStar = s0 + v * T
    const freeRoad = 1 - Math.pow(v / Math.max(v0, 0.1), delta)
    return a * freeRoad
  }

  // Following: compute desired gap
  const deltaV = v - leaderSpeed
  const safeGap = Math.max(gap, 0.1)
  const sStar = s0 + Math.max(0, v * T + (v * deltaV) / (2 * Math.sqrt(a * b)))
  const freeRoad = 1 - Math.pow(v / Math.max(v0, 0.1), delta)
  const interaction = Math.pow(sStar / safeGap, 2)
  return a * (freeRoad - interaction)
}

function computeIDMAcceleration(vehicle: SimVehicle): number {
  if (!ctx.idmParams) return 0
  const spec = VEHICLE_SPECS[vehicle.type]
  const geo = ctx.laneGeoMap.get(vehicle.currentLaneId)
  const laneLength = geo?.length ?? 100

  // Speed limit from lane restriction
  const restriction = ctx.laneRestrictions.get(vehicle.currentLaneId)
  const speedLimitMs = restriction?.speedLimit && restriction.speedLimit > 0
    ? (restriction.speedLimit / 3.6)
    : spec.maxSpeed / 3.6
  const v0 = Math.min(spec.maxSpeed / 3.6, speedLimitMs)

  // Find leader
  const leader = findLeader(vehicle)

  if (!leader) {
    return idmAcceleration(vehicle.currentSpeed, v0, null, null, ctx.idmParams, spec)
  }

  // Gap calculation: distance from vehicle front to leader rear
  const leaderSpec = VEHICLE_SPECS[leader.type]
  const progressDiff = leader.progress - vehicle.progress
  const gap = progressDiff * laneLength - leaderSpec.length

  return idmAcceleration(
    vehicle.currentSpeed,
    v0,
    leader.currentSpeed,
    gap,
    ctx.idmParams,
    spec,
  )
}

// ============================================================
// MOBIL Lane Change Model
// ============================================================

interface LaneChangeDecision {
  shouldChange: boolean
  targetLaneId: string | null
  direction: 'NONE' | 'LEFT' | 'RIGHT'
}

function computeMOBILDecision(vehicle: SimVehicle): LaneChangeDecision {
  if (!ctx.mobilParams || !ctx.idmParams) {
    return { shouldChange: false, targetLaneId: null, direction: 'NONE' }
  }

  const geo = ctx.laneGeoMap.get(vehicle.currentLaneId)
  if (!geo) return { shouldChange: false, targetLaneId: null, direction: 'NONE' }

  const restriction = ctx.laneRestrictions.get(vehicle.currentLaneId)
  // Check if lane change is allowed
  const canGoLeft = restriction ? restriction.allowLeftChange : true
  const canGoRight = restriction ? restriction.allowRightChange : true
  if (!canGoLeft && !canGoRight) {
    return { shouldChange: false, targetLaneId: null, direction: 'NONE' }
  }

  const { bSafe, politenessFactor, threshold } = ctx.mobilParams
  const spec = VEHICLE_SPECS[vehicle.type]
  // Use clamped acceleration consistent with stepVehicles clamping
  const rawAcc = computeIDMAcceleration(vehicle)
  const currentAcc = Math.max(-spec.comfortableDeceleration * 2, Math.min(spec.acceleration, rawAcc))

  let bestDecision: LaneChangeDecision = { shouldChange: false, targetLaneId: null, direction: 'NONE' }
  let bestGain = threshold // Must exceed threshold to trigger

  // Evaluate left lane
  if (canGoLeft && geo.leftLaneId) {
    const decision = evaluateLaneChange(
      vehicle, geo.leftLaneId, currentAcc, spec, bSafe, politenessFactor,
    )
    if (decision.shouldChange && decision.gain > bestGain) {
      bestGain = decision.gain
      bestDecision = { shouldChange: true, targetLaneId: geo.leftLaneId, direction: 'LEFT' }
    }
  }

  // Evaluate right lane
  if (canGoRight && geo.rightLaneId) {
    const decision = evaluateLaneChange(
      vehicle, geo.rightLaneId, currentAcc, spec, bSafe, politenessFactor,
    )
    if (decision.shouldChange && decision.gain > bestGain) {
      bestGain = decision.gain
      bestDecision = { shouldChange: true, targetLaneId: geo.rightLaneId, direction: 'RIGHT' }
    }
  }

  return bestDecision
}

function evaluateLaneChange(
  vehicle: SimVehicle,
  targetLaneId: string,
  currentAcc: number,
  vehicleSpec: VehicleSpec,
  bSafe: number,
  politenessFactor: number,
): { shouldChange: boolean; gain: number } {
  // Check if target lane is restricted for this vehicle type
  const targetRestriction = ctx.laneRestrictions.get(targetLaneId)
  if (targetRestriction?.allowedVehicleTypes.length && !targetRestriction.allowedVehicleTypes.includes(vehicle.type)) {
    return { shouldChange: false, gain: -Infinity }
  }

  // Acceleration in target lane (with target lane leader)
  const targetLeader = findLeaderInLane(vehicle, targetLaneId)
  const geo = ctx.laneGeoMap.get(vehicle.currentLaneId)
  const laneLength = geo?.length ?? 100

  // Use target lane speed limit
  const targetLaneRestriction = ctx.laneRestrictions.get(targetLaneId)
  const targetSpeedLimitMs = targetLaneRestriction?.speedLimit && targetLaneRestriction.speedLimit > 0
    ? targetLaneRestriction.speedLimit / 3.6
    : vehicleSpec.maxSpeed / 3.6
  const v0 = Math.min(vehicleSpec.maxSpeed / 3.6, targetSpeedLimitMs)

  let accInTarget: number
  if (!targetLeader) {
    accInTarget = idmAcceleration(vehicle.currentSpeed, v0, null, null, ctx.idmParams!, vehicleSpec)
  } else {
    const progressDiff = targetLeader.progress - vehicle.progress
    const gap = progressDiff * laneLength - VEHICLE_SPECS[targetLeader.type].length
    accInTarget = idmAcceleration(vehicle.currentSpeed, v0, targetLeader.currentSpeed, gap, ctx.idmParams!, vehicleSpec)
  }

  // Follower in target lane
  const targetFollower = findFollowerInLane(vehicle, targetLaneId)
  if (!targetFollower) {
    // No follower: safety criterion automatically satisfied
    const gain = accInTarget - currentAcc
    return { shouldChange: gain > 0, gain }
  }

  // Follower's new acceleration if we move there
  const followerSpec = VEHICLE_SPECS[targetFollower.type]
  const followerGap = (vehicle.progress - targetFollower.progress) * laneLength - vehicleSpec.length
  const accFollowerNew = idmAcceleration(
    targetFollower.currentSpeed, followerSpec.maxSpeed / 3.6,
    vehicle.currentSpeed, followerGap, ctx.idmParams!, followerSpec,
  )

  // Safety criterion: follower deceleration must not exceed bSafe
  if (accFollowerNew < -bSafe) {
    return { shouldChange: false, gain: -Infinity }
  }

  // Incentive criterion: gain - p * decel > 0
  const followerCurrentAcc = computeIDMAcceleration(targetFollower)
  const decel = followerCurrentAcc - accFollowerNew
  const gain = (accInTarget - currentAcc) - politenessFactor * decel

  return { shouldChange: gain > 0, gain }
}

function findLeaderInLane(vehicle: SimVehicle, laneId: string): SimVehicle | null {
  const list = ctx.laneVehicleIndex.get(laneId)
  if (!list) return null
  for (const vid of list) {
    const other = ctx.vehicles.get(vid)
    if (other && other.progress > vehicle.progress) return other
  }
  return null
}

function findFollowerInLane(vehicle: SimVehicle, laneId: string): SimVehicle | null {
  const list = ctx.laneVehicleIndex.get(laneId)
  if (!list) return null
  let closest: SimVehicle | null = null
  let closestProgress = Infinity
  for (const vid of list) {
    const other = ctx.vehicles.get(vid)
    if (other && other.progress < vehicle.progress && other.progress < closestProgress) {
      closest = other
      closestProgress = other.progress
    }
  }
  return closest
}

// ============================================================
// Signal State Machine
// ============================================================

function updateSignals(dt: number): void {
  for (const [nodeId, state] of ctx.signalStates) {
    const controller = ctx.signalControllers.get(nodeId)
    if (!controller || controller.steps.length === 0) continue

    state.timeInCurrentStep += dt
    const step = controller.steps[state.currentStepIndex]
    if (!step) continue

    // Determine phase
    const greenDuration = (step.minGreenTime + step.maxGreenTime) / 2
    const yellowDuration = step.yellowTime
    const allRedDuration = step.allRedTime

    if (!state.isYellow && !state.isAllRed && state.timeInCurrentStep >= greenDuration) {
      state.isYellow = true
      state.timeInCurrentStep = 0
      state.greenLanes.clear()
    } else if (state.isYellow && state.timeInCurrentStep >= yellowDuration) {
      state.isYellow = false
      state.isAllRed = true
      state.timeInCurrentStep = 0
    } else if (state.isAllRed && state.timeInCurrentStep >= allRedDuration) {
      state.isAllRed = false
      state.timeInCurrentStep = 0
      // Advance to next step
      state.currentStepIndex = (state.currentStepIndex + 1) % controller.steps.length
      const nextStep = controller.steps[state.currentStepIndex]
      state.greenLanes = new Set(nextStep?.greenLanes ?? [])
    }
  }
}

function isGreenForLane(laneId: string): boolean {
  // Find which node this lane approaches
  const geo = ctx.laneGeoMap.get(laneId)
  if (!geo) return true // No geometry info → assume green

  // A lane approaching a node means vehicles on this lane are heading toward the end node
  const endNodeId = geo.endNodeId
  const signal = ctx.signalStates.get(endNodeId)
  if (!signal) return true // No signal at this node → yield, assume passable

  return signal.greenLanes.has(laneId)
}

// ============================================================
// Poisson Vehicle Spawning
// ============================================================

function sampleVehicleType(): VehicleType {
  const r = Math.random()
  let acc = 0
  for (const item of ctx.vehicleMix.ratios) {
    acc += item.ratio
    if (r <= acc) return item.type
  }
  return 'CAR'
}

function findSpawnLane(fromNodeId: string): LaneGeo | null {
  const lanesFromNode = ctx.nodeToLanes.get(fromNodeId)
  if (!lanesFromNode || lanesFromNode.length === 0) return null

  // Pick a lane starting from or going through this node
  // Prefer FORWARD lanes from this node
  for (const laneId of lanesFromNode) {
    const geo = ctx.laneGeoMap.get(laneId)
    if (geo && geo.startNodeId === fromNodeId) return geo
  }
  // Fallback: any lane connected to this node
  for (const laneId of lanesFromNode) {
    const geo = ctx.laneGeoMap.get(laneId)
    if (geo) return geo
  }
  return null
}

function spawnVehicles(dt: number): void {
  if (!ctx.odMatrix || !ctx.topology) return

  for (const entry of ctx.odMatrix.pairs) {
    if (!entry.fromNodeId || !entry.toNodeId || entry.volumePerHour <= 0) continue

    // Poisson distribution: P(at least 1 vehicle in dt) = 1 - exp(-lambda * dt)
    const lambda = entry.volumePerHour / 3600
    if (Math.random() >= 1 - Math.exp(-lambda * dt)) continue

    const spawnLane = findSpawnLane(entry.fromNodeId)
    if (!spawnLane) continue

    // Check if spawn position is clear (no vehicle too close to start)
    const laneVehicles = ctx.laneVehicleIndex.get(spawnLane.id) ?? []
    let canSpawn = true
    for (const vid of laneVehicles) {
      const veh = ctx.vehicles.get(vid)
      if (veh && veh.progress < 0.05) { canSpawn = false; break }
    }
    if (!canSpawn) continue

    const vehicleId = `v_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const type = sampleVehicleType()
    // A* route from spawn lane to destination node
    const plannedRoute = findRoute(spawnLane.id, entry.toNodeId, type)
    const newVehicle: SimVehicle = {
      id: vehicleId,
      type,
      currentLaneId: spawnLane.id,
      progress: 0.001, // Slightly past start to avoid spawn collision
      currentSpeed: 5, // Initial speed 5 m/s (~18 km/h)
      lateralOffset: 0,
      targetLaneId: null,
      laneChangeState: 'NONE',
      laneChangeProgress: 0,
      plannedRoute,
      currentRouteIndex: 0,
      totalDistanceTraveled: 0,
      spawnTime: ctx.time,
    }
    ctx.vehicles.set(vehicleId, newVehicle)
    addToLaneIndex(spawnLane.id, vehicleId)
  }
}

// ============================================================
// A* Path Finder (lane-level graph)
// ============================================================

/**
 * A* search on the lane-level graph.
 * Nodes = lanes; edges = lane connectors + same-segment adjacency + node-to-node transitions.
 * Heuristic = Euclidean distance between end-node of current lane and destination node.
 * Vehicle type filter: skips lanes whose allowedVehicleTypes excludes the vehicle type.
 */
function aStarFindPath(
  fromLaneId: string,
  toNodeId: string,
  vehicleType: VehicleType,
): RouteWaypoint[] | null {
  const fromGeo = ctx.laneGeoMap.get(fromLaneId)
  if (!fromGeo) return null
  const destNode = ctx.nodeMap.get(toNodeId)
  if (!destNode) return null

  // If already on a lane ending at destination, simple route
  if (fromGeo.endNodeId === toNodeId) {
    return [{ laneId: fromLaneId }]
  }

  const openSet = new Map<string, { g: number; f: number }>() // laneId → g,f
  const cameFrom = new Map<string, { laneId: string; connectorId?: string }>()
  const gScore = new Map<string, number>()
  const closedSet = new Set<string>()

  const startKey = fromLaneId
  const h0 = heuristic(fromGeo, destNode)
  gScore.set(startKey, 0)
  openSet.set(startKey, { g: 0, f: h0 })

  while (openSet.size > 0) {
    // Pick node with lowest f
    let currentKey = ''
    let bestF = Infinity
    for (const [key, val] of openSet) {
      if (val.f < bestF) { bestF = val.f; currentKey = key }
    }

    const currentGeo = ctx.laneGeoMap.get(currentKey)
    if (!currentGeo) { openSet.delete(currentKey); continue }

    // Goal: a lane whose endNodeId equals the destination
    if (currentGeo.endNodeId === toNodeId) {
      return reconstructPath(cameFrom, currentKey)
    }

    openSet.delete(currentKey)
    closedSet.add(currentKey)

    // Expand neighbors
    const neighbors = getLaneNeighbors(currentKey, vehicleType)
    for (const neighbor of neighbors) {
      if (closedSet.has(neighbor.laneId)) continue

      const neighborGeo = ctx.laneGeoMap.get(neighbor.laneId)
      if (!neighborGeo) continue

      const tentativeG = (gScore.get(currentKey) ?? Infinity) + currentGeo.length
      const existingG = gScore.get(neighbor.laneId) ?? Infinity

      if (tentativeG < existingG) {
        cameFrom.set(neighbor.laneId, { laneId: currentKey, connectorId: neighbor.connectorId })
        gScore.set(neighbor.laneId, tentativeG)
        const h = heuristic(neighborGeo, destNode)
        const f = tentativeG + h
        openSet.set(neighbor.laneId, { g: tentativeG, f })
      }
    }

    // Safety: limit search depth
    if (closedSet.size > 500) break
  }

  return null // No path found
}

function heuristic(laneGeo: LaneGeo, destNode: RoadNode): number {
  // Euclidean distance from lane's end node to destination
  const endNode = ctx.nodeMap.get(laneGeo.endNodeId)
  if (!endNode) return 0
  const dx = endNode.position.x - destNode.position.x
  const dy = endNode.position.y - destNode.position.y
  return Math.sqrt(dx * dx + dy * dy)
}

interface LaneNeighbor {
  laneId: string
  connectorId?: string
}

function getLaneNeighbors(laneId: string, vehicleType: VehicleType): LaneNeighbor[] {
  const result: LaneNeighbor[] = []
  const geo = ctx.laneGeoMap.get(laneId)
  if (!geo) return result

  const endNodeId = geo.endNodeId

  // 1. Lane connectors from this lane at the end node
  const connectors = ctx.laneConnectorsByFrom.get(laneId) ?? []
  for (const lc of connectors) {
    const toGeo = ctx.laneGeoMap.get(lc.toLaneId)
    if (!toGeo || toGeo.startNodeId !== endNodeId) continue
    if (!isLaneAllowed(lc.toLaneId, vehicleType)) continue
    result.push({ laneId: lc.toLaneId, connectorId: lc.id })
  }

  // 2. If no connectors, fallback: all lanes starting at end node
  if (result.length === 0) {
    const nodeLanes = ctx.nodeToLanes.get(endNodeId) ?? []
    for (const nlId of nodeLanes) {
      if (nlId === laneId) continue
      const nlGeo = ctx.laneGeoMap.get(nlId)
      if (!nlGeo || nlGeo.startNodeId !== endNodeId) continue
      if (!isLaneAllowed(nlId, vehicleType)) continue
      result.push({ laneId: nlId })
    }
  }

  // 3. Same-segment adjacent lanes (for lane change awareness, not routing)
  // Not added as A* neighbors — MOBIL handles lane changes at runtime

  return result
}

function isLaneAllowed(laneId: string, vehicleType: VehicleType): boolean {
  const restriction = ctx.laneRestrictions.get(laneId)
  if (!restriction) return true
  if (restriction.allowedVehicleTypes.length === 0) return true
  return restriction.allowedVehicleTypes.includes(vehicleType)
}

function reconstructPath(
  cameFrom: Map<string, { laneId: string; connectorId?: string }>,
  endKey: string,
): RouteWaypoint[] {
  const path: RouteWaypoint[] = []
  let current: string | undefined = endKey
  const visited = new Set<string>()

  // Trace back from end to start
  const stack: string[] = []
  while (current && !visited.has(current)) {
    visited.add(current)
    stack.push(current)
    const from = cameFrom.get(current)
    current = from?.laneId
  }
  stack.reverse()

  for (const laneId of stack) {
    const from = cameFrom.get(laneId)
    path.push({ laneId, connectorId: from?.connectorId })
  }

  return path
}

/** Find or compute a route from originLaneId toward toNodeId */
function findRoute(fromLaneId: string, toNodeId: string, vehicleType: VehicleType): RouteWaypoint[] {
  const cacheKey = `${fromLaneId}:${toNodeId}:${vehicleType}`
  const cached = ctx.routeCache.get(cacheKey)
  if (cached) return cached

  const route = aStarFindPath(fromLaneId, toNodeId, vehicleType)
  if (route) {
    ctx.routeCache.set(cacheKey, route)
    return route
  }

  // Fallback: single-lane route
  return [{ laneId: fromLaneId }]
}

// ============================================================
// PID Tracker for Connector Guidance
// ============================================================

const PID_KP = 1.2
const PID_KI = 0.0
const PID_KD = 0.8

function pidCompute(vehicleId: string, setpoint: number, actual: number): number {
  let state = ctx.pidState.get(vehicleId)
  if (!state) {
    state = { integral: 0, prevError: 0 }
    ctx.pidState.set(vehicleId, state)
  }
  const error = setpoint - actual
  state.integral += error
  // Anti-windup
  state.integral = Math.max(-5, Math.min(5, state.integral))
  const derivative = error - state.prevError
  state.prevError = error
  return PID_KP * error + PID_KI * state.integral + PID_KD * derivative
}

/** Compute lateral offset to follow a LaneConnector through an intersection */
function computeConnectorGuidance(veh: SimVehicle): number | null {
  // Only apply near end of lane (entering intersection zone)
  if (veh.progress < 0.7) return null

  // Find the connector from planned route
  const nextIdx = veh.currentRouteIndex + 1
  if (nextIdx >= veh.plannedRoute.length) return null
  const nextWaypoint = veh.plannedRoute[nextIdx]
  if (!nextWaypoint.connectorId) return null

  // Find the connector
  const connectors = ctx.laneConnectorsByFrom.get(veh.currentLaneId) ?? []
  const connector = connectors.find(lc => lc.id === nextWaypoint.connectorId)
  if (!connector) return null

  const geo = ctx.laneGeoMap.get(veh.currentLaneId)
  if (!geo) return null

  // Compute target lateral offset from connector anchors
  // fromAnchor.x is the lateral position on the source lane
  // The lane center is at offset 0, so fromAnchor relative to center
  // gives us the target offset as the vehicle transitions
  const laneWidth = geo.width

  // Interpolate: at progress=0.7 start tracking, at progress=1.0 fully on connector
  const t = Math.min(1, (veh.progress - 0.7) / 0.3)

  // Target offset = position relative to lane center
  // fromAnchor.x is in world coords; approximate lateral offset from lane center
  // For simplicity: compute the lateral difference between connector entry point and lane center
  const fromAnchorOffset = connector.fromAnchor.x !== undefined ? 0 : 0 // anchors are world XY, not lane-relative

  // Simpler approach: compute lateral offset based on connector direction
  // The connector goes from fromLane to toLane; the lateral offset is determined
  // by the relative position of fromAnchor within the lane width
  // We approximate: target offset = (connector.toAnchor direction) * t
  const dx = connector.toAnchor.x - connector.fromAnchor.x
  const dy = connector.toAnchor.y - connector.fromAnchor.y
  const turnAngle = Math.atan2(dy, dx)

  // For a straight connector: offset ~0, for left turn: negative, for right: positive
  // Scale by progress through intersection zone
  const maxLateralShift = laneWidth * 0.5
  // Classify turn direction by angle (simplified)
  let targetOffset = 0
  if (Math.abs(turnAngle) > 0.3) {
    // Non-straight: lateral shift toward target lane
    targetOffset = turnAngle > 0 ? -maxLateralShift : maxLateralShift
  }
  const setpoint = targetOffset * t

  // PID correction
  return pidCompute(veh.id, setpoint, veh.lateralOffset)
}

// ============================================================
// Lane-Level Rolling Statistics
// ============================================================

function updateLaneStats(): void {
  // Reset per-lane counters
  for (const [laneId, stats] of ctx.laneStats) {
    stats.vehicleCount = 0
    stats.totalSpeed = 0
    stats.currentQueueLen = 0
  }

  // Aggregate from vehicles
  for (const veh of ctx.vehicles.values()) {
    let stats = ctx.laneStats.get(veh.currentLaneId)
    if (!stats) {
      stats = { vehicleCount: 0, totalSpeed: 0, maxQueueLen: 0, currentQueueLen: 0, throughput: 0, totalDelay: 0 }
      ctx.laneStats.set(veh.currentLaneId, stats)
    }
    stats.vehicleCount++
    stats.totalSpeed += veh.currentSpeed
    if (veh.currentSpeed < 0.5) {
      stats.currentQueueLen++
    }
    // Delay: difference between desired travel time and actual
    const restriction = ctx.laneRestrictions.get(veh.currentLaneId)
    const speedLimitMs = restriction?.speedLimit && restriction.speedLimit > 0
      ? restriction.speedLimit / 3.6
      : VEHICLE_SPECS[veh.type].maxSpeed / 3.6
    const delay = Math.max(0, speedLimitMs - veh.currentSpeed)
    stats.totalDelay += delay
  }

  // Update max queue & reset current queue
  for (const stats of ctx.laneStats.values()) {
    if (stats.currentQueueLen > stats.maxQueueLen) {
      stats.maxQueueLen = stats.currentQueueLen
    }
  }
}

// ============================================================
// Lane Transition
// ============================================================

function findNextLane(vehicle: SimVehicle): string | null {
  // 1. Try planned route (A* pre-computed)
  if (vehicle.plannedRoute.length > 0) {
    const nextIdx = vehicle.currentRouteIndex + 1
    if (nextIdx < vehicle.plannedRoute.length) {
      const nextWaypoint = vehicle.plannedRoute[nextIdx]
      if (nextWaypoint.laneId !== vehicle.currentLaneId) {
        return nextWaypoint.laneId
      }
    }
  }

  // 2. Fallback: lane connector routing
  const geo = ctx.laneGeoMap.get(vehicle.currentLaneId)
  if (!geo) return null

  const endNodeId = geo.endNodeId
  const connectors = ctx.laneConnectorsByFrom.get(vehicle.currentLaneId) ?? []
  const validConnectors = connectors.filter((lc) => {
    const toGeo = ctx.laneGeoMap.get(lc.toLaneId)
    return toGeo?.startNodeId === endNodeId
  })

  if (validConnectors.length > 0) {
    // Prefer connectors leading to allowed lanes
    for (const lc of validConnectors) {
      if (isLaneAllowed(lc.toLaneId, vehicle.type)) return lc.toLaneId
    }
    return validConnectors[0].toLaneId
  }

  // 3. Fallback: any lane starting at end node
  const nodeLanes = ctx.nodeToLanes.get(endNodeId) ?? []
  for (const laneId of nodeLanes) {
    const nextGeo = ctx.laneGeoMap.get(laneId)
    if (nextGeo && nextGeo.startNodeId === endNodeId && laneId !== vehicle.currentLaneId) {
      if (isLaneAllowed(laneId, vehicle.type)) return laneId
    }
  }

  return null
}

/** Extract destination node ID from vehicle's planned route */
function findDestinationNode(vehicle: SimVehicle): string | null {
  if (vehicle.plannedRoute.length === 0) return null
  const lastWaypoint = vehicle.plannedRoute[vehicle.plannedRoute.length - 1]
  const lastGeo = ctx.laneGeoMap.get(lastWaypoint.laneId)
  return lastGeo?.endNodeId ?? null
}

// ============================================================
// Vehicle Step
// ============================================================

function stepVehicles(dt: number): void {
  if (!ctx.idmParams) return
  const toRemove: string[] = []
  const laneChanges: Array<{ vehicleId: string; fromLane: string; toLane: string; targetProgress: number }> = []

  for (const [id, veh] of ctx.vehicles) {
    const geo = ctx.laneGeoMap.get(veh.currentLaneId)
    const laneLength = Math.max(geo?.length ?? 100, 0.1)

    // --- IDM acceleration ---
    let acc = computeIDMAcceleration(veh)

    // --- Signal: check if approaching red light ---
    if (geo) {
      const green = isGreenForLane(veh.currentLaneId)
      if (!green) {
        const distToStop = (1 - veh.progress) * laneLength
        const spec = VEHICLE_SPECS[veh.type]
        // Dilemma zone: during yellow, allow passage if too close to stop comfortably
        const signalState = ctx.signalStates.get(geo.endNodeId)
        const stoppingDist = (veh.currentSpeed * veh.currentSpeed) / (2 * spec.comfortableDeceleration)
        const inDilemmaZone = signalState?.isYellow && distToStop < stoppingDist * 1.5

        if (!inDilemmaZone) {
          // Approaching red: compute distance to stop line (end of lane)
          const leader = findLeader(veh)

          // If no leader or stop line is closer than leader, decelerate toward stop
          if (!leader || distToStop < ((leader.progress - veh.progress) * laneLength - VEHICLE_SPECS[leader.type].length)) {
            // IDM with virtual stopped vehicle at stop line
            const stopLineGap = Math.max(distToStop - 0.5, 0.1)
            acc = idmAcceleration(
              veh.currentSpeed,
              spec.maxSpeed / 3.6,
              0, // leader speed = 0 (stopped)
              stopLineGap,
              ctx.idmParams,
              spec,
            )
          }
        }
      }
    }

    // Clamp acceleration
    const spec = VEHICLE_SPECS[veh.type]
    acc = Math.max(-spec.comfortableDeceleration * 2, Math.min(spec.acceleration, acc))

    // --- Vehicle type forbidden check ---
    if (!isLaneAllowed(veh.currentLaneId, veh.type)) {
      // Vehicle is on a forbidden lane → brake to stop and reroute
      acc = Math.max(-spec.comfortableDeceleration * 2, -spec.comfortableDeceleration)
      if (veh.currentSpeed < 0.5) {
        // Stopped on forbidden lane: try reroute via A*
        const geo2 = ctx.laneGeoMap.get(veh.currentLaneId)
        if (geo2) {
          const nodeLanes = ctx.nodeToLanes.get(geo2.endNodeId) ?? []
          for (const nlId of nodeLanes) {
            const nlGeo = ctx.laneGeoMap.get(nlId)
            if (nlGeo && nlGeo.startNodeId === geo2.endNodeId && isLaneAllowed(nlId, veh.type)) {
              // Force transition to allowed lane
              const updatedVeh: SimVehicle = {
                ...veh,
                currentLaneId: nlId,
                progress: 0.001,
                currentSpeed: 0,
                laneChangeState: 'NONE',
                laneChangeProgress: 0,
                lateralOffset: 0,
                totalDistanceTraveled: veh.totalDistanceTraveled,
              }
              ctx.vehicles.set(id, updatedVeh)
              removeFromLaneIndex(veh.currentLaneId, id)
              addToLaneIndex(nlId, id)
              // Reroute from new lane
              const destNodeId = findDestinationNode(veh)
              if (destNodeId) {
                const newRoute = findRoute(nlId, destNodeId, veh.type)
                ctx.vehicles.set(id, { ...updatedVeh, plannedRoute: newRoute, currentRouteIndex: 0 })
              }
              break
            }
          }
        }
      }
    }

    // --- Update speed and progress ---
    const newSpeed = Math.max(0, veh.currentSpeed + acc * dt)
    const distanceTraveled = ((veh.currentSpeed + newSpeed) / 2) * dt // Trapezoidal integration
    const progressDelta = distanceTraveled / laneLength
    const newProgress = veh.progress + progressDelta

    // --- Check lane transition ---
    if (newProgress >= 1.0) {
      const nextLaneId = findNextLane(veh)
      if (nextLaneId) {
        // Transition to next lane
        const nextGeo = ctx.laneGeoMap.get(nextLaneId)
        const nextLength = nextGeo?.length ?? 100
        const overflow = newProgress - 1.0
        const nextProgress = overflow * (laneLength / nextLength)

        laneChanges.push({
          vehicleId: id,
          fromLane: veh.currentLaneId,
          toLane: nextLaneId,
          targetProgress: Math.min(nextProgress, 0.99),
        })

        const updatedVeh: SimVehicle = {
          ...veh,
          currentLaneId: nextLaneId,
          progress: Math.min(nextProgress, 0.99),
          currentSpeed: newSpeed,
          currentRouteIndex: veh.currentRouteIndex + 1,
          totalDistanceTraveled: veh.totalDistanceTraveled + distanceTraveled,
        }
        ctx.vehicles.set(id, updatedVeh)
      } else {
        // No next lane: vehicle exits simulation
        toRemove.push(id)
      }
      continue
    }

    // --- MOBIL lane change (only when not currently changing) ---
    let newLaneId = veh.currentLaneId
    let newLateralOffset = veh.lateralOffset
    let newLaneChangeState = veh.laneChangeState
    let newLaneChangeProgress = veh.laneChangeProgress

    if (veh.laneChangeState === 'NONE' && ctx.mobilParams) {
      const decision = computeMOBILDecision(veh)
      if (decision.shouldChange && decision.targetLaneId) {
        newLaneChangeState = decision.direction === 'LEFT' ? 'CHANGING_LEFT' : 'CHANGING_RIGHT'
        newLaneId = decision.targetLaneId
        newLaneChangeProgress = 0
      }
    }

    // Process lane change progress
    if (newLaneChangeState !== 'NONE') {
      newLaneChangeProgress += dt / 2.0 // 2-second lane change duration
      if (newLaneChangeProgress >= 1.0) {
        // Lane change complete
        newLaneChangeState = 'NONE'
        newLaneChangeProgress = 0
        newLateralOffset = 0
      } else {
        // Interpolate lateral offset from source lane position → target lane center
        // CHANGING_LEFT: vehicle starts at +width (right of target) and moves to 0
        // CHANGING_RIGHT: vehicle starts at -width (left of target) and moves to 0
        const startOffset = newLaneChangeState === 'CHANGING_LEFT' ? 1 : -1
        newLateralOffset = startOffset * (1 - newLaneChangeProgress) * (geo?.width ?? 3.5)
      }
    } else {
      // --- Connector guidance: PID lateral correction near intersections ---
      const pidCorrection = computeConnectorGuidance(veh)
      if (pidCorrection !== null) {
        newLateralOffset = veh.lateralOffset + pidCorrection * dt
        // Clamp lateral offset to lane width
        const maxOffset = (geo?.width ?? 3.5) * 0.8
        newLateralOffset = Math.max(-maxOffset, Math.min(maxOffset, newLateralOffset))
      } else {
        // Decay lateral offset back to center when not in intersection zone
        newLateralOffset = veh.lateralOffset * (1 - dt * 2) // decay over ~0.5s
      }
    }

    // Commit vehicle update
    const updatedVeh: SimVehicle = {
      ...veh,
      currentLaneId: newLaneId,
      progress: newProgress,
      currentSpeed: newSpeed,
      lateralOffset: newLateralOffset,
      laneChangeState: newLaneChangeState,
      laneChangeProgress: newLaneChangeProgress,
      totalDistanceTraveled: veh.totalDistanceTraveled + distanceTraveled,
    }
    ctx.vehicles.set(id, updatedVeh)

    // Update lane index if lane changed
    if (newLaneId !== veh.currentLaneId) {
      removeFromLaneIndex(veh.currentLaneId, id)
      addToLaneIndex(newLaneId, id)
    }
  }

  // Process lane changes from transitions
  for (const lc of laneChanges) {
    removeFromLaneIndex(lc.fromLane, lc.vehicleId)
    addToLaneIndex(lc.toLane, lc.vehicleId)
  }

  // Remove exited vehicles
  for (const id of toRemove) {
    const veh = ctx.vehicles.get(id)
    if (veh) removeFromLaneIndex(veh.currentLaneId, id)
    ctx.vehicles.delete(id)
    ctx.completedVehicles++
  }
}

// ============================================================
// Buffer Flush
// ============================================================

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
  // Zero out remaining buffer slots
  const usedSlots = i * VEHICLE_BUFFER_STRIDE
  const totalSlots = MAX_VEHICLES * VEHICLE_BUFFER_STRIDE
  if (usedSlots < totalSlots) {
    ctx.vehicleBuffer.fill(0, usedSlots, totalSlots)
  }
}

// ============================================================
// Worker API
// ============================================================

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
    ctx.laneVehicleIndex.clear()
    ctx.completedVehicles = 0
    ctx.time = 0
    ctx.running = false

    buildIndices(topology, rules)
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
    ctx.laneVehicleIndex.clear()
    ctx.routeCache.clear()
    ctx.pidState.clear()
    ctx.laneStats.clear()
    ctx.statsAccumulator = 0
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

    // 1. Update signal states
    updateSignals(dt)

    // 2. Spawn new vehicles (Poisson)
    spawnVehicles(dt)

    // 3. Step all vehicles (IDM + MOBIL + lane transition + connector guidance)
    stepVehicles(dt)

    // 4. Flush to buffer
    flushToBuffer()

    // 5. Update lane-level rolling stats periodically
    ctx.statsAccumulator += dt
    if (ctx.statsAccumulator >= ctx.statsInterval) {
      ctx.statsAccumulator = 0
      updateLaneStats()
    }

    // 6. Aggregate global stats from lane stats
    let totalSpeed = 0
    let totalDelay = 0
    let maxQueue = 0
    let queueCount = 0
    for (const veh of ctx.vehicles.values()) {
      totalSpeed += veh.currentSpeed
      const restriction = ctx.laneRestrictions.get(veh.currentLaneId)
      const speedLimitMs = restriction?.speedLimit && restriction.speedLimit > 0
        ? restriction.speedLimit / 3.6
        : VEHICLE_SPECS[veh.type].maxSpeed / 3.6
      totalDelay += Math.max(0, speedLimitMs - veh.currentSpeed)
    }
    for (const stats of ctx.laneStats.values()) {
      if (stats.maxQueueLen > maxQueue) maxQueue = stats.maxQueueLen
      queueCount += stats.currentQueueLen
    }

    const count = ctx.vehicles.size
    const avgSpeed = count > 0 ? totalSpeed / count : 0
    const avgDelay = count > 0 ? totalDelay / count : 0

    return {
      time: ctx.time,
      vehicleCount: count,
      stats: {
        totalVehicles: count + ctx.completedVehicles,
        completedVehicles: ctx.completedVehicles,
        averageSpeed: avgSpeed,
        averageDelay: avgDelay,
        maxQueueLength: maxQueue,
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
