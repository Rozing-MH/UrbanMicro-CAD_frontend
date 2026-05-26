import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  RoadNode,
  RoadSegment,
  Lane,
  LaneArrow,
  HalfEdge,
  DrawingContext,
  DrawingMode,
  ElevationMode,
  TopologyData,
  Point2D,
} from '@/types/road-network'

export const useRoadNetworkStore = defineStore('roadNetwork', () => {
  const nodes = ref<Map<string, RoadNode>>(new Map())
  const segments = ref<Map<string, RoadSegment>>(new Map())
  const lanes = ref<Map<string, Lane>>(new Map())
  const laneArrows = ref<Map<string, LaneArrow>>(new Map())
  const halfEdges = ref<Map<string, HalfEdge>>(new Map())

  const drawingContext = ref<DrawingContext>({
    state: 'IDLE',
    mode: 'STRAIGHT',
    startNodeId: null,
    startPoint: null,
    controlPoint: null,
    previewEndPoint: null,
    currentElevationMode: 'GROUND',
    startElevation: 0,
    endElevation: 0,
    activeCrossSectionId: 'default-2lane',
  })

  const selectedNodeIds = ref<Set<string>>(new Set())
  const selectedSegmentIds = ref<Set<string>>(new Set())
  const hoveredSegmentId = ref<string | null>(null)
  const topologyVersion = ref(1)

  const nodeCount = computed(() => nodes.value.size)
  const segmentCount = computed(() => segments.value.size)
  const isDrawing = computed(() => drawingContext.value.state !== 'IDLE')

  function laneArrowKey(arrow: Pick<LaneArrow, 'nodeId' | 'laneId'>): string {
    return `${arrow.nodeId}:${arrow.laneId}`
  }

  function addNode(node: RoadNode): void {
    nodes.value.set(node.id, node)
    topologyVersion.value++
  }

  function updateNode(id: string, patch: Partial<RoadNode>): void {
    const existing = nodes.value.get(id)
    if (!existing) return
    nodes.value.set(id, { ...existing, ...patch })
    topologyVersion.value++
  }

  function removeNode(id: string): void {
    nodes.value.delete(id)
    topologyVersion.value++
  }

  function getNode(id: string): RoadNode | undefined {
    return nodes.value.get(id)
  }

  function addSegment(seg: RoadSegment): void {
    segments.value.set(seg.id, seg)
    topologyVersion.value++
  }

  function updateSegment(id: string, patch: Partial<RoadSegment>): void {
    const existing = segments.value.get(id)
    if (!existing) return
    segments.value.set(id, { ...existing, ...patch })
    topologyVersion.value++
  }

  function removeSegment(id: string): void {
    const seg = segments.value.get(id)
    if (!seg) return
    segments.value.delete(id)
    for (const nodeId of [seg.startNodeId, seg.endNodeId]) {
      const n = nodes.value.get(nodeId)
      if (n) {
        const updated = n.connectedSegmentIds.filter((s) => s !== id)
        if (updated.length === 0) {
          nodes.value.delete(nodeId)
        } else {
          nodes.value.set(nodeId, { ...n, connectedSegmentIds: updated })
        }
      }
    }
    topologyVersion.value++
  }

  function getSegment(id: string): RoadSegment | undefined {
    return segments.value.get(id)
  }

  function addLane(lane: Lane): void {
    lanes.value.set(lane.id, lane)
  }

  function removeLane(id: string): void {
    lanes.value.delete(id)
  }

  function getLanesBySegment(segmentId: string): Lane[] {
    const result: Lane[] = []
    for (const lane of lanes.value.values()) {
      if (lane.segmentId === segmentId) result.push(lane)
    }
    return result
  }

  function startDrawing(mode: DrawingMode, startPoint: Point2D, startNodeId: string | null): void {
    drawingContext.value = {
      ...drawingContext.value,
      state: 'DRAWING',
      mode,
      startPoint,
      startNodeId,
      previewEndPoint: startPoint,
    }
  }

  function updatePreview(endPoint: Point2D, controlPoint: Point2D | null = null): void {
    if (drawingContext.value.state !== 'DRAWING' && drawingContext.value.state !== 'PREVIEW') return
    drawingContext.value = {
      ...drawingContext.value,
      state: 'PREVIEW',
      previewEndPoint: endPoint,
      controlPoint,
    }
  }

  function confirmDrawing(): void {
    drawingContext.value = { ...drawingContext.value, state: 'CONFIRMED' }
  }

  function cancelDrawing(): void {
    drawingContext.value = {
      ...drawingContext.value,
      state: 'IDLE',
      startNodeId: null,
      startPoint: null,
      controlPoint: null,
      previewEndPoint: null,
    }
  }

  function setDrawingMode(mode: DrawingMode): void {
    drawingContext.value = { ...drawingContext.value, mode }
  }

  function setElevationMode(mode: ElevationMode): void {
    drawingContext.value = { ...drawingContext.value, currentElevationMode: mode }
  }

  function setActiveCrossSection(id: string): void {
    drawingContext.value = { ...drawingContext.value, activeCrossSectionId: id }
  }

  function selectNode(id: string, additive = false): void {
    if (!additive) selectedNodeIds.value.clear()
    selectedNodeIds.value.add(id)
  }

  function selectSegment(id: string, additive = false): void {
    if (!additive) selectedSegmentIds.value.clear()
    selectedSegmentIds.value.add(id)
  }

  function clearSelection(): void {
    selectedNodeIds.value.clear()
    selectedSegmentIds.value.clear()
  }

  function setHoveredSegment(id: string | null): void {
    hoveredSegmentId.value = id
  }

  function serialize(): TopologyData {
    return {
      version: topologyVersion.value,
      nodes: Array.from(nodes.value.values()),
      segments: Array.from(segments.value.values()),
      lanes: Array.from(lanes.value.values()),
      laneArrows: Array.from(laneArrows.value.values()),
      halfEdges: Array.from(halfEdges.value.values()),
    }
  }

  function deserialize(data: TopologyData): void {
    nodes.value = new Map(data.nodes.map((n) => [n.id, n]))
    segments.value = new Map(data.segments.map((s) => [s.id, s]))
    lanes.value = new Map(data.lanes.map((l) => [l.id, l]))
    laneArrows.value = new Map(data.laneArrows.map((a) => [laneArrowKey(a), a]))
    halfEdges.value = new Map(data.halfEdges.map((e) => [e.id, e]))
    topologyVersion.value = data.version
  }

  function clear(): void {
    nodes.value.clear()
    segments.value.clear()
    lanes.value.clear()
    laneArrows.value.clear()
    halfEdges.value.clear()
    clearSelection()
    cancelDrawing()
    topologyVersion.value = 1
  }

  return {
    nodes, segments, lanes, laneArrows, halfEdges,
    drawingContext, selectedNodeIds, selectedSegmentIds, hoveredSegmentId, topologyVersion,
    nodeCount, segmentCount, isDrawing,
    addNode, updateNode, removeNode, getNode,
    addSegment, updateSegment, removeSegment, getSegment,
    addLane, removeLane, getLanesBySegment,
    startDrawing, updatePreview, confirmDrawing, cancelDrawing,
    setDrawingMode, setElevationMode, setActiveCrossSection,
    selectNode, selectSegment, clearSelection, setHoveredSegment,
    serialize, deserialize, clear,
  }
})
