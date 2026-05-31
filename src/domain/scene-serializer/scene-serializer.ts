import type { RoadNetwork } from '@/types/road-network'
import type { TrafficRuleSetData } from '@/types/traffic-rule'
import type { ODMatrix, VehicleMixConfig } from '@/types/simulation'
import type { ProjectPayload, SceneRebuildResult } from './types'
import { serializeScene } from './serialize-scene'
import { migratePayload } from './migrate-payload'
import { rebuildTopology, rebuildRules } from './rebuild-topology'

// ============================================================
// SceneSerializer 领域服务 — 对齐设计文档 §4.5.2
// Push-in/Pull-out 模式：零 Pinia/Vue 依赖
// ============================================================

export class SceneSerializer {
  /** 序列化：Store 域对象 → 持久化格式 */
  serialize(
    network: RoadNetwork,
    ruleSets: TrafficRuleSetData[],
    odMatrix: ODMatrix,
    vehicleMix: VehicleMixConfig,
  ): ProjectPayload {
    return serializeScene(network, ruleSets, odMatrix, vehicleMix)
  }

  /** 反序列化：持久化格式 → 重建结果（调用方按路由标签分发到各 Store） */
  deserialize(payload: ProjectPayload): SceneRebuildResult {
    const migrated = migratePayload({
      topologyData: payload.topologyData,
      ruleData: payload.ruleData,
      version: payload.version,
    })

    const network = rebuildTopology(migrated.topologyData)
    const { ruleSets, odMatrix, vehicleMix, pendingLaneArrows } = rebuildRules(migrated.ruleData)

    const requiresMeshRebuild = migrated.topologyData.segments.length > 0

    return {
      network,
      ruleSets,
      odMatrix,
      vehicleMix,
      requiresMeshRebuild,
      pendingLaneArrows,
    }
  }
}
