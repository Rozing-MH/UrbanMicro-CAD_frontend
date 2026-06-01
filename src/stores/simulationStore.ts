import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Remote } from 'comlink'
import { getSimulationWorker } from '@/workers'
import type { TopologyData } from '@/types/road-network'
import type { RuleData } from '@/types/traffic-rule'
import type {
  SimVehicle,
  ODMatrix,
  IDMParams,
  MOBILParams,
  SimulationStats,
  SimulationFrame,
  LaneMetricSnapshot,
  VehicleMixConfig,
} from '@/types/simulation'
import type { SimulationWorkerApi } from '@/workers/simulation.worker'
import {
  DEFAULT_IDM,
  DEFAULT_MOBIL,
  DEFAULT_VEHICLE_MIX,
  VEHICLE_BUFFER_STRIDE,
  MAX_VEHICLES,
} from '@/types/simulation'
import { storeEventBus } from '@/stores/storeEventBus'

/** Default timeout for Worker RPC calls (ms) */
const WORKER_RPC_TIMEOUT = 30_000

/**
 * Wrap a Worker RPC promise with a timeout guard.
 * Rejects with a descriptive error if the Worker doesn't respond in time.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Worker ${label} 超时 (${ms}ms)`)), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

export type SimState = 'IDLE' | 'RUNNING' | 'PAUSED' | 'FINISHED'

export const useSimulationStore = defineStore('simulation', () => {
  const state = ref<SimState>('IDLE')
  const currentTime = ref(0)
  const simulatedDuration = ref(3600)
  const timeScale = ref(1)
  const vehicleCount = ref(0)
  const vehicles = ref<Map<string, SimVehicle>>(new Map())

  const odMatrix = ref<ODMatrix>({
    pairs: [],
  })

  const idmParams = ref<IDMParams>({ ...DEFAULT_IDM })
  const mobilParams = ref<MOBILParams>({ ...DEFAULT_MOBIL })
  const vehicleMix = ref({ ...DEFAULT_VEHICLE_MIX })

  const stats = ref<SimulationStats>({
    totalVehicles: 0,
    completedVehicles: 0,
    averageSpeed: 0,
    averageDelay: 0,
    maxQueueLength: 0,
    throughput: 0,
  })

  const laneMetrics = ref<LaneMetricSnapshot[]>([])

  /** Latest non-empty lane metrics (avoids UI flicker on empty-tick frames) */
  const lastLaneMetrics = computed(() =>
    laneMetrics.value.length > 0 ? laneMetrics.value : [],
  )

  /** Whether SharedArrayBuffer is available (requires COOP/COEP headers) */
  const sharedBufferSupported = typeof SharedArrayBuffer !== 'undefined'

  let sharedBuffer: SharedArrayBuffer | ArrayBuffer | null = null
  let vehicleView: Float32Array | null = null
  let worker: Remote<SimulationWorkerApi> | null = null
  let lastTickAt = 0

  const isRunning = computed(() => state.value === 'RUNNING')
  const progress = computed(() =>
    simulatedDuration.value > 0 ? currentTime.value / simulatedDuration.value : 0,
  )

  /**
   * Initialize the vehicle buffer.
   * Uses SharedArrayBuffer when available (zero-copy Worker→main transfer),
   * falls back to a regular ArrayBuffer (Worker copies data each tick).
   */
  function initSharedBuffer(): SharedArrayBuffer | ArrayBuffer {
    const byteLength = MAX_VEHICLES * VEHICLE_BUFFER_STRIDE * 4
    if (sharedBufferSupported) {
      sharedBuffer = new SharedArrayBuffer(byteLength)
    } else {
      sharedBuffer = new ArrayBuffer(byteLength)
    }
    vehicleView = new Float32Array(sharedBuffer)
    return sharedBuffer
  }

  function getSharedBuffer(): SharedArrayBuffer | ArrayBuffer | null {
    return sharedBuffer
  }

  function getVehicleView(): Float32Array | null {
    return vehicleView
  }

  function setState(s: SimState): void {
    state.value = s
  }

  async function start(topology: TopologyData, rules: RuleData): Promise<void> {
    if (!sharedBuffer) initSharedBuffer()
    if (!sharedBuffer) return
    worker = getSimulationWorker()
    try {
      await withTimeout(
        worker.init(
          topology,
          rules,
          odMatrix.value,
          idmParams.value,
          mobilParams.value,
          vehicleMix.value,
          sharedBuffer as SharedArrayBuffer,
        ),
        WORKER_RPC_TIMEOUT,
        'init',
      )
      await withTimeout(worker.start(), WORKER_RPC_TIMEOUT, 'start')
      state.value = 'RUNNING'
      lastTickAt = performance.now()
      storeEventBus.emit('simulation:started', {})
      storeEventBus.emit('simulation:state-changed', { running: true })
    } catch (err) {
      // Roll back to IDLE on init/start failure
      state.value = 'IDLE'
      storeEventBus.emit('simulation:state-changed', { running: false })
      throw err
    }
  }

  async function pause(): Promise<void> {
    try {
      await withTimeout(worker?.pause() ?? Promise.resolve(), WORKER_RPC_TIMEOUT, 'pause')
      state.value = 'PAUSED'
      storeEventBus.emit('simulation:paused', {})
      storeEventBus.emit('simulation:state-changed', { running: false })
    } catch (err) {
      // On pause failure, still set state to PAUSED to prevent runaway simulation
      state.value = 'PAUSED'
      storeEventBus.emit('simulation:state-changed', { running: false })
      throw err
    }
  }

  async function tick(now = performance.now()): Promise<SimulationFrame | null> {
    if (state.value !== 'RUNNING' || !worker) return null
    const dt = Math.min(0.1, Math.max(0.001, ((now - lastTickAt) / 1000) * timeScale.value))
    lastTickAt = now
    try {
      const frame = await withTimeout(worker.tick(dt), WORKER_RPC_TIMEOUT, 'tick')
      currentTime.value = frame.time
      vehicleCount.value = frame.vehicleCount
      stats.value = frame.stats
      if (frame.laneMetrics.length > 0) {
        laneMetrics.value = frame.laneMetrics
        storeEventBus.emit('simulation:metrics-updated', { laneMetrics: frame.laneMetrics })
      }
      storeEventBus.emit('simulation:frame-updated', { frameData: frame })
      return frame
    } catch (err) {
      // On tick failure, pause the simulation to prevent cascading errors
      state.value = 'PAUSED'
      storeEventBus.emit('simulation:state-changed', { running: false })
      throw err
    }
  }

  async function stop(): Promise<void> {
    try {
      await withTimeout(worker?.reset() ?? Promise.resolve(), WORKER_RPC_TIMEOUT, 'reset')
    } catch {
      // Swallow stop errors — we're resetting anyway
    }
    reset()
    storeEventBus.emit('simulation:stopped', {})
    storeEventBus.emit('simulation:state-changed', { running: false })
  }

  function setCurrentTime(t: number): void {
    currentTime.value = t
  }

  function setVehicleCount(n: number): void {
    vehicleCount.value = n
  }

  function setTimeScale(s: number): void {
    timeScale.value = Math.max(0.1, Math.min(10, s))
  }

  function setSimulatedDuration(d: number): void {
    simulatedDuration.value = d
  }

  function setODMatrix(matrix: ODMatrix): void {
    odMatrix.value = matrix
    storeEventBus.emit('simulation:od-matrix-changed', {})
  }

  function setVehicleMix(mix: VehicleMixConfig): void {
    vehicleMix.value = mix
    storeEventBus.emit('simulation:vehicle-mix-changed', {})
  }

  function addODPair(): void {
    odMatrix.value = {
      pairs: [...odMatrix.value.pairs, { fromNodeId: '', toNodeId: '', volumePerHour: 360 }],
    }
  }

  function updateODPair(index: number, patch: Partial<ODMatrix['pairs'][number]>): void {
    odMatrix.value = {
      pairs: odMatrix.value.pairs.map((pair, i) => (i === index ? { ...pair, ...patch } : pair)),
    }
  }

  function removeODPair(index: number): void {
    odMatrix.value = {
      pairs: odMatrix.value.pairs.filter((_, i) => i !== index),
    }
  }

  function setIDMParams(p: Partial<IDMParams>): void {
    idmParams.value = { ...idmParams.value, ...p }
  }

  function setMOBILParams(p: Partial<MOBILParams>): void {
    mobilParams.value = { ...mobilParams.value, ...p }
  }

  function updateStats(s: Partial<SimulationStats>): void {
    stats.value = { ...stats.value, ...s }
  }

  function reset(): void {
    state.value = 'IDLE'
    currentTime.value = 0
    vehicleCount.value = 0
    vehicles.value.clear()
    laneMetrics.value = []
    stats.value = {
      totalVehicles: 0,
      completedVehicles: 0,
      averageSpeed: 0,
      averageDelay: 0,
      maxQueueLength: 0,
      throughput: 0,
    }
    if (vehicleView) vehicleView.fill(0)
  }

  return {
    state, currentTime, simulatedDuration, timeScale, vehicleCount, vehicles,
    odMatrix, idmParams, mobilParams, vehicleMix, stats, laneMetrics, lastLaneMetrics,
    isRunning, progress,
    initSharedBuffer, getSharedBuffer, getVehicleView,
    start, pause, tick, stop,
    /** @alias start — per design doc naming */
    startSimulation: start,
    /** @alias pause — per design doc naming */
    pauseSimulation: pause,
    setState, setCurrentTime, setVehicleCount, setTimeScale, setSimulatedDuration,
    setODMatrix, setVehicleMix, addODPair, updateODPair, removeODPair,
    setIDMParams, setMOBILParams, updateStats, reset,
  }
})
