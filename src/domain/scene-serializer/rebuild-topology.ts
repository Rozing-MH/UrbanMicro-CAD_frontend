import type {
  RoadNetwork,
  TopologyData,
  LaneArrow,
  HalfEdge,
  RoadSegment,
} from '@/types/road-network'
import type {
  RuleData,
  TrafficRuleSetData,
  TrafficLightController,
  LaneRestriction,
  LaneArrowRule,
} from '@/types/traffic-rule'
import type { ODMatrix, VehicleMixConfig } from '@/types/simulation'
import { DEFAULT_VEHICLE_MIX } from '@/types/simulation'
import { laneArrowKey, createLanesForSegment, buildHalfEdgesForSegment } from '@/utils/roadGeometry'

// ============================================================
// 拓扑重建纯函数 — TopologyData → RoadNetwork (Map 结构)
// ============================================================

/** 归一化信控策略名：线缆格式 → 内部格式 */
export function normalizeTrafficLight(light: TrafficLightController): TrafficLightController {
  const strategy = light.strategy === 'FIXED_TIMING'
    ? 'FIXED'
    : light.strategy === 'SENSOR_ACTUATED'
      ? 'ACTUATED'
      : light.strategy
  return { ...light, strategy }
}

/** 归一化标线类型：线缆格式 → 内部格式 */
function normalizeMarkingType(type: LaneRestriction['markingType']): LaneRestriction['markingType'] {
  return type === 'SOLID_DOUBLE_YELLOW' ? 'DOUBLE_SOLID_YELLOW' : type
}

/** 归一化车道限制 */
export function normalizeLaneRestriction(restriction: LaneRestriction): LaneRestriction {
  return {
    ...restriction,
    markingType: normalizeMarkingType(restriction.markingType),
  }
}

/** 重建路网 Map 结构（含 auto-heal 缺失车道和半边） */
export function rebuildTopology(topologyData: TopologyData): RoadNetwork {
  const nodes = new Map(topologyData.nodes.map((n) => [n.id, n]))
  const segments = new Map(topologyData.segments.map((s) => [s.id, s]))
  const lanes = new Map(topologyData.lanes.map((l) => [l.id, l]))
  const laneArrows = new Map(
    (topologyData.laneArrows ?? []).map((a) => [laneArrowKey(a), a]),
  )
  const halfEdges = new Map(
    (topologyData.halfEdges ?? []).map((e) => [e.id, { ...e, laneIndex: e.laneIndex ?? 0 }]),
  )

  // Auto-heal：为缺少车道的路段补充车道
  for (const segment of segments.values()) {
    if (!hasSegmentLanes(segment, lanes)) {
      for (const lane of createLanesForSegment(segment)) {
        lanes.set(lane.id, lane)
      }
    }
  }

  // Auto-heal：为缺少半边的路段补充半边
  for (const segment of segments.values()) {
    for (const he of buildHalfEdgesForSegment(segment)) {
      if (!halfEdges.has(he.id)) {
        halfEdges.set(he.id, he)
      }
    }
  }

  return { nodes, segments, lanes, laneArrows, halfEdges }
}

/** 检查路段是否已有车道 */
function hasSegmentLanes(
  segment: RoadSegment,
  lanes: Map<string, { id: string; segmentId: string }>,
): boolean {
  for (const lane of lanes.values()) {
    if (lane.segmentId === segment.id) return true
  }
  return false
}

/** 重建规则数据（含 vehicleMix 提取和 pendingLaneArrows 路由） */
export function rebuildRules(ruleData: RuleData): {
  ruleSets: TrafficRuleSetData[]
  odMatrix: ODMatrix
  vehicleMix: VehicleMixConfig
  pendingLaneArrows: LaneArrow[]
} {
  // 扁平化 ruleSets 回全局结构（已归一化）
  const flatRestrictions = ruleData.ruleSets.flatMap((set) =>
    set.laneRestrictions.map((item) =>
      normalizeLaneRestriction({ ...item.restriction, laneId: item.laneId }),
    ),
  )
  const flatConnectors = ruleData.ruleSets.flatMap((set) => set.laneConnectors)
  const flatLights = ruleData.ruleSets.flatMap((set) =>
    set.trafficLight ? [normalizeTrafficLight(set.trafficLight)] : [],
  )
  const flatTurnRestrictions = ruleData.ruleSets.flatMap((set) => set.turnRestrictions)
  const flatLaneArrows: LaneArrowRule[] = ruleData.ruleSets.flatMap((set) => set.laneArrows)
  const flatCrosswalks = ruleData.ruleSets.flatMap((set) => set.crosswalks ?? [])

  // 重建归一化后的 ruleSets（供 trafficRuleStore.restoreRules 直接使用）
  const ruleSets: TrafficRuleSetData[] = ruleData.ruleSets.map((set) => ({
    nodeId: set.nodeId,
    nodeControlMode: set.nodeControlMode,
    crosswalkEnabled: set.crosswalkEnabled,
    turnRestrictions: set.turnRestrictions,
    laneArrows: set.laneArrows,
    laneConnectors: set.laneConnectors,
    trafficLight: set.trafficLight ? normalizeTrafficLight(set.trafficLight) : null,
    laneRestrictions: set.laneRestrictions.map((item) => ({
      laneId: item.laneId,
      restriction: normalizeLaneRestriction(item.restriction),
    })),
    crosswalks: set.crosswalks ?? [],
  }))

  // Bug Fix：提取 vehicleMix
  const vehicleMix = ruleData.odConfig?.vehicleMix ?? DEFAULT_VEHICLE_MIX

  // 从 odConfig 提取 OD 矩阵
  const odMatrix: ODMatrix = { pairs: ruleData.odConfig?.pairs ?? [] }

  // legacy 规则中的 laneArrows 需路由到 roadNetworkStore
  // LaneArrowRule → LaneArrow 转换（补充 isManualOverride）
  const pendingLaneArrows: LaneArrow[] = flatLaneArrows.map((a) => ({
    ...a,
    isManualOverride: true,
  }))

  return { ruleSets, odMatrix, vehicleMix, pendingLaneArrows }
}
