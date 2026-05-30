// ============================================================
// StoreEventBus — 类型安全的 Store 间事件总线
// Per design doc: Store 间通过事件总线解耦，禁止 Store 之间直接引用。
// ============================================================

import type { CrossSectionProfile } from '@/types/road-network'
import type { TurnDirection } from '@/types/traffic-rule'
import type { LaneMetricSnapshot, SimulationFrame } from '@/types/simulation'

export interface StoreEventMap {
  // --- road-network ---
  'road-network:segment-added': { segmentId: string }
  'road-network:segment-removed': { segmentId: string }
  'road-network:segment-deleted': { segmentId: string; cascadeRuleCount: number }
  'road-network:segment-upgraded': { segmentId: string; oldProfile: CrossSectionProfile }
  'road-network:node-moved': { nodeId: string }
  'road-network:node-changed': { nodeId: string }
  'road-network:topology-changed': { version: number }
  'road-network:profile-changed': { segmentId: string; oldProfile: CrossSectionProfile; newProfile: CrossSectionProfile }
  // --- traffic-rule ---
  'traffic-rule:rule-changed': { ruleType: string; entityId: string }
  'traffic-rule:lane-arrow-changed': { nodeId: string; laneId: string; directions: TurnDirection[] }
  'traffic-rule:validation-requested': {}
  // --- cross-section ---
  'cross-section:profile-changed': { profileId: string; segmentId?: string }
  // --- simulation ---
  'simulation:state-changed': { running: boolean }
  'simulation:started': {}
  'simulation:paused': {}
  'simulation:stopped': {}
  'simulation:vehicle-spawned': { vehicleId: string }
  'simulation:frame-updated': { frameData: SimulationFrame }
  'simulation:metrics-updated': { laneMetrics: LaneMetricSnapshot[] }
  'simulation:od-matrix-changed': {}
  'simulation:vehicle-mix-changed': {}
  // --- evaluation ---
  'evaluation:report-generated': { reportId: string }
}

type EventKey = keyof StoreEventMap
type Handler<T> = (payload: T) => void

// Internal storage: Map<eventKey, Set<handler>>
const handlersMap = new Map<EventKey, Set<Handler<unknown>>>()

export const storeEventBus = {
  emit<K extends EventKey>(event: K, payload: StoreEventMap[K]): void {
    const set = handlersMap.get(event)
    if (!set) return
    for (const handler of set) {
      handler(payload)
    }
  },

  on<K extends EventKey>(event: K, handler: Handler<StoreEventMap[K]>): void {
    let set = handlersMap.get(event)
    if (!set) {
      set = new Set()
      handlersMap.set(event, set)
    }
    set.add(handler as Handler<unknown>)
  },

  off<K extends EventKey>(event: K, handler: Handler<StoreEventMap[K]>): void {
    const set = handlersMap.get(event)
    if (!set) return
    set.delete(handler as Handler<unknown>)
  },

  clear(): void {
    handlersMap.clear()
  },
}
