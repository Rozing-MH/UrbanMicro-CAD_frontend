import { defineStore } from 'pinia'
import { ref } from 'vue'
import type {
  TrafficLightController,
  LaneRestriction,
  LaneConnector,
  TurnRestriction,
  Crosswalk,
  RuleData,
  LegacyRuleData,
  TrafficRuleSetData,
} from '@/types/traffic-rule'
import type { ODMatrix, VehicleMixConfig } from '@/types/simulation'
import { DEFAULT_VEHICLE_MIX } from '@/types/simulation'

export const useTrafficRuleStore = defineStore('trafficRule', () => {
  const trafficLights = ref<Map<string, TrafficLightController>>(new Map())
  const laneRestrictions = ref<Map<string, LaneRestriction>>(new Map())
  const laneConnectors = ref<Map<string, LaneConnector>>(new Map())
  const turnRestrictions = ref<Map<string, TurnRestriction>>(new Map())
  const crosswalks = ref<Map<string, Crosswalk>>(new Map())
  const ruleVersion = ref(1)

  const selectedLightId = ref<string | null>(null)

  function turnRestrictionKey(tr: TurnRestriction): string {
    return `${tr.nodeId}:${tr.fromSegmentId}:${tr.toSegmentId}:${tr.restriction}`
  }

  function isDocumentRuleData(data: RuleData | LegacyRuleData): data is RuleData {
    return Array.isArray((data as RuleData).ruleSets)
  }

  function addTrafficLight(light: TrafficLightController): void {
    trafficLights.value.set(light.id, light)
    ruleVersion.value++
  }

  function updateTrafficLight(id: string, patch: Partial<TrafficLightController>): void {
    const existing = trafficLights.value.get(id)
    if (!existing) return
    trafficLights.value.set(id, { ...existing, ...patch })
    ruleVersion.value++
  }

  function removeTrafficLight(id: string): void {
    trafficLights.value.delete(id)
    ruleVersion.value++
  }

  function setLaneRestriction(r: LaneRestriction): void {
    laneRestrictions.value.set(r.laneId, r)
    ruleVersion.value++
  }

  function removeLaneRestriction(laneId: string): void {
    laneRestrictions.value.delete(laneId)
    ruleVersion.value++
  }

  function addLaneConnector(c: LaneConnector): void {
    laneConnectors.value.set(c.id, c)
    ruleVersion.value++
  }

  function removeLaneConnector(id: string): void {
    laneConnectors.value.delete(id)
    ruleVersion.value++
  }

  function addTurnRestriction(tr: TurnRestriction): void {
    turnRestrictions.value.set(turnRestrictionKey(tr), tr)
    ruleVersion.value++
  }

  function removeTurnRestriction(id: string): void {
    turnRestrictions.value.delete(id)
    ruleVersion.value++
  }

  function addCrosswalk(cw: Crosswalk): void {
    crosswalks.value.set(cw.id, cw)
    ruleVersion.value++
  }

  function removeCrosswalk(id: string): void {
    crosswalks.value.delete(id)
    ruleVersion.value++
  }

  function selectLight(id: string | null): void {
    selectedLightId.value = id
  }

  function getConnectorsFrom(laneId: string): LaneConnector[] {
    const result: LaneConnector[] = []
    for (const c of laneConnectors.value.values()) {
      if (c.fromLaneId === laneId) result.push(c)
    }
    return result
  }

  function serialize(
    odMatrix: ODMatrix = { pairs: [] },
    vehicleMix: VehicleMixConfig = DEFAULT_VEHICLE_MIX,
  ): RuleData {
    const nodeIds = new Set<string>()
    for (const light of trafficLights.value.values()) nodeIds.add(light.nodeId)
    for (const tr of turnRestrictions.value.values()) nodeIds.add(tr.nodeId)
    for (const crosswalk of crosswalks.value.values()) nodeIds.add(crosswalk.nodeId)

    const hasGlobalRules = laneRestrictions.value.size > 0 || laneConnectors.value.size > 0
    if (hasGlobalRules) nodeIds.add('__global__')

    const ruleSets: TrafficRuleSetData[] = Array.from(nodeIds).map((nodeId) => {
      const nodeTrafficLights = Array.from(trafficLights.value.values()).filter((light) => light.nodeId === nodeId)
      const nodeCrosswalks = Array.from(crosswalks.value.values()).filter((crosswalk) => crosswalk.nodeId === nodeId)
      return {
        nodeId,
        nodeControlMode: nodeTrafficLights.length > 0 ? 'TRAFFIC_LIGHT' : 'NONE',
        crosswalkEnabled: nodeCrosswalks.some((crosswalk) => crosswalk.isActive),
        turnRestrictions: Array.from(turnRestrictions.value.values()).filter((tr) => tr.nodeId === nodeId),
        laneArrows: [],
        laneConnectors: nodeId === '__global__' ? Array.from(laneConnectors.value.values()) : [],
        trafficLight: nodeTrafficLights[0] ?? null,
        laneRestrictions: nodeId === '__global__'
          ? Array.from(laneRestrictions.value.values()).map((restriction) => ({
              laneId: restriction.laneId,
              restriction,
            }))
          : [],
        crosswalks: nodeCrosswalks,
      }
    })

    return {
      ruleSets,
      odConfig: {
        pairs: odMatrix.pairs,
        vehicleMix,
      },
    }
  }

  function deserialize(data: RuleData | LegacyRuleData): void {
    if (isDocumentRuleData(data)) {
      const flattenedLaneRestrictions = data.ruleSets.flatMap((set) =>
        set.laneRestrictions.map((item) => ({ ...item.restriction, laneId: item.laneId })),
      )
      const flattenedConnectors = data.ruleSets.flatMap((set) => set.laneConnectors)
      const flattenedLights = data.ruleSets.flatMap((set) => (set.trafficLight ? [set.trafficLight] : []))
      const flattenedTurnRestrictions = data.ruleSets.flatMap((set) => set.turnRestrictions)
      const flattenedCrosswalks = data.ruleSets.flatMap((set) => set.crosswalks ?? [])

      laneRestrictions.value = new Map(flattenedLaneRestrictions.map((r) => [r.laneId, r]))
      laneConnectors.value = new Map(flattenedConnectors.map((c) => [c.id, c]))
      trafficLights.value = new Map(flattenedLights.map((l) => [l.id, l]))
      turnRestrictions.value = new Map(flattenedTurnRestrictions.map((t) => [turnRestrictionKey(t), t]))
      crosswalks.value = new Map(flattenedCrosswalks.map((cw) => [cw.id, cw]))
      ruleVersion.value++
      return
    }

    laneRestrictions.value = new Map(data.laneRestrictions.map((r) => [r.laneId, r]))
    laneConnectors.value = new Map(data.laneConnectors.map((c) => [c.id, c]))
    trafficLights.value = new Map(data.trafficLights.map((l) => [l.id, l]))
    turnRestrictions.value = new Map(data.turnRestrictions.map((t) => [turnRestrictionKey(t), t]))
    crosswalks.value = new Map(data.crosswalks.map((cw) => [cw.id, cw]))
    ruleVersion.value = data.version ?? ruleVersion.value + 1
  }

  function clear(): void {
    trafficLights.value.clear()
    laneRestrictions.value.clear()
    laneConnectors.value.clear()
    turnRestrictions.value.clear()
    crosswalks.value.clear()
    selectedLightId.value = null
    ruleVersion.value = 1
  }

  return {
    trafficLights, laneRestrictions, laneConnectors, turnRestrictions, crosswalks,
    ruleVersion, selectedLightId,
    addTrafficLight, updateTrafficLight, removeTrafficLight,
    setLaneRestriction, removeLaneRestriction,
    addLaneConnector, removeLaneConnector,
    addTurnRestriction, removeTurnRestriction,
    addCrosswalk, removeCrosswalk,
    selectLight, getConnectorsFrom,
    serialize, deserialize, clear,
  }
})
