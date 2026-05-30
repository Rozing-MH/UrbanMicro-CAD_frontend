import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { TopologyData } from '@/types/road-network'
import type { RuleData } from '@/types/traffic-rule'
import type { ODMatrix } from '@/types/simulation'
import { projectApi } from '@/api/projectApi'
import { useRoadNetworkStore } from '@/stores/roadNetworkStore'
import { useTrafficRuleStore } from '@/stores/trafficRuleStore'
import { useSimulationStore } from '@/stores/simulationStore'
import { storeEventBus } from '@/stores/storeEventBus'

export interface ProjectMeta {
  id: string
  name: string
  description: string
  createdAt: string
  updatedAt: string
  ownerId?: string
  thumbnail?: string
}

export interface ProjectSnapshot {
  meta: ProjectMeta
  topology: TopologyData
  rules: RuleData
  odMatrix: ODMatrix
}

export interface ProjectDTO {
  id: string
  name: string
  description: string
  topologyData: TopologyData
  ruleData: RuleData
  version: number
  createdAt: string
  updatedAt: string
  ownerId?: string
  thumbnailUrl?: string
}

export const useProjectStore = defineStore('project', () => {
  const currentProject = ref<ProjectMeta | null>(null)
  const isDirty = ref(false)
  const lastSavedAt = ref<string | null>(null)
  const projectList = ref<ProjectMeta[]>([])
  const isLoadingList = ref(false)

  function setCurrentProject(meta: ProjectMeta | null): void {
    currentProject.value = meta
    isDirty.value = false
    lastSavedAt.value = meta ? new Date().toISOString() : null
  }

  function markDirty(): void {
    isDirty.value = true
  }

  function markSaved(): void {
    isDirty.value = false
    lastSavedAt.value = new Date().toISOString()
  }

  function setProjectList(list: ProjectMeta[]): void {
    projectList.value = list
  }

  function setLoadingList(loading: boolean): void {
    isLoadingList.value = loading
  }

  function updateProjectMeta(patch: Partial<ProjectMeta>): void {
    if (!currentProject.value) return
    currentProject.value = { ...currentProject.value, ...patch, updatedAt: new Date().toISOString() }
    isDirty.value = true
  }

  /**
   * Load a project from backend and restore all stores.
   * Per design doc: ProjectStore.loadProject() encapsulates API call + store restoration.
   */
  async function loadProject(projectId: string): Promise<void> {
    const snapshot = await projectApi.get(projectId)
    setCurrentProject(snapshot.meta)

    // Restore road network
    const roadStore = useRoadNetworkStore()
    roadStore.deserialize(snapshot.topology)

    // Restore traffic rules + OD
    const ruleStore = useTrafficRuleStore()
    ruleStore.deserialize(snapshot.rules)

    // Restore OD matrix
    const simStore = useSimulationStore()
    simStore.setODMatrix(snapshot.odMatrix)
  }

  /**
   * Save current project state to backend.
   * Per design doc: ProjectStore.saveProject() serializes all stores + calls API.
   */
  async function saveProject(): Promise<void> {
    if (!currentProject.value) throw new Error('No project loaded')

    const roadStore = useRoadNetworkStore()
    const ruleStore = useTrafficRuleStore()
    const simStore = useSimulationStore()

    const snapshot: ProjectSnapshot = {
      meta: currentProject.value,
      topology: roadStore.serialize(),
      rules: ruleStore.serialize(simStore.odMatrix, simStore.vehicleMix),
      odMatrix: simStore.odMatrix,
    }

    await projectApi.save(currentProject.value.id, snapshot)
    markSaved()
  }

  /**
   * Load a specific snapshot version from backend.
   * Per design doc: ProjectStore.loadSnapshot() for version history browsing.
   */
  async function loadSnapshot(projectId: string, _version?: number): Promise<void> {
    // Current API only supports latest snapshot; version param reserved for future
    await loadProject(projectId)
  }

  return {
    currentProject, isDirty, lastSavedAt, projectList, isLoadingList,
    setCurrentProject, markDirty, markSaved, setProjectList, setLoadingList, updateProjectMeta,
    loadProject, saveProject, loadSnapshot,
  }
})
