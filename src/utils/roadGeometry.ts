import { getGeometryWorker } from '@/workers'
import type {
  CrossSectionProfile,
  ElevationProfile,
  MeshData,
  Point2D,
  RoadSegment,
} from '@/types/road-network'
import { buildQuadraticCenterLine, approximateCurveLength } from '@/adapters/BezierJsAdapter'

export function calculatePolylineLength(points: Point2D[]): number {
  let length = 0
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  }
  return length
}

export function buildFallbackRoadMesh(
  centerLine: Point2D[],
  profile: CrossSectionProfile,
  elevation: number,
): MeshData {
  if (centerLine.length <= 2) {
    const start = centerLine[0]
    const end = centerLine[centerLine.length - 1]
    const halfWidth = profile.totalWidth / 2
    const dx = end.x - start.x
    const dy = end.y - start.y
    const len = Math.hypot(dx, dy) || 1
    const nx = -dy / len
    const ny = dx / len
    const positions = new Float32Array([
      start.x + nx * halfWidth, elevation, start.y + ny * halfWidth,
      start.x - nx * halfWidth, elevation, start.y - ny * halfWidth,
      end.x + nx * halfWidth, elevation, end.y + ny * halfWidth,
      end.x - nx * halfWidth, elevation, end.y - ny * halfWidth,
    ])
    return {
      positions,
      indices: new Uint32Array([0, 1, 2, 2, 1, 3]),
      uvs: new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
      normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
    }
  }

  const halfWidth = profile.totalWidth / 2
  const vertCount = centerLine.length * 2
  const positions = new Float32Array(vertCount * 3)
  const uvs = new Float32Array(vertCount * 2)
  const normals = new Float32Array(vertCount * 3)
  const indices: number[] = []
  const totalLen = calculatePolylineLength(centerLine)

  for (let i = 0; i < centerLine.length; i++) {
    let nx: number, ny: number
    if (i === 0) {
      nx = centerLine[1].x - centerLine[0].x
      ny = centerLine[1].y - centerLine[0].y
    } else if (i === centerLine.length - 1) {
      nx = centerLine[i].x - centerLine[i - 1].x
      ny = centerLine[i].y - centerLine[i - 1].y
    } else {
      nx = centerLine[i + 1].x - centerLine[i - 1].x
      ny = centerLine[i + 1].y - centerLine[i - 1].y
    }
    const segLen = Math.hypot(nx, ny) || 1
    const perpX = -ny / segLen
    const perpY = nx / segLen

    const leftIdx = i * 2
    const rightIdx = i * 2 + 1
    positions[leftIdx * 3] = centerLine[i].x + perpX * halfWidth
    positions[leftIdx * 3 + 1] = elevation
    positions[leftIdx * 3 + 2] = centerLine[i].y + perpY * halfWidth
    positions[rightIdx * 3] = centerLine[i].x - perpX * halfWidth
    positions[rightIdx * 3 + 1] = elevation
    positions[rightIdx * 3 + 2] = centerLine[i].y - perpY * halfWidth

    const v = totalLen > 0 ? calculatePolylineLength(centerLine.slice(0, i + 1)) / totalLen : 0
    uvs[leftIdx * 2] = v
    uvs[leftIdx * 2 + 1] = 0
    uvs[rightIdx * 2] = v
    uvs[rightIdx * 2 + 1] = 1

    normals[leftIdx * 3] = 0
    normals[leftIdx * 3 + 1] = 1
    normals[leftIdx * 3 + 2] = 0
    normals[rightIdx * 3] = 0
    normals[rightIdx * 3 + 1] = 1
    normals[rightIdx * 3 + 2] = 0

    if (i < centerLine.length - 1) {
      const li = i * 2
      const ri = i * 2 + 1
      const nli = (i + 1) * 2
      const nri = (i + 1) * 2 + 1
      indices.push(li, ri, nli, nli, ri, nri)
    }
  }

  return {
    positions,
    indices: new Uint32Array(indices),
    uvs,
    normals,
  }
}

export async function buildSegmentGeometry(
  centerLine: Point2D[],
  profile: CrossSectionProfile,
  elevation: number,
): Promise<MeshData> {
  try {
    return await getGeometryWorker().buildRoadMesh(centerLine, profile.totalWidth / 2, elevation)
  } catch {
    return buildFallbackRoadMesh(centerLine, profile, elevation)
  }
}

export function offsetPolyline(points: Point2D[], offset: number): Point2D[] {
  if (points.length < 2) return points.map((point) => ({ ...point }))
  const first = points[0]
  const last = points[points.length - 1]
  const dx = last.x - first.x
  const dy = last.y - first.y
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  return points.map((point) => ({
    x: point.x + nx * offset,
    y: point.y + ny * offset,
  }))
}

export function createSegmentFromPoints(params: {
  id: string
  startNodeId: string
  endNodeId: string
  centerLine: Point2D[]
  profile: CrossSectionProfile
  elevation: ElevationProfile
  isCurved?: boolean
  controlPoint?: Point2D
  meshData?: MeshData
}): RoadSegment {
  return {
    id: params.id,
    startNodeId: params.startNodeId,
    endNodeId: params.endNodeId,
    centerLine: params.centerLine,
    profile: params.profile,
    elevation: params.elevation,
    isCurved: params.isCurved ?? false,
    controlPoint: params.controlPoint,
    length: calculatePolylineLength(params.centerLine),
    meshData: params.meshData,
  }
}

export function rebuildCurvedCenterLine(seg: RoadSegment, startPos: Point2D, endPos: Point2D): Point2D[] {
  if (!seg.controlPoint) return [startPos, endPos]
  return buildQuadraticCenterLine(startPos, seg.controlPoint, endPos, 32)
}

