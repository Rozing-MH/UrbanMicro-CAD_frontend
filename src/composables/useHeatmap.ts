import * as THREE from 'three'
import { type Ref } from 'vue'
import type { HeatmapConfig, SegmentMetric } from '@/types/evaluation'

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
    const normalizedValue = Math.max(0, Math.min(1, (value - config.minValue) / (config.maxValue - config.minValue)))
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
    const overlay = new THREE.Mesh(
      existingMesh.geometry.clone(),
      createHeatmapMaterial(metric.density, config),
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
