/**
 * csvExport — 纯函数服务，将评估数据导出为 CSV 格式。
 *
 * 对齐设计文档 FR6.5：
 * - 前端本地生成 CSV，包含车辆轨迹、车道指标、延误数据
 * - 不需要后端交互
 */
import type { LaneMetricSnapshot } from '@/types/simulation'
import type { SegmentMetric, EvaluationResult } from '@/types/evaluation'

// ============================================================
// CSV Builder Helpers
// ============================================================

function escapeCsv(value: unknown): string {
  const str = String(value ?? '')
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function toCsvRow(values: unknown[]): string {
  return values.map(escapeCsv).join(',')
}

function downloadBlob(content: string, filename: string, mime = 'text/csv;charset=utf-8'): void {
  const BOM = '﻿'
  const blob = new Blob([BOM + content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ============================================================
// Segment Metrics CSV
// ============================================================

/**
 * 导出路段级指标为 CSV。
 * 列：segmentId, avgSpeed(m/s), density(veh/km), volume(veh/hr), delay(s), LOS
 */
export function exportSegmentMetricsCsv(
  segmentMetrics: Map<string, SegmentMetric>,
): void {
  const header = toCsvRow(['segmentId', 'avgSpeed(m/s)', 'density(veh/km)', 'volume(veh/hr)', 'delay(s)', 'LOS'])
  const rows: string[] = [header]

  for (const metric of segmentMetrics.values()) {
    rows.push(toCsvRow([
      metric.segmentId,
      metric.avgSpeed.toFixed(2),
      metric.density.toFixed(1),
      metric.volume.toFixed(0),
      metric.delay.toFixed(2),
      metric.los,
    ]))
  }

  downloadBlob(rows.join('\n'), `segment_metrics_${Date.now()}.csv`)
}

// ============================================================
// Lane Metrics CSV
// ============================================================

/**
 * 导出车道级指标为 CSV。
 * 列：laneId, vehicleCount, avgSpeed(m/s), throughput(veh/hr), avgDelay(s), maxQueueLen, currentQueueLen, congestionRatio
 */
export function exportLaneMetricsCsv(
  laneMetrics: Map<string, LaneMetricSnapshot>,
): void {
  const header = toCsvRow([
    'laneId', 'vehicleCount', 'avgSpeed(m/s)', 'throughput(veh/hr)',
    'avgDelay(s)', 'maxQueueLen', 'currentQueueLen', 'congestionRatio',
  ])
  const rows: string[] = [header]

  for (const lm of laneMetrics.values()) {
    rows.push(toCsvRow([
      lm.laneId,
      lm.vehicleCount,
      lm.avgSpeed.toFixed(2),
      lm.throughput.toFixed(0),
      lm.avgDelay.toFixed(2),
      lm.maxQueueLen,
      lm.currentQueueLen,
      lm.congestionRatio.toFixed(3),
    ]))
  }

  downloadBlob(rows.join('\n'), `lane_metrics_${Date.now()}.csv`)
}

// ============================================================
// Intersection LOS CSV
// ============================================================

/**
 * 导出交叉口 LOS 评估为 CSV。
 * 列：nodeId, averageDelay(s), LOS, throughput(veh/hr), queueLength, approachCount
 */
export function exportIntersectionLosCsv(
  results: Map<string, EvaluationResult>,
): void {
  const header = toCsvRow([
    'nodeId', 'averageDelay(s)', 'LOS', 'throughput(veh/hr)', 'queueLength', 'approachCount',
  ])
  const rows: string[] = [header]

  for (const result of results.values()) {
    rows.push(toCsvRow([
      result.nodeId,
      result.averageDelay.toFixed(2),
      result.grade,
      result.throughput.toFixed(0),
      result.queueLength,
      result.approachDelays.length,
    ]))
  }

  downloadBlob(rows.join('\n'), `intersection_los_${Date.now()}.csv`)
}

// ============================================================
// All-in-One Export
// ============================================================

export interface CsvExportData {
  segmentMetrics: Map<string, SegmentMetric>
  laneMetrics: Map<string, LaneMetricSnapshot>
  intersectionResults: Map<string, EvaluationResult>
}

/**
 * 一键导出全部评估数据为三个 CSV 文件。
 * 对齐设计文档 EvaluationStore.exportCSV() 行为。
 */
export function exportAllCsv(data: CsvExportData): void {
  if (data.segmentMetrics.size > 0) exportSegmentMetricsCsv(data.segmentMetrics)
  if (data.laneMetrics.size > 0) exportLaneMetricsCsv(data.laneMetrics)
  if (data.intersectionResults.size > 0) exportIntersectionLosCsv(data.intersectionResults)
}
