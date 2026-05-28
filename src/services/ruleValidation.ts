import type { RoadNode, RoadSegment, Lane, LaneArrow } from '@/types/road-network'
import type {
  TrafficLightController,
  LaneRestriction,
  LaneConnector,
  TurnRestriction,
  Crosswalk,
} from '@/types/traffic-rule'
import type { ValidationCheckId, ValidationIssue, ValidationResult, ValidationRuleType } from '@/types/validation'
import { useRoadNetworkStore } from '@/stores/roadNetworkStore'
import { useTrafficRuleStore } from '@/stores/trafficRuleStore'

// ============================================================
// Validation Context
// ============================================================

export interface ValidationContext {
  nodes: Map<string, RoadNode>
  segments: Map<string, RoadSegment>
  lanes: Map<string, Lane>
  laneArrows: Map<string, LaneArrow>
  laneConnectors: Map<string, LaneConnector>
  laneRestrictions: Map<string, LaneRestriction>
  turnRestrictions: Map<string, TurnRestriction>
  trafficLights: Map<string, TrafficLightController>
  crosswalks: Map<string, Crosswalk>
}

export function createValidationContext(): ValidationContext {
  const road = useRoadNetworkStore()
  const rules = useTrafficRuleStore()
  return {
    nodes: road.nodes,
    segments: road.segments,
    lanes: road.lanes,
    laneArrows: road.laneArrows,
    laneConnectors: rules.laneConnectors,
    laneRestrictions: rules.laneRestrictions,
    turnRestrictions: rules.turnRestrictions,
    trafficLights: rules.trafficLights,
    crosswalks: rules.crosswalks,
  }
}

// ============================================================
// Topology Helpers
// ============================================================

function segmentIdFromLaneId(laneId: string): string {
  const idx = laneId.indexOf(':lane:')
  return idx >= 0 ? laneId.slice(0, idx) : laneId
}

function sharedNodeId(segA: RoadSegment, segB: RoadSegment): string | null {
  if (segA.startNodeId === segB.startNodeId || segA.startNodeId === segB.endNodeId) return segA.startNodeId
  if (segA.endNodeId === segB.startNodeId || segA.endNodeId === segB.endNodeId) return segA.endNodeId
  return null
}

type LaneOrientation = 'incoming' | 'outgoing' | 'both' | 'none'

function laneOrientationAtNode(lane: Lane, segment: RoadSegment, nodeId: string): LaneOrientation {
  const atStart = segment.startNodeId === nodeId
  const atEnd = segment.endNodeId === nodeId
  if (!atStart && !atEnd) return 'none'
  if (lane.direction === 'BOTH') return 'both'
  if (atStart) return lane.direction === 'FORWARD' ? 'outgoing' : 'incoming'
  return lane.direction === 'FORWARD' ? 'incoming' : 'outgoing'
}

// ============================================================
// Issue Emitter
// ============================================================

function emit(
  issues: ValidationIssue[],
  ruleType: ValidationRuleType,
  checkId: ValidationCheckId,
  severity: 'error' | 'warning',
  entityId: string,
  message: string,
  nodeId?: string,
): void {
  issues.push({ ruleType, checkId, severity, entityId, message, nodeId })
}

// ============================================================
// 1. Dangling References
// ============================================================

function checkDanglingReferences(ctx: ValidationContext, issues: ValidationIssue[]): void {
  const laneIds = new Set(ctx.lanes.keys())
  const nodeIds = new Set(ctx.nodes.keys())
  const segmentIds = new Set(ctx.segments.keys())

  for (const c of ctx.laneConnectors.values()) {
    if (!laneIds.has(c.fromLaneId)) {
      emit(issues, 'LANE_CONNECTOR', 'DANGLING_LANE_REF', 'error', c.id,
        `车道连接器 ${c.id} 的起始车道 ${c.fromLaneId} 不存在`)
    }
    if (!laneIds.has(c.toLaneId)) {
      emit(issues, 'LANE_CONNECTOR', 'DANGLING_LANE_REF', 'error', c.id,
        `车道连接器 ${c.id} 的目标车道 ${c.toLaneId} 不存在`)
    }
  }

  for (const r of ctx.laneRestrictions.values()) {
    if (!laneIds.has(r.laneId)) {
      emit(issues, 'LANE_RESTRICTION', 'DANGLING_LANE_REF', 'error', r.laneId,
        `车道限制引用的车道 ${r.laneId} 不存在`)
    }
  }

  for (const a of ctx.laneArrows.values()) {
    if (!laneIds.has(a.laneId)) {
      emit(issues, 'LANE_ARROW', 'DANGLING_LANE_REF', 'error', `${a.nodeId}:${a.laneId}`,
        `车道箭头引用的车道 ${a.laneId} 不存在`)
    }
  }

  for (const light of ctx.trafficLights.values()) {
    if (!nodeIds.has(light.nodeId)) {
      emit(issues, 'TRAFFIC_LIGHT', 'DANGLING_NODE_REF', 'error', light.id,
        `信号灯控制器 ${light.id} 引用的节点 ${light.nodeId} 不存在`)
      continue
    }
    for (const step of light.steps) {
      for (const gl of step.greenLanes) {
        if (!laneIds.has(gl)) {
          emit(issues, 'TRAFFIC_LIGHT', 'DANGLING_LANE_REF', 'error', step.id,
            `步阶 ${step.id} 的绿灯车道 ${gl} 不存在`, light.nodeId)
        }
      }
    }
    for (const sensor of light.sensors) {
      if (!laneIds.has(sensor.laneId)) {
        emit(issues, 'SENSOR', 'DANGLING_LANE_REF', 'error', sensor.id,
          `虚拟传感器 ${sensor.id} 引用的车道 ${sensor.laneId} 不存在`, light.nodeId)
      }
    }
  }

  for (const tr of ctx.turnRestrictions.values()) {
    if (!nodeIds.has(tr.nodeId)) {
      emit(issues, 'TURN_RESTRICTION', 'DANGLING_NODE_REF', 'error',
        `${tr.nodeId}:${tr.fromSegmentId}:${tr.toSegmentId}:${tr.restriction}`,
        `转向限制引用的节点 ${tr.nodeId} 不存在`)
    }
    if (!segmentIds.has(tr.fromSegmentId)) {
      emit(issues, 'TURN_RESTRICTION', 'DANGLING_SEGMENT_REF', 'error',
        `${tr.nodeId}:${tr.fromSegmentId}:${tr.toSegmentId}:${tr.restriction}`,
        `转向限制引用的起始路段 ${tr.fromSegmentId} 不存在`)
    }
    if (!segmentIds.has(tr.toSegmentId)) {
      emit(issues, 'TURN_RESTRICTION', 'DANGLING_SEGMENT_REF', 'error',
        `${tr.nodeId}:${tr.fromSegmentId}:${tr.toSegmentId}:${tr.restriction}`,
        `转向限制引用的目标路段 ${tr.toSegmentId} 不存在`)
    }
  }

  for (const cw of ctx.crosswalks.values()) {
    if (!nodeIds.has(cw.nodeId)) {
      emit(issues, 'CROSSWALK', 'DANGLING_NODE_REF', 'error', cw.id,
        `人行横道 ${cw.id} 引用的节点 ${cw.nodeId} 不存在`)
    }
  }
}

// ============================================================
// 2. Cross-Node Connectors
// ============================================================

function checkCrossNodeConnectors(ctx: ValidationContext, issues: ValidationIssue[]): void {
  for (const c of ctx.laneConnectors.values()) {
    const fromSegId = segmentIdFromLaneId(c.fromLaneId)
    const toSegId = segmentIdFromLaneId(c.toLaneId)
    if (fromSegId === toSegId) continue
    const fromSeg = ctx.segments.get(fromSegId)
    const toSeg = ctx.segments.get(toSegId)
    if (!fromSeg || !toSeg) continue // caught by dangling check
    if (sharedNodeId(fromSeg, toSeg) === null) {
      emit(issues, 'LANE_CONNECTOR', 'CROSS_NODE_CONNECTOR', 'error', c.id,
        `连接器 ${c.id} 跨节点连接：起始车道与目标车道所属路段无公共节点`)
    }
  }
}

// ============================================================
// 3. Dead-End Lanes at Nodes
// ============================================================

function checkDeadEndLanes(ctx: ValidationContext, issues: ValidationIssue[]): void {
  for (const node of ctx.nodes.values()) {
    if (node.controlMode !== 'TRAFFIC_LIGHT') continue

    const incomingLanes = new Set<string>()
    const outgoingLanes = new Set<string>()

    for (const segId of node.connectedSegmentIds) {
      const seg = ctx.segments.get(segId)
      if (!seg) continue
      for (const lane of ctx.lanes.values()) {
        if (lane.segmentId !== segId) continue
        const orient = laneOrientationAtNode(lane, seg, node.id)
        if (orient === 'incoming' || orient === 'both') incomingLanes.add(lane.id)
        if (orient === 'outgoing' || orient === 'both') outgoingLanes.add(lane.id)
      }
    }

    const lanesWithOutgoing = new Set<string>()
    const lanesWithIncoming = new Set<string>()

    for (const c of ctx.laneConnectors.values()) {
      if (incomingLanes.has(c.fromLaneId)) lanesWithOutgoing.add(c.fromLaneId)
      if (outgoingLanes.has(c.toLaneId)) lanesWithIncoming.add(c.toLaneId)
    }

    for (const laneId of incomingLanes) {
      if (!lanesWithOutgoing.has(laneId)) {
        emit(issues, 'LANE_CONNECTOR', 'DEAD_END_INCOMING', 'warning', laneId,
          `节点 ${node.id} 的入向车道 ${laneId} 无出向连接器（车辆将滞留）`, node.id)
      }
    }
    for (const laneId of outgoingLanes) {
      if (!lanesWithIncoming.has(laneId)) {
        emit(issues, 'LANE_CONNECTOR', 'DEAD_END_OUTGOING', 'warning', laneId,
          `节点 ${node.id} 的出向车道 ${laneId} 无入向连接器（无车辆可达）`, node.id)
      }
    }
  }
}

// ============================================================
// 4. Signal Phase Conflicts
// ============================================================

function checkSignalPhaseConflicts(ctx: ValidationContext, issues: ValidationIssue[]): void {
  for (const light of ctx.trafficLights.values()) {
    const node = ctx.nodes.get(light.nodeId)
    if (!node) continue

    if (light.steps.length === 0) {
      emit(issues, 'TRAFFIC_LIGHT', 'SIGNAL_NO_STEPS', 'warning', light.id,
        `信号灯控制器 ${light.id} 无任何步阶定义`, light.nodeId)
    }

    const nodeLaneIds = new Set<string>()
    for (const segId of node.connectedSegmentIds) {
      for (const lane of ctx.lanes.values()) {
        if (lane.segmentId === segId) nodeLaneIds.add(lane.id)
      }
    }

    const seenGreen = new Map<string, string>()
    for (const step of light.steps) {
      for (const gl of step.greenLanes) {
        const prev = seenGreen.get(gl)
        if (prev) {
          emit(issues, 'TRAFFIC_LIGHT', 'SIGNAL_DUPLICATE_GREEN_LANE', 'error', step.id,
            `车道 ${gl} 在步阶 ${prev} 和 ${step.id} 中均设为绿灯`, light.nodeId)
        } else {
          seenGreen.set(gl, step.id)
        }
        if (!nodeLaneIds.has(gl)) {
          emit(issues, 'TRAFFIC_LIGHT', 'SIGNAL_GREEN_LANE_NOT_AT_NODE', 'error', step.id,
            `步阶 ${step.id} 的绿灯车道 ${gl} 不属于节点 ${light.nodeId} 的连接路段`, light.nodeId)
        }
      }
    }
  }
}

// ============================================================
// 5. Turn Restriction vs Connector Conflicts
// ============================================================

const RESTRICTION_LABEL: Record<string, string> = {
  NO_LEFT: '禁左',
  NO_RIGHT: '禁右',
  NO_STRAIGHT: '禁直',
  NO_UTURN: '禁掉头',
}

function checkTurnVsConnectorConflicts(ctx: ValidationContext, issues: ValidationIssue[]): void {
  for (const tr of ctx.turnRestrictions.values()) {
    if (tr.restriction === 'NONE') continue

    for (const c of ctx.laneConnectors.values()) {
      const fromSegId = segmentIdFromLaneId(c.fromLaneId)
      const toSegId = segmentIdFromLaneId(c.toLaneId)
      if (fromSegId !== tr.fromSegmentId || toSegId !== tr.toSegmentId) continue

      const fromSeg = ctx.segments.get(fromSegId)
      const toSeg = ctx.segments.get(toSegId)
      if (!fromSeg || !toSeg) continue
      if (sharedNodeId(fromSeg, toSeg) !== tr.nodeId) continue

      emit(issues, 'LANE_CONNECTOR', 'TURN_VS_CONNECTOR_CONFLICT', 'warning', c.id,
        `连接器 ${c.id} 与转向限制冲突：${tr.fromSegmentId}→${tr.toSegmentId} 已设为${RESTRICTION_LABEL[tr.restriction] ?? tr.restriction}`,
        tr.nodeId)
    }
  }
}

// ============================================================
// Main Entry Point
// ============================================================

export function validateRules(ctx: ValidationContext): ValidationResult {
  const issues: ValidationIssue[] = []
  checkDanglingReferences(ctx, issues)
  checkCrossNodeConnectors(ctx, issues)
  checkDeadEndLanes(ctx, issues)
  checkSignalPhaseConflicts(ctx, issues)
  checkTurnVsConnectorConflicts(ctx, issues)
  return { issues, timestamp: Date.now() }
}
