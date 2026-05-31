import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { TopologyData } from '@/types/road-network'
import type { RuleData } from '@/types/traffic-rule'
import type { ODMatrix, VehicleMixConfig } from '@/types/simulation'
import { projectApi } from '@/api/projectApi'
import { templateApi } from '@/api/templateApi'
import { useRoadNetworkStore } from '@/stores/roadNetworkStore'
import { useTrafficRuleStore } from '@/stores/trafficRuleStore'
import { useSimulationStore } from '@/stores/simulationStore'
import { useEditorStateStore } from '@/stores/editorStateStore'
import { storeEventBus } from '@/stores/storeEventBus'
import { historyStack } from '@/commands/HistoryStack'
import { SceneSerializer } from '@/domain/scene-serializer'
import type { ProjectPayload, SceneRebuildResult } from '@/domain/scene-serializer'

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

/** 快照摘要信息 */
export interface SnapshotInfo {
  id: number
  projectId: string
  version: number
  description: string
  createdAt: string
}

/** 本地导入/导出的 JSON 结构 */
export interface ProjectExportData {
  name: string
  description: string
  exportedAt: string
  formatVersion: number
  topologyData: TopologyData
  ruleData: RuleData
}

/** 当前导出格式版本 */
const EXPORT_FORMAT_VERSION = 1

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

/** 验证导入数据的结构完整性 */
function validateExportData(data: unknown): data is ProjectExportData {
  if (typeof data !== 'object' || data === null) return false
  const d = data as Record<string, unknown>
  if (!d.topologyData || typeof d.topologyData !== 'object') return false
  if (!d.ruleData || typeof d.ruleData !== 'object') return false
  return true
}

export const useProjectStore = defineStore('project', () => {
  const currentProject = ref<ProjectMeta | null>(null)
  const isDirty = ref(false)
  const lastSavedAt = ref<string | null>(null)
  const projectList = ref<ProjectMeta[]>([])
  const isLoadingList = ref(false)

  // ---- 快照列表状态 ----
  const snapshots = ref<SnapshotInfo[]>([])
  const snapshotsTotal = ref(0)
  const isLoadingSnapshots = ref(false)

  // ---- 回滚竞态防护 ----
  let rollbackGeneration = 0

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
   * 将 SceneSerializer 反序列化结果应用到各 Store。
   * 提取公共逻辑，避免 3 处重复。
   */
  function applySceneResult(result: SceneRebuildResult): void {
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
    simStore.setVehicleMix(result.vehicleMix)

    // 通知需要重建 mesh
    if (result.requiresMeshRebuild) {
      storeEventBus.emit('scene:mesh-rebuild-needed', {})
    }
  }

  /**
   * 清除命令历史栈并重置编辑器历史状态。
   * 在 loadProject / loadSnapshot / importFromJson 后调用，
   * 防止旧命令的 undo 产生不一致状态。
   */
  function resetHistoryAfterRestore(): void {
    historyStack.clear()
    const editor = useEditorStateStore()
    editor.updateHistoryState(-1, 0)
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
    applySceneResult(result)
    resetHistoryAfterRestore()
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
   * 获取工程快照版本列表。
   * 对齐设计文档 FR5.3：GET /api/projects/{id}/snapshots
   */
  async function fetchSnapshots(projectId: string, page: number = 1, size: number = 20): Promise<void> {
    isLoadingSnapshots.value = true
    try {
      const result = await projectApi.listSnapshots(projectId, page, size)
      snapshots.value = result.items
      snapshotsTotal.value = result.total
    } finally {
      isLoadingSnapshots.value = false
    }
  }

  /**
   * 加载指定版本快照并恢复所有 Store。
   * 对齐设计文档 FR5.3：GET /api/projects/{id}/snapshots/{version}
   * 回滚操作：用户选择历史版本 → 反序列化覆盖当前状态 → 重建 3D mesh
   * 包含竞态防护：连续点击回滚时，仅最新请求生效。
   */
  async function loadSnapshot(projectId: string, version: number): Promise<void> {
    const gen = ++rollbackGeneration
    const snapshot = await projectApi.getSnapshot(projectId, version)
    // 如果有更新的回滚请求，丢弃本请求的结果
    if (gen !== rollbackGeneration) return

    const payload = snapshotToPayload(snapshot)
    const result = serializer.deserialize(payload)
    applySceneResult(result)
    resetHistoryAfterRestore()

    // 回滚后标记为 dirty（与当前后端保存的版本不同）
    markDirty()
  }

  /**
   * 导出当前工程为 JSON 字符串。
   * 对齐设计文档 FR5：本地 JSON 导出完整工程快照
   */
  function exportToJson(): string {
    if (!currentProject.value) throw new Error('No project loaded')

    const roadStore = useRoadNetworkStore()
    const ruleStore = useTrafficRuleStore()
    const simStore = useSimulationStore()

    const network = {
      nodes: roadStore.nodes,
      segments: roadStore.segments,
      lanes: roadStore.lanes,
      laneArrows: roadStore.laneArrows,
      halfEdges: roadStore.halfEdges,
    }

    const rules = ruleStore.serialize(simStore.odMatrix, simStore.vehicleMix)
    const payload = serializer.serialize(
      network,
      rules.ruleSets,
      simStore.odMatrix,
      simStore.vehicleMix,
    )

    const exportData: ProjectExportData = {
      name: currentProject.value.name,
      description: currentProject.value.description,
      exportedAt: new Date().toISOString(),
      formatVersion: EXPORT_FORMAT_VERSION,
      topologyData: payload.topologyData,
      ruleData: payload.ruleData,
    }

    return JSON.stringify(exportData, null, 2)
  }

  /**
   * 从 JSON 字符串导入工程数据并恢复所有 Store。
   * 对齐设计文档 FR5：本地 JSON 导入完整工程快照
   * 使用运行时验证确保导入数据结构完整。
   */
  function importFromJson(jsonStr: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(jsonStr)
    } catch {
      throw new Error('无效的工程文件：JSON 解析失败')
    }

    if (!validateExportData(parsed)) {
      throw new Error('无效的工程文件：缺少 topologyData 或 ruleData')
    }

    const payload: ProjectPayload = {
      topologyData: parsed.topologyData,
      ruleData: parsed.ruleData,
      version: parsed.topologyData.version,
    }

    const result = serializer.deserialize(payload)
    applySceneResult(result)
    resetHistoryAfterRestore()

    // 更新项目元数据（如果有当前项目）
    if (currentProject.value) {
      updateProjectMeta({
        name: parsed.name ?? currentProject.value.name,
        description: parsed.description ?? currentProject.value.description,
      })
    }

    markDirty()
  }

  /**
   * 从模板一键加载到当前工程。
   * 对齐设计文档 FR5：样例库一键加载
   * 获取模板的 snapshotData，通过 SceneSerializer 反序列化后恢复到各 Store。
   */
  async function loadFromTemplate(templateId: string): Promise<void> {
    const template = await templateApi.getTemplate(templateId)
    if (!template) throw new Error('模板不存在')

    const snapshot = template.snapshotData as
      | { topologyData?: TopologyData; ruleData?: RuleData }
      | undefined

    if (!snapshot?.topologyData) {
      throw new Error('模板缺少拓扑数据')
    }

    const payload: ProjectPayload = {
      topologyData: snapshot.topologyData,
      ruleData: snapshot.ruleData ?? { ruleSets: [], odConfig: { pairs: [], vehicleMix: { ratios: [{ type: 'CAR', ratio: 0.82 }, { type: 'BUS', ratio: 0.06 }, { type: 'TRUCK', ratio: 0.08 }, { type: 'BIKE', ratio: 0.04 }, { type: 'TRAM', ratio: 0 }] } as VehicleMixConfig } },
      version: snapshot.topologyData.version,
    }

    const result = serializer.deserialize(payload)
    applySceneResult(result)
    resetHistoryAfterRestore()

    // 更新项目元数据
    if (currentProject.value) {
      updateProjectMeta({
        name: `${template.name} - ${currentProject.value.name}`,
        description: `从模板「${template.name}」加载`,
      })
    }

    markDirty()
  }

  function clearSnapshots(): void {
    snapshots.value = []
    snapshotsTotal.value = 0
  }

  return {
    currentProject, isDirty, lastSavedAt, projectList, isLoadingList,
    snapshots, snapshotsTotal, isLoadingSnapshots,
    setCurrentProject, markDirty, markSaved, setProjectList, setLoadingList, updateProjectMeta,
    loadProject, saveProject,
    fetchSnapshots, loadSnapshot, clearSnapshots,
    exportToJson, importFromJson, loadFromTemplate,
  }
})
