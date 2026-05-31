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
import { SceneSerializer } from '@/domain/scene-serializer'
import type { ProjectPayload } from '@/domain/scene-serializer'

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

/** SceneSerializer 单例 */
const serializer = new SceneSerializer()

/** 将 ProjectSnapshot 转为 SceneSerializer 输入格式 */
function snapshotToPayload(snapshot: ProjectSnapshot): ProjectPayload {
  return {
    topologyData: snapshot.topology,
    ruleData: snapshot.rules,
    version: snapshot.topology.version,
  }
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
   * 加载工程并恢复所有 Store。
   * 使用 SceneSerializer 协调反序列化，修复 5 个已知 Bug：
   * 1. vehicleMix 未恢复 → 现在 restoreRules 提取并恢复
   * 2. 加载后无 meshData → requiresMeshRebuild 标记 + 事件
   * 3. 跨 Store 写入 laneArrow → pendingLaneArrows 显式路由
   * 4. OD 数据分裂 → SceneRebuildResult 统一输出
   * 5. 重复恢复路径 → EditorView 应使用本方法
   */
  async function loadProject(projectId: string): Promise<void> {
    const snapshot = await projectApi.get(projectId)
    setCurrentProject(snapshot.meta)

    const payload = snapshotToPayload(snapshot)
    const result = serializer.deserialize(payload)

    const roadStore = useRoadNetworkStore()
    roadStore.restoreNetwork(result.network)

    // 路由 legacy 规则中的车道箭头到 roadNetworkStore
    for (const arrow of result.pendingLaneArrows) {
      roadStore.setLaneArrow({ ...arrow, isManualOverride: true })
    }

    const ruleStore = useTrafficRuleStore()
    ruleStore.restoreRules(result.ruleSets)

    const simStore = useSimulationStore()
    simStore.setODMatrix(result.odMatrix)
    simStore.setVehicleMix(result.vehicleMix)  // Bug Fix: 之前从未恢复

    // 通知需要重建 mesh
    if (result.requiresMeshRebuild) {
      storeEventBus.emit('scene:mesh-rebuild-needed', {})
    }
  }

  /**
   * 保存当前工程状态到后端。
   * 使用 SceneSerializer 协调序列化。
   */
  async function saveProject(): Promise<void> {
    if (!currentProject.value) throw new Error('No project loaded')

    const roadStore = useRoadNetworkStore()
    const ruleStore = useTrafficRuleStore()
    const simStore = useSimulationStore()

    // 构建 RoadNetwork 域对象
    const network = {
      nodes: roadStore.nodes,
      segments: roadStore.segments,
      lanes: roadStore.lanes,
      laneArrows: roadStore.laneArrows,
      halfEdges: roadStore.halfEdges,
    }

    // 序列化规则（仍使用 store 的 serialize 来生成 per-node ruleSets）
    const rules = ruleStore.serialize(simStore.odMatrix, simStore.vehicleMix)

    const payload = serializer.serialize(
      network,
      rules.ruleSets,
      simStore.odMatrix,
      simStore.vehicleMix,
    )

    const snapshot: ProjectSnapshot = {
      meta: currentProject.value,
      topology: payload.topologyData,
      rules: payload.ruleData,
      odMatrix: simStore.odMatrix,
    }

    await projectApi.save(currentProject.value.id, snapshot)
    markSaved()
  }

  /**
   * 加载指定版本快照。
   * 当前 API 仅支持最新快照；version 参数预留。
   */
  async function loadSnapshot(projectId: string, _version?: number): Promise<void> {
    await loadProject(projectId)
  }

  return {
    currentProject, isDirty, lastSavedAt, projectList, isLoadingList,
    setCurrentProject, markDirty, markSaved, setProjectList, setLoadingList, updateProjectMeta,
    loadProject, saveProject, loadSnapshot,
  }
})
