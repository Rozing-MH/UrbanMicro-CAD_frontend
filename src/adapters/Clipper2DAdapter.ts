import ClipperLib from 'clipper-lib'
import type { Point2D } from '@/types/road-network'

const SCALE = 1000

function toClipperPath(pts: Point2D[]): number[][] {
  return pts.map((p) => [Math.round(p.x * SCALE), Math.round(p.y * SCALE)])
}

function fromClipperPath(path: number[][]): Point2D[] {
  return path.map((p) => ({ x: p[0] / SCALE, y: p[1] / SCALE }))
}

export function offsetPolygon(polygon: Point2D[], delta: number): Point2D[][] {
  const scaled = ClipperLib.JS.ScaleUpPaths([toClipperPath(polygon)], 1)
  const solution: number[][][] = new (ClipperLib.Paths as unknown as new () => number[][][])()
  const co = new ClipperLib.ClipperOffset()
  co.AddPaths(scaled, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon)
  co.Execute(solution, delta * SCALE)
  return solution.map(fromClipperPath)
}

export function unionPolygons(subjects: Point2D[][], clips: Point2D[][]): Point2D[][] {
  const toClipper = (polys: Point2D[][]) => polys.map(toClipperPath)
  const solution: number[][][] = new (ClipperLib.Paths as unknown as new () => number[][][])()
  const clipper = new ClipperLib.Clipper()
  clipper.AddPaths(toClipper(subjects), ClipperLib.PolyType.ptSubject, true)
  clipper.AddPaths(toClipper(clips), ClipperLib.PolyType.ptClip, true)
  clipper.Execute(
    ClipperLib.ClipType.ctUnion,
    solution,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  )
  return solution.map(fromClipperPath)
}

export function differencePolygons(subjects: Point2D[][], clips: Point2D[][]): Point2D[][] {
  const toClipper = (polys: Point2D[][]) => polys.map(toClipperPath)
  const solution: number[][][] = new (ClipperLib.Paths as unknown as new () => number[][][])()
  const clipper = new ClipperLib.Clipper()
  clipper.AddPaths(toClipper(subjects), ClipperLib.PolyType.ptSubject, true)
  clipper.AddPaths(toClipper(clips), ClipperLib.PolyType.ptClip, true)
  clipper.Execute(
    ClipperLib.ClipType.ctDifference,
    solution,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  )
  return solution.map(fromClipperPath)
}

export function buildRoadPolygon(centerLine: Point2D[], halfWidth: number): Point2D[] {
  const results = offsetPolygon(centerLine, halfWidth)
  return results[0] ?? []
}
