/**
 * useLOSBadges — 3D 场景中交叉口 LOS 评级徽章渲染
 *
 * 使用 THREE.Sprite（Canvas 纹理）在每个交叉口节点上方
 * 悬浮显示 A-F 服务水平评级徽章。
 *
 * 特点：
 * - Canvas 绘制圆形背景 + 字母，颜色按 LOS 等级区分
 * - 深度测试关闭，始终可见
 * - 资源在 clear/dispose 中释放
 */
import * as THREE from 'three'
import { type Ref } from 'vue'
import type { LOSGrade } from '@/types/evaluation'

/** LOS 等级对应的颜色映射（背景色） */
const LOS_COLORS: Record<LOSGrade, string> = {
  A: '#2ecc71',
  B: '#58c177',
  C: '#f1c40f',
  D: '#e67e22',
  E: '#e74c3c',
  F: '#c0392b',
}

/** LOS 等级对应的文字颜色 */
const LOS_TEXT_COLORS: Record<LOSGrade, string> = {
  A: '#ffffff',
  B: '#ffffff',
  C: '#1f232b',
  D: '#ffffff',
  E: '#ffffff',
  F: '#ffffff',
}

/** Canvas 尺寸 */
const BADGE_CANVAS_SIZE = 64

export function useLOSBadges(scene: Ref<THREE.Scene | null>) {
  const badgeSprites: Map<string, THREE.Sprite> = new Map()

  /**
   * 创建单个 LOS 徽章 Sprite
   */
  function createLOSSprite(grade: LOSGrade): THREE.Sprite {
    const canvas = document.createElement('canvas')
    canvas.width = BADGE_CANVAS_SIZE
    canvas.height = BADGE_CANVAS_SIZE
    const ctx = canvas.getContext('2d')!

    // 圆形背景
    const cx = BADGE_CANVAS_SIZE / 2
    const cy = BADGE_CANVAS_SIZE / 2
    const r = BADGE_CANVAS_SIZE / 2 - 4
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = LOS_COLORS[grade]
    ctx.fill()

    // 深色描边
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'
    ctx.lineWidth = 2
    ctx.stroke()

    // 字母
    ctx.fillStyle = LOS_TEXT_COLORS[grade]
    ctx.font = 'bold 32px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(grade, cx, cy)

    const texture = new THREE.CanvasTexture(canvas)
    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    })
    const sprite = new THREE.Sprite(spriteMat)
    sprite.scale.set(2.5, 2.5, 1)
    return sprite
  }

  /**
   * 更新或创建指定节点的 LOS 徽章
   */
  function updateLOSBadge(
    nodeId: string,
    x: number,
    z: number,
    elevation: number,
    grade: LOSGrade,
  ): void {
    if (!scene.value) return

    // 移除旧徽章
    removeLOSBadge(nodeId)

    const sprite = createLOSSprite(grade)
    sprite.position.set(x, elevation + 5, z) // 悬浮于节点上方 5m
    sprite.userData.nodeId = nodeId
    sprite.userData.losGrade = grade
    scene.value.add(sprite)
    badgeSprites.set(nodeId, sprite)
  }

  /**
   * 移除指定节点的 LOS 徽章
   */
  function removeLOSBadge(nodeId: string): void {
    const old = badgeSprites.get(nodeId)
    if (!old) return
    scene.value?.remove(old)
    const mat = old.material as THREE.SpriteMaterial
    if (mat.map) {
      mat.map.dispose()
    }
    mat.dispose()
    badgeSprites.delete(nodeId)
  }

  /**
   * 清除所有 LOS 徽章
   */
  function clearLOSBadges(): void {
    for (const [nodeId] of badgeSprites) {
      removeLOSBadge(nodeId)
    }
  }

  function dispose(): void {
    clearLOSBadges()
  }

  return { updateLOSBadge, removeLOSBadge, clearLOSBadges, dispose, badgeSprites }
}
