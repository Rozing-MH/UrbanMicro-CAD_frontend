/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

declare module 'clipper-lib' {
  const ClipperLib: {
    Clipper: new () => {
      AddPaths(paths: number[][][], polyType: number, closed: boolean): void
      Execute(
        clipType: number,
        solution: number[][][],
        fillType?: number,
        subjFillType?: number
      ): boolean
    }
    ClipperOffset: new () => {
      AddPaths(paths: number[][][], joinType: number, endType: number): void
      Execute(solution: number[][][], delta: number): void
    }
    Paths: () => number[][][]
    ClipType: { ctUnion: number; ctIntersection: number; ctDifference: number; ctXor: number }
    PolyType: { ptSubject: number; ptClip: number }
    PolyFillType: { pftEvenOdd: number; pftNonZero: number; pftPositive: number; pftNegative: number }
    JoinType: { jtSquare: number; jtRound: number; jtMiter: number }
    EndType: { etClosedPolygon: number; etOpenSquare: number; etOpenRound: number; etOpenButt: number }
    JS: {
      ScaleUpPaths(paths: number[][][], scale: number): number[][][]
      ScaleDownPaths(paths: number[][][], scale: number): number[][][]
    }
  }
  export = ClipperLib
}

declare module 'bezier-js' {
  export class Bezier {
    constructor(
      p1x: number, p1y: number,
      p2x: number, p2y: number,
      p3x: number, p3y: number,
      p4x?: number, p4y?: number
    )
    getLUT(steps?: number): Array<{ x: number; y: number }>
    get(t: number): { x: number; y: number }
    length(): number
    split(t: number): { left: Bezier; right: Bezier }
    tangent(t: number): { x: number; y: number }
    normal(t: number): { x: number; y: number }
    offset(d: number): Bezier[]
  }
}
