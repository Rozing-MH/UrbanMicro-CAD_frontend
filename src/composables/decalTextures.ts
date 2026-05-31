/**
 * @file Canvas 纹理生成纯函数 — 供 DecalRenderer 使用
 * 所有函数无副作用，生成 THREE.CanvasTexture 实例。
 */
import * as THREE from 'three'
import type { TurnDirection } from '@/types/road-network'
import type { LaneMarkingType } from '@/types/traffic-rule'

// ─── 颜色映射 ───────────────────────────────────────────────

const COLOR_WHITE = '#ffffff'
const COLOR_YELLOW = '#ffcc00'

/** LaneMarkingType → CSS 颜色 */
function markingColor(type: LaneMarkingType): string {
  return type.includes('YELLOW') ? COLOR_YELLOW : COLOR_WHITE
}

// ─── 箭头纹理 ───────────────────────────────────────────────

/**
 * 创建车道转向箭头纹理。
 * 128×128 Canvas，透明背景，白色 Path2D 矢量箭头。
 * 多方向组合绘制（如 STRAIGHT+LEFT 两个箭头并排）。
 */
export function createArrowTexture(directions: TurnDirection[]): THREE.CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  ctx.clearRect(0, 0, size, size)

  const sorted = [...directions].sort()
  const count = sorted.length
  const colWidth = size / Math.max(count, 1)

  sorted.forEach((dir, i) => {
    const cx = colWidth * (i + 0.5)
    const cy = size * 0.5
    drawArrow(ctx, dir, cx, cy, colWidth * 0.8, size * 0.7)
  })

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

/** 用 Path2D 绘制单个方向箭头 */
function drawArrow(
  ctx: CanvasRenderingContext2D,
  direction: TurnDirection,
  cx: number,
  cy: number,
  width: number,
  height: number,
): void {
  ctx.save()
  ctx.fillStyle = COLOR_WHITE
  ctx.strokeStyle = COLOR_WHITE
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const hw = width * 0.35
  const hh = height * 0.4
  const shaftW = width * 0.12

  switch (direction) {
    case 'STRAIGHT':
      // ↑ 直行箭头：竖线 + 三角箭头
      ctx.beginPath()
      ctx.moveTo(cx - shaftW, cy + hh)
      ctx.lineTo(cx - shaftW, cy - hh * 0.3)
      ctx.lineTo(cx - hw, cy - hh * 0.3)
      ctx.lineTo(cx, cy - hh)
      ctx.lineTo(cx + hw, cy - hh * 0.3)
      ctx.lineTo(cx + shaftW, cy - hh * 0.3)
      ctx.lineTo(cx + shaftW, cy + hh)
      ctx.closePath()
      ctx.fill()
      break

    case 'LEFT':
      // ↰ 左转箭头：竖线 + 弧形箭头
      ctx.beginPath()
      ctx.moveTo(cx + shaftW, cy + hh)
      ctx.lineTo(cx + shaftW, cy - hh * 0.1)
      ctx.arc(cx, cy - hh * 0.1, shaftW + hw * 0.5, 0, -Math.PI * 0.5, true)
      ctx.lineTo(cx - hw, cy - hh * 0.6)
      ctx.lineTo(cx - hw * 0.3, cy - hh)
      ctx.lineTo(cx - hw * 0.3, cy - hh * 0.3)
      ctx.arc(cx, cy - hh * 0.1, shaftW + hw * 0.2, -Math.PI * 0.5, 0, false)
      ctx.closePath()
      ctx.fill()
      break

    case 'RIGHT':
      // ↱ 右转箭头：竖线 + 弧形箭头（镜像）
      ctx.beginPath()
      ctx.moveTo(cx - shaftW, cy + hh)
      ctx.lineTo(cx - shaftW, cy - hh * 0.1)
      ctx.arc(cx, cy - hh * 0.1, shaftW + hw * 0.5, Math.PI, -Math.PI * 0.5, false)
      ctx.lineTo(cx + hw, cy - hh * 0.6)
      ctx.lineTo(cx + hw * 0.3, cy - hh)
      ctx.lineTo(cx + hw * 0.3, cy - hh * 0.3)
      ctx.arc(cx, cy - hh * 0.1, shaftW + hw * 0.2, -Math.PI * 0.5, Math.PI, true)
      ctx.closePath()
      ctx.fill()
      break

    case 'U_TURN':
      // ↩ 掉头箭头：竖线 + U 形弧
      ctx.beginPath()
      ctx.moveTo(cx - shaftW, cy + hh)
      ctx.lineTo(cx - shaftW, cy - hh * 0.2)
      ctx.arc(cx, cy - hh * 0.2, shaftW + hw * 0.4, Math.PI, 0, true)
      ctx.lineTo(cx + shaftW + hw * 0.4, cy - hh * 0.6)
      ctx.lineTo(cx + shaftW + hw * 0.4 + hw * 0.3, cy - hh * 0.2)
      ctx.lineTo(cx + shaftW + hw * 0.4 + hw * 0.3, cy + hh * 0.1)
      ctx.lineTo(cx + shaftW, cy + hh * 0.1)
      ctx.lineTo(cx + shaftW, cy - hh * 0.1)
      ctx.arc(cx, cy - hh * 0.2, shaftW + hw * 0.2, 0, Math.PI, false)
      ctx.lineTo(cx + shaftW, cy + hh)
      ctx.closePath()
      ctx.fill()
      break
  }

  ctx.restore()
}

// ─── 斑马线纹理 ─────────────────────────────────────────────

/**
 * 创建人行横道（斑马线）纹理。
 * 128×64 Canvas，透明背景，6 条白色横纹。
 */
export function createCrosswalkTexture(): THREE.CanvasTexture {
  const w = 128
  const h = 64
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!

  ctx.clearRect(0, 0, w, h)

  const stripeCount = 6
  const stripeWidth = w / (stripeCount * 2 - 1)
  ctx.fillStyle = COLOR_WHITE

  for (let i = 0; i < stripeCount; i++) {
    const x = i * stripeWidth * 2
    ctx.fillRect(x, 0, stripeWidth, h)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

// ─── 车道标线纹理 ───────────────────────────────────────────

/**
 * 创建实线标线纹理。
 * 128×16 Canvas，居中实线。
 */
export function createSolidMarkingTexture(color: string): THREE.CanvasTexture {
  const w = 128
  const h = 16
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!

  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = color
  ctx.fillRect(0, h * 0.3, w, h * 0.4)

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

/**
 * 创建虚线标线纹理。
 * 128×16 Canvas，居中虚线。
 */
export function createDashedMarkingTexture(
  color: string,
  dashRatio: number = 0.5,
): THREE.CanvasTexture {
  const w = 128
  const h = 16
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!

  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = color

  const dashLen = w * dashRatio / 4
  const gapLen = w * (1 - dashRatio) / 4
  let x = 0
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(x, h * 0.3, dashLen, h * 0.4)
    x += dashLen + gapLen
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

/**
 * 创建双实线标线纹理。
 * 128×16 Canvas，两条平行实线。
 */
export function createDoubleMarkingTexture(color: string): THREE.CanvasTexture {
  const w = 128
  const h = 16
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!

  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = color
  ctx.fillRect(0, h * 0.15, w, h * 0.25)
  ctx.fillRect(0, h * 0.6, w, h * 0.25)

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

// ─── 纹理缓存键 & 工厂 ──────────────────────────────────────

/** 根据标线类型获取缓存的纹理 */
export function getMarkingTexture(
  cache: Map<string, THREE.CanvasTexture>,
  type: LaneMarkingType,
): THREE.CanvasTexture {
  const cached = cache.get(type)
  if (cached) return cached

  const color = markingColor(type)
  let texture: THREE.CanvasTexture

  if (type.startsWith('DASHED')) {
    texture = createDashedMarkingTexture(color)
  } else if (type.startsWith('DOUBLE') || type.startsWith('SOLID_DOUBLE')) {
    texture = createDoubleMarkingTexture(color)
  } else {
    texture = createSolidMarkingTexture(color)
  }

  cache.set(type, texture)
  return texture
}

/** 根据箭头方向组合获取缓存的纹理 */
export function getArrowTexture(
  cache: Map<string, THREE.CanvasTexture>,
  directions: TurnDirection[],
): THREE.CanvasTexture {
  const key = `arrow:${[...directions].sort().join('+')}`
  const cached = cache.get(key)
  if (cached) return cached

  const texture = createArrowTexture(directions)
  cache.set(key, texture)
  return texture
}

/** 获取缓存的斑马线纹理 */
export function getCrosswalkTexture(
  cache: Map<string, THREE.CanvasTexture>,
): THREE.CanvasTexture {
  const key = 'crosswalk'
  const cached = cache.get(key)
  if (cached) return cached

  const texture = createCrosswalkTexture()
  cache.set(key, texture)
  return texture
}
