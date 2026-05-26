import * as THREE from 'three'
import { type Ref } from 'vue'

interface CameraState {
  isDragging: boolean
  isOrbiting: boolean
  lastX: number
  lastY: number
  spherical: THREE.Spherical
  target: THREE.Vector3
}

export function useCameraControls(
  camera: Ref<THREE.PerspectiveCamera | null>,
  domElement: Ref<HTMLElement | null>,
) {
  const state: CameraState = {
    isDragging: false,
    isOrbiting: false,
    lastX: 0,
    lastY: 0,
    spherical: new THREE.Spherical(280, Math.PI / 3, Math.PI / 4),
    target: new THREE.Vector3(0, 0, 0),
  }

  function updateCamera(): void {
    if (!camera.value) return
    const offset = new THREE.Vector3().setFromSpherical(state.spherical)
    camera.value.position.copy(state.target).add(offset)
    camera.value.lookAt(state.target)
  }

  function onMouseDown(e: MouseEvent): void {
    state.lastX = e.clientX
    state.lastY = e.clientY
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      state.isDragging = true
    } else if (e.button === 2) {
      state.isOrbiting = true
    }
  }

  function onMouseMove(e: MouseEvent): void {
    const dx = e.clientX - state.lastX
    const dy = e.clientY - state.lastY
    state.lastX = e.clientX
    state.lastY = e.clientY

    if (state.isOrbiting) {
      state.spherical.theta -= dx * 0.005
      state.spherical.phi -= dy * 0.005
      state.spherical.phi = Math.max(0.1, Math.min(Math.PI / 2 - 0.05, state.spherical.phi))
      updateCamera()
    } else if (state.isDragging) {
      if (!camera.value) return
      const panSpeed = state.spherical.radius * 0.0015
      const right = new THREE.Vector3()
      camera.value.getWorldDirection(right)
      right.cross(camera.value.up).normalize()
      const forward = new THREE.Vector3(right.z, 0, -right.x)
      state.target.addScaledVector(right, -dx * panSpeed)
      state.target.addScaledVector(forward, -dy * panSpeed)
      updateCamera()
    }
  }

  function onMouseUp(): void {
    state.isDragging = false
    state.isOrbiting = false
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault()
    const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9
    state.spherical.radius = Math.max(20, Math.min(2000, state.spherical.radius * zoomFactor))
    updateCamera()
  }

  function attach(): void {
    const el = domElement.value
    if (!el) return
    el.addEventListener('mousedown', onMouseDown)
    el.addEventListener('mousemove', onMouseMove)
    el.addEventListener('mouseup', onMouseUp)
    el.addEventListener('mouseleave', onMouseUp)
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  function detach(): void {
    const el = domElement.value
    if (!el) return
    el.removeEventListener('mousedown', onMouseDown)
    el.removeEventListener('mousemove', onMouseMove)
    el.removeEventListener('mouseup', onMouseUp)
    el.removeEventListener('mouseleave', onMouseUp)
    el.removeEventListener('wheel', onWheel)
  }

  function reset(): void {
    state.spherical.set(280, Math.PI / 3, Math.PI / 4)
    state.target.set(0, 0, 0)
    updateCamera()
  }

  return { attach, detach, reset, updateCamera, state }
}
