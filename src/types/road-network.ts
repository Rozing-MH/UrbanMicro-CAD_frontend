// ============================================================
// Core Geometry Types
// ============================================================

export interface Point2D {
  x: number
  y: number
}

export interface Point3D {
  x: number
  y: number
  z: number
}

export interface Polygon2D {
  exterior: Point2D[]
  holes: Point2D[][]
}

export interface BoundingBox2D {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

// ============================================================
// Road Geometry and 3D Mesh
// ============================================================

export interface MeshData {
  positions: Float32Array
  indices: Uint32Array
  uvs: Float32Array
  normals: Float32Array
}

// ============================================================
// Elevation
// ============================================================

export type ElevationMode = 'GROUND' | 'BRIDGE' | 'TUNNEL' | 'ANARCHY'

export interface ElevationProfile {
  startZ: number
  endZ: number
  mode: ElevationMode
}

export interface SlopeConstraint {
  mode: ElevationMode
  maxSlope: number
}

export const SLOPE_LIMITS: Record<ElevationMode, number> = {
  GROUND: 5,
  BRIDGE: 8,
  TUNNEL: 6,
  ANARCHY: Infinity,
}

export interface RampTransition {
  startNodeId: string
  endNodeId: string
  controlPoints: Point3D[]
  rampLength: number
  maxSlope: number
  transitionCurve: 'LINEAR' | 'PARABOLIC' | 'CUBIC'
}

// ============================================================
// Cross Section
// ============================================================

export type LaneType = 'CAR' | 'BUS' | 'BIKE' | 'TRAM'
export type LaneDirection = 'FORWARD' | 'BACKWARD' | 'BOTH'

export interface LaneConfig {
  id: string
  width: number
  type: LaneType
  direction: LaneDirection
}

/** @deprecated Use LaneConfig */
export type LaneDef = LaneConfig

export interface MedianConfig {
  width: number
  type: 'PAINTED' | 'CONCRETE' | 'GRASS' | 'BARRIER' | 'NONE'
}

/** @deprecated Use MedianConfig */
export type MedianDef = MedianConfig

export interface SidewalkConfig {
  leftWidth: number
  rightWidth: number
  hasCurb: boolean
}

/** @deprecated Use SidewalkConfig */
export type SidewalkDef = SidewalkConfig

export interface CrossSectionProfile {
  id: string
  name: string
  lanes: LaneConfig[]
  median: MedianConfig
  sidewalk: SidewalkConfig
  totalWidth: number
}

// ============================================================
// Road Network Entities
// ============================================================

export interface RoadNode {
  id: string
  position: Point2D
  elevation: number
  controlMode: 'YIELD' | 'TRAFFIC_LIGHT' | 'ROUNDABOUT' | 'NONE'
  connectedSegmentIds: string[]
  polygonVertices: Point2D[]
}

export interface RoadSegment {
  id: string
  startNodeId: string
  endNodeId: string
  centerLine: Point2D[]
  profile: CrossSectionProfile
  elevation: ElevationProfile
  isCurved: boolean
  controlPoint?: Point2D
  length: number
  meshData?: MeshData
}

// ============================================================
// Half-Edge Topology
// ============================================================

export interface HalfEdge {
  id: string
  originNodeId: string
  twinId: string
  nextId: string
  segmentId: string
  laneIndex: number
}

// ============================================================
// Lane-level Entities
// ============================================================

export type TurnDirection = 'LEFT' | 'STRAIGHT' | 'RIGHT' | 'U_TURN'

export interface Lane {
  id: string
  segmentId: string
  index: number
  direction: LaneDirection
  type: LaneType
  width: number
}

export interface LaneArrow {
  laneId: string
  nodeId: string
  allowedDirections: TurnDirection[]
  isManualOverride: boolean
}

// ============================================================
// Drawing State Machine
// ============================================================

export type DrawingState = 'IDLE' | 'DRAWING' | 'PREVIEW' | 'CONFIRMED'
export type DrawingMode = 'STRAIGHT' | 'CURVE' | 'FREE'

export interface DrawingContext {
  state: DrawingState
  mode: DrawingMode
  startNodeId: string | null
  startPoint: Point2D | null
  controlPoint: Point2D | null
  previewEndPoint: Point2D | null
  currentElevationMode: ElevationMode
  startElevation: number
  endElevation: number
  activeCrossSectionId: string | null
}

// ============================================================
// Angle Annotation (FR1.9)
// ============================================================

export interface AnglePair {
  fromSegmentId: string
  toSegmentId: string
  angleDeg: number
}

export interface AngleAnnotation {
  nodeId: string
  pairs: AnglePair[]
}

// ============================================================
// Topology Data
// ============================================================

export interface TopologyData {
  version: number
  nodes: RoadNode[]
  segments: RoadSegment[]
  lanes: Lane[]
  laneArrows: LaneArrow[]
  halfEdges: HalfEdge[]
}

export interface RoadNetwork {
  nodes: Map<string, RoadNode>
  segments: Map<string, RoadSegment>
  lanes: Map<string, Lane>
  laneArrows: Map<string, LaneArrow>
  halfEdges: Map<string, HalfEdge>
}
