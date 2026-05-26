import { defineStore } from 'pinia'
import { ref } from 'vue'
import type {
  TrafficLightController,
  LaneRestriction,
  LaneConnector,
  TurnRestriction,
  Crosswalk,
  RuleData,
} from '@/types/traffic-rule'

export const useTrafficRuleStore = defineStore('trafficRule', () => {
  const trafficLights = ref<Map<string, TrafficLightController>>(new Map())
  const laneRestrictions = ref<Map<string, LaneRestriction>>(new Map())
  const laneConnectors = ref<Map<string, LaneConnector>>(new Map())
  const turnRestrictions = ref<Map<string, TurnRestriction>>(new Map())
  const crosswalks = ref<Map<string, Crosswalk>>(new Map())
  const ruleVersion = ref(1)

  const selectedLightId = ref<string | null>(null)

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
    turnRestrictions.value.set(tr.id, tr)
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

  function serialize(): RuleData {
    return {
      version: ruleVersion.value,
      laneRestrictions: Array.from(laneRestrictions.value.values()),
      laneConnectors: Array.from(laneConnectors.value.values()),
      trafficLights: Array.from(trafficLights.value.values()),
      turnRestrictions: Array.from(turnRestrictions.value.values()),
      crosswalks: Array.from(crosswalks.value.values()),
    }
  }

  function deserialize(data: RuleData): void {
    laneRestrictions.value = new Map(data.laneRestrictions.map((r) => [r.laneId, r]))
    laneConnectors.value = new Map(data.laneConnectors.map((c) => [c.id, c]))
    trafficLights.value = new Map(data.trafficLights.map((l) => [l.id, l]))
    turnRestrictions.value = new Map(data.turnRestrictions.map((t) => [t.id, t]))
    crosswalks.value = new Map(data.crosswalks.map((cw) => [cw.id, cw]))
    ruleVersion.value = data.version
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
