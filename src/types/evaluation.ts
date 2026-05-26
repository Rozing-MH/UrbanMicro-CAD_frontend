export interface LaneMetrics {
  laneId: string
  volume: number
  averageSpeed: number
  density: number
  maxQueueLength: number
  congestionRatio: number
  sampleCount: number
  updatedAt: number
}

export type LOSGrade = 'A' | 'B' | 'C' | 'D' | 'E' | 'F'

export interface IntersectionLOS {
  nodeId: string
  averageDelay: number
  grade: LOSGrade
  approachDelays: { fromSegmentId: string; delay: number }[]
}

export const LOS_THRESHOLDS: { grade: LOSGrade; max: number }[] = [
  { grade: 'A', max: 10 },
  { grade: 'B', max: 20 },
  { grade: 'C', max: 35 },
  { grade: 'D', max: 55 },
  { grade: 'E', max: 80 },
  { grade: 'F', max: Infinity },
]

export function delayToLOS(delay: number): LOSGrade {
  for (const { grade, max } of LOS_THRESHOLDS) {
    if (delay <= max) return grade
  }
  return 'F'
}

export type HeatmapMode = 'OFF' | 'VOLUME' | 'SPEED' | 'CONGESTION'

export interface HeatmapConfig {
  mode: HeatmapMode
  minValue: number
  maxValue: number
  colorStops: { value: number; color: [number, number, number] }[]
}

export const DEFAULT_HEATMAP_STOPS = [
  { value: 0.0, color: [0.0, 0.8, 0.0] as [number, number, number] },
  { value: 0.5, color: [1.0, 1.0, 0.0] as [number, number, number] },
  { value: 1.0, color: [1.0, 0.0, 0.0] as [number, number, number] },
]

export interface FlightLine {
  vehicleId: string
  vehicleType: string
  polyline: { x: number; y: number; z: number }[]
  color: [number, number, number]
  alpha: number
}

export interface FlightLineFilter {
  selectedSegmentId: string | null
  selectedNodeId: string | null
  vehicleTypeFilter: string[]
  enabled: boolean
}

export interface ReportExportRequest {
  projectId: string
  format: 'CSV' | 'PDF'
  includeHeatmapSnapshot: boolean
  includeLOSTable: boolean
  includeVehicleTrajectories: boolean
}
