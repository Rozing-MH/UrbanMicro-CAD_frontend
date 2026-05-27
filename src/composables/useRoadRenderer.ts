import * as THREE from 'three'
import { type Ref } from 'vue'
import type { RoadSegment, RoadNode, MeshData } from '@/types/road-network'

export function useRoadRenderer(scene: Ref<THREE.Scene | null>) {
  const segmentMeshes: Map<string, THREE.Mesh> = new Map()
  const nodeMarkers: Map<string, THREE.Mesh> = new Map()
  const previewLine: { line: THREE.Line | null } = { line: null }

  const roadMaterial = new THREE.MeshStandardMaterial({
    color: 0x2c2c2c,
    roughness: 0.85,
    metalness: 0.1,
  })

  const intersectionMaterial = new THREE.MeshStandardMaterial({
    color: 0x3a3a3a,
    roughness: 0.85,
    metalness: 0.1,
  })

  const nodeMaterial = new THREE.MeshStandardMaterial({
    color: 0xffeb3b,
    emissive: 0x553300,
  })

  function meshDataToGeometry(data: MeshData): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(data.vertices, 3))
    geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2))
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1))
    return geo
  }

  function fallbackSegmentGeometry(seg: RoadSegment): THREE.BufferGeometry {
    const start = seg.centerLine[0]
    const end = seg.centerLine[seg.centerLine.length - 1]
    const halfWidth = seg.profile.totalWidth / 2
    const dx = end.x - start.x
    const dy = end.y - start.y
    const len = Math.hypot(dx, dy) || 1
    const nx = -dy / len
    const ny = dx / len
    const z = seg.elevation.startZ
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute([
      start.x + nx * halfWidth, z, start.y + ny * halfWidth,
      start.x - nx * halfWidth, z, start.y - ny * halfWidth,
      end.x + nx * halfWidth, z, end.y + ny * halfWidth,
      end.x - nx * halfWidth, z, end.y - ny * halfWidth,
    ], 3))
    geo.setAttribute('normal', new THREE.Float32BufferAttribute([
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
    ], 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2))
    geo.setIndex([0, 1, 2, 2, 1, 3])
    return geo
  }

  function addSegment(seg: RoadSegment): void {
    if (!scene.value) return
    const existing = segmentMeshes.get(seg.id)
    if (existing) {
      scene.value.remove(existing)
      existing.geometry.dispose()
    }
    const geo = seg.meshData ? meshDataToGeometry(seg.meshData) : fallbackSegmentGeometry(seg)
    const mesh = new THREE.Mesh(geo, roadMaterial)
    mesh.receiveShadow = true
    mesh.userData.segmentId = seg.id
    scene.value.add(mesh)
    segmentMeshes.set(seg.id, mesh)
  }

  function removeSegment(id: string): void {
    if (!scene.value) return
    const mesh = segmentMeshes.get(id)
    if (mesh) {
      scene.value.remove(mesh)
      mesh.geometry.dispose()
      segmentMeshes.delete(id)
    }
  }

  function addNode(node: RoadNode): void {
    if (!scene.value) return
    const existing = nodeMarkers.get(node.id)
    if (existing) {
      scene.value.remove(existing)
      existing.geometry.dispose()
    }

    const geo = new THREE.SphereGeometry(1.2, 16, 12)
    const mesh = new THREE.Mesh(geo, nodeMaterial)
    mesh.position.set(node.position.x, node.elevation + 0.1, node.position.y)
    mesh.userData.nodeId = node.id
    scene.value.add(mesh)
    nodeMarkers.set(node.id, mesh)
  }

  function removeNode(id: string): void {
    if (!scene.value) return
    const mesh = nodeMarkers.get(id)
    if (mesh) {
      scene.value.remove(mesh)
      mesh.geometry.dispose()
      nodeMarkers.delete(id)
    }
  }

  function showPreview(start: { x: number; y: number }, end: { x: number; y: number }): void {
    if (!scene.value) return
    hidePreview()
    const points = [
      new THREE.Vector3(start.x, 0.5, start.y),
      new THREE.Vector3(end.x, 0.5, end.y),
    ]
    const geo = new THREE.BufferGeometry().setFromPoints(points)
    const mat = new THREE.LineBasicMaterial({ color: 0x00ffaa })
    const line = new THREE.Line(geo, mat)
    scene.value.add(line)
    previewLine.line = line
  }

  function hidePreview(): void {
    if (!scene.value || !previewLine.line) return
    scene.value.remove(previewLine.line)
    previewLine.line.geometry.dispose()
    previewLine.line = null
  }

  function highlightSegment(id: string | null): void {
    for (const [segId, mesh] of segmentMeshes) {
      if (segId === id) {
        (mesh.material as THREE.MeshStandardMaterial) = new THREE.MeshStandardMaterial({
          color: 0x4a90e2,
          roughness: 0.85,
        })
      } else {
        mesh.material = roadMaterial
      }
    }
  }

  function dispose(): void {
    if (!scene.value) return
    for (const mesh of segmentMeshes.values()) {
      scene.value.remove(mesh)
      mesh.geometry.dispose()
    }
    for (const mesh of nodeMarkers.values()) {
      scene.value.remove(mesh)
      mesh.geometry.dispose()
    }
    hidePreview()
    segmentMeshes.clear()
    nodeMarkers.clear()
  }

  return {
    addSegment,
    removeSegment,
    addNode,
    removeNode,
    showPreview,
    hidePreview,
    highlightSegment,
    dispose,
    segmentMeshes,
    nodeMarkers,
    intersectionMaterial,
  }
}
