/**
 * evaluationBridge — 纯函数服务，将 SimulationWorker 的车道级指标
 * 聚合为 EvaluationStore 所需的路段/交叉口指标。
 *
 * 数据流：Worker laneStats → LaneMetricSnapshot[] → evaluationBridge → SegmentMetric[] + EvaluationResult[]
 */
import type { LaneMetricSnapshot } from '@/types/simulation'
import type { SegmentMetric, EvaluationResult, LOSGrade } from '@/types/evaluation'
import { delayToLOS } from '@/types/evaluation'
import type { Lane, RoadSegment, RoadNode } from '@/types/road-network'

// ============================================================
// Public Types
// ============================================================

export interface EvaluationBridgeResult {
  segmentMetrics: Array<{ id: string; metric: SegmentMetric }>
  intersectionResults: Array<{ id: string; result: EvaluationResult }>
}

// ============================================================
// Segment Aggregation: Lane → Segment
// ============================================================

/**
 * 将车道级指标按 segmentId 分组聚合为路段级指标。
 *
 * 聚合规则：
 * - avgSpeed: 车辆数加权平均
 * - density: 各车道密度求和（路段总密度）
 * - volume: 各车道 throughput 求和
 * - delay: 车辆数加权平均
 * - los: 由 delay 映射 HCM 分级
 */
export function aggregateLaneToSegment(
  laneMetrics: LaneMetricSnapshot[],
  lanes: Map<string, Lane> | Lane[],
  segments: Map<string, RoadSegment> | RoadSegment[],
): Array<{ id: string; metric: SegmentMetric }> {
  const lanesArray = Array.isArray(lanes) ? lanes : Array.from(lanes.values())
  const segmentsArray = Array.isArray(segments) ? segments : Array.from(segments.values())

  // Build lane → segment lookup
  const laneSegmentMap = new Map<string, string>()
  for (const lane of lanesArray) {
    laneSegmentMap.set(lane.id, lane.segmentId)
  }

  // Segment length lookup (for density calculation)
  const segmentLengthMap = new Map<string, number>()
  for (const seg of segmentsArray) {
    segmentLengthMap.set(seg.id, seg.length ?? 100)
  }

  // Group lane metrics by segmentId
  const segmentGroups = new Map<string, {
    totalVehicleCount: number
    weightedSpeed: number
    sumDensity: number
    sumVolume: number
    weightedDelay: number
    laneCount: number
  }>()

  for (const lm of laneMetrics) {
    const segId = laneSegmentMap.get(lm.laneId)
    if (!segId) continue

    let group = segmentGroups.get(segId)
    if (!group) {
      group = { totalVehicleCount: 0, weightedSpeed: 0, sumDensity: 0, sumVolume: 0, weightedDelay: 0, laneCount: 0 }
      segmentGroups.set(segId, group)
    }

    group.totalVehicleCount += lm.vehicleCount
    group.weightedSpeed += lm.avgSpeed * lm.vehicleCount
    group.sumVolume += lm.throughput
    group.weightedDelay += lm.avgDelay * lm.vehicleCount
    group.laneCount++

    // Per-lane density: vehicles per km
    const segLen = segmentLengthMap.get(segId) ?? 100
    const laneLen = segLen // approximate: each lane ≈ segment length
    const densityPerKm = laneLen > 0 ? (lm.vehicleCount / laneLen) * 1000 : 0
    group.sumDensity += densityPerKm
  }

  const now = Date.now()
  const results: Array<{ id: string; metric: SegmentMetric }> = []

  for (const [segId, g] of segmentGroups) {
    const vc = Math.max(g.totalVehicleCount, 1)
    const avgSpeed = g.weightedSpeed / vc
    const delay = g.weightedDelay / vc
    const los: LOSGrade = delayToLOS(delay)

    results.push({
      id: segId,
      metric: {
        segmentId: segId,
        avgSpeed,
        density: g.sumDensity,
        volume: g.sumVolume,
        delay,
        los,
        updatedAt: now,
      },
    })
  }

  return results
}

// ============================================================
// Intersection Aggregation: Lane → Node LOS
// ============================================================

/**
 * 将车道级指标按交叉口节点分组，计算交叉口 LOS。
 *
 * 规则：
 * - 通过 nodeToLanes 映射确定每个节点关联的车道
 * - averageDelay: 节点关联车道的车辆数加权平均延误
 * - throughput: 节点关联车道的 throughput 之和
 * - queueLength: 节点关联车道的 currentQueueLen 之和
 * - grade: delayToLOS(averageDelay)
 */
export function aggregateLaneToIntersection(
  laneMetrics: LaneMetricSnapshot[],
  /** nodeId → laneId[] mapping */
  nodeToLanes: Map<string, string[]>,
  nodes: Map<string, RoadNode> | RoadNode[],
): Array<{ id: string; result: EvaluationResult }> {
  const nodesArray = Array.isArray(nodes) ? nodes : Array.from(nodes.values())

  // Only compute for actual intersection nodes (≥2 connected segments)
  const intersectionNodeIds = new Set<string>()
  for (const node of nodesArray) {
    if ((node.connectedSegmentIds?.length ?? 0) >= 2) {
      intersectionNodeIds.add(node.id)
    }
  }

  // Build laneId → LaneMetricSnapshot lookup
  const laneMetricMap = new Map<string, LaneMetricSnapshot>()
  for (const lm of laneMetrics) {
    laneMetricMap.set(lm.laneId, lm)
  }

  const now = Date.now()
  const results: Array<{ id: string; result: EvaluationResult }> = []

  for (const nodeId of intersectionNodeIds) {
    const laneIds = nodeToLanes.get(nodeId)
    if (!laneIds || laneIds.length === 0) continue

    let totalVehicleCount = 0
    let weightedDelay = 0
    let throughput = 0
    let queueLength = 0

    for (const lid of laneIds) {
      const lm = laneMetricMap.get(lid)
      if (!lm) continue

      totalVehicleCount += lm.vehicleCount
      weightedDelay += lm.avgDelay * lm.vehicleCount
      throughput += lm.throughput
      queueLength += lm.currentQueueLen
    }

    // Skip nodes with no vehicle data
    if (totalVehicleCount === 0) continue

    const averageDelay = weightedDelay / Math.max(totalVehicleCount, 1)
    const grade = delayToLOS(averageDelay)

    results.push({
      id: nodeId,
      result: {
        nodeId,
        averageDelay,
        grade,
        throughput,
        queueLength,
        updatedAt: now,
      },
    })
  }

  return results
}

// ============================================================
// Top-level Bridge Function
// ============================================================

/** Bridge context: topology data needed for aggregation */
export interface BridgeContext {
  lanes: Map<string, Lane> | Lane[]
  segments: Map<string, RoadSegment> | RoadSegment[]
  nodes: Map<string, RoadNode> | RoadNode[]
  /** nodeId → laneId[] mapping (built from roadNetworkStore) */
  nodeToLanes: Map<string, string[]>
}

/**
 * Top-level bridge: convert worker lane metrics into evaluation store data.
 * Pure function — no side effects, no store access.
 */
export function computeEvaluation(
  laneMetrics: LaneMetricSnapshot[],
  ctx: BridgeContext,
): EvaluationBridgeResult {
  if (laneMetrics.length === 0) {
    return { segmentMetrics: [], intersectionResults: [] }
  }

  const segmentMetrics = aggregateLaneToSegment(laneMetrics, ctx.lanes, ctx.segments)
  const intersectionResults = aggregateLaneToIntersection(laneMetrics, ctx.nodeToLanes, ctx.nodes)

  return { segmentMetrics, intersectionResults }
}
