import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { LOSGrade, EvaluationResult, HeatmapConfig, SegmentMetric } from '@/types/evaluation'
import { DEFAULT_HEATMAP_STOPS, delayToLOS } from '@/types/evaluation'
import type { LaneMetricSnapshot } from '@/types/simulation'
import { computeEvaluation, type BridgeContext } from '@/services/evaluationBridge'
import { useRoadNetworkStore } from '@/stores/roadNetworkStore'
import { storeEventBus } from '@/stores/storeEventBus'
import { exportAllCsv } from '@/services/csvExport'

export type EvalMode = 'NONE' | 'LOS' | 'SPEED' | 'DENSITY' | 'DELAY'

export const useEvaluationStore = defineStore('evaluation', () => {
  const evalMode = ref<EvalMode>('NONE')
  const results = ref<Map<string, EvaluationResult>>(new Map())
  const segmentMetrics = ref<Map<string, SegmentMetric>>(new Map())
  /** Raw per-lane metrics from simulation (laneId → LaneMetricSnapshot) */
  const laneMetricsMap = ref<Map<string, LaneMetricSnapshot>>(new Map())
  const heatmapConfig = ref<HeatmapConfig>({
    mode: 'OFF',
    colorStops: DEFAULT_HEATMAP_STOPS,
    minValue: 0,
    maxValue: 80,
  })
  const reportId = ref<string | null>(null)
  const isComputing = ref(false)

  const networkLOS = computed<LOSGrade | null>(() => {
    if (results.value.size === 0) return null
    let totalDelay = 0
    let count = 0
    for (const r of results.value.values()) {
      totalDelay += r.averageDelay
      count++
    }
    return count > 0 ? delayToLOS(totalDelay / count) : null
  })

  const worstIntersectionId = computed<string | null>(() => {
    let worst: string | null = null
    let maxDelay = -Infinity
    for (const [id, r] of results.value.entries()) {
      if (r.averageDelay > maxDelay) {
        maxDelay = r.averageDelay
        worst = id
      }
    }
    return worst
  })

  function setEvalMode(mode: EvalMode): void {
    evalMode.value = mode
  }

  function setResult(nodeId: string, result: EvaluationResult): void {
    results.value.set(nodeId, result)
  }

  function setSegmentMetric(segId: string, metric: SegmentMetric): void {
    segmentMetrics.value.set(segId, metric)
  }

  function bulkSetMetrics(metrics: Array<{ id: string; metric: SegmentMetric }>): void {
    for (const { id, metric } of metrics) {
      segmentMetrics.value.set(id, metric)
    }
  }

  function setHeatmapConfig(config: Partial<HeatmapConfig>): void {
    heatmapConfig.value = { ...heatmapConfig.value, ...config }
  }

  function setReportId(id: string | null): void {
    reportId.value = id
  }

  function setComputing(c: boolean): void {
    isComputing.value = c
  }

  /**
   * Build nodeId → laneId[] mapping from roadNetworkStore.
   * A lane belongs ONLY to the end node of its segment (the downstream
   * intersection where vehicles actually enter the junction area).
   * This avoids double-counting lane metrics across both endpoints.
   */
  function buildNodeToLanes(): Map<string, string[]> {
    const roadStore = useRoadNetworkStore()
    const mapping = new Map<string, string[]>()
    for (const lane of roadStore.lanes.values()) {
      const seg = roadStore.getSegment(lane.segmentId)
      if (!seg) continue
      // Lane only contributes to the end node (downstream intersection)
      const nodeId = seg.endNodeId
      let arr = mapping.get(nodeId)
      if (!arr) {
        arr = []
        mapping.set(nodeId, arr)
      }
      arr.push(lane.id)
    }
    return mapping
  }

  /**
   * Main bridge action: receive lane metrics from simulation,
   * aggregate to segment/intersection level, and update store.
   */
  function updateFromSimulation(laneMetrics: LaneMetricSnapshot[]): void {
    if (laneMetrics.length === 0) return

    // Preserve raw lane-level metrics for per-lane UI display
    const newLaneMap = new Map<string, LaneMetricSnapshot>()
    for (const lm of laneMetrics) {
      newLaneMap.set(lm.laneId, lm)
    }
    laneMetricsMap.value = newLaneMap

    const roadStore = useRoadNetworkStore()
    const bridgeCtx: BridgeContext = {
      lanes: roadStore.lanes,
      segments: roadStore.segments,
      nodes: roadStore.nodes,
      nodeToLanes: buildNodeToLanes(),
    }

    const result = computeEvaluation(laneMetrics, bridgeCtx)

    // Update segment metrics
    bulkSetMetrics(result.segmentMetrics)

    // Update intersection results
    for (const { id, result: evalResult } of result.intersectionResults) {
      results.value.set(id, evalResult)
    }

    // Trigger reactive update for computed properties
    results.value = new Map(results.value)
    segmentMetrics.value = new Map(segmentMetrics.value)
  }

  function clear(): void {
    results.value.clear()
    segmentMetrics.value.clear()
    laneMetricsMap.value = new Map()
    evalMode.value = 'NONE'
    reportId.value = null
    isComputing.value = false
  }

  /**
   * Subscribe to simulation:metrics-updated event bus.
   * Per design doc: EvaluationStore subscribes to SimulationStore events
   * instead of being called directly from the view layer.
   */
  const onMetricsUpdated = (payload: { laneMetrics: LaneMetricSnapshot[] }): void => {
    updateFromSimulation(payload.laneMetrics)
  }
  storeEventBus.on('simulation:metrics-updated', onMetricsUpdated)

  /**
   * Export all evaluation data as CSV files (local generation, no backend).
   * Per design doc FR6.5: EvaluationStore.exportCSV()
   */
  function exportCSV(): void {
    exportAllCsv({
      segmentMetrics: segmentMetrics.value,
      laneMetrics: laneMetricsMap.value,
      intersectionResults: results.value,
    })
  }

  return {
    evalMode, results, segmentMetrics, laneMetricsMap, heatmapConfig, reportId, isComputing,
    networkLOS, worstIntersectionId,
    setEvalMode, setResult, setSegmentMetric, bulkSetMetrics,
    setHeatmapConfig, setReportId, setComputing, clear,
    updateFromSimulation, exportCSV,
  }
})
