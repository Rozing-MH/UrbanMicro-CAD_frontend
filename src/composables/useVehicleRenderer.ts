import * as THREE from 'three'
import { ref, type Ref } from 'vue'
import type { SimVehicle } from '@/types/simulation'
import { MAX_VEHICLES, VEHICLE_BUFFER_OFFSETS, VEHICLE_BUFFER_STRIDE, VEHICLE_SPECS } from '@/types/simulation'

const VEHICLE_TYPES = ['CAR', 'BUS', 'TRUCK', 'BIKE', 'TRAM'] as const

const VEHICLE_COLORS: Record<string, number> = {
  CAR: 0x4fc3f7,
  BUS: 0xffd54f,
  TRUCK: 0xa5d6a7,
  BIKE: 0xff8a65,
  TRAM: 0xce93d8,
}

/** Perpendicular offset scale: 1 unit of lateralOffset ≈ this many world units */
const LATERAL_SCALE = 3.0

/**
 * Compute a perpendicular vector to the direction between two points.
 * Returns a normalized vector pointing to the "left" of the direction of travel.
 */
function perpendicularDirection(pos: THREE.Vector3, next: THREE.Vector3): THREE.Vector3 {
  const dir = new THREE.Vector3().subVectors(next, pos)
  if (dir.lengthSq() < 1e-8) {
    return new THREE.Vector3(0, 0, -1)
  }
  dir.normalize()
  // Cross with up to get rightward perpendicular, then negate for leftward
  const up = new THREE.Vector3(0, 1, 0)
  const right = new THREE.Vector3().crossVectors(dir, up).normalize()
  return right
}

export function useVehicleRenderer(scene: Ref<THREE.Scene | null>) {
  const meshes: Map<string, THREE.InstancedMesh> = new Map()
  const dummy = new THREE.Object3D()

  function createVehicleMesh(type: string, maxCount: number): THREE.InstancedMesh {
    const spec = VEHICLE_SPECS[type as keyof typeof VEHICLE_SPECS]
    const geo = new THREE.BoxGeometry(
      spec?.width ?? 1.8,
      1.4,
      spec?.length ?? 4.5,
    )
    const mat = new THREE.MeshStandardMaterial({
      color: VEHICLE_COLORS[type] ?? 0xffffff,
      roughness: 0.4,
      metalness: 0.2,
    })
    const mesh = new THREE.InstancedMesh(geo, mat, maxCount)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.count = 0
    mesh.frustumCulled = false
    return mesh
  }

  function init(): void {
    if (!scene.value) return
    for (const type of VEHICLE_TYPES) {
      const mesh = createVehicleMesh(type, MAX_VEHICLES)
      scene.value.add(mesh)
      meshes.set(type, mesh)
    }
  }

  /**
   * Position a vehicle on a lane centerline with lateral offset.
   * lateralOffset is applied perpendicular to the direction of travel.
   */
  function positionVehicle(
    positions: THREE.Vector3[],
    progress: number,
    lateralOffset: number,
  ): void {
    const ptIdx = Math.min(
      Math.floor(progress * (positions.length - 1)),
      positions.length - 2,
    )
    const pos = positions[ptIdx]
    const next = positions[ptIdx + 1] ?? pos

    // Compute perpendicular direction for lateral offset
    const perp = perpendicularDirection(pos, next)

    // Apply lateral offset (negative = offset to the left of travel direction)
    dummy.position.set(
      pos.x - perp.x * lateralOffset * LATERAL_SCALE,
      pos.y + 0.7,
      pos.z - perp.z * lateralOffset * LATERAL_SCALE,
    )
    dummy.lookAt(
      next.x - perp.x * lateralOffset * LATERAL_SCALE,
      next.y + 0.7,
      next.z - perp.z * lateralOffset * LATERAL_SCALE,
    )
    dummy.updateMatrix()
  }

  function update(vehicles: Map<string, SimVehicle>, lanePositions: Map<string, THREE.Vector3[]>): void {
    const counts: Map<string, number> = new Map()
    for (const type of meshes.keys()) counts.set(type, 0)

    for (const veh of vehicles.values()) {
      const positions = lanePositions.get(veh.currentLaneId)
      if (!positions || positions.length === 0) continue

      const mesh = meshes.get(veh.type)
      if (!mesh) continue

      const idx = counts.get(veh.type) ?? 0
      if (idx >= MAX_VEHICLES) continue

      positionVehicle(positions, veh.progress, veh.lateralOffset)
      mesh.setMatrixAt(idx, dummy.matrix)
      counts.set(veh.type, idx + 1)
    }

    for (const [type, mesh] of meshes) {
      mesh.count = counts.get(type) ?? 0
      mesh.instanceMatrix.needsUpdate = true
    }
  }

  function updateFromBuffer(
    vehicleBuffer: Float32Array | null,
    count: number,
    lanePositions: Map<string, THREE.Vector3[]>,
    laneIds: string[],
  ): void {
    if (!vehicleBuffer) return
    const renderedCounts = new Map<string, number>()
    for (const type of VEHICLE_TYPES) renderedCounts.set(type, 0)

    for (let i = 0; i < Math.min(count, MAX_VEHICLES); i++) {
      const base = i * VEHICLE_BUFFER_STRIDE
      const progress = vehicleBuffer[base + VEHICLE_BUFFER_OFFSETS.progress]
      const lateralOffset = vehicleBuffer[base + VEHICLE_BUFFER_OFFSETS.lateralOffset]
      const laneIndex = Math.trunc(vehicleBuffer[base + VEHICLE_BUFFER_OFFSETS.laneIndex])
      const typeIndex = Math.trunc(vehicleBuffer[base + VEHICLE_BUFFER_OFFSETS.typeIndex])

      const vehicleType = VEHICLE_TYPES[typeIndex] ?? 'CAR'
      const mesh = meshes.get(vehicleType)
      const laneId = laneIds[laneIndex]
      if (!mesh || !laneId) continue

      const positions = lanePositions.get(laneId)
      if (!positions || positions.length === 0) continue

      positionVehicle(positions, progress, lateralOffset)

      const rendered = renderedCounts.get(vehicleType) ?? 0
      mesh.setMatrixAt(rendered, dummy.matrix)
      renderedCounts.set(vehicleType, rendered + 1)
    }

    for (const [type, mesh] of meshes) {
      mesh.count = renderedCounts.get(type) ?? 0
      mesh.instanceMatrix.needsUpdate = true
    }
  }

  function dispose(): void {
    if (!scene.value) return
    for (const mesh of meshes.values()) {
      scene.value.remove(mesh)
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    }
    meshes.clear()
  }

  return { init, update, updateFromBuffer, dispose }
}
