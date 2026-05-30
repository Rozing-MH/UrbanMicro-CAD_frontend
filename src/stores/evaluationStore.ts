import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { LOSGrade, EvaluationResult, HeatmapConfig, SegmentMetric } from '@/types/evaluation'
import { DEFAULT_HEATMAP_STOPS, delayToLOS } from '@/types/evaluation'
import type { LaneMetricSnapshot } from '@/types/simulation'
import { computeEvaluation, type BridgeContext } from '@/services/evaluationBridge'
import { storeEventBus } from '@/stores/storeEventBus'
import { exportAllCsv } from '@/services/csvExport'
// Lazy accessor — imported here but only called inside actions to avoid
// tight module-level coupling. Pinia factory functions are safe to import;
// they only create the store instance when invoked.
import { useRoadNetworkStore } from '@/stores/roadNetworkStore'

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
    if (id) storeEventBus.emit('evaluation:report-generated', { reportId: id })
  }

  function setComputing(c: boolean): void {
    isComputing.value = c
  }

  /**
   * Build nodeId → laneId[] mapping from lanes and segments.
   * A lane belongs ONLY to the end node of its segment (the downstream
   * intersection where vehicles actually enter the junction area).
   */
  function buildNodeToLanes(
    lanes: Map<string, { id: string; segmentId: string }>,
    segments: Map<string, { endNodeId: string }>,
  ): Map<string, string[]> {
    const mapping = new Map<string, string[]>()
    for (const lane of lanes.values()) {
      const seg = segments.get(lane.segmentId)
      if (!seg) continue
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
   * Accepts optional BridgeContext for decoupled callers;
   * falls back to lazy roadNetworkStore access if not provided.
   */
  function updateFromSimulation(laneMetrics: LaneMetricSnapshot[], ctx?: BridgeContext): void {
    if (laneMetrics.length === 0) return

    // Preserve raw lane-level metrics for per-lane UI display
    const newLaneMap = new Map<string, LaneMetricSnapshot>()
    for (const lm of laneMetrics) {
      newLaneMap.set(lm.laneId, lm)
    }
    laneMetricsMap.value = newLaneMap

    // Lazy accessor — only invoked at call time, not at module init
    let bridgeCtx = ctx
    if (!bridgeCtx) {
      const roadStore = useRoadNetworkStore()
      bridgeCtx = {
        lanes: roadStore.lanes,
        segments: roadStore.segments,
        nodes: roadStore.nodes,
        nodeToLanes: buildNodeToLanes(roadStore.lanes, roadStore.segments),
      }
    } else if (!bridgeCtx.nodeToLanes) {
      bridgeCtx = { ...bridgeCtx, nodeToLanes: buildNodeToLanes(bridgeCtx.lanes as Map<string, { id: string; segmentId: string }>, bridgeCtx.segments as Map<string, { endNodeId: string }>) }
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

  /**
   * Generate a report via backend API.
   * Per design doc: EvaluationStore.generateReport()
   */
  async function generateReport(projectId: string): Promise<string | null> {
    isComputing.value = true
    try {
      const { reportApi } = await import('@/api/reportApi')
      const summary = await reportApi.generate(projectId, {
        segmentMetrics: Object.fromEntries(segmentMetrics.value),
        intersectionResults: Object.fromEntries(results.value),
      })
      reportId.value = summary.id
      storeEventBus.emit('evaluation:report-generated', { reportId: summary.id })
      return summary.id
    } catch {
      return null
    } finally {
      isComputing.value = false
    }
  }

  /**
   * Export evaluation report as PDF via backend API.
   * Per design doc: EvaluationStore.exportPDF()
   */
  async function exportPDF(projectId: string): Promise<Blob | null> {
    try {
      const { reportApi } = await import('@/api/reportApi')
      return await reportApi.exportReport(projectId, 'PDF', {
        segmentMetrics: Object.fromEntries(segmentMetrics.value),
        intersectionResults: Object.fromEntries(results.value),
      })
    } catch {
      return null
    }
  }

  return {
    evalMode, results, segmentMetrics, laneMetricsMap, heatmapConfig, reportId, isComputing,
    networkLOS, worstIntersectionId,
    setEvalMode, setResult, setSegmentMetric, bulkSetMetrics,
    setHeatmapConfig, setReportId, setComputing, clear,
    updateFromSimulation, exportCSV, generateReport, exportPDF,
  }
})
