import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { TopologyData } from '@/types/road-network'
import type { RuleData } from '@/types/traffic-rule'
import type { ODMatrix } from '@/types/simulation'

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

  return {
    currentProject, isDirty, lastSavedAt, projectList, isLoadingList,
    setCurrentProject, markDirty, markSaved, setProjectList, setLoadingList, updateProjectMeta,
  }
})
