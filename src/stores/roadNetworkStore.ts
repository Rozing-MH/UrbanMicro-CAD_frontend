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
  CrossSectionProfile,
  MeshData,
} from '@/types/road-network'
import { createSegmentFromPoints, offsetPolyline } from '@/utils/roadGeometry'

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

  function createLanesForSegment(seg: RoadSegment): Lane[] {
    return seg.profile.lanes.map((laneDef, index) => ({
      id: `${seg.id}:lane:${index}`,
      segmentId: seg.id,
      index,
      direction: laneDef.direction,
      type: laneDef.type,
      width: laneDef.width,
    }))
  }

  function ensureSegmentHalfEdges(seg: RoadSegment): void {
    const forwardId = `${seg.id}:he:forward`
    const backwardId = `${seg.id}:he:backward`
    if (!halfEdges.value.has(forwardId)) {
      halfEdges.value.set(forwardId, {
        id: forwardId,
        originNodeId: seg.startNodeId,
        twinId: backwardId,
        nextId: '',
        segmentId: seg.id,
      })
    }
    if (!halfEdges.value.has(backwardId)) {
      halfEdges.value.set(backwardId, {
        id: backwardId,
        originNodeId: seg.endNodeId,
        twinId: forwardId,
        nextId: '',
        segmentId: seg.id,
      })
    }
  }

  function attachSegmentToNode(nodeId: string, segmentId: string): void {
    const node = nodes.value.get(nodeId)
    if (!node || node.connectedSegmentIds.includes(segmentId)) return
    nodes.value.set(nodeId, {
      ...node,
      connectedSegmentIds: [...node.connectedSegmentIds, segmentId],
    })
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
    attachSegmentToNode(seg.startNodeId, seg.id)
    attachSegmentToNode(seg.endNodeId, seg.id)
    for (const lane of createLanesForSegment(seg)) {
      lanes.value.set(lane.id, lane)
    }
    ensureSegmentHalfEdges(seg)
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
    for (const lane of Array.from(lanes.value.values())) {
      if (lane.segmentId !== id) continue
      lanes.value.delete(lane.id)
      for (const arrow of Array.from(laneArrows.value.values())) {
        if (arrow.laneId === lane.id) laneArrows.value.delete(laneArrowKey(arrow))
      }
    }
    for (const he of Array.from(halfEdges.value.values())) {
      if (he.segmentId === id) halfEdges.value.delete(he.id)
    }
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

  function removeHalfEdge(id: string): void {
    halfEdges.value.delete(id)
  }

  function getLanesBySegment(segmentId: string): Lane[] {
    const result: Lane[] = []
    for (const lane of lanes.value.values()) {
      if (lane.segmentId === segmentId) result.push(lane)
    }
    return result.sort((a, b) => a.index - b.index)
  }

  function getSegmentLaneIds(segmentId: string): string[] {
    return getLanesBySegment(segmentId).map((lane) => lane.id)
  }

  function rebuildSegmentLanes(segmentId: string): { oldLaneIds: string[]; newLaneIds: string[]; removedLaneIds: string[] } {
    const seg = segments.value.get(segmentId)
    if (!seg) return { oldLaneIds: [], newLaneIds: [], removedLaneIds: [] }
    const oldLaneIds = getSegmentLaneIds(segmentId)
    const nextLanes = createLanesForSegment(seg)
    const nextLaneIds = new Set(nextLanes.map((lane) => lane.id))

    for (const lane of Array.from(lanes.value.values())) {
      if (lane.segmentId === segmentId && !nextLaneIds.has(lane.id)) {
        lanes.value.delete(lane.id)
        for (const arrow of Array.from(laneArrows.value.values())) {
          if (arrow.laneId === lane.id) laneArrows.value.delete(laneArrowKey(arrow))
        }
      }
    }
    for (const lane of nextLanes) lanes.value.set(lane.id, lane)

    return {
      oldLaneIds,
      newLaneIds: nextLanes.map((lane) => lane.id),
      removedLaneIds: oldLaneIds.filter((laneId) => !nextLaneIds.has(laneId)),
    }
  }

  function rebuildSegmentMeshData(segmentId: string, meshData: MeshData | undefined): void {
    const existing = segments.value.get(segmentId)
    if (!existing) return
    segments.value.set(segmentId, { ...existing, meshData })
    topologyVersion.value++
  }

  function replaceSegmentProfile(
    segmentId: string,
    profile: CrossSectionProfile,
    meshData?: MeshData,
  ): { oldLaneIds: string[]; newLaneIds: string[]; removedLaneIds: string[] } {
    const existing = segments.value.get(segmentId)
    if (!existing) return { oldLaneIds: [], newLaneIds: [], removedLaneIds: [] }
    segments.value.set(segmentId, { ...existing, profile, meshData })
    const laneResult = rebuildSegmentLanes(segmentId)
    for (const he of Array.from(halfEdges.value.values())) {
      if (he.segmentId === segmentId) halfEdges.value.delete(he.id)
    }
    ensureSegmentHalfEdges(segments.value.get(segmentId)!)
    topologyVersion.value++
    return laneResult
  }

  function createParallelSegmentDraft(params: {
    sourceSegmentId: string
    profile: CrossSectionProfile
    offsetDistance: number
    segmentId: string
    startNodeId: string
    endNodeId: string
    meshData?: MeshData
  }): { startNode: RoadNode; endNode: RoadNode; segment: RoadSegment } | null {
    const source = segments.value.get(params.sourceSegmentId)
    if (!source) return null
    const shiftedLine = offsetPolyline(source.centerLine, params.offsetDistance)
    const sourceStart = nodes.value.get(source.startNodeId)
    const sourceEnd = nodes.value.get(source.endNodeId)
    const startPoint = shiftedLine[0]
    const endPoint = shiftedLine[shiftedLine.length - 1]
    const startNode: RoadNode = {
      id: params.startNodeId,
      position: startPoint,
      elevation: sourceStart?.elevation ?? source.elevation.startZ,
      controlMode: 'NONE',
      connectedSegmentIds: [],
      polygonVertices: [],
    }
    const endNode: RoadNode = {
      id: params.endNodeId,
      position: endPoint,
      elevation: sourceEnd?.elevation ?? source.elevation.endZ,
      controlMode: 'NONE',
      connectedSegmentIds: [],
      polygonVertices: [],
    }
    const segment = createSegmentFromPoints({
      id: params.segmentId,
      startNodeId: startNode.id,
      endNodeId: endNode.id,
      centerLine: shiftedLine,
      profile: params.profile,
      elevation: { ...source.elevation },
      isCurved: source.isCurved,
      meshData: params.meshData,
    })
    return { startNode, endNode, segment }
  }

  function setLaneArrow(arrow: LaneArrow): void {
    laneArrows.value.set(laneArrowKey(arrow), arrow)
    topologyVersion.value++
  }

  function removeLaneArrow(nodeId: string, laneId: string): void {
    laneArrows.value.delete(`${nodeId}:${laneId}`)
    topologyVersion.value++
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

  function updatePreview(endPoint: Point2D, controlPoint: Point2D | null = null, endElevation?: number): void {
    if (drawingContext.value.state !== 'DRAWING' && drawingContext.value.state !== 'PREVIEW') return
    drawingContext.value = {
      ...drawingContext.value,
      state: 'PREVIEW',
      previewEndPoint: endPoint,
      controlPoint,
      ...(endElevation !== undefined ? { endElevation } : {}),
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
    laneArrows.value = new Map((data.laneArrows ?? []).map((a) => [laneArrowKey(a), a]))
    halfEdges.value = new Map((data.halfEdges ?? []).map((e) => [e.id, e]))
    for (const segment of segments.value.values()) {
      if (!Array.from(lanes.value.values()).some((lane) => lane.segmentId === segment.id)) {
        for (const lane of createLanesForSegment(segment)) lanes.value.set(lane.id, lane)
      }
      ensureSegmentHalfEdges(segment)
    }
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
    addLane, removeLane, removeHalfEdge, getLanesBySegment, getSegmentLaneIds,
    rebuildSegmentLanes, rebuildSegmentMeshData, replaceSegmentProfile, createParallelSegmentDraft,
    setLaneArrow, removeLaneArrow,
    startDrawing, updatePreview, confirmDrawing, cancelDrawing,
    setDrawingMode, setElevationMode, setActiveCrossSection,
    selectNode, selectSegment, clearSelection, setHoveredSegment,
    serialize, deserialize, clear,
  }
})
