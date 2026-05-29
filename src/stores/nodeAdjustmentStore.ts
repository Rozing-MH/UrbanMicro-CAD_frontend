import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

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

  function activateNode(nodeId: string): void {
    activeNodeId.value = nodeId
  }

  function deactivateNode(): void {
    activeNodeId.value = null
  }

  function setGizmoMode(mode: GizmoMode): void {
    gizmoMode.value = mode
  }

  return {
    activeNodeId,
    gizmoMode,
    isActive,
    activateNode,
    deactivateNode,
    setGizmoMode,
  }
})
