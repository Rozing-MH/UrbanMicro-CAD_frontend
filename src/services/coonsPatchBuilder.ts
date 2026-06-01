/**
 * Coons Patch 曲面构建器 — 对齐设计文档 §4.2.2 CoonsPatchBuilder
 *
 * 纯函数服务，无 Vue/Pinia/Three.js 依赖。
 * 实现双线性 Coons Patch 曲面求值，生成 MeshData（positions/normals/uvs/indices）。
 *
 * 算法：
 *   双线性 Coons Patch:
 *   S(u,v) = (1-v)·C₀(u) + v·C₁(u) + (1-u)·D₀(v) + u·D₁(v)
 *            - [(1-u)(1-v)·P₀₀ + u(1-v)·P₁₀ + (1-u)v·P₀₁ + uv·P₁₁]
 *
 *   法线：N = normalize(∂S/∂u × ∂S/∂v)
 */

import type { Point3D, MeshData } from '@/types/road-network'
import type { CubicBezierCurve } from '@/services/tangentHandleService'

// ============================================================
// Bezier 曲线求值
// ============================================================

/**
 * 三次 Bezier 曲线求值
 * B(t) = (1-t)³·P₀ + 3(1-t)²t·P₁ + 3(1-t)t²·P₂ + t³·P₃
 */
function evaluateCubicBezier(curve: CubicBezierCurve, t: number): Point3D {
  const mt = 1 - t
  const mt2 = mt * mt
  const mt3 = mt2 * mt
  const t2 = t * t
  const t3 = t2 * t

  return {
    x: mt3 * curve.p0.x + 3 * mt2 * t * curve.p1.x + 3 * mt * t2 * curve.p2.x + t3 * curve.p3.x,
    y: mt3 * curve.p0.y + 3 * mt2 * t * curve.p1.y + 3 * mt * t2 * curve.p2.y + t3 * curve.p3.y,
    z: mt3 * curve.p0.z + 3 * mt2 * t * curve.p1.z + 3 * mt * t2 * curve.p2.z + t3 * curve.p3.z,
  }
}

/**
 * 三次 Bezier 曲线切线（一阶导数）
 * B'(t) = 3(1-t)²·(P₁-P₀) + 6(1-t)t·(P₂-P₁) + 3t²·(P₃-P₂)
 */
function evaluateCubicBezierDerivative(curve: CubicBezierCurve, t: number): Point3D {
  const mt = 1 - t
  const mt2 = mt * mt
  const t2 = t * t

  return {
    x: 3 * mt2 * (curve.p1.x - curve.p0.x)
      + 6 * mt * t * (curve.p2.x - curve.p1.x)
      + 3 * t2 * (curve.p3.x - curve.p2.x),
    y: 3 * mt2 * (curve.p1.y - curve.p0.y)
      + 6 * mt * t * (curve.p2.y - curve.p1.y)
      + 3 * t2 * (curve.p3.y - curve.p2.y),
    z: 3 * mt2 * (curve.p1.z - curve.p0.z)
      + 6 * mt * t * (curve.p2.z - curve.p1.z)
      + 3 * t2 * (curve.p3.z - curve.p2.z),
  }
}

// ============================================================
// Coons Patch 核心算法
// ============================================================

/**
 * 双线性 Coons Patch 单点求值。
 *
 * @param c0  下边界曲线 C₀(u) — u 从 0→1
 * @param c1  上边界曲线 C₁(u) — u 从 0→1
 * @param d0  左边界曲线 D₀(v) — v 从 0→1
 * @param d1  右边界曲线 D₁(v) — v 从 0→1
 * @param u   参数 u ∈ [0, 1]
 * @param v   参数 v ∈ [0, 1]
 * @returns 曲面上的点 (x, y, z)
 */
export function evaluateCoonsSurface(
  c0: CubicBezierCurve,
  c1: CubicBezierCurve,
  d0: CubicBezierCurve,
  d1: CubicBezierCurve,
  u: number,
  v: number,
): Point3D {
  // 双线性插值部分
  const c0Val = evaluateCubicBezier(c0, u)
  const c1Val = evaluateCubicBezier(c1, u)
  const d0Val = evaluateCubicBezier(d0, v)
  const d1Val = evaluateCubicBezier(d1, v)

  // 角点
  const p00 = evaluateCubicBezier(c0, 0) // = d0(0)
  const p10 = evaluateCubicBezier(c0, 1) // = d1(0)
  const p01 = evaluateCubicBezier(c1, 0) // = d0(1)
  const p11 = evaluateCubicBezier(c1, 1) // = d1(1)

  // Coons Patch 公式
  return {
    x:
      (1 - v) * c0Val.x + v * c1Val.x
      + (1 - u) * d0Val.x + u * d1Val.x
      - ((1 - u) * (1 - v) * p00.x + u * (1 - v) * p10.x + (1 - u) * v * p01.x + u * v * p11.x),
    y:
      (1 - v) * c0Val.y + v * c1Val.y
      + (1 - u) * d0Val.y + u * d1Val.y
      - ((1 - u) * (1 - v) * p00.y + u * (1 - v) * p10.y + (1 - u) * v * p01.y + u * v * p11.y),
    z:
      (1 - v) * c0Val.z + v * c1Val.z
      + (1 - u) * d0Val.z + u * d1Val.z
      - ((1 - u) * (1 - v) * p00.z + u * (1 - v) * p10.z + (1 - u) * v * p01.z + u * v * p11.z),
  }
}

/**
 * Coons Patch 偏导数 ∂S/∂u（数值差分）
 */
function evaluatePartialU(
  c0: CubicBezierCurve,
  c1: CubicBezierCurve,
  d0: CubicBezierCurve,
  d1: CubicBezierCurve,
  u: number,
  v: number,
): Point3D {
  const eps = 1e-4
  const u0 = Math.max(0, u - eps)
  const u1 = Math.min(1, u + eps)
  const s0 = evaluateCoonsSurface(c0, c1, d0, d1, u0, v)
  const s1 = evaluateCoonsSurface(c0, c1, d0, d1, u1, v)
  const invD = 1 / (u1 - u0)
  return { x: (s1.x - s0.x) * invD, y: (s1.y - s0.y) * invD, z: (s1.z - s0.z) * invD }
}

/**
 * Coons Patch 偏导数 ∂S/∂v（数值差分）
 */
function evaluatePartialV(
  c0: CubicBezierCurve,
  c1: CubicBezierCurve,
  d0: CubicBezierCurve,
  d1: CubicBezierCurve,
  u: number,
  v: number,
): Point3D {
  const eps = 1e-4
  const v0 = Math.max(0, v - eps)
  const v1 = Math.min(1, v + eps)
  const s0 = evaluateCoonsSurface(c0, c1, d0, d1, u, v0)
  const s1 = evaluateCoonsSurface(c0, c1, d0, d1, u, v1)
  const invD = 1 / (v1 - v0)
  return { x: (s1.x - s0.x) * invD, y: (s1.y - s0.y) * invD, z: (s1.z - s0.z) * invD }
}

/**
 * 计算曲面法线 N = normalize(∂S/∂u × ∂S/∂v)
 */
function computeNormal(
  c0: CubicBezierCurve,
  c1: CubicBezierCurve,
  d0: CubicBezierCurve,
  d1: CubicBezierCurve,
  u: number,
  v: number,
): Point3D {
  const du = evaluatePartialU(c0, c1, d0, d1, u, v)
  const dv = evaluatePartialV(c0, c1, d0, d1, u, v)

  // 叉积 du × dv
  const nx = du.y * dv.z - du.z * dv.y
  const ny = du.z * dv.x - du.x * dv.z
  const nz = du.x * dv.y - du.y * dv.x

  const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
  if (len < 1e-10) return { x: 0, y: 1, z: 0 }

  return { x: nx / len, y: ny / len, z: nz / len }
}

// ============================================================
// MeshData 生成
// ============================================================

/** 子 Patch 的 4 条边界曲线：[C0, C1, D0, D1] */
export type SubPatchCurves = [CubicBezierCurve, CubicBezierCurve, CubicBezierCurve, CubicBezierCurve]

/**
 * 构建单个 Coons 子 Patch 的 MeshData。
 *
 * @param curves  4 条边界曲线 [C0, C1, D0, D1]
 * @param uDiv    u 方向细分数
 * @param vDiv    v 方向细分数
 * @returns MeshData（positions/normals/uvs/indices）
 */
export function buildCoonsPatchMesh(
  curves: SubPatchCurves,
  uDiv: number = 8,
  vDiv: number = 8,
): MeshData {
  const [c0, c1, d0, d1] = curves
  const vertexCount = (uDiv + 1) * (vDiv + 1)
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)

  // 生成顶点
  let vIdx = 0
  let uvIdx = 0
  for (let iv = 0; iv <= vDiv; iv++) {
    const v = iv / vDiv
    for (let iu = 0; iu <= uDiv; iu++) {
      const u = iu / uDiv

      const pos = evaluateCoonsSurface(c0, c1, d0, d1, u, v)
      const norm = computeNormal(c0, c1, d0, d1, u, v)

      positions[vIdx] = pos.x
      positions[vIdx + 1] = pos.y
      positions[vIdx + 2] = pos.z

      normals[vIdx] = norm.x
      normals[vIdx + 1] = norm.y
      normals[vIdx + 2] = norm.z

      uvs[uvIdx] = u
      uvs[uvIdx + 1] = v

      vIdx += 3
      uvIdx += 2
    }
  }

  // 生成索引（三角面片）
  const indexCount = uDiv * vDiv * 6
  const indices = new Uint32Array(indexCount)
  let iIdx = 0

  for (let iv = 0; iv < vDiv; iv++) {
    for (let iu = 0; iu < uDiv; iu++) {
      const a = iv * (uDiv + 1) + iu
      const b = a + 1
      const c = a + (uDiv + 1)
      const d = c + 1

      // 两个三角形（注意 Y-up 坐标系的绕序）
      indices[iIdx++] = a
      indices[iIdx++] = c
      indices[iIdx++] = b

      indices[iIdx++] = b
      indices[iIdx++] = c
      indices[iIdx++] = d
    }
  }

  return { positions, normals, uvs, indices }
}

/**
 * 构建多个子 Patch 组合的 MeshData（用于 N-gon 交叉口）。
 * 将所有子 Patch 的顶点合并到一个 MeshData 中。
 *
 * @param subPatchCurves  子 Patch 边界曲线数组
 * @param uDiv            u 方向细分数
 * @param vDiv            v 方向细分数
 * @returns 合并后的 MeshData
 */
export function buildMergedCoonsPatchMesh(
  subPatchCurves: SubPatchCurves[],
  uDiv: number = 8,
  vDiv: number = 8,
): MeshData {
  if (subPatchCurves.length === 0) {
    return { positions: new Float32Array(0), normals: new Float32Array(0), uvs: new Float32Array(0), indices: new Uint32Array(0) }
  }

  if (subPatchCurves.length === 1) {
    return buildCoonsPatchMesh(subPatchCurves[0], uDiv, vDiv)
  }

  // 收集所有子 Patch 的网格数据
  const patches = subPatchCurves.map((curves) => buildCoonsPatchMesh(curves, uDiv, vDiv))

  // 计算总顶点数和索引数
  let totalVertices = 0
  let totalIndices = 0
  for (const p of patches) {
    totalVertices += p.positions.length / 3
    totalIndices += p.indices.length
  }

  const positions = new Float32Array(totalVertices * 3)
  const normals = new Float32Array(totalVertices * 3)
  const uvs = new Float32Array(totalVertices * 2)
  const indices = new Uint32Array(totalIndices)

  let vertexOffset = 0
  let indexOffset = 0
  let posOffset = 0
  let normOffset = 0
  let uvOffset = 0

  for (const p of patches) {
    const vCount = p.positions.length / 3

    // 复制顶点数据
    positions.set(p.positions, posOffset)
    normals.set(p.normals, normOffset)
    uvs.set(p.uvs, uvOffset)

    // 复制并偏移索引
    for (let i = 0; i < p.indices.length; i++) {
      indices[indexOffset + i] = p.indices[i] + vertexOffset
    }

    vertexOffset += vCount
    posOffset += p.positions.length
    normOffset += p.normals.length
    uvOffset += p.uvs.length
    indexOffset += p.indices.length
  }

  return { positions, normals, uvs, indices }
}
