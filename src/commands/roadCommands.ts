import type { ICommand } from '@/types/commands'
import type { RoadNode, RoadSegment } from '@/types/road-network'
import { useRoadNetworkStore } from '@/stores/roadNetworkStore'

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
  private snapshot: { segment: RoadSegment; startNode: RoadNode; endNode: RoadNode } | null = null

  constructor(private segmentId: string) {}

  execute(): void {
    const store = useRoadNetworkStore()
    const seg = store.getSegment(this.segmentId)
    if (!seg) return
    const startNode = store.getNode(seg.startNodeId)
    const endNode = store.getNode(seg.endNodeId)
    if (startNode && endNode) {
      this.snapshot = { segment: seg, startNode, endNode }
    }
    store.removeSegment(this.segmentId)
  }

  undo(): void {
    if (!this.snapshot) return
    const store = useRoadNetworkStore()
    const { segment, startNode, endNode } = this.snapshot
    if (!store.getNode(startNode.id)) store.addNode(startNode)
    if (!store.getNode(endNode.id)) store.addNode(endNode)
    store.addSegment(segment)
  }

  getDescription(): string {
    return `Delete road segment ${this.segmentId}`
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
