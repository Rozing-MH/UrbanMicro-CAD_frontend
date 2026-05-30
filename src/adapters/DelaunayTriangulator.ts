import { Delaunay } from 'd3-delaunay'
import type { Point2D, MeshData } from '@/types/road-network'

export function triangulatePolygon(polygon: Point2D[], elevation = 0): MeshData {
  if (polygon.length < 3) {
    return {
      positions: new Float32Array(0),
      indices: new Uint32Array(0),
      uvs: new Float32Array(0),
      normals: new Float32Array(0),
    }
  }

  const flat = new Float64Array(polygon.length * 2)
  for (let i = 0; i < polygon.length; i++) {
    flat[i * 2] = polygon[i].x
    flat[i * 2 + 1] = polygon[i].y
  }

  const delaunay = new Delaunay(flat)
  const triangles = delaunay.triangles

  const positions = new Float32Array(polygon.length * 3)
  const normals = new Float32Array(polygon.length * 3)
  const uvs = new Float32Array(polygon.length * 2)

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const p of polygon) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  const sizeX = maxX - minX || 1
  const sizeY = maxY - minY || 1

  for (let i = 0; i < polygon.length; i++) {
    positions[i * 3] = polygon[i].x
    positions[i * 3 + 1] = elevation
    positions[i * 3 + 2] = polygon[i].y
    normals[i * 3] = 0
    normals[i * 3 + 1] = 1
    normals[i * 3 + 2] = 0
    uvs[i * 2] = (polygon[i].x - minX) / sizeX
    uvs[i * 2 + 1] = (polygon[i].y - minY) / sizeY
  }

  const indices = new Uint32Array(triangles.length)
  for (let i = 0; i < triangles.length; i += 3) {
    // Flip winding for Three.js (y-up)
    indices[i] = triangles[i]
    indices[i + 1] = triangles[i + 2]
    indices[i + 2] = triangles[i + 1]
  }

  return { positions, indices, uvs, normals }
}

export function triangulateRibbon(leftEdge: Point2D[], rightEdge: Point2D[], elevation = 0): MeshData {
  const count = Math.min(leftEdge.length, rightEdge.length)
  if (count < 2) {
    return {
      positions: new Float32Array(0),
      indices: new Uint32Array(0),
      uvs: new Float32Array(0),
      normals: new Float32Array(0),
    }
  }

  const vertexCount = count * 2
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  const indices = new Uint32Array((count - 1) * 6)

  for (let i = 0; i < count; i++) {
    const l = leftEdge[i]
    const r = rightEdge[i]
    const li = i * 2
    const ri = i * 2 + 1

    positions[li * 3] = l.x
    positions[li * 3 + 1] = elevation
    positions[li * 3 + 2] = l.y
    positions[ri * 3] = r.x
    positions[ri * 3 + 1] = elevation
    positions[ri * 3 + 2] = r.y

    normals[li * 3 + 1] = 1
    normals[ri * 3 + 1] = 1

    const t = i / (count - 1)
    uvs[li * 2] = 0
    uvs[li * 2 + 1] = t
    uvs[ri * 2] = 1
    uvs[ri * 2 + 1] = t
  }

  for (let i = 0; i < count - 1; i++) {
    const a = i * 2
    const b = i * 2 + 1
    const c = (i + 1) * 2
    const d = (i + 1) * 2 + 1
    const idx = i * 6
    indices[idx] = a
    indices[idx + 1] = c
    indices[idx + 2] = b
    indices[idx + 3] = b
    indices[idx + 4] = c
    indices[idx + 5] = d
  }

  return { positions, indices, uvs, normals }
}
