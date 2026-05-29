import { expose } from 'comlink'
import type {
  SimVehicle,
  IDMParams,
  MOBILParams,
  SimulationStats,
  VehicleMixConfig,
  VehicleType,
  VehicleSpec,
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
      plannedRoute: [{ laneId: spawnLane.id }],
      currentRouteIndex: 0,
      totalDistanceTraveled: 0,
      spawnTime: ctx.time,
    }
    ctx.vehicles.set(vehicleId, newVehicle)
    addToLaneIndex(spawnLane.id, vehicleId)
  }
}

// ============================================================
// Lane Transition
// ============================================================

function findNextLane(vehicle: SimVehicle): string | null {
  const geo = ctx.laneGeoMap.get(vehicle.currentLaneId)
  if (!geo) return null

  const endNodeId = geo.endNodeId

  // Check lane connectors from this lane at this node
  const connectors = ctx.laneConnectorsByFrom.get(vehicle.currentLaneId) ?? []
  // Filter connectors: target lane must START at the end node (not end there = opposite direction)
  const validConnectors = connectors.filter((lc) => {
    const toGeo = ctx.laneGeoMap.get(lc.toLaneId)
    return toGeo?.startNodeId === endNodeId
  })

  if (validConnectors.length > 0) {
    // Pick a random connector (simple strategy; A* will improve this later)
    const idx = Math.floor(Math.random() * validConnectors.length)
    return validConnectors[idx].toLaneId
  }

  // Fallback: find any lane at the end node that starts from there
  const nodeLanes = ctx.nodeToLanes.get(endNodeId) ?? []
  for (const laneId of nodeLanes) {
    const nextGeo = ctx.laneGeoMap.get(laneId)
    if (nextGeo && nextGeo.startNodeId === endNodeId && laneId !== vehicle.currentLaneId) {
      return laneId
    }
  }

  return null
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

    // 3. Step all vehicles (IDM + MOBIL + lane transition)
    stepVehicles(dt)

    // 4. Flush to buffer
    flushToBuffer()

    // 5. Compute stats
    let totalSpeed = 0
    let maxQueue = 0
    for (const veh of ctx.vehicles.values()) {
      totalSpeed += veh.currentSpeed
    }
    // Count vehicles waiting at red lights
    const queueByLane = new Map<string, number>()
    for (const veh of ctx.vehicles.values()) {
      if (veh.currentSpeed < 0.5) {
        const count = queueByLane.get(veh.currentLaneId) ?? 0
        queueByLane.set(veh.currentLaneId, count + 1)
      }
    }
    for (const count of queueByLane.values()) {
      if (count > maxQueue) maxQueue = count
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
