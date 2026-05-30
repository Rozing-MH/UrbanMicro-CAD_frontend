/**
 * useLOSBadges — 3D 场景中交叉口 LOS 评级徽章渲染
 *
 * 对齐设计文档 FR6.4：
 * - LOSBadgeRenderer 使用 CSS2DRenderer
 * - DOM 渲染，不占用 WebGL Draw Call
 * - CSS2DObject 加入 scene 后由 useThreeRenderer 的
 *   labelRenderer 自动渲染，无需额外 render 调用
 */
import * as THREE from 'three'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import type { LOSGrade } from '@/types/evaluation'

/** LOS 等级对应的背景色 */
const LOS_COLORS: Record<LOSGrade, string> = {
  A: '#2ecc71', B: '#58c177', C: '#f1c40f',
  D: '#e67e22', E: '#e74c3c', F: '#c0392b',
}

/** LOS 等级对应的文字色 */
const LOS_TEXT_COLORS: Record<LOSGrade, string> = {
  A: '#ffffff', B: '#ffffff', C: '#1f232b',
  D: '#ffffff', E: '#ffffff', F: '#ffffff',
}

export function useLOSBadges(scene: THREE.Scene) {
  const badgeObjects: Map<string, CSS2DObject> = new Map()

  function createLOSElement(grade: LOSGrade): HTMLDivElement {
    const el = document.createElement('div')
    el.textContent = grade
    el.style.cssText = `
      width:28px;height:28px;border-radius:50%;
      display:flex;align-items:center;justify-content:center;
      font-family:ui-monospace,Menlo,Consolas,monospace;
      font-size:14px;font-weight:700;
      background:${LOS_COLORS[grade]};color:${LOS_TEXT_COLORS[grade]};
      border:2px solid rgba(0,0,0,0.3);
      box-shadow:0 2px 6px rgba(0,0,0,0.4);
      pointer-events:none;user-select:none;
    `
    return el
  }

  function updateLOSBadge(
    nodeId: string, x: number, z: number, elevation: number, grade: LOSGrade,
  ): void {
    removeLOSBadge(nodeId)
    const el = createLOSElement(grade)
    const obj = new CSS2DObject(el)
    obj.position.set(x, elevation + 5, z)
    obj.userData.nodeId = nodeId
    obj.userData.losGrade = grade
    scene.add(obj)
    badgeObjects.set(nodeId, obj)
  }

  function removeLOSBadge(nodeId: string): void {
    const old = badgeObjects.get(nodeId)
    if (!old) return
    scene.remove(old)
    old.element.remove()
    badgeObjects.delete(nodeId)
  }

  function clearLOSBadges(): void {
    for (const [nodeId] of badgeObjects) {
      removeLOSBadge(nodeId)
    }
  }

  function dispose(): void {
    clearLOSBadges()
  }

  return { updateLOSBadge, removeLOSBadge, clearLOSBadges, dispose, badgeObjects }
}
