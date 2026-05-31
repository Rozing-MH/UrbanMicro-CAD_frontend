import type { TopologyData, RoadNetwork, LaneArrow, HalfEdge } from '@/types/road-network'
import type { RuleData, TrafficRuleSetData } from '@/types/traffic-rule'
import type { ODMatrix, VehicleMixConfig } from '@/types/simulation'

// ============================================================
// Scene Serializer Types — 对齐设计文档 §4.5.2
// ============================================================

/** 场景持久化载荷 — 序列化输出 / 反序列化输入 */
export interface ProjectPayload {
  readonly topologyData: TopologyData
  readonly ruleData: RuleData
  readonly version: number
}

/** 场景重建结果 — 反序列化输出，按路由标签分发到各 Store */
export interface SceneRebuildResult {
  /** 重建的路网 Map 结构 → roadNetworkStore.restoreNetwork() */
  readonly network: RoadNetwork
  /** 扁平化规则数据 → trafficRuleStore.restoreRules() */
  readonly ruleSets: TrafficRuleSetData[]
  /** OD 矩阵 → simulationStore.setODMatrix() */
  readonly odMatrix: ODMatrix
  /** 车型配比 → simulationStore.setVehicleMix() (Bug Fix: 之前从未恢复) */
  readonly vehicleMix: VehicleMixConfig
  /** 是否需要 Worker 重建 mesh → 调用方检测后触发 */
  readonly requiresMeshRebuild: boolean
  /** legacy 规则数据中的车道箭头 → 调用方路由到 roadNetworkStore.setLaneArrow() */
  readonly pendingLaneArrows: LaneArrow[]
}

/** 当前序列化格式版本号 */
export const SCENE_FORMAT_VERSION = 2
