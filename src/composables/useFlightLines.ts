import * as THREE from 'three'
import { type Ref, shallowRef } from 'vue'
import type { FlightLine, FlightLineFilter } from '@/types/evaluation'
import type { VehicleType } from '@/types/simulation'

/** Vehicle type → flight line color (RGB 0–1) */
const FLIGHT_LINE_COLORS: Record<string, [number, number, number]> = {
  CAR: [0.31, 0.76, 0.97],
  BUS: [1.0, 0.84, 0.31],
  TRUCK: [0.65, 0.84, 0.65],
  BIKE: [1.0, 0.54, 0.40],
  TRAM: [0.81, 0.58, 0.85],
}

const DEFAULT_COLOR: [number, number, number] = [0.6, 0.8, 1.0]
const LINE_Y_OFFSET = 1.8
const DASH_SIZE = 2.0
const GAP_SIZE = 1.5
const FLOW_SPEED = 8.0

/**
 * FlightLineRenderer — 对齐设计文档 §4.6 FlightLineRenderer。
 * 使用 THREE.Line + LineDashedMaterial 实现 UV 动画流动效果。
 * 支持按车型过滤飞线颜色。
 */
export function useFlightLines(scene: Ref<THREE.Scene | null>) {
  const flightLineGroup = shallowRef<THREE.Group | null>(null)
  const filter = shallowRef<FlightLineFilter>({
    selectedSegmentId: null,
    selectedNodeId: null,
    vehicleTypeFilter: [],
    enabled: false,
  })
  let animOffset = 0

  function ensureGroup(): THREE.Group {
    if (!flightLineGroup.value && scene.value) {
      const g = new THREE.Group()
      g.name = 'flightLines'
      scene.value.add(g)
      flightLineGroup.value = g
    }
    return flightLineGroup.value!
  }

  /**
   * 渲染飞线数据。
   * 每条 FlightLine 生成一条虚线，颜色按车型区分。
   */
  function renderFlightLines(lines: FlightLine[]): void {
    clearAll()
    if (lines.length === 0) return
    const group = ensureGroup()

    for (const line of lines) {
      if (line.polyline.length < 2) continue

      // Apply vehicle type filter
      if (filter.value.vehicleTypeFilter.length > 0 &&
          !filter.value.vehicleTypeFilter.includes(line.vehicleType)) {
        continue
      }

      const points = line.polyline.map(p => new THREE.Vector3(p.x, p.y + LINE_Y_OFFSET, p.z))
      const geometry = new THREE.BufferGeometry().setFromPoints(points)

      const color = FLIGHT_LINE_COLORS[line.vehicleType] ?? DEFAULT_COLOR
      const material = new THREE.LineDashedMaterial({
        color: new THREE.Color(color[0], color[1], color[2]),
        transparent: true,
        opacity: line.alpha,
        dashSize: DASH_SIZE,
        gapSize: GAP_SIZE,
        depthTest: true,
      })

      const lineObj = new THREE.Line(geometry, material)
      lineObj.computeLineDistances()
      lineObj.userData = { vehicleId: line.vehicleId, vehicleType: line.vehicleType }
      group.add(lineObj)
    }
  }

  /** 按车型过滤已渲染的飞线可见性 */
  function filterByVehicleType(types: VehicleType[]): void {
    filter.value = { ...filter.value, vehicleTypeFilter: types }
    const group = flightLineGroup.value
    if (!group) return
    for (const child of group.children) {
      const vType = child.userData.vehicleType as string | undefined
      if (!vType) continue
      child.visible = types.length === 0 || types.includes(vType as VehicleType)
    }
  }

  /** 更新流动动画偏移量（每帧调用） */
  function updateAnimation(delta: number): void {
    const group = flightLineGroup.value
    if (!group || group.children.length === 0) return
    animOffset += delta * FLOW_SPEED

    for (const child of group.children) {
      const mat = (child as THREE.Line).material as THREE.LineDashedMaterial
      if (mat.isLineDashedMaterial) {
        // Shift dash offset to create flowing effect
        mat.dashSize = DASH_SIZE
        mat.gapSize = GAP_SIZE
        // We recompute line distances with offset by adjusting dashSize
        // LineDashedMaterial doesn't support dashOffset directly in three.js 0.160,
        // so we simulate flow by slightly varying the dash pattern.
        mat.dashSize = DASH_SIZE + Math.sin(animOffset) * 0.3
        mat.needsUpdate = true
      }
    }
  }

  function clearAll(): void {
    const group = flightLineGroup.value
    if (!group) return
    for (const child of group.children) {
      const line = child as THREE.Line
      line.geometry.dispose()
      ;(line.material as THREE.Material).dispose()
    }
    group.clear()
  }

  function setFilter(patch: Partial<FlightLineFilter>): void {
    filter.value = { ...filter.value, ...patch }
  }

  function dispose(): void {
    clearAll()
    if (flightLineGroup.value && scene.value) {
      scene.value.remove(flightLineGroup.value)
      flightLineGroup.value = null
    }
  }

  return {
    flightLineGroup,
    filter,
    renderFlightLines,
    filterByVehicleType,
    updateAnimation,
    clearAll,
    setFilter,
    dispose,
  }
}
