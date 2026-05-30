import * as THREE from 'three'
import { type Ref } from 'vue'
import type { HeatmapConfig, HeatmapMode, LOSGrade, SegmentMetric } from '@/types/evaluation'

/** LOS grade → numeric value for heatmap color mapping (A=0, F=1) */
const LOS_NUMERIC: Record<LOSGrade, number> = {
  A: 0.0,
  B: 0.2,
  C: 0.4,
  D: 0.6,
  E: 0.8,
  F: 1.0,
}

/**
 * Select the metric value based on heatmap mode.
 * Returns the raw value appropriate for the selected visualization dimension.
 * For LOS mode, maps grade A→0 / F→1.
 */
function selectMetricValue(metric: SegmentMetric, mode: HeatmapMode): number {
  switch (mode) {
    case 'VOLUME':
      return metric.volume
    case 'SPEED':
      return metric.avgSpeed
    case 'CONGESTION':
      return metric.delay
    case 'LOS':
      return LOS_NUMERIC[metric.los] ?? 0.5
    default:
      return metric.density
  }
}

/**
 * Default min/max ranges per heatmap mode.
 * Used when config.minValue === 0 && config.maxValue === 80 (the initial defaults).
 */
const MODE_RANGES: Record<HeatmapMode, { min: number; max: number }> = {
  OFF: { min: 0, max: 1 },
  VOLUME: { min: 0, max: 1800 },
  SPEED: { min: 0, max: 20 },
  CONGESTION: { min: 0, max: 40 },
  LOS: { min: 0, max: 1 },
}

const HEATMAP_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const HEATMAP_FRAG = `
uniform float uValue;
uniform vec3 uColorLow;
uniform vec3 uColorMid;
uniform vec3 uColorHigh;
uniform float uOpacity;
varying vec2 vUv;

void main() {
  vec3 color;
  if (uValue < 0.5) {
    color = mix(uColorLow, uColorMid, uValue * 2.0);
  } else {
    color = mix(uColorMid, uColorHigh, (uValue - 0.5) * 2.0);
  }
  gl_FragColor = vec4(color, uOpacity);
}
`

export function useHeatmap(scene: Ref<THREE.Scene | null>) {
  const heatmapMeshes: Map<string, THREE.Mesh> = new Map()

  function createHeatmapMaterial(value: number, config: HeatmapConfig): THREE.ShaderMaterial {
    const range = Math.max(0.0001, config.maxValue - config.minValue)
    const normalizedValue = Math.max(0, Math.min(1, (value - config.minValue) / range))
    const stops = config.colorStops
    const low = stops[0].color
    const mid = stops[Math.floor(stops.length / 2)].color
    const high = stops[stops.length - 1].color
    return new THREE.ShaderMaterial({
      vertexShader: HEATMAP_VERT,
      fragmentShader: HEATMAP_FRAG,
      uniforms: {
        uValue: { value: normalizedValue },
        uColorLow: { value: new THREE.Color(low[0], low[1], low[2]) },
        uColorMid: { value: new THREE.Color(mid[0], mid[1], mid[2]) },
        uColorHigh: { value: new THREE.Color(high[0], high[1], high[2]) },
        uOpacity: { value: 0.75 },
      },
      transparent: true,
      depthWrite: false,
    })
  }

  function updateSegmentHeatmap(
    segmentId: string,
    existingMesh: THREE.Mesh | undefined,
    metric: SegmentMetric,
    config: HeatmapConfig,
  ): void {
    if (!scene.value || !existingMesh) return
    const old = heatmapMeshes.get(segmentId)
    if (old) {
      scene.value.remove(old)
      old.geometry.dispose()
      ;(old.material as THREE.Material).dispose()
    }
    // Pick the right metric field based on heatmap mode
    const value = selectMetricValue(metric, config.mode)
    // Auto-adjust range if still at default (0-80)
    const modeRange = MODE_RANGES[config.mode]
    const effectiveConfig: HeatmapConfig = {
      ...config,
      minValue: config.minValue === 0 && config.maxValue === 80 ? modeRange.min : config.minValue,
      maxValue: config.minValue === 0 && config.maxValue === 80 ? modeRange.max : config.maxValue,
    }
    const overlay = new THREE.Mesh(
      existingMesh.geometry.clone(),
      createHeatmapMaterial(value, effectiveConfig),
    )
    overlay.position.copy(existingMesh.position)
    overlay.position.y += 0.05
    overlay.rotation.copy(existingMesh.rotation)
    overlay.userData.segmentId = segmentId
    scene.value.add(overlay)
    heatmapMeshes.set(segmentId, overlay)
  }

  function clearHeatmap(): void {
    if (!scene.value) return
    for (const mesh of heatmapMeshes.values()) {
      scene.value.remove(mesh)
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    }
    heatmapMeshes.clear()
  }

  function dispose(): void {
    clearHeatmap()
  }

  return { updateSegmentHeatmap, clearHeatmap, dispose, heatmapMeshes }
}
