import type { ICommand } from '@/types/commands'
import type {
  CrossSectionProfile,
  Lane,
  LaneArrow,
  MeshData,
  RoadNode,
  RoadSegment,
} from '@/types/road-network'
import type { Crosswalk, LaneConnector, LaneRestriction, SignalStep, TrafficLightController, TurnRestriction } from '@/types/traffic-rule'

function turnRestrictionKey(tr: TurnRestriction): string {
  return `${tr.nodeId}:${tr.fromSegmentId}:${tr.toSegmentId}:${tr.restriction}`
}
import { useRoadNetworkStore } from '@/stores/roadNetworkStore'
import { useTrafficRuleStore } from '@/stores/trafficRuleStore'

interface RuleSnapshot {
  laneRestrictions: LaneRestriction[]
  laneConnectors: LaneConnector[]
  laneArrows: LaneArrow[]
  turnRestrictions: TurnRestriction[]
}

function cloneMeshData(meshData: MeshData | undefined): MeshData | undefined {
  if (!meshData) return undefined
  return {
    vertices: meshData.vertices.slice(),
    indices: meshData.indices.slice(),
    uvs: meshData.uvs.slice(),
    normals: meshData.normals.slice(),
  }
}

function cloneSegment(segment: RoadSegment): RoadSegment {
  return {
    ...segment,
    centerLine: segment.centerLine.map((point) => ({ ...point })),
    profile: {
      ...segment.profile,
      lanes: segment.profile.lanes.map((lane) => ({ ...lane })),
      median: { ...segment.profile.median },
      sidewalk: { ...segment.profile.sidewalk },
    },
    elevation: { ...segment.elevation },
    meshData: cloneMeshData(segment.meshData),
  }
}

function cloneNode(node: RoadNode): RoadNode {
  return {
    ...node,
    position: { ...node.position },
    connectedSegmentIds: [...node.connectedSegmentIds],
    polygonVertices: node.polygonVertices.map((point) => ({ ...point })),
  }
}

function captureRulesForLaneIds(laneIds: Set<string>, segmentIds = new Set<string>()): RuleSnapshot {
  const road = useRoadNetworkStore()
  const rules = useTrafficRuleStore()
  return {
    laneRestrictions: Array.from(rules.laneRestrictions.values())
      .filter((restriction) => laneIds.has(restriction.laneId))
      .map((restriction) => ({ ...restriction, allowedVehicleTypes: [...restriction.allowedVehicleTypes] })),
    laneConnectors: Array.from(rules.laneConnectors.values())
      .filter((connector) => laneIds.has(connector.fromLaneId) || laneIds.has(connector.toLaneId))
      .map((connector) => ({
        ...connector,
        fromAnchor: { ...connector.fromAnchor },
        toAnchor: { ...connector.toAnchor },
      })),
    laneArrows: Array.from(road.laneArrows.values())
      .filter((arrow) => laneIds.has(arrow.laneId))
      .map((arrow) => ({ ...arrow, allowedDirections: [...arrow.allowedDirections] })),
    turnRestrictions: Array.from(rules.turnRestrictions.values())
      .filter((restriction) => segmentIds.has(restriction.fromSegmentId) || segmentIds.has(restriction.toSegmentId))
      .map((restriction) => ({ ...restriction })),
  }
}

function removeRuleSnapshot(snapshot: RuleSnapshot): void {
  const road = useRoadNetworkStore()
  const rules = useTrafficRuleStore()
  for (const restriction of snapshot.laneRestrictions) rules.removeLaneRestriction(restriction.laneId)
  for (const connector of snapshot.laneConnectors) rules.removeLaneConnector(connector.id)
  for (const arrow of snapshot.laneArrows) road.removeLaneArrow(arrow.nodeId, arrow.laneId)
  let removedTurnRestriction = false
  for (const restriction of snapshot.turnRestrictions) {
    if (rules.turnRestrictions.delete(turnRestrictionKey(restriction))) removedTurnRestriction = true
  }
  if (removedTurnRestriction) rules.ruleVersion++
}

function restoreRuleSnapshot(snapshot: RuleSnapshot): void {
  const road = useRoadNetworkStore()
  const rules = useTrafficRuleStore()
  for (const restriction of snapshot.laneRestrictions) {
    rules.setLaneRestriction({ ...restriction, allowedVehicleTypes: [...restriction.allowedVehicleTypes] })
  }
  for (const connector of snapshot.laneConnectors) {
    rules.addLaneConnector({
      ...connector,
      fromAnchor: { ...connector.fromAnchor },
      toAnchor: { ...connector.toAnchor },
    })
  }
  for (const arrow of snapshot.laneArrows) {
    road.setLaneArrow({ ...arrow, allowedDirections: [...arrow.allowedDirections] })
  }
  for (const restriction of snapshot.turnRestrictions) rules.addTurnRestriction({ ...restriction })
}

export class AddSegmentCommand implements ICommand {
  readonly timestamp = Date.now()
  private segmentId: string
  private startNodeId: string
  private endNodeId: string
  private isNewStartNode: boolean
  private isNewEndNode: boolean

  constructor(
    private segment: RoadSegment,
    private startNode: RoadNode,
    private endNode: RoadNode,
    newStartNode: boolean,
    newEndNode: boolean,
  ) {
    this.segmentId = segment.id
    this.startNodeId = startNode.id
    this.endNodeId = endNode.id
    this.isNewStartNode = newStartNode
    this.isNewEndNode = newEndNode
  }

  execute(): void {
    const store = useRoadNetworkStore()
    if (this.isNewStartNode) store.addNode(this.startNode)
    if (this.isNewEndNode) store.addNode(this.endNode)
    store.addSegment(this.segment)
  }

  undo(): void {
    const store = useRoadNetworkStore()
    store.removeSegment(this.segmentId)
    if (this.isNewStartNode) store.removeNode(this.startNodeId)
    if (this.isNewEndNode) store.removeNode(this.endNodeId)
  }

  getDescription(): string {
    return `Add road segment ${this.segmentId}`
  }
}

export class DeleteSegmentCommand implements ICommand {
  readonly timestamp = Date.now()
  private snapshot: {
    segment: RoadSegment
    startNode: RoadNode
    endNode: RoadNode
    lanes: Lane[]
    rules: RuleSnapshot
  } | null = null

  constructor(private segmentId: string) {}

  execute(): void {
    const store = useRoadNetworkStore()
    const seg = store.getSegment(this.segmentId)
    if (!seg) return
    const startNode = store.getNode(seg.startNodeId)
    const endNode = store.getNode(seg.endNodeId)
    const lanes = store.getLanesBySegment(this.segmentId).map((lane) => ({ ...lane }))
    const laneIds = new Set(lanes.map((lane) => lane.id))
    const rules = captureRulesForLaneIds(laneIds, new Set([this.segmentId]))
    if (startNode && endNode) {
      this.snapshot = {
        segment: cloneSegment(seg),
        startNode: cloneNode(startNode),
        endNode: cloneNode(endNode),
        lanes,
        rules,
      }
    }
    removeRuleSnapshot(rules)
    store.removeSegment(this.segmentId)
  }

  undo(): void {
    if (!this.snapshot) return
    const store = useRoadNetworkStore()
    const { segment, startNode, endNode, lanes, rules } = this.snapshot
    if (!store.getNode(startNode.id)) store.addNode(startNode)
    if (!store.getNode(endNode.id)) store.addNode(endNode)
    store.addSegment(cloneSegment(segment))
    for (const lane of lanes) store.addLane({ ...lane })
    restoreRuleSnapshot(rules)
  }

  getDescription(): string {
    return `Delete road segment ${this.segmentId}`
  }
}

export class UpgradeSegmentCommand implements ICommand {
  readonly timestamp = Date.now()
  conflictMessage: string | null = null
  private oldSegment: RoadSegment | null = null
  private oldLanes: Lane[] = []

  constructor(
    private segmentId: string,
    private profile: CrossSectionProfile,
    private meshData?: MeshData,
  ) {}

  execute(): void {
    const store = useRoadNetworkStore()
    const segment = store.getSegment(this.segmentId)
    if (!segment) throw new Error('无法升级断面：目标路段不存在')

    this.oldSegment = cloneSegment(segment)
    this.oldLanes = store.getLanesBySegment(this.segmentId).map((lane) => ({ ...lane }))
    const nextLaneIds = new Set(this.profile.lanes.map((_, index) => `${this.segmentId}:lane:${index}`))
    const removedLaneIds = this.oldLanes
      .map((lane) => lane.id)
      .filter((laneId) => !nextLaneIds.has(laneId))
    const conflictingRules = captureRulesForLaneIds(new Set(removedLaneIds))
    const conflictRuleCount =
      conflictingRules.laneRestrictions.length +
      conflictingRules.laneConnectors.length +
      conflictingRules.laneArrows.length

    if (conflictRuleCount > 0) {
      this.conflictMessage = `断面降级被阻止：目标断面会删除仍关联 ${conflictRuleCount} 项交规的车道，请先移除相关车道限制、连接器或箭头。`
      throw new Error(this.conflictMessage)
    }

    store.replaceSegmentProfile(this.segmentId, this.profile, this.meshData)
    this.conflictMessage = null
  }

  undo(): void {
    if (!this.oldSegment) return
    const store = useRoadNetworkStore()
    store.replaceSegmentProfile(this.segmentId, this.oldSegment.profile, this.oldSegment.meshData)
    for (const lane of this.oldLanes) store.addLane({ ...lane })
  }

  getDescription(): string {
    return `Upgrade road segment ${this.segmentId}`
  }
}

export class CreateParallelSegmentCommand extends AddSegmentCommand {
  getDescription(): string {
    return 'Create parallel road segment'
  }
}

export class UpdateSegmentCommand implements ICommand {
  readonly timestamp = Date.now()
  private beforeSegment: RoadSegment | null = null

  constructor(
    private segmentId: string,
    private patch: Partial<RoadSegment>,
  ) {}

  execute(): void {
    const store = useRoadNetworkStore()
    const segment = store.getSegment(this.segmentId)
    if (!segment) throw new Error('无法更新路段：目标路段不存在')
    if (!this.beforeSegment) this.beforeSegment = cloneSegment(segment)
    store.updateSegment(this.segmentId, this.patch)
  }

  undo(): void {
    if (!this.beforeSegment) return
    const store = useRoadNetworkStore()
    store.updateSegment(this.segmentId, cloneSegment(this.beforeSegment))
  }

  getDescription(): string {
    return `Update road segment ${this.segmentId}`
  }
}

export class UpdateNodeCommand implements ICommand {
  readonly timestamp = Date.now()
  private beforeNode: RoadNode | null = null

  constructor(
    private nodeId: string,
    private patch: Partial<RoadNode>,
  ) {}

  execute(): void {
    const store = useRoadNetworkStore()
    const node = store.getNode(this.nodeId)
    if (!node) throw new Error('无法更新节点：目标节点不存在')
    if (!this.beforeNode) this.beforeNode = cloneNode(node)
    store.updateNode(this.nodeId, this.patch)
  }

  undo(): void {
    if (!this.beforeNode) return
    const store = useRoadNetworkStore()
    store.updateNode(this.nodeId, cloneNode(this.beforeNode))
  }

  getDescription(): string {
    return `Update road node ${this.nodeId}`
  }
}

function cloneLaneRestriction(restriction: LaneRestriction): LaneRestriction {
  return {
    ...restriction,
    allowedVehicleTypes: [...restriction.allowedVehicleTypes],
  }
}

function cloneLaneConnector(connector: LaneConnector): LaneConnector {
  return {
    ...connector,
    fromAnchor: { ...connector.fromAnchor },
    toAnchor: { ...connector.toAnchor },
  }
}

function cloneTrafficLight(light: TrafficLightController): TrafficLightController {
  return {
    ...light,
    steps: light.steps.map((step) => ({
      ...step,
      greenLanes: [...step.greenLanes],
      sensorBindings: step.sensorBindings.map((binding) => ({ ...binding })),
    })),
    sensors: light.sensors.map((sensor) => ({ ...sensor })),
  }
}

export class SetLaneRestrictionCommand implements ICommand {
  readonly timestamp = Date.now()
  private beforeRestriction: LaneRestriction | null | undefined

  constructor(private restriction: LaneRestriction) {}

  execute(): void {
    const rules = useTrafficRuleStore()
    if (this.beforeRestriction === undefined) {
      const existing = rules.laneRestrictions.get(this.restriction.laneId)
      this.beforeRestriction = existing ? cloneLaneRestriction(existing) : null
    }
    rules.setLaneRestriction(cloneLaneRestriction(this.restriction))
  }

  undo(): void {
    const rules = useTrafficRuleStore()
    if (this.beforeRestriction) {
      rules.setLaneRestriction(cloneLaneRestriction(this.beforeRestriction))
      return
    }
    rules.removeLaneRestriction(this.restriction.laneId)
  }

  getDescription(): string {
    return `Set lane restriction ${this.restriction.laneId}`
  }
}

export class SetLaneConnectorCommand implements ICommand {
  readonly timestamp = Date.now()
  private beforeConnector: LaneConnector | null | undefined
  private duplicateConnectorId: string | null = null

  constructor(private connector: LaneConnector) {}

  execute(): void {
    const rules = useTrafficRuleStore()
    const duplicate = Array.from(rules.laneConnectors.values()).find(
      (item) => item.fromLaneId === this.connector.fromLaneId && item.toLaneId === this.connector.toLaneId,
    )
    if (duplicate && duplicate.id !== this.connector.id) {
      this.duplicateConnectorId = duplicate.id
      return
    }
    if (this.beforeConnector === undefined) {
      const existing = rules.laneConnectors.get(this.connector.id)
      this.beforeConnector = existing ? cloneLaneConnector(existing) : null
    }
    rules.addLaneConnector(cloneLaneConnector(this.connector))
  }

  undo(): void {
    if (this.duplicateConnectorId) return
    const rules = useTrafficRuleStore()
    if (this.beforeConnector) {
      rules.addLaneConnector(cloneLaneConnector(this.beforeConnector))
      return
    }
    rules.removeLaneConnector(this.connector.id)
  }

  getDescription(): string {
    return `Set lane connector ${this.connector.fromLaneId} -> ${this.connector.toLaneId}`
  }
}

export class RemoveLaneConnectorCommand implements ICommand {
  readonly timestamp = Date.now()
  private beforeConnector: LaneConnector | null = null

  constructor(private connectorId: string) {}

  execute(): void {
    const rules = useTrafficRuleStore()
    const connector = rules.laneConnectors.get(this.connectorId)
    if (!connector) return
    if (!this.beforeConnector) this.beforeConnector = cloneLaneConnector(connector)
    rules.removeLaneConnector(this.connectorId)
  }

  undo(): void {
    if (!this.beforeConnector) return
    const rules = useTrafficRuleStore()
    rules.addLaneConnector(cloneLaneConnector(this.beforeConnector))
  }

  getDescription(): string {
    return `Remove lane connector ${this.connectorId}`
  }
}

function cloneLaneArrow(arrow: LaneArrow): LaneArrow {
  return { ...arrow, allowedDirections: [...arrow.allowedDirections] }
}

export class SetLaneArrowCommand implements ICommand {
  readonly timestamp = Date.now()
  private beforeArrow: LaneArrow | null | undefined

  constructor(private arrow: LaneArrow) {}

  execute(): void {
    const road = useRoadNetworkStore()
    if (this.beforeArrow === undefined) {
      const key = `${this.arrow.nodeId}:${this.arrow.laneId}`
      const existing = road.laneArrows.get(key)
      this.beforeArrow = existing ? cloneLaneArrow(existing) : null
    }
    road.setLaneArrow(cloneLaneArrow(this.arrow))
  }

  undo(): void {
    const road = useRoadNetworkStore()
    if (this.beforeArrow) {
      road.setLaneArrow(cloneLaneArrow(this.beforeArrow))
      return
    }
    road.removeLaneArrow(this.arrow.nodeId, this.arrow.laneId)
  }

  getDescription(): string {
    return `Set lane arrow ${this.arrow.laneId}@${this.arrow.nodeId}`
  }
}

export class UpdateTrafficLightCommand implements ICommand {
  readonly timestamp = Date.now()
  private beforeLight: TrafficLightController | null = null

  constructor(
    private lightId: string,
    private patch: Partial<TrafficLightController>,
  ) {}

  execute(): void {
    const rules = useTrafficRuleStore()
    const light = rules.trafficLights.get(this.lightId)
    if (!light) throw new Error('无法更新信号灯：目标控制器不存在')
    if (!this.beforeLight) this.beforeLight = cloneTrafficLight(light)
    rules.updateTrafficLight(this.lightId, this.patch)
  }

  undo(): void {
    if (!this.beforeLight) return
    const rules = useTrafficRuleStore()
    rules.addTrafficLight(cloneTrafficLight(this.beforeLight))
  }

  getDescription(): string {
    return `Update traffic light ${this.lightId}`
  }
}

export class AddSignalStepCommand implements ICommand {
  readonly timestamp = Date.now()
  private oldSteps: SignalStep[] | null = null

  constructor(
    private controllerId: string,
    private step: SignalStep,
  ) {}

  execute(): void {
    const rules = useTrafficRuleStore()
    const light = rules.trafficLights.get(this.controllerId)
    if (!light) throw new Error('无法添加步阶：目标控制器不存在')
    if (!this.oldSteps) this.oldSteps = light.steps.map((s) => ({ ...s, greenLanes: [...s.greenLanes], sensorBindings: s.sensorBindings.map((b) => ({ ...b })) }))
    rules.updateTrafficLight(this.controllerId, { steps: [...light.steps, { ...this.step, greenLanes: [...this.step.greenLanes], sensorBindings: this.step.sensorBindings.map((b) => ({ ...b })) }] })
  }

  undo(): void {
    if (!this.oldSteps) return
    const rules = useTrafficRuleStore()
    rules.updateTrafficLight(this.controllerId, { steps: this.oldSteps.map((s) => ({ ...s, greenLanes: [...s.greenLanes], sensorBindings: s.sensorBindings.map((b) => ({ ...b })) })) })
  }

  getDescription(): string {
    return `Add signal step to ${this.controllerId}`
  }
}

export class RemoveSignalStepCommand implements ICommand {
  readonly timestamp = Date.now()
  private oldSteps: SignalStep[] | null = null

  constructor(
    private controllerId: string,
    private stepId: string,
  ) {}

  execute(): void {
    const rules = useTrafficRuleStore()
    const light = rules.trafficLights.get(this.controllerId)
    if (!light) return
    if (!this.oldSteps) this.oldSteps = light.steps.map((s) => ({ ...s, greenLanes: [...s.greenLanes], sensorBindings: s.sensorBindings.map((b) => ({ ...b })) }))
    rules.updateTrafficLight(this.controllerId, { steps: light.steps.filter((s) => s.id !== this.stepId) })
  }

  undo(): void {
    if (!this.oldSteps) return
    const rules = useTrafficRuleStore()
    rules.updateTrafficLight(this.controllerId, { steps: this.oldSteps.map((s) => ({ ...s, greenLanes: [...s.greenLanes], sensorBindings: s.sensorBindings.map((b) => ({ ...b })) })) })
  }

  getDescription(): string {
    return `Remove signal step ${this.stepId} from ${this.controllerId}`
  }
}

export class SetTurnRestrictionCommand implements ICommand {
  readonly timestamp = Date.now()
  private key: string
  private beforeRestriction: TurnRestriction | null = null

  constructor(private restriction: TurnRestriction) {
    this.key = turnRestrictionKey(restriction)
  }

  execute(): void {
    const rules = useTrafficRuleStore()
    if (!this.beforeRestriction) {
      const existing = rules.turnRestrictions.get(this.key)
      this.beforeRestriction = existing ? { ...existing } : null
    }
    rules.addTurnRestriction({ ...this.restriction })
  }

  undo(): void {
    const rules = useTrafficRuleStore()
    if (this.beforeRestriction) {
      rules.addTurnRestriction({ ...this.beforeRestriction })
      return
    }
    rules.removeTurnRestriction(this.key)
  }

  getDescription(): string {
    return `Set turn restriction ${this.key}`
  }
}

export class AddTrafficLightCommand implements ICommand {
  readonly timestamp = Date.now()
  private beforeLight: TrafficLightController | null | undefined
  private beforeNode: RoadNode | null = null
  private beforeSelectedLightId: string | null = null

  constructor(private light: TrafficLightController) {}

  execute(): void {
    const road = useRoadNetworkStore()
    const rules = useTrafficRuleStore()
    const node = road.getNode(this.light.nodeId)
    if (!node) throw new Error('无法添加信号灯：目标节点不存在')
    if (!this.beforeNode) this.beforeNode = cloneNode(node)
    if (this.beforeLight === undefined) {
      const existing = rules.trafficLights.get(this.light.id)
      this.beforeLight = existing ? cloneTrafficLight(existing) : null
      this.beforeSelectedLightId = rules.selectedLightId
    }
    if (!this.beforeLight) {
      rules.addTrafficLight(cloneTrafficLight(this.light))
      road.updateNode(this.light.nodeId, { controlMode: 'TRAFFIC_LIGHT' })
    }
    rules.selectLight(this.light.id)
  }

  undo(): void {
    const road = useRoadNetworkStore()
    const rules = useTrafficRuleStore()
    if (this.beforeLight) {
      rules.addTrafficLight(cloneTrafficLight(this.beforeLight))
    } else {
      rules.removeTrafficLight(this.light.id)
    }
    if (this.beforeNode) road.updateNode(this.beforeNode.id, cloneNode(this.beforeNode))
    rules.selectLight(this.beforeSelectedLightId)
  }

  getDescription(): string {
    return `Add traffic light ${this.light.id}`
  }
}

export class MoveNodeCommand implements ICommand {
  readonly timestamp = Date.now()

  constructor(
    private nodeId: string,
    private fromPosition: { x: number; y: number; z: number },
    private toPosition: { x: number; y: number; z: number },
  ) {}

  execute(): void {
    const store = useRoadNetworkStore()
    store.updateNode(this.nodeId, { position: this.toPosition })
  }

  undo(): void {
    const store = useRoadNetworkStore()
    store.updateNode(this.nodeId, { position: this.fromPosition })
  }

  getDescription(): string {
    return `Move node ${this.nodeId}`
  }
}

type NodeControlMode = RoadNode['controlMode']

export class SetNodeControlModeCommand implements ICommand {
  readonly timestamp = Date.now()
  private beforeMode: NodeControlMode | null = null
  private beforeLight: TrafficLightController | null = null
  private beforeSelectedLightId: string | null = null
  private createdLightId: string | null = null

  constructor(
    private nodeId: string,
    private newMode: NodeControlMode,
  ) {}

  execute(): void {
    const road = useRoadNetworkStore()
    const rules = useTrafficRuleStore()
    const node = road.getNode(this.nodeId)
    if (!node) throw new Error('无法切换控制模式：目标节点不存在')

    if (this.beforeMode === null) {
      this.beforeMode = node.controlMode
      this.beforeSelectedLightId = rules.selectedLightId
      const existingLight = Array.from(rules.trafficLights.values()).find((l) => l.nodeId === this.nodeId)
      this.beforeLight = existingLight ? cloneTrafficLight(existingLight) : null
    }

    road.updateNode(this.nodeId, { controlMode: this.newMode })

    if (this.newMode === 'TRAFFIC_LIGHT' && !this.beforeLight) {
      const lightId = `light:${this.nodeId}:${Date.now()}`
      const defaultLight: TrafficLightController = {
        id: lightId,
        nodeId: this.nodeId,
        strategy: 'FIXED',
        steps: [{
          id: `${lightId}:step:0`,
          greenLanes: [],
          minGreenTime: 10,
          maxGreenTime: 30,
          yellowTime: 3,
          allRedTime: 1,
          sensorBindings: [],
        }],
        sensors: [],
        currentStepIndex: 0,
        timeInCurrentStep: 0,
      }
      rules.addTrafficLight(cloneTrafficLight(defaultLight))
      rules.selectLight(lightId)
      this.createdLightId = lightId
    }

    if (this.newMode !== 'TRAFFIC_LIGHT' && this.beforeLight) {
      rules.removeTrafficLight(this.beforeLight.id)
      if (rules.selectedLightId === this.beforeLight.id) rules.selectLight(null)
    }
  }

  undo(): void {
    if (this.beforeMode === null) return
    const road = useRoadNetworkStore()
    const rules = useTrafficRuleStore()

    road.updateNode(this.nodeId, { controlMode: this.beforeMode })

    if (this.createdLightId && this.newMode === 'TRAFFIC_LIGHT') {
      rules.removeTrafficLight(this.createdLightId)
      if (rules.selectedLightId === this.createdLightId) rules.selectLight(null)
    }

    if (this.beforeLight) {
      rules.addTrafficLight(cloneTrafficLight(this.beforeLight))
    } else if (this.newMode !== 'TRAFFIC_LIGHT') {
      // no light to restore
    }

    rules.selectLight(this.beforeSelectedLightId)
  }

  getDescription(): string {
    return `Set node ${this.nodeId} control mode to ${this.newMode}`
  }
}

export class SetCrosswalkCommand implements ICommand {
  readonly timestamp = Date.now()
  private beforeCrosswalk: Crosswalk | null | undefined

  constructor(private crosswalk: Crosswalk) {}

  execute(): void {
    const rules = useTrafficRuleStore()
    if (this.beforeCrosswalk === undefined) {
      const existing = rules.crosswalks.get(this.crosswalk.id)
      this.beforeCrosswalk = existing ? { ...existing } : null
    }
    if (this.crosswalk.isActive) {
      rules.addCrosswalk({ ...this.crosswalk })
    } else {
      rules.removeCrosswalk(this.crosswalk.id)
    }
  }

  undo(): void {
    const rules = useTrafficRuleStore()
    if (this.beforeCrosswalk) {
      rules.addCrosswalk({ ...this.beforeCrosswalk })
      return
    }
    rules.removeCrosswalk(this.crosswalk.id)
  }

  getDescription(): string {
    return `Set crosswalk ${this.crosswalk.id} active=${this.crosswalk.isActive}`
  }
}
