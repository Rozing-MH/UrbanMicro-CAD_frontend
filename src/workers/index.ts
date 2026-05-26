import * as Comlink from 'comlink'
import type { GeometryWorkerApi } from './geometry.worker'
import type { SimulationWorkerApi } from './simulation.worker'

let geometryWorker: Worker | null = null
let geometryProxy: Comlink.Remote<GeometryWorkerApi> | null = null

let simulationWorker: Worker | null = null
let simulationProxy: Comlink.Remote<SimulationWorkerApi> | null = null

export function getGeometryWorker(): Comlink.Remote<GeometryWorkerApi> {
  if (!geometryProxy) {
    geometryWorker = new Worker(new URL('./geometry.worker.ts', import.meta.url), { type: 'module' })
    geometryProxy = Comlink.wrap<GeometryWorkerApi>(geometryWorker)
  }
  return geometryProxy
}

export function getSimulationWorker(): Comlink.Remote<SimulationWorkerApi> {
  if (!simulationProxy) {
    simulationWorker = new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' })
    simulationProxy = Comlink.wrap<SimulationWorkerApi>(simulationWorker)
  }
  return simulationProxy
}

export function disposeWorkers(): void {
  if (geometryWorker) {
    geometryWorker.terminate()
    geometryWorker = null
    geometryProxy = null
  }
  if (simulationWorker) {
    simulationWorker.terminate()
    simulationWorker = null
    simulationProxy = null
  }
}
