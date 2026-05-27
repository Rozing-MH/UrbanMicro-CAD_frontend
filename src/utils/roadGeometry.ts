import { getGeometryWorker } from '@/workers'
import type {
  CrossSectionProfile,
  ElevationProfile,
  MeshData,
  Point2D,
  RoadSegment,
} from '@/types/road-network'

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
  const start = centerLine[0]
  const end = centerLine[centerLine.length - 1]
  const halfWidth = profile.totalWidth / 2
  const dx = end.x - start.x
  const dy = end.y - start.y
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const vertices = new Float32Array([
    start.x + nx * halfWidth, elevation, start.y + ny * halfWidth,
    start.x - nx * halfWidth, elevation, start.y - ny * halfWidth,
    end.x + nx * halfWidth, elevation, end.y + ny * halfWidth,
    end.x - nx * halfWidth, elevation, end.y - ny * halfWidth,
  ])
  return {
    vertices,
    indices: new Uint32Array([0, 1, 2, 2, 1, 3]),
    uvs: new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
    normals: new Float32Array([
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
    ]),
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
    length: calculatePolylineLength(params.centerLine),
    meshData: params.meshData,
  }
}

