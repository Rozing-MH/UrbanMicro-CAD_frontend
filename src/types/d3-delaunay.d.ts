declare module 'd3-delaunay' {
  export class Delaunay {
    constructor(points: Float64Array | number[])
    readonly points: Float64Array | number[]
    readonly triangles: Uint32Array
    readonly hull: Uint32Array
    readonly halfedges: Int32Array
    readonly inedges: Int32Array
    static from(
      points: Iterable<[number, number]>,
      fx?: (d: [number, number]) => number,
      fy?: (d: [number, number]) => number,
    ): Delaunay
    voronoi(bounds?: [number, number, number, number]): Voronoi
    neighbors(i: number): Iterable<number>
    find(x: number, y: number, i?: number): number
  }

  export class Voronoi {
    readonly delaunay: Delaunay
    readonly circumcenters: Float64Array
    readonly vectors: Float64Array
    readonly xmin: number
    readonly ymin: number
    readonly xmax: number
    readonly ymax: number
    cellPolygon(i: number): Array<[number, number]> | null
    cellPolygons(): IterableIterator<Array<[number, number]>>
    contains(i: number, x: number, y: number): boolean
    neighbors(i: number): Iterable<number>
  }
}
