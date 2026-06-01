import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Point3D, RoadNode, RoadSegment, TangentHandleData } from '@/types/road-network'
import { computeDefaultTangentHandles } from '@/services/tangentHandleService'
import { useRoadNetworkStore } from './roadNetworkStore'

/**
 * Gizmo 操作模式 — 对齐设计文档 FR2.3 GizmoMode 枚举
 */
export type GizmoMode = 'TRANSLATE' | 'ROTATE' | 'SCALE'

export const useNodeAdjustmentStore = defineStore('nodeAdjustment', () => {
  /** 当前激活微调的节点 ID */
  const activeNodeId = ref<string | null>(null)

  /** 当前 Gizmo 操作模式 */
  const gizmoMode = ref<GizmoMode>('TRANSLATE')

  /** 是否有激活的微调节点 */
  const isActive = computed(() => activeNodeId.value !== null)

  // ============================================================
  // FR2.2 切线手柄状态
  // ============================================================

  /** 节点切线手柄缓存 — key: nodeId, value: 切线手柄数组 */
  const tangentHandleCache = ref<Map<string, TangentHandleData[]>>(new Map())

  /** 当前激活节点的切线手柄 */
  const activeTangentHandles = computed<TangentHandleData[]>(() => {
    if (!activeNodeId.value) return []
    return tangentHandleCache.value.get(activeNodeId.value) ?? []
  })

  /**
   * 激活节点微调模式。
   * 如果节点没有切线手柄数据，自动初始化默认值。
   */
  function activateNode(nodeId: string): void {
    activeNodeId.value = nodeId
    initTangentHandles(nodeId)
  }

  function deactivateNode(): void {
    activeNodeId.value = null
  }

  function setGizmoMode(mode: GizmoMode): void {
    gizmoMode.value = mode
  }

  // ============================================================
  // FR2.2 切线手柄管理
  // ============================================================

  /**
   * 初始化节点的默认切线手柄。
   * 如果节点已有 tangentHandles 则跳过。
   */
  function initTangentHandles(nodeId: string): void {
    const roadStore = useRoadNetworkStore()
    const node = roadStore.nodes.get(nodeId)
    if (!node) return

    // 优先使用缓存
    if (tangentHandleCache.value.has(nodeId)) return

    // 其次使用节点已有数据
    if (node.tangentHandles && node.tangentHandles.length > 0) {
      tangentHandleCache.value.set(nodeId, [...node.tangentHandles])
      return
    }

    // 计算默认值
    const segments = node.connectedSegmentIds
      .map((sid) => roadStore.segments.get(sid))
      .filter((s): s is RoadSegment => s !== undefined)

    const handles = computeDefaultTangentHandles(node, segments)
    tangentHandleCache.value.set(nodeId, handles)
  }

  /**
   * 更新切线方向（仅内存，拖拽中高频调用）。
   * 不触发 Worker 重算，仅更新缓存中的方向和长度。
   *
   * @param nodeId    节点 ID
   * @param handleIdx 手柄索引
   * @param direction 新方向（归一化向量）
   * @param length    新长度
   */
  function setTangentDirection(
    nodeId: string,
    handleIdx: number,
    direction: Point3D,
    length: number,
  ): void {
    const handles = tangentHandleCache.value.get(nodeId)
    if (!handles || handleIdx < 0 || handleIdx >= handles.length) return

    // 不可变更新
    const updated: TangentHandleData = {
      ...handles[handleIdx],
      direction: { ...direction },
      length,
    }
    const newHandles = [...handles]
    newHandles[handleIdx] = updated
    tangentHandleCache.value.set(nodeId, newHandles)
  }

  /**
   * 获取节点的切线手柄数据。
   */
  function getTangentHandles(nodeId: string): TangentHandleData[] {
    return tangentHandleCache.value.get(nodeId) ?? []
  }

  /**
   * 将缓存中的切线手柄数据写回 RoadNode。
   * 在 SetTangentDirectionCommand 的 execute/undo 中调用。
   */
  function commitTangentHandlesToNode(nodeId: string): void {
    const roadStore = useRoadNetworkStore()
    const node = roadStore.nodes.get(nodeId)
    if (!node) return

    const handles = tangentHandleCache.value.get(nodeId)
    if (!handles) return

    roadStore.updateNode(nodeId, { tangentHandles: handles.map((h) => ({ ...h })) })
  }

  /**
   * 清空所有切线手柄缓存。
   */
  function clearTangentHandles(): void {
    tangentHandleCache.value.clear()
  }

  return {
    activeNodeId,
    gizmoMode,
    isActive,
    activeTangentHandles,
    tangentHandleCache,
    activateNode,
    deactivateNode,
    setGizmoMode,
    initTangentHandles,
    setTangentDirection,
    getTangentHandles,
    commitTangentHandlesToNode,
    clearTangentHandles,
  }
})
