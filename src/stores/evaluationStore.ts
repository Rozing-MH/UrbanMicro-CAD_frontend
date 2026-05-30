import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { LOSGrade, EvaluationResult, HeatmapConfig, SegmentMetric } from '@/types/evaluation'
import { DEFAULT_HEATMAP_STOPS, delayToLOS } from '@/types/evaluation'
import type { LaneMetricSnapshot } from '@/types/simulation'
import { computeEvaluation, type BridgeContext } from '@/services/evaluationBridge'
import { useRoadNetworkStore } from '@/stores/roadNetworkStore'

export type EvalMode = 'NONE' | 'LOS' | 'SPEED' | 'DENSITY' | 'DELAY'

export const useEvaluationStore = defineStore('evaluation', () => {
  const evalMode = ref<EvalMode>('NONE')
  const results = ref<Map<string, EvaluationResult>>(new Map())
  const segmentMetrics = ref<Map<string, SegmentMetric>>(new Map())
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
   * A lane belongs to a node's intersection if its segment is connected to that node.
   */
  function buildNodeToLanes(): Map<string, string[]> {
    const roadStore = useRoadNetworkStore()
    const mapping = new Map<string, string[]>()
    for (const lane of roadStore.lanes.values()) {
      const seg = roadStore.getSegment(lane.segmentId)
      if (!seg) continue
      // Add lane to both start and end nodes of its segment
      for (const nodeId of [seg.startNodeId, seg.endNodeId]) {
        let arr = mapping.get(nodeId)
        if (!arr) {
          arr = []
          mapping.set(nodeId, arr)
        }
        arr.push(lane.id)
      }
    }
    return mapping
  }

  /**
   * Main bridge action: receive lane metrics from simulation,
   * aggregate to segment/intersection level, and update store.
   */
  function updateFromSimulation(laneMetrics: LaneMetricSnapshot[]): void {
    if (laneMetrics.length === 0) return

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
    evalMode.value = 'NONE'
    reportId.value = null
    isComputing.value = false
  }

  return {
    evalMode, results, segmentMetrics, heatmapConfig, reportId, isComputing,
    networkLOS, worstIntersectionId,
    setEvalMode, setResult, setSegmentMetric, bulkSetMetrics,
    setHeatmapConfig, setReportId, setComputing, clear,
    updateFromSimulation,
  }
})
