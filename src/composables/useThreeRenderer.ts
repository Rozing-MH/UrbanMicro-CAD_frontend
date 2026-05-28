import * as THREE from 'three'
import { shallowRef, onMounted, onBeforeUnmount, type Ref } from 'vue'
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'

export interface RendererState {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  labelRenderer: CSS2DRenderer
  animationId: number | null
}

export function useThreeRenderer(container: Ref<HTMLElement | null>) {
  const state = shallowRef<RendererState | null>(null)
  let resizeObserver: ResizeObserver | null = null

  function init(): RendererState {
    const el = container.value
    if (!el) throw new Error('Container element not ready')

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x1a1a2e)

    const camera = new THREE.PerspectiveCamera(60, el.clientWidth / el.clientHeight, 0.1, 10000)
    camera.position.set(0, 200, 200)
    camera.lookAt(0, 0, 0)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(el.clientWidth, el.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    el.appendChild(renderer.domElement)

    const labelRenderer = new CSS2DRenderer()
    labelRenderer.setSize(el.clientWidth, el.clientHeight)
    labelRenderer.domElement.style.position = 'absolute'
    labelRenderer.domElement.style.top = '0'
    labelRenderer.domElement.style.pointerEvents = 'none'
    el.appendChild(labelRenderer.domElement)

    const ambient = new THREE.AmbientLight(0xffffff, 0.4)
    scene.add(ambient)

    const sun = new THREE.DirectionalLight(0xfff5e0, 1.2)
    sun.position.set(100, 200, 100)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.near = 0.5
    sun.shadow.camera.far = 800
    sun.shadow.camera.left = -300
    sun.shadow.camera.right = 300
    sun.shadow.camera.top = 300
    sun.shadow.camera.bottom = -300
    scene.add(sun)

    const s: RendererState = { scene, camera, renderer, labelRenderer, animationId: null }
    state.value = s

    resizeObserver = new ResizeObserver(() => {
      if (!el) return
      camera.aspect = el.clientWidth / el.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(el.clientWidth, el.clientHeight)
      labelRenderer.setSize(el.clientWidth, el.clientHeight)
    })
    resizeObserver.observe(el)

    return s
  }

  function startRenderLoop(onFrame?: () => void): void {
    const s = state.value
    if (!s) return

    const loop = () => {
      s.animationId = requestAnimationFrame(loop)
      onFrame?.()
      s.renderer.render(s.scene, s.camera)
      s.labelRenderer.render(s.scene, s.camera)
    }
    loop()
  }

  function stopRenderLoop(): void {
    const s = state.value
    if (s?.animationId !== null && s?.animationId !== undefined) {
      cancelAnimationFrame(s.animationId)
      s.animationId = null
    }
  }

  function dispose(): void {
    stopRenderLoop()
    resizeObserver?.disconnect()
    const s = state.value
    if (s) {
      s.renderer.dispose()
      container.value?.removeChild(s.renderer.domElement)
      container.value?.removeChild(s.labelRenderer.domElement)
    }
    state.value = null
  }

  onMounted(() => {
    if (container.value) init()
  })

  onBeforeUnmount(() => {
    dispose()
  })

  return { state, init, startRenderLoop, stopRenderLoop, dispose }
}

export function createLine2(points: THREE.Vector3[], color: number, lineWidth = 2): Line2 {
  const positions: number[] = []
  for (const p of points) {
    positions.push(p.x, p.y, p.z)
  }
  const geo = new LineGeometry()
  geo.setPositions(positions)
  const mat = new LineMaterial({ color, linewidth: lineWidth, worldUnits: false })
  return new Line2(geo, mat)
}
