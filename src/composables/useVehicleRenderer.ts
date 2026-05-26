import * as THREE from 'three'
import { ref, type Ref } from 'vue'
import type { SimVehicle } from '@/types/simulation'
import { MAX_VEHICLES, VEHICLE_BUFFER_STRIDE } from '@/types/simulation'

const VEHICLE_COLORS: Record<string, number> = {
  CAR: 0x4fc3f7,
  BUS: 0xffd54f,
  TRUCK: 0xa5d6a7,
  BIKE: 0xff8a65,
  TRAM: 0xce93d8,
}

export function useVehicleRenderer(scene: Ref<THREE.Scene | null>) {
  const meshes: Map<string, THREE.InstancedMesh> = new Map()
  const dummy = new THREE.Object3D()

  function createVehicleMesh(type: string, maxCount: number): THREE.InstancedMesh {
    const geo = new THREE.BoxGeometry(
      type === 'BUS' || type === 'TRUCK' ? 2.5 : 1.8,
      1.4,
      type === 'BUS' ? 12 : type === 'TRUCK' ? 8 : 4.5,
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
    for (const type of ['CAR', 'BUS', 'TRUCK', 'BIKE', 'TRAM']) {
      const mesh = createVehicleMesh(type, MAX_VEHICLES)
      scene.value.add(mesh)
      meshes.set(type, mesh)
    }
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

      const t = veh.progress
      const ptIdx = Math.min(Math.floor(t * (positions.length - 1)), positions.length - 2)
      const pos = positions[ptIdx]
      const next = positions[ptIdx + 1] ?? pos

      dummy.position.set(pos.x, pos.y + 0.7, pos.z)
      dummy.lookAt(next.x, next.y + 0.7, next.z)
      dummy.updateMatrix()
      mesh.setMatrixAt(idx, dummy.matrix)
      counts.set(veh.type, idx + 1)
    }

    for (const [type, mesh] of meshes) {
      mesh.count = counts.get(type) ?? 0
      mesh.instanceMatrix.needsUpdate = true
    }
  }

  function updateFromBuffer(vehicleBuffer: Float32Array | null, count: number, lanePositions: Map<string, THREE.Vector3[]>, laneIds: string[]): void {
    if (!vehicleBuffer) return
    const carMesh = meshes.get('CAR')
    if (!carMesh) return
    let rendered = 0
    for (let i = 0; i < Math.min(count, MAX_VEHICLES); i++) {
      const base = i * VEHICLE_BUFFER_STRIDE
      const progress = vehicleBuffer[base]
      const laneId = laneIds[i % laneIds.length]
      const positions = lanePositions.get(laneId)
      if (!positions || positions.length === 0) continue
      const ptIdx = Math.min(Math.floor(progress * (positions.length - 1)), positions.length - 2)
      const pos = positions[ptIdx]
      const next = positions[ptIdx + 1] ?? pos
      dummy.position.set(pos.x, pos.y + 0.7, pos.z)
      dummy.lookAt(next.x, next.y + 0.7, next.z)
      dummy.updateMatrix()
      carMesh.setMatrixAt(rendered, dummy.matrix)
      rendered++
    }
    carMesh.count = rendered
    carMesh.instanceMatrix.needsUpdate = true
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
