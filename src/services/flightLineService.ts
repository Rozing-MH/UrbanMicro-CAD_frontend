/**
 * 飞线数据服务 — 对齐设计文档 §4.6 FlightLineData。
 * 从 SimulationStore 的车辆数据 + RoadNetworkStore 的几何数据
 * 生成 FlightLine[] 供 FlightLineRenderer 渲染。
 */
import type { FlightLine } from '@/types/evaluation'
import type { SimVehicle } from '@/types/simulation'

interface LaneGeo {
  id: string
  segmentId: string
  startNodeId: string
  endNodeId: string
}

interface SegmentGeo {
  id: string
  startNodeId: string
  endNodeId: string
  centerLine: { x: number; y: number }[]
  startElevation: number
  endElevation: number
}

interface NodeGeo {
  id: string
  position: { x: number; y: number }
  elevation: number
}

/**
 * 计算车道上 progress 对应的 3D 世界坐标。
 * 使用路段中心线线性插值 + 高程插值。
 */
function interpolateOnSegment(
  segment: SegmentGeo,
  progress: number,
): { x: number; y: number; z: number } {
  const pts = segment.centerLine
  if (pts.length === 0) return { x: 0, y: 0, z: 0 }
  if (pts.length === 1) {
    const z = segment.startElevation + progress * (segment.endElevation - segment.startElevation)
    return { x: pts[0].x, y: z, z: pts[0].y }
  }

  const totalSegs = pts.length - 1
  const t = Math.max(0, Math.min(1, progress))
  const segFloat = t * totalSegs
  const idx = Math.min(Math.floor(segFloat), totalSegs - 1)
  const frac = segFloat - idx

  const p0 = pts[idx]
  const p1 = pts[idx + 1]
  const z = segment.startElevation + t * (segment.endElevation - segment.startElevation)

  return {
    x: p0.x + frac * (p1.x - p0.x),
    y: z,
    z: p0.y + frac * (p1.y - p0.y),
  }
}

/**
 * 构建飞线数据：从仿真车辆数据生成 FlightLine[]。
 * 每辆车生成一条飞线，包含当前位置 + 计划路径。
 *
 * @param vehicles 当前所有仿真车辆
 * @param lanes 车道几何索引
 * @param segments 路段几何索引
 * @param selectedSegmentId 选中的路段（null=不过滤）
 * @param selectedNodeId 选中的节点（null=不过滤）
 */
export function buildFlightLines(
  vehicles: Map<string, SimVehicle>,
  lanes: Map<string, LaneGeo>,
  segments: Map<string, SegmentGeo>,
  selectedSegmentId: string | null,
  selectedNodeId: string | null,
): FlightLine[] {
  const lines: FlightLine[] = []
  const hasFilter = selectedSegmentId !== null || selectedNodeId !== null

  for (const veh of vehicles.values()) {
    // If a segment/node filter is active, only include vehicles on related lanes
    if (hasFilter) {
      const lane = lanes.get(veh.currentLaneId)
      if (!lane) continue
      const seg = segments.get(lane.segmentId)
      if (!seg) continue

      const matchesSegment = selectedSegmentId !== null && lane.segmentId === selectedSegmentId
      const matchesNode = selectedNodeId !== null &&
        (seg.startNodeId === selectedNodeId || seg.endNodeId === selectedNodeId)

      if (!matchesSegment && !matchesNode) continue
    }

    const polyline = buildVehiclePolyline(veh, lanes, segments)
    if (polyline.length < 2) continue

    lines.push({
      vehicleId: veh.id,
      vehicleType: veh.type,
      polyline,
      color: [0.6, 0.8, 1.0],
      alpha: 0.7,
    })
  }

  return lines
}

/**
 * 构建单辆车的飞线轨迹点。
 * 包含：当前位置点 + plannedRoute 剩余路径点。
 */
function buildVehiclePolyline(
  veh: SimVehicle,
  lanes: Map<string, LaneGeo>,
  segments: Map<string, SegmentGeo>,
): { x: number; y: number; z: number }[] {
  const points: { x: number; y: number; z: number }[] = []

  // Current position
  const curLane = lanes.get(veh.currentLaneId)
  if (!curLane) return points
  const curSeg = segments.get(curLane.segmentId)
  if (!curSeg) return points

  points.push(interpolateOnSegment(curSeg, veh.progress))

  // Planned route points (from remaining route waypoints)
  const remainingRoute = veh.plannedRoute.slice(veh.currentRouteIndex)
  for (const waypoint of remainingRoute) {
    const wLane = lanes.get(waypoint.laneId)
    if (!wLane) continue
    const wSeg = segments.get(wLane.segmentId)
    if (!wSeg) continue
    // Use midpoint of lane as a representative point
    points.push(interpolateOnSegment(wSeg, 0.5))
  }

  return points
}
