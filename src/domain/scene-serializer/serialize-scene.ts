import type { RoadNetwork, TopologyData, LaneArrow } from '@/types/road-network'
import type {
  RuleData,
  TrafficRuleSetData,
  TrafficLightController,
  LaneRestriction,
} from '@/types/traffic-rule'
import type { ODMatrix, VehicleMixConfig } from '@/types/simulation'
import { laneArrowKey } from '@/utils/roadGeometry'
import type { ProjectPayload } from './types'
import { SCENE_FORMAT_VERSION } from './types'

// ============================================================
// 序列化纯函数 — 从 Store 域对象生成持久化格式
// ============================================================

/** 序列化信控控制器：内部策略名 → 线缆格式 */
export function serializeTrafficLight(light: TrafficLightController): TrafficLightController {
  const strategy = light.strategy === 'FIXED'
    ? 'FIXED_TIMING'
    : light.strategy === 'ACTUATED'
      ? 'SENSOR_ACTUATED'
      : light.strategy
  return { ...light, strategy }
}

/** 序列化车道限制：内部标线类型 → 线缆格式 */
export function serializeLaneRestriction(restriction: LaneRestriction): LaneRestriction {
  return {
    ...restriction,
    markingType: serializeMarkingType(restriction.markingType),
  }
}

/** 标线类型 → 线缆格式映射 */
function serializeMarkingType(type: LaneRestriction['markingType']): LaneRestriction['markingType'] {
  return type === 'DOUBLE_SOLID_YELLOW' ? 'SOLID_DOUBLE_YELLOW' : type
}

/** 序列化路网 Map 结构为数组格式 */
export function serializeTopology(network: RoadNetwork): TopologyData {
  return {
    version: SCENE_FORMAT_VERSION,
    nodes: Array.from(network.nodes.values()),
    segments: Array.from(network.segments.values()),
    lanes: Array.from(network.lanes.values()),
    laneArrows: Array.from(network.laneArrows.values()),
    halfEdges: Array.from(network.halfEdges.values()),
  }
}

/** 序列化完整场景 */
export function serializeScene(
  network: RoadNetwork,
  ruleSets: TrafficRuleSetData[],
  odMatrix: ODMatrix,
  vehicleMix: VehicleMixConfig,
): ProjectPayload {
  return {
    topologyData: serializeTopology(network),
    ruleData: {
      ruleSets,
      odConfig: {
        pairs: odMatrix.pairs,
        vehicleMix,
      },
    },
    version: SCENE_FORMAT_VERSION,
  }
}
