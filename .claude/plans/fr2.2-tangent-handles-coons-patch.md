# FR2.2 Tangent Handles and Coons Patch Surface Blending - Implementation Plan

## Architecture Decisions

### A1: Where to store TangentHandle data?
**Extend RoadNode with optional tangentHandles field.**
- RoadNode already has polygonVertices (added for FR2.1)
- Optional field ensures backward compatibility
- NodeAdjustmentStore stays transient (interaction only, not persistent data)

### A2: How to compute initial tangent directions?
**Auto-compute from connected segment directions on node activation.**
- For each polygon vertex, compute direction from adjacent vertices (through-direction)
- Default length = 1/3 of edge length
- If handles already exist on the node, use stored values

### A3: Coons Patch boundary construction
**Each polygon edge + two endpoint tangent handles = one cubic Bezier boundary.**
- For edge Vi to V(i+1): [Vi, Vi+tangentOut, V(i+1)-tangentIn, V(i+1)]
- Triangles: 3 boundaries, triangular Coons patch
- Quads: natural Coons patch
- N-gons (n>4): fan triangulation from P0 into (n-2) sub-patches

### A4: Worker vs main thread
**Heavy tessellation in Worker; lightweight preview on main thread.**
- Drag: update handle 3D position only (60FPS)
- pointerup: Worker rebuilds Coons patch mesh
- buildCoonsPatchMesh added to geometry.worker.ts via Comlink

### A5: Persistence
**Extend RoadNode type now; defer backend schema migration.**
- tangentHandles optional field auto-serialized
- Deserialization handles missing field gracefully
- SCENE_FORMAT_VERSION bumps 2 to 3

---

## Phase 1: Type Definitions and Data Model

**Goal:** Define types, extend RoadNode. Zero runtime impact.

### Modify: src/types/road-network.ts

Add TangentHandleData interface:

    export interface TangentHandleData {
      vertexIndex: number
      directionX: number
      directionY: number
      length: number
    }

Extend RoadNode:

    export interface RoadNode {
      // ...existing...
      tangentHandles?: TangentHandleData[]
    }

### Verify
- vue-tsc --noEmit passes
- Existing tests pass

---

## Phase 2: Tangent Handle Computation Service

**Goal:** Pure function service computing initial tangent handles.

### Create: src/services/tangentHandleService.ts

    export function computeDefaultTangentHandles(
      node: RoadNode,
      segments: Map of string to RoadSegment,
      nodes: Map of string to RoadNode,
    ): TangentHandleData[]

    export function tangentHandleToBezierControlPoints(
      fromVertex: Point2D,
      fromHandle: TangentHandleData,
      toVertex: Point2D,
      toHandle: TangentHandleData,
    ): [Point2D, Point2D, Point2D, Point2D]

Algorithm for computeDefaultTangentHandles:
1. For each polygon vertex V[i], find adjacent V[i-1] and V[i+1] (circular)
2. Through-direction = V[i+1] - V[i-1]
3. Project onto outgoing edge direction
4. Default length = 1/3 * |V[i+1] - V[i]|
5. Normalize direction, store length separately

### Create: src/services/__tests__/tangentHandleService.test.ts
- Test with square, triangle, L-shape polygons
- Verify handle directions point along expected tangents

---

## Phase 3: Visual Rendering of Tangent Handles

**Goal:** Render tangent handles as 3D arrows/lines when node selected in NODE_ADJUST.

### Modify: src/composables/useRoadRenderer.ts

New shared resources:
- tangentHandleTipGeometry = SphereGeometry(0.25, 8, 8)
- tangentHandleTipMaterial = MeshBasicMaterial({ color: 0x00ffcc })
- tangentHandleLineMaterial = LineBasicMaterial({ color: 0x00ffcc })

New functions:

    function addTangentHandles(nodeId: string, node: RoadNode): void
    function removeTangentHandles(nodeId: string): void
    function updateTangentHandlePosition(nodeId: string, handleIndex: number, newTipPos: Point2D): void

Each handle = line (vertex to tip) + sphere (tip).
Tip sphere userData: { handleIndex, nodeId } for ray picking.
All stored in Map keyed by nodeId. Disposed in onBeforeUnmount.

### Modify: src/components/viewport/ThreeViewport.vue

In updateNodeAdjustVisuals(), after vertex markers, render tangent handles for selected nodes.

### Verify
- Select node with polygon then tangent handle arrows appear
- Switch tool then handles disappear
- Different node then handles update correctly

---

## Phase 4: Handle Drag Interaction (Preview Only)

**Goal:** Drag tangent handle tips in real-time. No Coons rebuild during drag.

### Modify: src/stores/nodeAdjustmentStore.ts

New state:

    const isDraggingTangentHandle = ref(false)
    const dragTangentHandleNodeId = ref of string or null
    const dragTangentHandleIndex = ref of number
    const dragTangentHandleStartDirection = ref of Point2D or null
    const dragTangentHandleStartLength = ref of number or null

New methods:

    function startTangentHandleDrag(handleIndex, direction, length): void
    function endTangentHandleDrag(): void

### Modify: src/components/viewport/ThreeViewport.vue

New function: pickTangentHandle(event) returns { nodeId, handleIndex } or null
- Raycasts against tangent handle tip spheres

onPointerDown flow (NODE_ADJUST):
1. Try pickTangentHandle first
2. If hit: enter tangent handle drag mode, disable camera controls
3. Track start direction/length for undo

onPointerMove flow:
- If dragging tangent handle: project mouse to ground plane
- Compute new direction/length from vertex to tip
- Update only 3D visual (line + sphere position) at 60FPS
- NO mesh rebuild during drag

onPointerUp flow (deferred to Phase 7):
- End drag state

### Verify
- Drag handle tip then line + sphere move smoothly at 60FPS
- Camera controls disabled during drag
- Esc restores original position

---

## Phase 5: CoonsPatchBuilder Service + Worker Integration

**Goal:** Implement Coons patch surface computation in geometry Worker.

### Create: src/services/coonsPatchBuilder.ts

    export function buildCoonsPatchMeshData(
      polygon: Point2D[],
      handles: TangentHandleData[],
      elevation: number,
      uDivisions: number,
      vDivisions: number,
    ): MeshData

Algorithm:
1. Construct boundary Bezier curves (one per edge) using tangentHandleToBezierControlPoints
2. For N-gons: fan-triangulate from P0 into (N-2) sub-patches
3. Evaluate each sub-patch using bilinearly blended Coons formula:
   S(u,v) = (1-v)*C0(u) + v*C1(u) + (1-u)*C2(v) + u*C3(v)
           - [(1-u)(1-v)*P00 + u(1-v)*P10 + (1-u)v*P01 + uv*P11]
4. Sample at uDivisions x vDivisions grid
5. Generate MeshData: positions, indices, normals (cross product of partials), UVs

### Modify: src/workers/geometry.worker.ts

Add method:

    buildCoonsPatchMesh(polygon, handles, elevation): MeshData

Calls buildCoonsPatchMeshData with default 16x16 divisions.

### Create: src/services/__tests__/coonsPatchBuilder.test.ts
- Verify mesh vertex count for square, triangle
- Verify normals point upward
- Verify flat handles produce same result as Delaunay

### Verify
- Worker buildCoonsPatchMesh returns valid MeshData
- Flat handles (default) produce approximately flat surface
- Curved handles produce smoothly blended surface

---

## Phase 6: SetTangentDirectionCommand (Undo/Redo)

**Goal:** ICommand for tangent handle changes with full undo/redo.

### Modify: src/commands/roadCommands.ts

    export class SetTangentDirectionCommand implements ICommand {
      readonly timestamp = Date.now()
      private oldHandle: TangentHandleData | null = null

      constructor(
        private nodeId: string,
        private handleIndex: number,
        private newDirection: { x: number; y: number },
        private newLength: number,
      ) {}

      execute(): void {
        // Snapshot old handle, update with new direction/length
        // Calls roadStore.updateNode(nodeId, { tangentHandles: updated })
      }

      undo(): void {
        // Restore old handle data
      }

      getDescription(): string
    }

### Modify: src/commands/index.ts
Export SetTangentDirectionCommand.

### Verify
- Drag handle then release then undo then handle returns to original
- Undo then redo then handle returns to new position
- Multiple changes all undoable

---

## Phase 7: Integration in ThreeViewport

**Goal:** Connect all pieces in the main viewport.

### Modify: src/components/viewport/ThreeViewport.vue

1. updateNodeAdjustVisuals(): compute default handles if missing, render handles
2. handleNodeAdjust(): try pickTangentHandle before vertex/node picking
3. onPointerMove(): add tangent handle drag branch
4. onPointerUp(): commit SetTangentDirectionCommand + rebuildIntersectionSurface()
5. New async function rebuildIntersectionSurface(nodeId):
   - If tangentHandles exist: call Worker.buildCoonsPatchMesh then updateIntersectionSurface
   - Else: fallback to updateIntersectionPolygon (flat Delaunay)
6. clearNodeAdjustState(): remove tangent handle visuals
7. Watch topologyVersion: rebuild intersection surface for nodes with tangent handles

### Modify: src/composables/useRoadRenderer.ts

Add updateIntersectionSurface(nodeId, meshData):
- Remove existing intersection mesh
- Create new mesh from MeshData
- Tag with userData.isCoonsPatch = true

### Modify: src/stores/nodeAdjustmentStore.ts

Add setTangentDirection(handleIndex, direction):
- Updates RoadNode.tangentHandles via roadStore.updateNode

### Verify
- Full flow: activate node then see handles then drag then preview then release then Coons surface
- Undo works
- Switching nodes updates handles
- ESC cancels drag

---

## Phase 8: Store Events + Persistence

**Goal:** Add typed events and serialization support.

### Modify: src/stores/storeEventBus.ts
Add event:

    "road-network:tangent-handle-changed": { nodeId: string; handleIndex: number }

### Modify: src/stores/nodeAdjustmentStore.ts
Emit tangent-handle-changed after setTangentDirection.

### Modify: src/domain/scene-serializer/types.ts
Bump SCENE_FORMAT_VERSION from 2 to 3.

### Modify: src/domain/scene-serializer/migrate-payload.ts
Add v2-to-v3 migration: default tangentHandles to undefined for each node.

### Verify
- Save with tangent handles then reload then handles preserved
- Load v2 project then no errors, handles computed on demand
- Load v3 project then handles restored correctly

---

## Dependency Graph

    Phase 1 (Types)
      |-> Phase 2 (Compute) -> Phase 5 (Coons Worker)
      |-> Phase 3 (Visual) -> Phase 4 (Drag)
      |-> Phase 6 (Command)

    Phase 5 + Phase 4 + Phase 6 -> Phase 7 (Integration) -> Phase 8 (Persistence)

Parallel tracks:
- Track A: Phase 1 -> 2 -> 5 (math + worker)
- Track B: Phase 1 -> 3 -> 4 (visual + interaction)
- Then: Phase 6 -> 7 -> 8

---

## File Summary

### New Files (4)

| File | Est. Lines | Purpose |
|------|-----------|---------|
| src/services/tangentHandleService.ts | ~80 | Compute default handles + Bezier control points |
| src/services/coonsPatchBuilder.ts | ~150 | Coons patch evaluation + mesh generation |
| src/services/__tests__/tangentHandleService.test.ts | ~60 | Handle computation unit tests |
| src/services/__tests__/coonsPatchBuilder.test.ts | ~80 | Coons patch unit tests |

### Modified Files (9)

| File | Scope |
|------|-------|
| src/types/road-network.ts | +15 lines |
| src/stores/nodeAdjustmentStore.ts | +25 lines |
| src/stores/storeEventBus.ts | +2 lines |
| src/commands/roadCommands.ts | +40 lines |
| src/commands/index.ts | +2 lines |
| src/composables/useRoadRenderer.ts | +60 lines |
| src/components/viewport/ThreeViewport.vue | +100 lines |
| src/workers/geometry.worker.ts | +15 lines |
| src/domain/scene-serializer/types.ts | +1 line |

---

## Performance Notes

- 60FPS drag: only sphere + line position update, no Worker calls
- Lazy Worker rebuild on pointerup: typical 16x16 Coons = 289 vertices, sub-1ms
- Geometry disposal: always dispose() old BufferGeometry
- Debounced rapid changes: 50ms debounce on Worker rebuild queue

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Coons artifacts for n>6 polygons | Fan triangulation; each triangle gets own Coons sub-patch |
| Backward compat with existing data | tangentHandles optional; fallback to flat Delaunay |
| Worker build errors | try/catch with fallback to updateIntersectionPolygon |
| Handle direction ambiguity | 1:1 mapping: handleIndex = vertexIndex |
