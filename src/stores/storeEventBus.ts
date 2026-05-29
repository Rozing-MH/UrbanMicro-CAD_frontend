// ============================================================
// StoreEventBus — 类型安全的 Store 间事件总线
// Per design doc: Store 间通过事件总线解耦，禁止 Store 之间直接引用。
// ============================================================

export interface StoreEventMap {
  'road-network:segment-added': { segmentId: string }
  'road-network:segment-removed': { segmentId: string }
  'road-network:node-moved': { nodeId: string }
  'road-network:topology-changed': { version: number }
  'traffic-rule:rule-changed': { ruleType: string; entityId: string }
  'traffic-rule:validation-requested': {}
  'cross-section:profile-changed': { profileId: string; segmentId?: string }
  'simulation:state-changed': { running: boolean }
  'simulation:metrics-updated': {}
  'simulation:od-matrix-changed': {}
  'simulation:vehicle-mix-changed': {}
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
