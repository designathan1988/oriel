# Workspaces and the non-destructive core (forma/4): research and design

Research only, 2026-10-11. Nothing in the code was changed. Line numbers refer to the working tree read on that date and will drift; the function names are the stable reference.

Convention used in this file: **[source]** marks what a page I opened says (with its link). **[proposal]** marks my own design. A claim without a link is about FORMA's own code (path given).

## Summary

**Workspaces** [proposal]:
- Five fixed presets of the same document: Model, Components, Materials, Interior, Present.
- Each preset only filters what is shown: the tool bar, the contextual-bar actions, the right panel's starting tab and sections, the library's state, the handles, and the Interior panel. The document itself is never touched.
- Switching: a segmented control in the centre of the top bar, Ctrl+PageUp/PageDown (Blender's keys; they need checking in Chrome, see A6), and Ctrl+K entries.
- The choice is a per-user UI preference in `localStorage`, like the panel width already is. It is not stored in the project, so switching never creates a history step, an autosave or "Saving…".
- One new module, `ui/workspaces.ts`, plus small hooks in `shell.ts`, `editor.ts` (`renderTools`, `bindKeys`, `handlesLive`), `actions.ts`, `catalog.ts`, `layers.ts`, `interior.ts` and `palette.ts`.

**Non-destructive core (forma/4)** [proposal]:
- Each building gets a node graph with three node kinds:
  - **generators**: today's `Solid` without `op`, later a free polyhedron;
  - **operations**: one input node, parameters and references to sub-elements;
  - **combine** nodes: an ordered fold of add/subtract/intersect over operand nodes, which is exactly forma/3's "booleans in list order".
- Migration is lossless: every `Solid` becomes a generator with the same ID, and `building.solids` order + `op` becomes one root combine. Every existing reference keeps working (facade rule sides, hosted items, selection sets, layers).
- References name sub-elements by stable keys (plan vertex IDs + node-derived keys), never by mesh index. They travel through Manifold booleans as `faceID`, as FORMA already does today.
- A reference that no longer resolves makes its node an **orphan**: it is skipped, shown in red with the reason, and offered Reattach/Delete. It is never re-guessed by position (RESEARCH.md decision 12).
- Incremental evaluation uses a per-node data ID and cache, the Houdini "data ID" idea, and moves to a worker.
- The plan has 9 steps, each shippable and testable alone. The first two (worker, per-volume cache) change no data model.

---

# Part A — Workspaces

## A1. Sources read

### Blender, Workspaces
https://docs.blender.org/manual/en/latest/interface/window_system/workspaces.html

**[source]**
- Workspaces are "predefined window layouts", each a set of areas with editors, for a task such as modeling, animating or scripting.
- Tabs switch them. **Ctrl-PageUp / Ctrl-PageDown** activate the workspace to the left or right.
- Workspaces are **saved in the .blend file**. "Load UI" in the File Browser decides whether a file's saved layout replaces the current one, and a custom set can be saved as part of the Defaults.
- Per-workspace settings:
  - **Mode**: "the object mode to enter when the workspace is activated";
  - **Pin Scene**;
  - **Filter Add-ons**, which enables only chosen add-ons in that workspace.
- The defaults (Layout, Modeling, Sculpting, UV Editing, Texture Paint, Shading, Animation, Rendering, Compositing, Geometry Nodes, Scripting) are each a task.

### Autodesk Fusion
Workspaces: https://help.autodesk.com/cloudhelp/ENU/Fusion-GetStarted/files/GS-WORKSPACES.htm. Interface: https://help.autodesk.com/view/fusion360/ENU/?guid=GS-THE-FUSION-INTERFACE.

**[source]**
- "Fusion capabilities are grouped into purpose-driven workspaces": Design, Electronics, Generative Design, Render, Animation, Simulation, Manufacture, Drawing.
- In each workspace the tools are "organized into tabs in the toolbar according to particular design objectives", and some tools appear in more than one workspace.
- The interface page says the workspace switcher sits in the Toolbar, and "Fusion uses workspaces to control which commands are available".
- **Contextual tabs** appear only while a command (such as Sketch) is active.
- A **contextual environment** (such as Form) "replace[s] the workspace's default tabs until you exit it".
- The workspaces page does not say whether state is shared between workspaces. I make no claim about that.

### Figma
- Dev Mode: https://help.figma.com/hc/en-us/articles/15023124644247-Guide-to-Dev-Mode
- Right sidebar: https://help.figma.com/hc/en-us/articles/360039832014-Design-prototype-and-explore-layer-properties-in-the-right-sidebar
- Toolbar: https://help.figma.com/hc/en-us/articles/360041064174-Access-tools-in-the-Editor-with-the-toolbar

**[source]**
- Dev Mode is entered "with the Dev Mode toggle in the toolbar or Shift+D". Shift+D or the toggle goes back to Design mode. A Dev Mode link opens a file directly in Dev Mode.
- It is the same file: version history is still there, and the left sidebar and inspect panel change.
- Some Dev Mode actions do change the file for everyone, for example marking a frame "ready for dev". The page does not say whether the mode itself is stored per user.
- The right sidebar has Design and Prototype tabs whose controls depend on the selection.
- The toolbar page lists the toolbar's menus (Move, Region, Shape, Creation, Text, Comment, Actions) and the Dev Mode toggle (Shift D). It does not say whether the tools change by mode.

The "Navigating UI3" article only came up as a listing in search. **I did not open it** and make no claim about it.

### Shapr3D and Plasticity
The official Shapr3D release note on switching Modeling/Visualization/Drawings (https://support.shapr3d.com/hc/en-us/articles/22969697540764) returned **HTTP 403**: not read, no claim. Plasticity: no official page opened, no claim.

## A2. What applies to FORMA

1. **A workspace is a preset over the same document, not a different document.** Fusion shows it directly ("control which commands are available"); Figma Dev Mode shows it implicitly (same file, same history). [proposal] So a FORMA workspace never edits `Project3`. It only changes which tools, actions, panels and overlays are shown.
2. **Each preset has an entry state.** Blender's per-workspace "Mode" is the precedent. [proposal] On entering, FORMA activates a default tool and a library tab, but never changes the selection or the camera.
3. **Contextual tabs stay contextual.** In Fusion, contextual tabs and environments sit on top of the workspace. [proposal] FORMA's contextual bar (`ui/actions.ts`) and last-operation panel (`ui/lastop.ts`) stay in every editing workspace, filtered by the workspace.
4. **Switching:** tabs plus left/right keys (Blender), a toggle plus a one-key shortcut (Figma Shift+D), a switcher in the toolbar (Fusion). [proposal] Tabs in the top bar plus Ctrl+PageUp/PageDown, which is what INTERFACE.md already sketches ("work modes in the center").
5. **Storage:** Blender keeps workspaces in the file, but there they are user-built layouts with editors. FORMA's workspaces are fixed presets (see A5 for why that leads to a UI preference).

**Note on the planned set.** `docs/INTERFACE.md` lists "Model, Materials, Interior, Light, Walk". `docs/AUDIT-2026-10-11.md` Phase 1 lists "Model, Components, Materials, Interior, Present". This design follows the AUDIT list, as the coordinator asked. Light and Walk fit inside Present for now: the time of day stays on the View island, and walking is Phase 9. **Open question for the user.**

## A3. FORMA code a workspace drives (read)

- **Top bar** (`ui/shell.ts`, `createShell3`): brand, name, saved, undo/redo, two `.f3-sp` spacers around the search button, help, Export. There is no workspace control yet. The panel width is already a per-browser preference: `localStorage 'forma3_aside_w'` in `createShell3`.
- **Tool bar** (`editor/editor.ts`, `renderTools`): four hard-coded groups (Select/Move/Rotate/Scale | Push/Extrude | Rect/Circle/Polygon/add-subtract | Library/Paint/Tape). The Library button toggles `.f3-cat.closed` through `toggleLibrary`.
- **Right panel tabs** (`ui/layers.ts`, the click handler at the top of `mountLayers`): Properties / Structure / Layers, by toggling `hidden` on three panes. Collapsed inspector sections are remembered in `localStorage` (`ui/kit.ts`, `CLOSED_KEY = 'forma3_closed_sections_v2'`).
- **Library** (`ui/catalog.ts`, `mountCatalog`): an internal `tab` variable (default `'blocks'`), with favourites in `localStorage` (`FAV_KEY`). `ed.catalogRequested` opens it and focuses the search.
- **Actions** (`ui/actions.ts`): `actionsFor` (selection actions + "Selection" group), `transformActions` (Move/Rotate/Scale), the `PRIMARY` set (bar vs "More"), and `mountActions` (render, right-click menu).
- **Interior** (`ui/interior.ts`, `mountInteriorView`): a button on the View island opens a popover. Its state lives in **the project** (`project.view.hiddenBody / cutLevel / onlyLevel / explode`) and is recorded by `ed.store.commit(null, msg, false)`, so it is undoable and saved.
- **Palette** (`ui/palette.ts`, `commands()`): a hand-written list (see audit D33).
- **Handles and overlays** (`editor.ts`): `drawSelection`, `handlesLive`, `placeCtxBar`.

## A4. The five workspaces [proposal]

| | Model | Components | Materials | Interior | Present |
|---|---|---|---|---|---|
| Purpose | massing and volumes (today's editor) | windows, doors, balconies, rules, free parts | finishes and paint | floors, interior walls, cuts (Phase 9 grows here) | look, compare, export |
| Tool bar | all groups as today | Select, Move, Rotate · Library (place) · Tape | Select · Paint (B) · Library | Select · Rect/Polygon (interior walls later) · Tape | Select only (orbit/pan/zoom), no edit tools |
| Entry tool | `select` | `select` | `paint` if a bucket material is armed, else `select` | `select` | `select` |
| Contextual bar | all actions | element/component actions (Row, Column, Same type, Swap, Detach/Back to rule, Make unique) + Move/Rotate | selection actions only (Hide, Isolate, Select similar) | Floor ± and Leave; volume modeling actions hidden | hidden |
| Handles, dimensions | yes | component handles only (`cwidth/cheight/csill`), volume gizmo hidden | none (paint needs a clean face) | none in exploded/single-floor views | none |
| Right panel | Properties, sections as today | Properties with "Facade" and component sections first | Properties with "Materials" first (bucket panel when painting) | a pinned **Interior** section at the top of Properties (the popover's content) | collapsed (`.f3-aside.min`) |
| Library | closed | open on the last component tab (default Windows) | open on Materials | closed | closed |
| View settings | as saved | as saved | as saved | interior view on (see open question) | as saved; the time-of-day control stays on the View island |
| Ctrl+K | everything | everything; component types first | materials first | interior commands first | view and export commands |

Rules for every workspace:
- The **document is never changed** by a switch.
- The selection and the camera are kept.
- A tool missing from the workspace is not reachable by its key (keys come from the same definition).
- Ctrl+K can always run any command: running a command from another workspace switches to it first, as Fusion runs a command inside its workspace.

## A5. Where the choice is stored, and why [proposal]

**Choice:** a UI preference in `localStorage`. Key `forma3_workspace` holds `{ current: WorkspaceId, perWs: { [id]: { libraryTab?, asideTab?, tool? } } }`, read and written in try/catch as `createShell3` already does for `forma3_aside_w`.

Why not in the project:
1. **Fixed presets.** Unlike Blender, the user does not build layouts, so nothing project-specific needs saving. The Blender manual's "Load UI" option shows that even Blender separates "the file's UI" from "my UI".
2. **History and saving stay clean.** A project write goes through `Store.commit`, so a switch would add an undo step and trigger "Saving…" (audit D9). A preference does neither.
3. **One project, several people.** Like Figma's per-user modes, a colleague opening my project gets their own workspace, not mine.

**Exception, the Interior view state** (open question): today `hiddenBody/cutLevel/explode` live in `project.view` and are undoable. Two options:
- **(a)** Keep them in the project. The Interior workspace only shows the controls, and leaving it leaves the cut on.
- **(b)** Make them workspace state. They apply only while Interior is active, are remembered in the preference, and Model always shows whole buildings.

**[proposal] recommend (b).** It removes the "I left the building cut and forgot" trap. It also matches what the module's own header says: "Hiding is only a view state" (`ui/interior.ts`, first comment). It needs a one-time migration that moves `project.view` interior fields into the preference on open. **The user decides.**

## A6. Switching [proposal]

- **Top bar:** a `role="tablist"` segmented control `.f3-ws` in the centre. The search button moves to the right, before Help.
  - Layout: `◆ FORMA · name · saved · ↶ ↷ | [Model][Components][Materials][Interior][Present] | (search Ctrl K) ? Export`.
  - The saved label gets a fixed width (fixes D9 by the same change).
- **Keys:**
  - Ctrl+PageUp / Ctrl+PageDown cycle, as in Blender.
  - **Risk:** Chrome may reserve these keys for its own tab switching and not deliver them to the page. **Not verified; I opened no source.** The first step must check in the browser whether `keydown` reaches the page. If not, use Alt+PageUp/PageDown, and keep Ctrl+K "Workspace: …" entries as the always-working path.
  - 1/2/3 are taken by the selection modes; F1–F5 are not proposed (browser help on F1).
- **Ctrl+K:** entries "Workspace: Model" … "Workspace: Present".
- **Feedback:** the tab highlights, plus a short toast "Materials workspace". No camera animation.

## A7. Files and functions to change [proposal]

1. **New** `src/f3/ui/workspaces.ts`:
   - `export type WorkspaceId = 'model' | 'components' | 'materials' | 'interior' | 'present'`;
   - `export const WORKSPACES: Record<WorkspaceId, WorkspaceDef>`, where `WorkspaceDef = { label; tools: Tool[] | 'all'; entryTool; actionGroups: string[] | 'all'; handles: HandleKind[] | 'all' | 'none'; asideTab; asideMin?; sectionsFirst?: string[]; library: { open: boolean; tab?: string } }`;
   - `loadPref()` / `savePref()` (try/catch `localStorage`);
   - `mountWorkspaces(ed)`: builds the tablist, wires clicks, and applies the definition.
2. `ui/shell.ts`, `createShell3`: the top bar markup (`.f3-ws` container), the CSS, and a `ws: HTMLElement` field in `Shell3`.
3. `editor/editor.ts`:
   - add `workspace: WorkspaceId` and `setWorkspace(id)`, which emits a change and does not touch the store;
   - `renderTools`: filter `groups` by `WORKSPACES[ws].tools`;
   - `setTool`: refuse tools outside the workspace, with a toast naming the workspace that has them;
   - `bindKeys`: Ctrl/Alt+PageUp/PageDown, and ignore keys of tools that are not available;
   - `handlesLive` / `drawSelection`: honour `handles`;
   - `freeRect`: unchanged (the panels stay docked).
4. `ui/actions.ts`: in `actionsFor` and `mountActions.render`, drop actions whose group is not in `actionGroups`; in Present, `bar.hidden = true`.
5. `ui/catalog.ts`: return `{ open(tab?: string) }` and accept a tab in `ed.catalogRequested`. Today `tab` is private.
6. `ui/layers.ts`: export a `selectTab(tab)` used by the tab buttons and by `setWorkspace`.
7. `ui/inspector.ts`: section order and open state per workspace. Simplest: `kit.ts` `CLOSED_KEY` gains a workspace suffix.
8. `ui/interior.ts`: extract the popover body into a function the inspector can render as a pinned section in the Interior workspace. For option (b), read the interior state from the workspace preference instead of `project.view`.
9. `ui/palette.ts`: the "Workspace: …" commands. Better: generate the palette from the same definitions (fixes D33 along the way).
10. `src/app/editor.ts`: call `mountWorkspaces(editor)` after the other `mount*`.
11. Docs: INTERFACE.md (layout), PLAN.md (Phase 1 item). Tests:
    - unit tests for `loadPref/savePref` and the definitions;
    - e2e: switch by tab and by key; the tool bar shows the expected buttons; the library opens on the right tab; `store.seq` does not change on a switch; reload restores the workspace; Present hides handles and the bar.

---

# Part B — Phase 3: the non-destructive core (forma/4)

## B1. Sources read and what applies

### Blender, modifiers
https://docs.blender.org/manual/en/latest/modeling/modifiers/introduction.html

**[source]**
- Modifiers are "a series of non-destructive operations which can be applied on top of an object's geometry".
- They are "calculated from top to bottom in the stack", and order changes the result (the manual shows Mirror before vs after Subdivision Surface).
- **Apply** makes a modifier "real" and removes it; applying one that is not first ignores the stack order.
- Each panel has Realtime/Render visibility toggles, Move up/down, Move to First/Last, **Pin to Last**, Duplicate, Delete, and an editable name unique per object.

**Applies:**
- an ordered per-object stack;
- an enable toggle that skips an entry without deleting it;
- Apply = freeze;
- reorder.

### Blender, Geometry Nodes
https://docs.blender.org/manual/en/latest/modeling/geometry_nodes/introduction.html

**[source]**
- Geometry Nodes is "a system for modifying the geometry of an object with node-based operations".
- The modifier's node tree is a node group. The geometry from before the modifier (the original, or the previous modifier's result) enters the Group Input, and the Group Output goes to the next modifier.

**Applies:** a graph can sit *inside* a stack entry. FORMA can start with a linear stack per volume plus combine nodes and grow to graphs later without changing the evaluation contract (input geometry → output geometry).

### Autodesk Fusion, timeline and compute
- Interface (Timeline): https://help.autodesk.com/view/fusion360/ENU/?guid=GS-THE-FUSION-INTERFACE
- Compute All: https://help.autodesk.com/cloudhelp/ENU/Fusion-Model/files/SLD-COMPUTE-ALL.htm
- Custom features API: https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/CustomFeatures_UM.htm

**[source]**
- **Timeline:** it "lists the operations in your design". An operation can be changed from the right-click menu and reordered by dragging, in Parametric Modeling mode.
- **Compute All:**
  - When something cannot be computed, "a yellow warning or red error highlights the feature in the Timeline";
  - "Review Warning" shows the message;
  - one suggested fix is "Reselect any missing geometry";
  - Compute All recomputes everything.
- **Custom features:**
  - When a feature is edited, Fusion has "effectively rolled the timeline to just before the edited feature" and "all the nodes to the right of the edited feature are disabled";
  - because "if you edit a fillet, you must roll the timeline to just before the fillet, so all the original edges are available again";
  - a custom feature recomputes "if any of the entities the feature depends on are modified".

The dedicated Timeline page I tried (`…/ASM-USE-TIMELINE`) returned "Page Not Found": no claim from it.

**Applies:**
- the yellow/red states with "Review" and "Reselect" are the model for FORMA's orphan reporting;
- editing a node shows the geometry as it was before the node, so its references can be picked again;
- dependency-driven recompute.

### Onshape FeatureScript
- Modeling: https://cad.onshape.com/FsDoc/modeling.html
- Standard library: https://cad.onshape.com/FsDoc/library.html

**[source]** `modeling.html`:
- a query "does not reference entities": it is a set of criteria;
- FeatureScript uses queries "in place of direct references" for robustness against changes earlier in the feature list, with the example of finding a cube's top face again after the cube is resized and a hole drilled;
- `evaluateQuery` "returns an array of transient queries", one per entity at evaluation time.

**[source]** `library.html`:
- A `Query` "identifies a specific subset of a context's entities".
- `qCreatedBy` returns entities created by a feature id.
- `qUnion` and `qSubtraction` combine queries, and `qNothing` is "an empty query".
- Ids: "The full id hierarchy must reflect creation history".
- `unstableIdComponent` marks a component "causing queries to treat it as a wildcard", for values that are not expected to be robust.
- When a parameter needs one entity and the query resolves to several, an operation "takes the first resolved entity".
- Transient query results become invalid when the context changes.

**Applies:**
- a reference is a description (creator node + role + source key), resolved again on every evaluation;
- IDs encode creation history;
- "takes the first" is a silent choice that FORMA should **not** copy (decision 12), so FORMA reports ambiguity instead.

### FreeCAD, topological naming problem
- Wiki page https://wiki.freecad.org/Topological_naming_problem: **blocked** (the site returned an "Access Denied" bot-protection page). Not read, no claim from it.
- 1.0 announcement, read: https://blog.freecad.org/2024/11/19/freecad-version-1-0-released/

**[source]** The mitigation algorithm "offers resiliency against topology changes in a parametric chain", is "already in action in the Sketcher and PartDesign, and is being progressively extended to everything else", and is "Not finished".

**Applies:** a mature CAD project calls this *mitigated, not solved*. FORMA's design must assume some references will break and make that visible.

### Manifold (the kernel FORMA uses, `manifold-3d` 3.5.4)
- The JS API index https://manifoldcad.org/docs/jsapi/ was opened. It links the C++ class reference; the JS class pages I tried returned 404.
- So I read the declarations shipped in the installed package: `labs/building/forma/node_modules/manifold-3d/manifold-encapsulated-types.d.ts` (the same text as the API docs comments).

**[source]**
- "Manifolds also keep track of their relationships to their inputs, via OriginalIDs and the faceIDs and transforms accessible through MeshGL".
- `asOriginal()`: "reset its IDs to a new original". It "also condenses all coplanar faces in the relation".
- `originalID()`: returns the ID if the mesh is an original, "If this manifold is a product, this returns -1".
- `reserveIDs(count)`: "Returns the first of n sequential new unique mesh IDs for marking sets of triangles that can be looked up after further operations".
- `MeshGL`:
  - `runOriginalID`: "ideal for reapplying materials to the output mesh";
  - `runIndex` gives the triangle runs;
  - `runTransform` is "how the corresponding original mesh was transformed";
  - `runFlags` bit 0 is "backside (… e.g. from a subtraction)";
  - `faceID`: "Input faceIDs will be maintained to the outputs".

**FORMA today** (`src/f3/eval/faces.ts` header, `evaluate.ts` `toShell`): every triangle entering Manifold carries a `FaceTable` index as `faceID` (kind, solid, side `edge`, segment, ring, frame), and `toShell` reads it back from `mesh.faceID`. So **generator-level face naming through booleans already works**. forma/4 extends it; it does not replace it.

### Houdini, cooking and caching
- Cooking: https://www.sidefx.com/docs/houdini/basics/cooking.html
- Cache If SOP: https://www.sidefx.com/docs/houdini/nodes/sop/cacheif.html

**[source]**
- "cooking refers to evaluating the nodes in the networks to compute the state of the scene".
- Update modes: Auto Update, **On Mouse Up** ("Recook … only after each discrete parameter change") and Manual.
- Cache If uses "the same 'data ID' metadata that Houdini uses to efficiently decide whether a node should recook its inputs", with an option to "Re-cache any time a node is added, removed, or edited in the upstream network".

**Applies:**
- a per-node data ID derived from its definition and its inputs' IDs;
- recompute only nodes whose data ID changed;
- FORMA's existing drag preview (`EvalOptions.preview`) followed by a full evaluation on release is the same idea as "On Mouse Up".

## B2. What FORMA has today (read)

- `model/schema.ts` (forma/3):
  - a `Building3` holds `solids: Solid[]` in order, each with `op: 'add'|'subtract'|'intersect'`, a `plan` of `PlanVertex` with **stable IDs** ("never derived from coordinates"; a side has the ID of its start vertex), `edges: Record<ID, EdgeSpec>`, `roof`, `facade: FacadeRule[]` (sides by ID, exceptions by `"side:level:index"`), `materials`, `bevel`, `bands`;
  - `Item.host` references `solid`+`edge`;
  - `SelectionSet` references solids.
- `eval/evaluate.ts`, `evaluateBuilding`:
  1. folds solids in list order with Manifold add/subtract/intersect;
  2. inserts group parapets after the last member;
  3. computes facade regions on the boolean result;
  4. places parts, cuts openings, adds plinths and the interior cuts;
  5. returns `Shell { positions, indices, faceOf }`, `faces`, `placements`, `warnings`.
- `eval/body.ts`: `solidRings`, `bodyMesh` (sides become faces with frames; corners `id:c`). `eval/subelements.ts`: `subElements` (corners/sides for the 1/2/3 modes, keyed by plan IDs) and `convertSub`.
- `kernel/kernel.ts`: `loadKernel`, `kernel()`, and `Scope`: every Manifold object must be `.delete()`d.
- Evaluation runs **on the main thread**: `editor/view.ts`, `sync`, calls `evaluateBuilding`.
- `io/migrate.ts`: `migrateForma3` (validate + repair: `repairRefs`, `repairColors`, `renameTypes`) and `fromForma2`.
- `editor/store.ts`: history as JSON snapshots, `revision` per building.

## B3. Inventory: every current operation and its node [proposal for the right column]

"Param" means it already is a non-destructive parameter of the volume and stays a **generator parameter**. "Node" means it becomes an operation node with references.

| Operation | Where (file:function) | What it does today | forma/4 |
|---|---|---|---|
| Draw rectangle / circle / polygon | `editor.ts:finishShape`; `model/plan.ts:planVertices`, `circlePlan` | new `Solid` (or a new building) | **Volume generator** |
| Massing block | `model/blocks.ts:blockSolid`; `editor.ts:blockAt` | new `Solid` from a block definition | **Volume generator** (block id kept as metadata) |
| Height, base, taper, wall lean, roof, plinth, materials, facade rules, bands | `ui/inspector.ts` fields; `model/modeling.ts:addBands` | edits `Solid` fields | **Param** |
| Volume bevel (top/base) | `editor.ts:modelOp 'bevel'` → `Solid.bevel` | sets a field | **Param** |
| Side bevel | `modelOp 'edge-bevel'` → `EdgeSpec.bevel` | per-side field | **Param** (keyed by side ID) |
| Round / chamfer corners | `modelOp 'corner'` → `PlanVertex.round/chamfer` | per-vertex field | **Param** (keyed by vertex ID) |
| Add / Subtract / Intersect | `editor.ts:command 'op-*'` → `Solid.op` + list order | changes the op | **Combine** item op |
| Move side (push/pull, edge Move) | `model/ops.ts:pushEdge`; `modelOp 'edge-offset'` | rewrites plan vertices | **Node `moveEdge`** {ref: side, d} |
| Curve side | `ops.ts:bendEdge`; `modelOp 'edge-curve'` | sets `bulge` | **Node `curveEdge`** {ref, sag} |
| Split side | `ops.ts:splitEdge`; `modelOp 'edge-split'` | inserts a vertex (new ID) | **Node `splitEdge`** {ref, t}; creates the key `<node>/b` |
| Move vertex | `ops.ts:moveVertex` | rewrites one vertex | **Node `moveVertex`** {ref, delta} |
| Delete vertex | `ops.ts:removeVertex` | removes a vertex | **Node `removeVertex`** {ref} |
| Offset outline | `model/modeling.ts:offsetSolid/offsetPlan`; Clipper2 fallback `eval/clipoffset.ts:clipperOffset` (in `modelOp 'offset'`) | rewrites the plan; the fallback may split it into several solids and **resets side settings and rule sides** | **Node `offset`** {d, corner}. Fallback pieces get keys `<node>/piece:i/side:j` (see B6) |
| Offset as a new volume | `modeling.ts:offsetCopy` (+ fallback pieces) | new `Solid` | **Node `offset`** with `copy: true` → a second output |
| Scale / size | `modeling.ts:scaleSolid`, `setSolidSize`; `editor.ts:applySize/scaleBuildingPlan/scaleBuildingHeight` | rewrites the plan / heights | **Node `scale`** {sx, sz, anchor} on a volume. Building-level scale stays a transform of every generator ([proposal]: keep it as a direct edit, see B6 "direct edits") |
| Move / rotate / mirror volume | `ops.ts:translateSolid/rotateSolid/mirrorSolid` | rewrites the plan | **Node `transform`** {matrix}. Plain moves while drawing fold into the generator (see B6) |
| Extrude face (side) | `modeling.ts:extrudeSide` → `sideVolume` | new `Solid` from a side | **Node `extrudeFace`** {ref: side, depth} → derived volume, live |
| Inset face (side) | `modeling.ts:insetSide` → `sideVolume` | new `Solid` (annex or cutter) | **Node `insetFace`** {ref, margin, depth, keepBottom} |
| Inset top / extrude top | `modeling.ts:insetTop` | new `Solid` on top; changes the source roof | **Node `insetTop`** {ref: top, inset, depth} |
| Split at height | `modeling.ts:splitAtHeight` | shortens the source and adds an upper `Solid` | **Node `split`** {y} → two outputs `lower`, `upper` |
| Top setback / podium / courtyard | `model/quick.ts:setbackOn, podiumUnder, courtyardIn` | new `Solid`s; edits the source | **Nodes `setback`, `podium`, `courtyard`** (macros over insetTop/offset/subtract) |
| Floors ± / levels / use | `quick.ts:changeLevels, fitLevels, setLevelHeights, applyUse` | building `levels`, solid heights | **Building params**, not nodes (levels are shared by every volume) |
| Align / distribute | `model/align.ts:alignSolids, alignBuildings` | moves solids / buildings | **direct edit** of generator placement (one history step) |
| Duplicate volume / building | `ops.ts:cloneSolid/cloneBuilding`; `editor.ts:duplicate` | copies | generator copy (unlinked). [proposal] later: an **instance** node (linked) |
| Facade rules, exceptions, detach / back to rule | `editor.ts:elemAction`; `Item.origin` | rule data, items | **Param** of the generator; refs to sides become `Ref` (B5) |
| Hosted items | `Item.host {solid, edge, u, y}` | references by IDs | `Ref` to a face (B5) |

## B4. forma/4 data model [proposal]

```ts
export const SCHEMA4 = 'forma/4' as const;

export interface Project4 extends Omit<Project3, 'schema' | 'buildings'> {
  schema: typeof SCHEMA4;
  buildings: Building4[];
}

/** Same as Building3 except `solids` → `graph`. */
export interface Building4 extends Omit<Building3, 'solids'> {
  graph: Graph;
}

export interface Graph {
  nodes: Record<ID, Node>;
  /** The building result: one node, normally a Combine (the forma/3 list becomes its items). */
  output: ID;
}

export type Node = VolumeNode | FreeSolidNode | OpNode | CombineNode;

interface NodeBase {
  id: ID;            // stable, never reused
  name: string;
  /** Blender modifier Realtime toggle: a disabled node passes its input through unchanged. */
  enabled: boolean;
  hidden?: boolean;  // view only, as today
  locked?: boolean;
  layer?: ID;
}

/** Generator: today's Solid without `op` (plan with stable vertex IDs, roof, rules…). */
export interface VolumeNode extends NodeBase, Omit<Solid, 'id' | 'name' | 'op' | 'hidden' | 'locked' | 'layer'> {
  kind: 'volume';
}

/** Generator: editable polyhedron (Phase 3 "free solid"), every vertex and face with a stable ID. */
export interface FreeSolidNode extends NodeBase {
  kind: 'free';
  verts: { id: ID; p: Vec3 }[];
  faces: { id: ID; loop: ID[]; material?: MaterialRef }[];
}

export type OpKind =
  | 'moveEdge' | 'curveEdge' | 'splitEdge' | 'moveVertex' | 'removeVertex'
  | 'offset' | 'scale' | 'transform'
  | 'extrudeFace' | 'insetFace' | 'insetTop' | 'split'
  | 'setback' | 'podium' | 'courtyard';

/** One operation on one input; outputs are named (most have only 'out'). */
export interface OpNode extends NodeBase {
  kind: 'op';
  op: OpKind;
  input: Port;
  params: Record<string, number | string | boolean>;
  /** Sub-elements it acts on, by name ('target', 'face'…). */
  refs: Record<string, Ref>;
}

/** Ordered fold, exactly forma/3: each item adds to / cuts / intersects what came before it. */
export interface CombineNode extends NodeBase {
  kind: 'combine';
  items: { input: Port; op: 'add' | 'subtract' | 'intersect' }[];
}

/** An output of a node: 'out', or a named one ('lower'/'upper' of split, 'copy' of offset). */
export interface Port { node: ID; out?: string }

/** Persistent reference (Onshape-style criteria, not a mesh index). */
export interface Ref {
  /** The node whose output it is resolved against (normally the op's own input). */
  in: Port;
  kind: 'vertex' | 'edge' | 'face';
  /** Stable key (B5): 'v:<vertexId>', 'side:<edgeId>', 'top', 'bottom', '<nodeId>/<role>[/…]'. */
  key: string;
  /** Last resolved geometry (building frame): only to draw a ghost of a lost reference. Never used to re-resolve. */
  hint?: { p: Vec3; n?: Vec3 };
}

/** Computed on every evaluation, never stored in the document. */
export type NodeStatus =
  | { state: 'ok' }
  | { state: 'disabled' }
  | { state: 'warning'; message: string }               // ran, but something changed meaning (e.g. side split)
  | { state: 'orphan'; ref: string; message: string }   // a reference did not resolve: the node was skipped
  | { state: 'error'; message: string };                // the operation itself failed (shape invalid…)
```

**Key point for FORMA's facades** [proposal]:
- Node outputs stay **parametric volumes** (rings + roof + rules, `VolumeOut[]`) for as long as possible.
- Only combine nodes (and free solids) go to Manifold.
- The reason: facade rules, face frames, side regions and roofs (`eval/body.ts:solidRings`, `eval/facade.ts`) need the parametric description.
- An op such as `moveEdge` transforms a `VolumeOut` (plan rewritten in memory, exactly today's `pushEdge` on a copy), never the stored generator.

## B5. Persistent references: how they survive, and how orphans are reported [proposal]

**Keys.**
1. **Generator keys:**
   - vertex `v:<PlanVertex.id>`;
   - side `side:<edgeId>` (`edgeId` = start-vertex ID, as today);
   - `top`, `bottom`;
   - a rounded or chamfered corner arc `corner:<vertexId>` (today `id:c`, `eval/body.ts:edgeOf`).
   - The keys already exist and are already stable: the schema promises IDs "never derived from coordinates".
2. **Op-created keys:** `<opNodeId>/<role>[/<sourceKey>]`, following Onshape's "id hierarchy must reflect creation history". Examples:
   - an extruded annex has `X/cap` (the new outer face) and `X/side:<k>` (its sides, named after the source side and its neighbours);
   - split has `S/lower`, `S/upper`, and the cut faces `S/lower/top` and `S/upper/bottom`;
   - `splitEdge` has `E/b` for the new half.
   - Roles are fixed per op type and never depend on mesh order.
3. **Through booleans:**
   - each face of the triangles sent to Manifold carries a `FaceTable` index as `faceID`, which "Input faceIDs will be maintained to the outputs" guarantees. `FaceInfo` gains the `key` and the producing `node`;
   - **optionally**, one `reserveIDs` ID per node marks the runs, so `runOriginalID` tells which node a triangle came from without a lookup, and `runFlags` bit 0 shows a subtract's backside;
   - a boolean **creates no keys**: faces of the result keep their operands' keys, and a face cut in two keeps one key on two patches.

**Resolution (every evaluation)** (Onshape "re-evaluated each time"):
1. Look the key up in the input port's key set (parametric volumes) or face table (meshes).
2. **Found once** → `ok`.
3. **Found on several patches** (a side split by a courtyard cutter):
   - ops that act on a whole face (paint, facade rule, push) act on all patches and stay `ok`;
   - ops that need one place (a hosted item at `u`, a vertex drag) use the patch that contains their parametric coordinate. If none contains it → `warning` "the point fell into a cut". Never Onshape's silent "takes the first resolved entity".
4. **Not found** → `orphan`:
   - the node is **skipped**, its input passing through unchanged like a disabled modifier;
   - downstream nodes still run on that input, and are themselves orphans only if *their* refs fail.
5. **Lineage, so meaning does not change silently.** Ops that replace an entity publish a lineage map in their output, e.g. `splitEdge` with `{ 'side:E': ['side:E', 'E2/b'] }` and `removeVertex` with `{ 'side:V': [] }`. Two kinds of consumers use it:
   - "Whole-side" consumers (facade rule `edges`, side paint, side bevel) follow the lineage to **all** descendants: a rule on side E keeps covering both halves.
   - "One-place" consumers (a hosted item, a vertex move) keep the primary key and become `warning` with the reason when lineage shows a split.

**Reporting** (Fusion yellow/red + "Review Warning" + "Reselect any missing geometry"):
- The Structure tab marks the node red (orphan or error) or yellow (warning), with a counter on the building row.
- The status bar warning icon lists them.
- The message names what and why, e.g. "Extrude 2: side 'b3af' of Block no longer exists (removed by 'Delete vertex' at step 4)".
- Actions:
  - **Reattach** shows the geometry just before the node, as Fusion rolls back on edit, and asks the user to pick a new sub-element. The `key` is updated as one history step.
  - **Delete** removes the node.
  - **Disable** keeps it.
- `hint` draws a dashed ghost where the reference was.
- **Never** re-resolve by nearest position (RESEARCH.md decision 12).

## B6. Direct edits vs nodes, combine and uncombine [proposal]

**Direct edits vs nodes:** the user asked for everything non-destructive. Recording every vertex drag as a node would make stacks long. Proposal:
- A sub-element edit **on the generator's own entities** while that generator has no downstream op nodes is applied to the generator. It is still non-destructive: the generator is parametric and the vertex keeps its ID.
- When downstream nodes exist, or when the entity was created by an op (`X/cap`), the edit becomes a node appended after the last node that produces that entity.
- Consecutive edits of the same kind on the same reference merge into one node, as the last-operation panel already redoes in place.
- **Apply** (Blender) folds a chain into the generator on request.
- **The user decides** whether drags on a "clean" generator should still be nodes.

**Combine / uncombine:**
- A building's output is a `CombineNode` whose items are today's solids in order, with their ops.
- **Combine** of selected volumes creates a nested `CombineNode` with those items in their current order, and replaces them in the parent by one item `{ input: newCombine, op: 'add' }`.
- **Uncombine** deletes the nested combine and puts its items back in the parent at its position. The operand nodes were never modified, so their IDs and every reference into them stay valid (operands are references, not consumed copies).
- A nested combine is drawn as a folder in the Structure tab. Dragging a volume in or out moves its item.
- Group parapets (today grouped by `topKey` in `evaluateBuilding`) are computed inside each combine over its own `add` members, which keeps today's result for the migrated root fold.

## B7. Incremental evaluation, cache, worker [proposal]

- **Data ID** (Houdini) per node: `hash(JSON(node definition minus view fields) + dataIDs of its input ports + building levels)`.
- **Cache** keyed by node ID, holding `{ dataID, output }`:
  - parametric outputs (`VolumeOut[]`, plain data);
  - Manifold handles only for combine results, freed when replaced (`kernel/kernel.ts:Scope` today frees everything at the end of an evaluation, so cached handles need their own owner and an LRU budget).
- **Pull evaluation** from `graph.output`: a node recomputes only if its data ID changed.
- **The final pass** (facade regions, placements, openings, plinths, interior cuts, `toShell`) depends on the final combine and the rules. Its own data ID is built from the final combine's data ID, the rules and the project types.
- **Drag:** the existing `preview` path stays (body only, no openings), and a full pass follows on release, as Houdini's "On Mouse Up".
- **Worker:**
  - `evaluateBuilding` is pure and has no three.js import (header of `eval/evaluate.ts`);
  - `loadKernel(wasmUrl)` already takes the WASM URL, so it can load inside a module worker;
  - message in: `{ buildingId, revision, building, types }`;
  - message out: `{ revision, shell (transferable typed arrays), faces, placements (plain), warnings, statuses }`;
  - results whose `revision` is stale are dropped;
  - the drag preview may stay on the main thread at first, to avoid one frame of latency: measure both.

## B8. Migration forma/3 → forma/4 [proposal]

`io/migrate.ts`: add `migrateForma4(raw)`. forma/3 input goes through the existing `migrateForma3` (validation + repairs), then `toForma4`:
1. **Each `Solid` becomes a `VolumeNode`** with **the same ID**, `enabled: true`, and `hidden/locked/layer` copied. Every existing reference therefore keeps working unchanged: `FacadeRule.edges`, `except` keys, `Item.host.solid/edge`, `Item.origin.solid`, `SelectionSet.sel.solids`, layer IDs.
2. A **root `CombineNode`** with `items = solids.map(s => ({ input: { node: s.id }, op: s.op }))` in list order, and `graph.output = rootId`.
3. Item hosts and rule sides stay in their forma/3 shape at this step. The `Ref` conversion is step 4 of B10, with its own migration.
4. **Not recoverable:** forma/3 annexes, setbacks and splits were copies with no link to their source. They migrate as independent generators, and the user is told once ("older derived volumes stay independent").
5. Tests:
   - a round-trip on the 11 samples: `evaluate(forma3)` and `evaluate(toForma4)` must give the same triangle count, volume and bounds (within 1e-6);
   - a validation test for every repair path.

Saving writes `forma/4`. Opening forma/1–3 keeps working. An older FORMA build cannot open forma/4: acceptable, but say so in the release note.

## B9. Risks

1. **Performance:**
   - per-node Manifold work can be slower than today's single fold for buildings with many volumes;
   - cached handles use WASM memory.
   - Measure rebuild ms per building and WASM heap before and after each step (Roadcraft CLAUDE.md).
2. **Facades on derived faces:** rules and hosted items on `X/cap` need face frames for op-created faces. `sideVolume` builds solids whose sides already get frames, so derived volumes should be emitted as `VolumeOut` (parametric), not as meshes.
3. **The Clipper2 fallback** (offset that splits the outline) creates sides without a source today; the code comment says "side settings and rule sides reset". Each piece's sides need deterministic keys (`<node>/piece:i/side:j`, ordered by the piece's lowest vertex), otherwise references into them break on every re-evaluation.
4. **Orphan cascades** after deleting an early node: the UI must group them ("3 steps depend on the deleted side").
5. **`editor.ts` (≈4,450 lines) assumes `Solid` everywhere** (handles, selection, dims, ctx bar). Mitigation: an adapter that exposes the evaluated `VolumeOut`s as read-only "virtual solids" with stable IDs, and routes every edit through `modelOp`-style commands that write nodes.
6. **Undo** stays a whole-project JSON snapshot (`editor/store.ts`). Graphs are larger, so watch the 200-step memory.
7. **Workspaces:** Ctrl+PageUp/PageDown may never reach the page in Chrome (A6), so check before relying on it.

## B10. Step-by-step plan (each step shippable and testable alone) [proposal]

| Step | What | Data model change | How it is tested |
|---|---|---|---|
| 0 | Evaluation in a worker (forma/3 as is); stale results dropped by revision | none | e2e: same pictures and the same `faces/placements` as the main-thread path; rebuild ms and frame ms before/after |
| 1 | Per-volume cache: `solidManifold` results keyed by a data ID of the solid; only changed volumes are re-meshed, the fold runs again | none | unit: the 2nd evaluation reuses N−1 volumes; e2e timings on 11 samples and on a 60-volume building |
| 2 | forma/4 schema with only `VolumeNode` + root `CombineNode`; `toForma4`, validation, save/open; editor through an adapter `volumesOf(building)` | `solids` → `graph` | round-trip equality on the samples; existing e2e suite green |
| 3 | Nested combine + **Combine / Uncombine** + Structure folders | `CombineNode` nesting | e2e: combine 2 volumes, uncombine, IDs and refs unchanged, result identical |
| 4 | `Ref` + resolver + statuses; facade rule sides, hosted items, selection sets converted to `Ref`; orphan UI (red row, message, Reattach/Delete) | `Ref` fields | unit: delete a vertex → rule side orphan reported, item not moved; e2e: Reattach picks a new side |
| 5 | Derived-volume ops as **live nodes**: extrude/inset face, inset top, split, setback, podium, courtyard, offset copy; **Apply** freezes | `OpNode` (derived) | e2e: extrude, then change the source height: the annex follows; Apply → independent generator |
| 6 | Plan-edit ops as nodes when downstream exists (moveEdge, curveEdge, splitEdge, moveVertex, removeVertex, offset, scale, transform) + merge of consecutive edits + lineage | `OpNode` (plan) | unit: lineage on split keeps rule coverage; e2e: edits upstream of an extrude keep the annex attached |
| 7 | Per-volume **history panel** (Blender modifier panel): enable eye, reorder by drag, delete, Apply, Review; Fusion-style "edit shows the state before the node" | none | e2e: disable/reorder/delete/apply each change the result as expected |
| 8 | **Free solid** generator (polyhedron with stable vertex/face IDs) and its face ops | `FreeSolidNode` | unit: push a face of a free solid; booleans with volumes keep keys |

## Open questions for the user

1. Workspace set: AUDIT (Model, Components, Materials, Interior, Present) or INTERFACE.md (Model, Materials, Interior, Light, Walk)?
2. Interior view state: keep it in the project (undoable, saved; it stays on in Model) or make it Interior-workspace state (Model always whole)? Recommended: workspace state.
3. Sub-element edits on a "clean" volume: written into the volume (still parametric) or always recorded as nodes? Recommended: into the volume while nothing downstream depends on it, otherwise a node.
4. A side that is split: facade rules follow both halves (recommended), or only the first?
5. Old derived volumes (annexes, setbacks, splits made before forma/4) cannot be relinked to their sources: acceptable to keep them as independent volumes?
6. Workspace keys if Chrome keeps Ctrl+PageUp/PageDown for itself: Alt+PageUp/PageDown?
