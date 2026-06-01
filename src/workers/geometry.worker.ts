import { expose } from 'comlink'
import { triangulatePolygon, triangulateRibbon } from '@/adapters/DelaunayTriangulator'
import { offsetPolygon, unionPolygons, buildRoadPolygon } from '@/adapters/Clipper2DAdapter'
import { buildQuadraticCenterLine, offsetCenterLine, approximateCurveLength } from '@/adapters/BezierJsAdapter'
import type { Point2D, MeshData } from '@/types/road-network'
import { buildMergedCoonsPatchMesh, type SubPatchCurves } from '@/services/coonsPatchBuilder'

const geometryApi = {
  buildRoadMesh(
    centerLine: Point2D[],
    halfWidth: number,
    elevation: number,
  ): MeshData {
    const leftEdge = offsetCenterLine(centerLine, halfWidth, 'left')
    const rightEdge = offsetCenterLine(centerLine, halfWidth, 'right')
    return triangulateRibbon(leftEdge, rightEdge, elevation)
  },

  buildIntersectionMesh(polygon: Point2D[], elevation: number): MeshData {
    return triangulatePolygon(polygon, elevation)
  },

  buildCurveCenterLine(
    start: Point2D,
    control: Point2D,
    end: Point2D,
    steps: number,
  ): Point2D[] {
    return buildQuadraticCenterLine(start, control, end, steps)
  },

  offsetPolygon(polygon: Point2D[], delta: number): Point2D[][] {
    return offsetPolygon(polygon, delta)
  },

  mergeIntersectionPolygons(subjects: Point2D[][], clips: Point2D[][]): Point2D[][] {
    return unionPolygons(subjects, clips)
  },

  measureLength(points: Point2D[]): number {
    return approximateCurveLength(points)
  },

  buildRoadPolygon(centerLine: Point2D[], halfWidth: number): Point2D[] {
    return buildRoadPolygon(centerLine, halfWidth)
  },

  /** FR2.2: 构建 Coons Patch 曲面网格 */
  buildCoonsPatchMesh(
    subPatchCurves: SubPatchCurves[],
    uDiv: number = 8,
    vDiv: number = 8,
  ): MeshData {
    return buildMergedCoonsPatchMesh(subPatchCurves, uDiv, vDiv)
  },
}

expose(geometryApi)

export type GeometryWorkerApi = typeof geometryApi
