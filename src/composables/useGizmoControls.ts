import * as THREE from 'three'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { type Ref, watch, onBeforeUnmount } from 'vue'
import type { GizmoMode } from '@/stores/nodeAdjustmentStore'

/**
 * GizmoController — 封装 Three.js TransformControls
 * 对齐设计文档 FR2.3 GizmoController
 *
 * @param onDragStart  Gizmo 拖拽开始回调（用于禁用相机控制）
 * @param onDragEnd    Gizmo 拖拽结束回调（用于恢复相机控制）
 */
export function useGizmoControls(
  camera: Ref<THREE.PerspectiveCamera | null>,
  domElement: Ref<HTMLElement | null>,
  scene: Ref<THREE.Scene | null>,
  gizmoMode: Ref<GizmoMode>,
  onDragStart?: () => void,
  onDragEnd?: () => void,
) {
  let controls: TransformControls | null = null
  let attachedObject: THREE.Object3D | null = null

  /** Gizmo 拖拽中禁用相机控制的回调 */
  let onDraggingChanged: ((event: { value?: unknown }) => void) | null = null
  /** Gizmo 变换完成的回调 — 由调用方设置 */
  let onTransformCallback: ((objectId: string, newPosition: THREE.Vector3) => void) | null = null

  function init(): void {
    if (!camera.value || !domElement.value) return
    controls = new TransformControls(camera.value, domElement.value)
    controls.size = 0.8

    onDraggingChanged = (event: { value?: unknown }) => {
      if (!controls) return
      if (event.value) {
        onDragStart?.()
      } else {
        onDragEnd?.()
      }
    }
    controls.addEventListener('dragging-changed', onDraggingChanged)

    // 监听 objectChange 事件，实时反馈
    controls.addEventListener('objectChange', () => {
      if (!attachedObject || !onTransformCallback) return
      const nodeId = attachedObject.userData.nodeId as string | undefined
      if (nodeId) {
        onTransformCallback(nodeId, attachedObject.position.clone())
      }
    })
  }

  /** 设置变换完成回调 */
  function setOnTransform(cb: (objectId: string, newPosition: THREE.Vector3) => void): void {
    onTransformCallback = cb
  }

  /** 将 Gizmo 附着到指定 3D 对象 */
  function attach(object: THREE.Object3D): void {
    if (!controls) init()
    if (!controls || !scene.value) return
    detach()
    attachedObject = object
    controls.attach(object)
    scene.value.add(controls)
    applyMode(gizmoMode.value)
  }

  /** 分离 Gizmo */
  function detach(): void {
    if (!controls) return
    controls.detach()
    attachedObject = null
    if (scene.value) {
      scene.value.remove(controls)
    }
  }

  /** 应用 Gizmo 模式 */
  function applyMode(mode: GizmoMode): void {
    if (!controls) return
    controls.setMode(mode.toLowerCase() as 'translate' | 'rotate' | 'scale')
  }

  /** 设置 Gizmo 可见性 */
  function setVisible(visible: boolean): void {
    if (!controls) return
    controls.visible = visible
  }

  /** 获取当前附着的对象 ID */
  function getAttachedNodeId(): string | null {
    return attachedObject?.userData.nodeId ?? null
  }

  /** 获取 TransformControls 是否处于拖拽状态 */
  function isDragging(): boolean {
    return controls?.dragging ?? false
  }

  /** 销毁资源 */
  function dispose(): void {
    detach()
    if (controls && onDraggingChanged) {
      controls.removeEventListener('dragging-changed', onDraggingChanged)
      onDraggingChanged = null
    }
    controls?.dispose()
    controls = null
    onTransformCallback = null
  }

  // 监听 gizmoMode 变化
  watch(gizmoMode, (mode) => {
    applyMode(mode)
  })

  onBeforeUnmount(() => {
    dispose()
  })

  return {
    init,
    attach,
    detach,
    applyMode,
    setVisible,
    getAttachedNodeId,
    isDragging,
    setOnTransform,
    dispose,
  }
}
