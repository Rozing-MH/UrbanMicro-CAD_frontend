import * as THREE from 'three'
import { type Ref } from 'vue'

export function useGroundGrid(scene: Ref<THREE.Scene | null>) {
  let ground: THREE.Mesh | null = null
  let grid: THREE.GridHelper | null = null
  let axis: THREE.AxesHelper | null = null

  function init(size = 1000, divisions = 100): void {
    if (!scene.value) return

    const groundGeo = new THREE.PlaneGeometry(size, size)
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x4a5568,
      roughness: 0.95,
      metalness: 0,
    })
    ground = new THREE.Mesh(groundGeo, groundMat)
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    scene.value.add(ground)

    grid = new THREE.GridHelper(size, divisions, 0x666688, 0x444466)
    grid.position.y = 0.01
    scene.value.add(grid)

    axis = new THREE.AxesHelper(20)
    axis.position.y = 0.1
    scene.value.add(axis)
  }

  function setVisible(visible: boolean): void {
    if (grid) grid.visible = visible
  }

  function dispose(): void {
    if (!scene.value) return
    if (ground) {
      scene.value.remove(ground)
      ground.geometry.dispose()
      ;(ground.material as THREE.Material).dispose()
      ground = null
    }
    if (grid) {
      scene.value.remove(grid)
      grid = null
    }
    if (axis) {
      scene.value.remove(axis)
      axis = null
    }
  }

  return { init, setVisible, dispose }
}
