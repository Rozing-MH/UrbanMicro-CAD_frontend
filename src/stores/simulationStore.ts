import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  SimVehicle,
  ODMatrix,
  IDMParams,
  MOBILParams,
  SimulationStats,
} from '@/types/simulation'
import {
  DEFAULT_IDM,
  DEFAULT_MOBIL,
  DEFAULT_VEHICLE_MIX,
  VEHICLE_BUFFER_STRIDE,
  MAX_VEHICLES,
} from '@/types/simulation'

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

  let sharedBuffer: SharedArrayBuffer | null = null
  let vehicleView: Float32Array | null = null

  const isRunning = computed(() => state.value === 'RUNNING')
  const progress = computed(() =>
    simulatedDuration.value > 0 ? currentTime.value / simulatedDuration.value : 0,
  )

  function initSharedBuffer(): SharedArrayBuffer {
    const byteLength = MAX_VEHICLES * VEHICLE_BUFFER_STRIDE * 4
    sharedBuffer = new SharedArrayBuffer(byteLength)
    vehicleView = new Float32Array(sharedBuffer)
    return sharedBuffer
  }

  function getSharedBuffer(): SharedArrayBuffer | null {
    return sharedBuffer
  }

  function getVehicleView(): Float32Array | null {
    return vehicleView
  }

  function setState(s: SimState): void {
    state.value = s
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
    stats.value = {
      totalVehicles: 0,
      completedVehicles: 0,
      averageSpeed: 0,
      averageDelay: 0,
      maxQueueLength: 0,
      throughput: 0,
    }
  }

  return {
    state, currentTime, simulatedDuration, timeScale, vehicleCount, vehicles,
    odMatrix, idmParams, mobilParams, vehicleMix, stats,
    isRunning, progress,
    initSharedBuffer, getSharedBuffer, getVehicleView,
    setState, setCurrentTime, setVehicleCount, setTimeScale, setSimulatedDuration,
    setODMatrix, setIDMParams, setMOBILParams, updateStats, reset,
  }
})
