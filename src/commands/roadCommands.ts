import type { ICommand } from '@/types/commands'
import type {
  CrossSectionProfile,
  Lane,
  LaneArrow,
  MeshData,
  RoadNode,
  RoadSegment,
} from '@/types/road-network'
import type { LaneConnector, LaneRestriction, TurnRestriction } from '@/types/traffic-rule'
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

function turnRestrictionKey(tr: TurnRestriction): string {
  return `${tr.nodeId}:${tr.fromSegmentId}:${tr.toSegmentId}:${tr.restriction}`
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
  private removedRules: RuleSnapshot | null = null

  constructor(
    private segmentId: string,
    private profile: CrossSectionProfile,
    private meshData?: MeshData,
  ) {}

  execute(): void {
    const store = useRoadNetworkStore()
    const segment = store.getSegment(this.segmentId)
    if (!segment) return

    this.oldSegment = cloneSegment(segment)
    this.oldLanes = store.getLanesBySegment(this.segmentId).map((lane) => ({ ...lane }))
    const nextLaneIds = new Set(this.profile.lanes.map((_, index) => `${this.segmentId}:lane:${index}`))
    const removedLaneIds = this.oldLanes
      .map((lane) => lane.id)
      .filter((laneId) => !nextLaneIds.has(laneId))
    this.removedRules = captureRulesForLaneIds(new Set(removedLaneIds))
    const removedRuleCount =
      this.removedRules.laneRestrictions.length +
      this.removedRules.laneConnectors.length +
      this.removedRules.laneArrows.length

    store.replaceSegmentProfile(this.segmentId, this.profile, this.meshData)
    removeRuleSnapshot(this.removedRules)
    this.conflictMessage = removedRuleCount > 0
      ? `Road upgrade removed ${removedRuleCount} lane rule(s) that could not be migrated.`
      : null
  }

  undo(): void {
    if (!this.oldSegment) return
    const store = useRoadNetworkStore()
    store.replaceSegmentProfile(this.segmentId, this.oldSegment.profile, this.oldSegment.meshData)
    for (const lane of this.oldLanes) store.addLane({ ...lane })
    if (this.removedRules) restoreRuleSnapshot(this.removedRules)
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
