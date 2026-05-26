import { Bezier } from 'bezier-js'
import type { Point2D } from '@/types/road-network'

export function buildQuadraticCenterLine(
  start: Point2D,
  control: Point2D,
  end: Point2D,
  steps = 32,
): Point2D[] {
  const curve = new Bezier(start.x, start.y, control.x, control.y, end.x, end.y)
  return curve.getLUT(steps).map((p) => ({ x: p.x, y: p.y }))
}

export function buildCubicCenterLine(
  start: Point2D,
  cp1: Point2D,
  cp2: Point2D,
  end: Point2D,
  steps = 32,
): Point2D[] {
  const curve = new Bezier(start.x, start.y, cp1.x, cp1.y, cp2.x, cp2.y, end.x, end.y)
  return curve.getLUT(steps).map((p) => ({ x: p.x, y: p.y }))
}

export function approximateCurveLength(points: Point2D[]): number {
  let length = 0
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x
    const dy = points[i].y - points[i - 1].y
    length += Math.sqrt(dx * dx + dy * dy)
  }
  return length
}

export function offsetCenterLine(
  centerLine: Point2D[],
  offset: number,
  normal: 'left' | 'right' = 'left',
): Point2D[] {
  const result: Point2D[] = []
  const sign = normal === 'left' ? 1 : -1

  for (let i = 0; i < centerLine.length; i++) {
    let nx: number, ny: number

    if (i === 0) {
      nx = centerLine[1].x - centerLine[0].x
      ny = centerLine[1].y - centerLine[0].y
    } else if (i === centerLine.length - 1) {
      nx = centerLine[i].x - centerLine[i - 1].x
      ny = centerLine[i].y - centerLine[i - 1].y
    } else {
      nx = centerLine[i + 1].x - centerLine[i - 1].x
      ny = centerLine[i + 1].y - centerLine[i - 1].y
    }

    const len = Math.sqrt(nx * nx + ny * ny)
    if (len < 1e-10) {
      result.push({ ...centerLine[i] })
      continue
    }
    const perpX = (-ny / len) * sign
    const perpY = (nx / len) * sign
    result.push({
      x: centerLine[i].x + perpX * offset,
      y: centerLine[i].y + perpY * offset,
    })
  }

  return result
}

export function interpolateAlongCurve(points: Point2D[], t: number): Point2D {
  if (points.length === 0) return { x: 0, y: 0 }
  if (points.length === 1) return { ...points[0] }
  if (t <= 0) return { ...points[0] }
  if (t >= 1) return { ...points[points.length - 1] }

  const totalLen = approximateCurveLength(points)
  const target = t * totalLen
  let accumulated = 0

  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x
    const dy = points[i].y - points[i - 1].y
    const segLen = Math.sqrt(dx * dx + dy * dy)
    if (accumulated + segLen >= target) {
      const r = (target - accumulated) / segLen
      return {
        x: points[i - 1].x + dx * r,
        y: points[i - 1].y + dy * r,
      }
    }
    accumulated += segLen
  }

  return { ...points[points.length - 1] }
}
