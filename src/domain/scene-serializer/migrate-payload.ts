import type { TopologyData, LaneArrow, HalfEdge } from '@/types/road-network'
import type {
  RuleData,
  LegacyRuleData,
  TrafficRuleSetData,
} from '@/types/traffic-rule'
import type { ODMatrix, VehicleMixConfig } from '@/types/simulation'
import { DEFAULT_VEHICLE_MIX } from '@/types/simulation'

// ============================================================
// 版本迁移 & legacy 格式处理
// ============================================================

/** 判断是否为文档格式（ruleSets 数组）的 RuleData */
export function isDocumentRuleData(data: RuleData | LegacyRuleData): data is RuleData {
  return Array.isArray((data as RuleData).ruleSets)
}

/** 将 legacy 扁平 RuleData 转为文档格式 */
function convertLegacyRuleData(data: LegacyRuleData): RuleData {
  const ruleSet: TrafficRuleSetData = {
    nodeId: '',
    nodeControlMode: 'NONE',
    crosswalkEnabled: false,
    turnRestrictions: data.turnRestrictions ?? [],
    laneArrows: [],
    laneConnectors: data.laneConnectors ?? [],
    trafficLight: null,
    laneRestrictions: [],
    crosswalks: data.crosswalks ?? [],
  }

  // legacy 数据中车道限制直接是 LaneRestriction[]，需转为 RuleSetLaneRestriction[]
  if (data.laneRestrictions?.length) {
    ruleSet.laneRestrictions = data.laneRestrictions.map((r) => ({
      laneId: r.laneId,
      restriction: r,
    }))
  }

  // legacy 数据中信控直接是数组，取第一个
  if (data.trafficLights?.length) {
    ruleSet.trafficLight = data.trafficLights[0]
    ruleSet.nodeControlMode = ruleSet.trafficLight.nodeId
      ? 'TRAFFIC_LIGHT'
      : 'NONE'
    ruleSet.nodeId = ruleSet.trafficLight.nodeId
  }

  return {
    ruleSets: [ruleSet],
    odConfig: {
      pairs: [],
      vehicleMix: DEFAULT_VEHICLE_MIX,
    },
  }
}

/** 确保 TopologyData 缺失字段有默认值 */
function ensureTopologyDefaults(topology: Partial<TopologyData>): TopologyData {
  return {
    version: topology.version ?? 1,
    nodes: topology.nodes ?? [],
    segments: topology.segments ?? [],
    lanes: topology.lanes ?? [],
    laneArrows: topology.laneArrows ?? [],
    halfEdges: topology.halfEdges ?? [],
  }
}

/** 确保 RuleData 缺失字段有默认值 */
function ensureRuleDataDefaults(ruleData: RuleData): RuleData {
  return {
    ruleSets: ruleData.ruleSets ?? [],
    odConfig: ruleData.odConfig ?? {
      pairs: [],
      vehicleMix: DEFAULT_VEHICLE_MIX,
    },
  }
}

/** 迁移载荷：处理版本差异和 legacy 格式 */
export function migratePayload(payload: {
  topologyData?: Partial<TopologyData>
  ruleData?: RuleData | LegacyRuleData
  version?: number
}): { topologyData: TopologyData; ruleData: RuleData; version: number } {
  const topologyData = ensureTopologyDefaults(payload.topologyData ?? {})

  let ruleData: RuleData
  if (payload.ruleData && isDocumentRuleData(payload.ruleData)) {
    ruleData = ensureRuleDataDefaults(payload.ruleData)
  } else if (payload.ruleData) {
    ruleData = convertLegacyRuleData(payload.ruleData as LegacyRuleData)
  } else {
    ruleData = { ruleSets: [], odConfig: { pairs: [], vehicleMix: DEFAULT_VEHICLE_MIX } }
  }

  return {
    topologyData,
    ruleData,
    version: payload.version ?? topologyData.version ?? 1,
  }
}
