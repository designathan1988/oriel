# FORMA 3: plan

Goal: a complete 3D constructor (houses, apartment blocks, factories, sheds,
shops, public buildings, curved and irregular buildings), with direct modeling,
parametric components and export to the game. Sources and decisions in
`docs/RESEARCH.md`. A phase only closes after it has been used in the browser.

## Architecture

```
src/f3/model      forma/3 document, forma/2 migration, operations (no three)
src/f3/kernel     Manifold: solids, booleans, cuts (no three)
src/f3/families   component families: parameters → parts (no three)
src/f3/eval       building → shell + parts + face regions + selection map (no three, runs in a worker)
src/f3/render     evaluated data → three.js
src/f3/editor     scene, selection, widget, tools, inference, measurements, history
src/f3/ui         contextual bar, compact inspector, catalog
```

Document: Project → Buildings (move and rotate as a whole) → Levels, Solids
(plan with arcs, base, height, taper, per-side lean, corners, add/sub/int
operation, roof, facade rules, materials) and component Occurrences (hosted on
a face, free, on a path or on the roof, with arrays). Component types live in the
project, linked to the occurrences.

## Phases

A. Solid core: forma/3 schema and migration; solids (plan with arcs, corners,
   taper, lean); solid roofs (flat, shed, gable, hip, mansard, gambrel, dome,
   vault, pyramid, sawtooth); live booleans; face regions; cut openings;
   evaluation in the worker; rendering. Done when: volumes that meet become one
   solid, a setback over a roof without a part passing through, a real dome.

B. Direct editor: building/solid/face/edge/component selection; widget (move
   on the ground, rotate around Y, height); push/pull a face; draw rectangle,
   polygon, arc, circle, curve; inference (vertex, midpoint, edge, axis,
   parallel, same height) and a measurements box with `5x`/`5/`; booleans from
   the selection; taper, lean, round, chamfer with handles; undo.

C. Components: parametric families (windows, doors, gates, balconies,
   verandas, railings, grilles, walls, fences, columns, beams, stairs, ramps,
   canopies, awnings, brise-soleil, cornices, pilasters, ornaments, chimneys,
   skylights, water tanks, solar panels, industrial elements); linked types and
   occurrences, make unique; arrays along a line, grid, curve and face; facade
   rules with four distribution modes; catalog with search, thumbnails,
   favorites and drag; save, import and export custom components.

D. Floors and structure: building levels; interior walls, slabs with cuts,
   stairs and ramps between levels, terraces, columns and beams; interior in
   section; walk mode.

E. Wrap-up: lots and indices; styles; ready models rebuilt in forma/3; save,
   open, full GLB/OBJ export and JSON for the game; performance; the five
   validation buildings; documentation.

## Validation (phase E)

From scratch, in the browser: a house with a pitched roof; an apartment block
with verandas; a factory; a curved building; an irregular building with an
inner courtyard. Change sizes after assembling, booleans, linked components,
save, open, export.

## Master plan (2026-10-13): everything that is left

The user asked for everything left to be done, decided without questions. The inventory (code read
item by item, audit reports in `C:/Codex-Shared/forma-audit`) is the list below; each step is
researched, coded, checked (`npm run check`), used on 5797 and committed. Order: defects, interface,
non-destructive core, selection and tools, properties, catalog, materials, interior, wrap-up.

Decisions taken (the questions that waited for the user):
1. Workspaces: Model, Components, Materials, Interior, Present (the audit set; light and walking live
   in Present). The choice is a UI preference (`localStorage`), never a project edit.
2. The interior view state (hidden body parts, cut, exploded) is state of the view, kept per browser,
   not an undoable project edit; leaving the Interior workspace keeps it (one place to turn it off).
3. A sub-element edit on a volume nothing depends on is written into the volume (still parametric,
   IDs kept); when an operation depends on it, the edit becomes a node.
4. A split side: facade rules and side settings follow both halves.
5. Older derived volumes (annexes, setbacks, splits made before forma/4) stay independent volumes.
6. Workspace keys: Alt+PageUp/PageDown (Chrome keeps Ctrl+PageUp/PageDown for its tabs) and Ctrl+K.
7. D16: right after a drag, digits go to the measurement (SketchUp: type to correct what was just
   done); Esc ends it, and 1/2/3 change mode again. Kept as is, said in the measure box.
8. D3: the building dimensions measure the body (walls, roof and eave), not awnings or balconies; the
   box still wraps everything.
9. F12: Floor + raises every volume tied to the floors (the tower too), as the relations do.
10. A drawn volume gets floors from its building use (residential 3.1 m, industrial one floor up to
    12 m); floors stay per building (an annex with other floors is another building).
11. forma/4: the node design of `docs/research/workspaces-and-nodes.md` (generators, operations,
    combine nodes, persistent references, orphans reported, never re-guessed).
12. IFC import is left out (a BIM model does not map to editable volumes); DXF outlines are imported.

### Stage 1: defects
- [x] F11 a choice that changes nothing records nothing and says nothing (store, panel, bar).
- [x] F13 Duplicate (and Mirror, about the group's middle) with several volumes; D34 a duplicated
      volume or component lands beside the original, clear of other volumes and buildings. Found on the
      way: mirroring turned outward arcs inward (fixed, tested).
- [x] D28 a part placed outside every building goes to the one being edited, the nearest within 30 m,
      or a new "Site" building (a building without volumes places its free and path parts); drawing a
      path shows the line and its lengths (it showed a meaningless "0; 0").
- [x] D4 subtract mode lasts for one shape (leaving the drawing tools turns it off).
- [x] E8 library card text; category names (Railings, Fences and hedges, Garden walls); view cube
      arrows to the neighbouring faces on a face view (Autodesk ViewCube).
- [x] E3 the Clipper2 offset keeps the identity of the sides (materials, rules, exceptions, hosted parts
      moving to the piece that got their side; `adoptOffsetSides`).
- [x] B2 the Shift cut shows the height from the ground (and up the volume); B3 split pieces are named
      "(upper)", "(upper 2)" and keep only the rules and exceptions of their floors. The cut tool picks
      the wall through windows and openings (it failed over a window).
- [x] C4 a volume made on a side (annex, niche) follows its wall when the wall moves, turns or changes
      length (relation 7 in `model/relations.ts`, anchored like hosted parts).
- [x] Offset "as a new volume" goes on top of the source, one floor high (a setback or overhanging
      storey), not inside it.
- [x] F5 the cut tool and Split keep a curved side curved (two arcs; Split straightened it before) and
      the new half keeps the rules; C1 a shed (industrial, up to 12 m) is one floor of its body's height,
      a door taller than its floor gets shorter to fit; C3 the dock canopy counts in its size.
- [x] A2 a finish change brings the finish's colors; ↺ gives one overridden parameter back to the type.
- [x] D27 windows on rounded corner arcs (repeating rules; a fixed count per side does not put a door on
      each corner); position keys of a corner parsed as such (`keyParts`).
- [x] Skeleton stops after a count of events, not 250 ms of clock (no purity exception left); triangles
      without area are left out of the drawn shell (zero normals in the GLB).
- [x] D3 building dimensions measure the body (walls, roof, eave). Hip vs Gable on a curved front: they
      differ (gable ends found on the short sides; checked in Node). D6 curved walls smooth: normals summed by position (the booleans left a duplicate vertex), walls
      textured along their outline, shadow normal offset 8 cm (the flat segments shadowed each other).
- [x] Functional sweep (2026-10-21, real app, scripted): all 26 tool keys, Ctrl+K (prefix ranking fixed), help,
      the 22 Export entries (downloads, no errors), save/open round trip of every new field, all 11 roof
      kinds, view cube, grid, time, layers, copy/paste/undo: no error, no problem reported.

Ideas taken from "Estúdio de Construção" (a smaller three.js + Manifold constructor the user sent on
2026-10-13; only its ideas, reimplemented here):
- [x] Opening tool (O): a click on a wall puts a window on that floor; a rectangle dragged on a wall
      opens a chooser (window, door, French door, shopfront, open bay, balcony, canopy, annex, niche),
      the default guessed from the rectangle (on the floor: door; wide on the ground floor: shopfront).
- [x] "Repeat on facade": a free part on a wall becomes a facade rule on every floor (its sill, width).
- [x] Drop chooser: a building dropped through another asks Join / Subtract / Intersect / Keep apart.
- [x] Several volumes: Join, Subtract (the others carve the first), Intersect, Separate (a volume becomes
      a building of its own).
- [x] Typed "5f" (floors) for a height and "dx;dz" for a move; numpad views 1/3/7 (Ctrl: opposite), 0
      home. An arrow seen end-on is hidden (the vertical arrow stole drags in a top view).
- [x] Numpad 5 perspective/parallel; touch (two fingers pan and zoom) and a narrow layout; dragging a
      roof changes its pitch.

From its version 3 (sent the same day):
- [x] Twist a volume (degrees, top turned against the base) and top scale (taper); a handle on the top.
- [x] Revolve a profile (domes, towers, silos); sphere, dome and pinnacle primitives; sweep a profile
      along a path (`sweep` family: low wall, coping, cornice, kerb, gutter, typed profile).
- [x] Linear and ring (radial) arrays and mirror X/Z as live modifiers of a volume; hollow shell
      (`Solid.shell`, a cutter made at evaluation).
- [x] A rectangle drawn on a wall is pulled out or carved in (R on a wall); drag a wall to curve it,
      snapping to straight and to a half circle. [ ] Circle and polygon on a wall. [x] An arch drawn as an opening (Opening tool:
      arched window, arched door).
- [x] A rule element's size "only at this position" (`FacadeRule.sizes`, handles on one selected element).
- [x] Size handles on any part of any family (`eval/partsize.ts`: the parameter behind each side found by
      a finite difference); component creator (`ui/creator.ts`: any family, every parameter, live picture;
      library +, Design on a part, Ctrl+K).

From its version 4:
- [x] Lots and streets (`model/site.ts`, `render/site.ts`, `editor/tools/site.ts`, `ui/site.ts`): a lot tool (rectangle or corners), streets with a width and sidewalks, lots
      along a street on both sides, lot setbacks (front, sides, back; side 0 = semi-detached), a
      warning for a building in the setbacks, "Build" a house / residential / commercial building in
      the buildable area, split a lot into equal fronts, trees along the sidewalk. Also: a drawn lot faces
      the nearest street; lots along a street skip the street, other lots and standing buildings;
      overlapping lots are reported.
- [x] Stair tool (click the foot and the end, then the height; `editor/tools/stair.ts`); helical repeat
      (rise and turn per copy); export for the game as a .zip with the .glb (`io/zip.ts`, stored ZIP
      after PKWARE APPNOTE; `game.json` + `buildings/<id>.glb` in their own frame + `scene.glb`).

### Stage 2: interface and navigation
- [ ] `editor.ts` split by tool and mode (`editor/tools/*`, selection, dimensions, keys).
- [ ] One command registry (`ui/commands.ts`): tool bar, keys, Ctrl+K, help, menus, contextual bar.
- [x] Workspaces (Model, Components, Materials, Interior, Present; `ui/workspaces.ts`). [x] Light theme and system theme; preferences (theme, navigation preset), `ui/prefs.ts`.
- [x] Parallel (orthographic) view: Numpad 5, the ∥ button on the cube; navigation presets (FORMA/Revit,
      SketchUp, Blender); touch: two fingers pan and pinch.
- [x] Screen-space selection outline (OutlinePass). [ ] Handles without allocation per frame.
- [x] Layout checked at 1280×720, 1440×860 and 1920×1080 (photos). [ ] 2560×1440.

### Libraries adopted (2026-10-13, research report in the session)
- [x] three-mesh-bvh (picking), Manifold slice (filled sections), @tarikjabiri/dxf + dxf (DXF with arcs),
      jsPDF + svg2pdf.js (drawings at scale), fflate (zip), glTF-Transform + meshoptimizer (compact GLB),
      Overpass + Nominatim (OSM neighbourhood, place search), three USDZExporter (AR), web-ifc (IFC4
      export validated in tests), OutlinePass (selection outline).
- [ ] Next candidates: meshopt simplifier LOD for heavy parts; clipper2-ts for the model-layer booleans
      (drop polygon-clipping); three upgrade to 0.186 (all reference pictures change).

### Reference software map (ArchiCAD, Revit, SketchUp, Blender, 3ds Max, Rhino; 2026-10-13)
Done this session: Walls tool (building from walls with real thickness, free walls), Room tool (by
rectangle or click inside walls, with outer walls), room labels, floor finish per room, wall/door/room
panels, Slab, Column and Beam tools, interior wall corners editable.
Backlog (P1 first):
- [x] P1 Walls: reference line (axis/inner/outer; tool options, 2026-10-21); curved by the midpoint handle of a
      side; height follows the floors (typed in floors, Floor ±).
- [x] P1 Wall types with layers (model/walltypes.ts: ceramic and concrete block, concrete, drywall, insulated
      double wall); thickness = their sum; layer lines in the floor plan (SVG, PDF, DXF A-WALL-PATT).
      Layers in the section too (io/sectionsvg.ts, only where the wall is cut solid).
- [x] P1 Curtain wall per face (families/curtainwall.ts: U/V grids at most a spacing apart, border and interior
      mullions, glass panels, opaque band at each floor; selected side → Curtain wall). Door panel in a bay of the ground row (doorBay).
- [x] P1 Shafts and atria: a cutter drawn inside a building opens every slab it crosses, and the floor
      areas leave it out (model/lots.ts levelAreas). Slabs per level: Slab tool (outline, thickness).
      [ ] Holes and cantilevers edited on a slab of its own.
- [x] P1 Pitch per side on hip, gable, mansard and gambrel roofs (weighted straight skeleton; selected side
      → Roof pitch; EdgeSpec.pitch).
- [x] P1 Railings: on stairs (the stair family's rails), around a selected top (terrace, slab edge: panel and
      bar → Railing around), drawn on a flat top at its height. [ ] Edge host kept by a relation.
- [x] P1 Rooms: use, ceiling height (a lowered ceiling board when below the slab), perimeter and volume;
      room schedule CSV with totals by use (io/schedule.ts); quantities and areas CSV already there.
- [x] P1 Terrain from points (modified Shepard, back to 0 within 40 m; Shift+T), pads under buildings and
      streets, lots tinted on it, contours in 3D, site plan and ground floor plans, section and elevations,
      exports (2026-10-21). [ ] From contours; sculpt.
- [x] P1 Elevations (SVG/PDF, painter with creases); floor plans with interior walls, doors, rooms. [x] Elevations in DXF with hidden lines removed by a depth buffer (io/elevationdxf.ts).
- [x] P1 Dimensions and labels saved in the project (Project3.notes; Tape tool, Shift+click a label,
      Alt+click deletes); measured on one building they follow it. [ ] Tied to vertices (associative).
- [x] P1 Saved scenes (camera, time, interior view, floor cut, layers; view bar → Scenes, ui/scenes.ts).
- [x] P1 Building instances: linked copies (Ctrl+Shift+D, Building3.linked); an edit of one is made on all,
      each keeps its position, rotation, name and lot; Make independent.
- [ ] P2 Corner window; curved interior walls; trim/extend; openings in interior walls; door swing in plan.
- [ ] P2 Roof by profile, openings in roofs; stair landings/winders; ramp tool; elevator core.
- [ ] P2 Grid axes with labels; automatic beams between columns; section box; guide lines; loft by
      several sections; mirror about a drawn axis; transfer properties; component from selection.
- [ ] P2 Parking along a path; renovation phases; view styles (white model, x-ray); design options.

### Procedural objects and methods (research 2026-10-13: three agent reports in the session)

Done: grown plants (`families/plantkit.ts`, the method of ez-tree's tree.js, MIT, and Weber & Penn 1995):
bark tubes and crossed leaf cards from a canvas foliage atlas (`render/foliage.ts`: 8 cells, alpha test
with alpha-to-coverage, coverage-preserving mipmaps, normals bent out of the crown, kept out of the
GTAO pass); 7 broadleaf species, 4 conifers, palm, 3 shrubs, ornamental grass, fern, beds, meadow;
blossom on leaf tips. ez-tree itself is not a dependency (4 MB of embedded textures, imports three, Phong).

Next, by impact (sources: three.js r170 docs, Infinigen v1.19 BSD-3, Archipack/Archimesh GPL (ideas
only), Müller 2006 CGA, CityEngine docs, Houdini Labs, TestFit, Forma):
- Engine: creased normals on profile meshes (mergeVertices + toCreasedNormals ~35°); a rounded box
  primitive (RoundedBoxGeometry, segments 1, r 2–5 mm); bevel on prism/slab; a profile swept along a
  closed contour with mitres (window/door frames, panels, worktops, mouldings); lathe with creases.
- Per-type mesh prototypes instanced across occurrences (street trees become occurrences), LOD from the
  same skeleton (ez-tree generateLODs: 40 % / 20 %) and a far impostor; wind on leaf cards with the
  time from the View clock (frozen in the visual check).
- Families: kitchen cabinets (Infinigen kitchen_cabinet sizes: 0.45 m cells, 18–20 mm boards, single
  door ≤ 0.6 m), appliances, sanitary ware by lathe/loft, upholstered sofa/bed (subdivided), lighting,
  curtains; classical column (one lathe with entasis, fluted profile), turned balusters, raised-panel
  doors; truss, container, dock leveller, conveyor; playground, kiosk, traffic signs, hydrant, power
  pole with catenary; monument plinth and obelisk.
- Methods: CGA size algebra in facade rules (absolute, relative, floating `~`, repeat `*`); semantic
  face selection (street front/side); occlusion tests (a window touching another volume becomes wall:
  a relation); snap lines across solids; per-edge roof pitch and gable flag (Chief Architect); typology
  presets with live metrics (TestFit, Forma); detail propagation (BricsCAD BIMPROPAGATE).

### Stage 3: non-destructive core (forma/4)
- [ ] Evaluation of edits and of opening a project in the workers; per-volume cache.
- [ ] forma/4 schema (graph), migration from forma/3, save/open, adapter for the editor.
- [ ] Nested combine, Combine/Uncombine, groups in the Structure tab, reorder by drag.
- [ ] Persistent references, statuses, orphans (red row, message, Reattach/Delete).
- [ ] Derived operations as live nodes (extrude, inset, split, setback, podium, courtyard, offset
      copy, bridge) and Apply; plan edits as nodes when something depends on them, with lineage.
- [ ] Operation stack panel (enable, reorder, delete, apply); free solid generator and its face ops.
- [x] Named and automatic versions in IndexedDB (project menu → Versions…). [x] Undo history across reloads (last 40 steps, io/history.ts).

### Stage 4: selection and tools
- [x] Alt picks the building behind the selected one; select row / column / grow / same type (loop and ring
      on facades). [ ] Component mode (4).
- [x] Editable dimension labels; value typed next to the cursor; expressions in fields and in the measure
      box; formulas between component parameters.
- [x] Arc drawing (Shift+C: chord ends, then a point of the arc). [x] Spline outlines (Shift+P, smooth points); copies along a drawn line. [ ] Free hand curve. [x] Mirror with copy and axis; radial arrays (ring,
      helix); booleans between chosen volumes (Combine); twist handle.
- [x] Same height when dragging a top; contact snapping (face against face, vertex, centered and aligned on a neighbour).
- [x] Revolve, sweep (family), bridge and loft generators.

### Stage 5: properties and tree
- [x] Layer in the panel; W·D·H lock (proportions kept); building size; floors table (name, height).
- [x] Information (footprint, gross floor area, volume), lot and indices sections.

### Stage 6: catalog
- [x] Counts, recents, tag filters, hover preview, thumbnails cached across sessions.
- [x] Furniture, vegetation, street furniture, pools, grilles; component creator (every parameter);
      import/export of components; formulas between parameters.

### Stage 7: materials
- [x] Project material library (save, name, reuse, change everywhere); pattern editor (base, joint, pattern
      parameters). [ ] Masks; sphere thumbnails.

### Stage 8: interior
- [x] Interior walls drawn per floor, interior doors, slab openings (a stair opens the slab it reaches),
      stairs tied to floors, structural grid (columns, `model/structure.ts`), copy a floor's walls up, walk mode.

### Stage 9: wrap-up
- [x] Lots and indices; game JSON with every component; building styles. [ ] forma/2 migration of what is left.
- [x] Sun by date, latitude and north; plans, sections and areas (SVG/DXF); DXF import.
- [ ] Performance items (material key per face, incremental sync and inference, batched unions,
      reuse of family meshes, LOD); the five validation buildings from scratch; docs.

## Verification (2026-10-13): seconds, not hours

The old gate timed medians of evaluation runs against ms budgets, measured frame times in a visible
Chrome and ran 39 gesture tests with 56 fixed waits (10.4 min): slow, and blind to what it did not
replay. Replaced by `npm run check` (`CLAUDE.md`, "The check"): static rules, work counts and eight
fixed scenes captured once against references, about 30 s, pixel-identical between runs.
- [x] Static rules (`test/unit/arch.test.ts`), counts (`test/unit/budget.test.ts`), scenes
  (`e2e/scenes.ts`, `e2e/visual.spec.ts`), `View.settled`, the 56 waits replaced by state waits.
- [x] The straight skeleton stops after a count of events (it stopped after 250 ms of wall clock).

## CURRENT (2026-10-11): professional FORMA

Audit done by using the app (5792) and reading the code; the full plan, with the
causes and the sources, is in `docs/AUDIT-2026-10-11.md`. User decisions:
everything non-destructive, including vertex/edge/face, with combine and
uncombine; defects first, then interface and navigation. Since 2026-10-11 the
code, interface, files, folders and docs are all in English.

Phases: 0 seen defects · 1 new interface (single command registry, HUD next to
the selection, workspaces) · 2 navigation (middle button pans, wheel zooms at
the point under the cursor, Shift+middle orbits) and selection outline · 3
non-destructive node core (forma/4, free solid, persistent references) · 4
selection modes and dimensions editable on the label · 5 tools v2 (Clipper2
offset, 3D contact snapping) · 6 properties and tree · 7 parametric catalog with
a family editor · 8 layered material editor · 9 interior · 10 performance and
validation.

Phase 0:
- [x] A saved project reopens: `#rgb` becomes `#rrggbb`, an unreadable color
  becomes gray with a note (before, one color rejected the whole project); sample fixed.
- [x] Box, handles and dimensions from the real bounds (`eval/bounds.ts`: the shell
  after the booleans and parts; a cutter does not count, roof, eave and awnings do).
- [x] Outlines with depth testing (strong in view, faint behind).
- [x] The yellow square between the arrows (TransformControls r170) moves on the
  gizmo plane and follows the cursor; size handles became 9/7 px squares.
  Tests: `e2e/f3.spec.ts`.
- [x] Dimensions out of the panels (they move aside or hide); frame (F) fits the box
  corners in the free area and centers there (`View.frame`, `Editor3.freeRect`).
- [x] Inspector without losing clicks or focus: redraw once per frame, never with
  the mouse button down in the panel, focus and typed text return to the field.
  Values typed after a strip action work (the failure seen in the audit was a
  click misplaced by the emulated screen, not the app).
- [x] Building use with an effect (`applyUse`): CTBUH floor-to-floor heights
  (residential 3.1 m, office 3.9 m), ground floor (door, shopfront, dock) and
  windows; heights remapped by level (`setLevelHeights`): a tower that rose above
  the roof still does.
- [x] A selection click no longer re-evaluates the whole project or saves:
  `Store.revert` without a change does nothing (before ~300 ms per click,
  headless) and the time of day no longer creates `view` on open.
- [→ Phase 1] Hint that follows the pointer, toast and status bar text: part of
  the shell redesign (the toast is already readable; the hint is the normal hover).

Phase 1:
- [x] Fixed panels (Figma UI3): tools, docked library, view, a resizable and
  collapsible right panel, status bar; over the view only the breadcrumb, the
  View island, the contextual bar and notices.
- [x] Contextual bar next to the selection instead of the fixed strip: Move,
  Rotate, Scale and the main actions; the rest under "More". Orbiting the view
  only repositions the bar (before, it redrew the panel every frame).
- [x] One function, one name, one place: "Floor +/−"; the panel does not repeat
  bar buttons; rotation moved to "Position and rotation".
- [x] Last operation panel (Blender, Adjust Last Operation): Offset, Extrude,
  Inset, Split, Bevel, Round, Chamfer with every parameter; changing a value
  redoes in place (one history step; another commit ends the adjustment). The
  operation forms left the properties panel.
- [x] Everything in English: code, comments, interface, file and folder names,
  docs; numbers with a decimal point (a comma is still accepted when typing).
  Renamed IDs keep working in saved projects (`win-basculante` → `win-hopper`,
  `builtin:moderno|comercial|torre` → `builtin:modern|commercial|tower`).
- [x] View cube (Autodesk ViewCube): 26 standard views, animated camera, Home;
  a true top view (pitch limit 0.001 rad).
- [x] Navigation redone and tested with real drags: orbit pivot (model under the
  cursor, else selection, else model), pitch sign fixed (it stuck at the limits and
  jumped), eye never under the ground, drag ends on any release, zoom without
  sliding at the limits, middle button without autoscroll, sky without one-frame
  lag, GTAO only around the buildings, stable shadow map (texel snapping).
- [x] Rooms behind windows fit the real volume section (tapered/leaning towers).
- [x] Properties | Structure | Layers tabs (Structure: filter, expand/collapse,
  show all, isolate, kind icons, rename by double click, layer dot).
- [x] Hover pre-selection is an outline only (the veil and overlays darkened the
  buildings in the GTAO pass: overlays, sky and pivot mark stay out of it).
- [x] Dimensions editable on the label (Revit temporary dimensions): click, type,
  Enter; Tab goes to the next; the total height lands exactly on the typed value.
- [x] Dimension labels never over one another or over a handle, at any distance:
  placed like map labels (Mapbox/MapLibre variable anchors: nearest free spot
  around the anchor, the height first, hidden only if nothing within 72 px is
  free; `editor/labels.ts`), 0.42 ms instead of 1.26 ms per redraw. A side facing
  away is measured on its top edge (before, its label floated over the front
  facade). Tests: `test/unit/f3-labels.test.ts`, `e2e/f3.spec.ts` (176 states).
- [x] Offset that never breaks the volume: blended corner arcs, a miter limit,
  and Clipper2 (`CrossSection.offset`) when the exact offset loses the shape.
- [ ] Workspaces.

Gizmo and floors (request of 2026-10-11: "do not confuse the green gizmo with
floors"; sources: Rhino 8 Gumball, TransformControls r170, Blender
Transformation Gizmos; floors as a property in Autodesk Forma and levels in
FormIt):
- [x] The gizmo only moves and rotates: red/blue move along the axes, the yellow
  square on the ground, **green moves vertically** (whole building and volume),
  the ring rotates.
- [x] White squares = size (corners/sides; on a volume, the top one is the height,
  floor by floor; Alt is free). Orange arrows = push/pull a face.
- [x] Floors: a "− N floors +" stepper on the contextual bar and a field in the
  panel; slab lines on the selected building. No floors on the gizmo.
- [x] Building elevation (`elevation`) in the document; vertical snapping to the
  ground and to the top of the buildings below (volumes: other tops/bases and
  level elevations).

Phase 4 (selection; sources: Blender manual Select Grouped and Show/Hide,
Revit selection sets):
- [x] Ctrl+A selects everything in the context (buildings outside, volumes inside,
  elements when elements are selected), Ctrl+I inverts; hidden and locked are
  never picked.
- [x] Select similar (Shift+G): same use (buildings), same operation, corners and
  height (volumes), same type (elements). The samples got their real uses.
- [x] H hides the selection, Shift+H hides the rest, Alt+H shows everything; one
  implementation used by the keys, the menus, the search and the Structure tab.
- [x] Named selection sets saved in the project (`selectionSets`, validated on
  open): saved from the Structure tab or the menu, renamed by double click,
  recalled by a click (entering the building when needed) or from Ctrl+K; what
  was deleted meanwhile is dropped.
- [x] Every selected building shows its box (before, the others only had a thin
  ground outline that vanished at a distance); the breadcrumb says "N volumes".
- [x] Vertex / edge / face modes (Blender 1/2/3, the same key goes back to
  volumes; a switch under the breadcrumb): corners and sides picked on screen
  (what the model hides is not picked, the top corner sits on the seen parapet),
  pre-highlight, Shift toggles, Ctrl adds, several corners or sides of one volume;
  the selection converts between modes like Blender's. Corners: round, chamfer,
  delete, drag. Sides: move, curve, split, bevel, drag. Faces: click and push.
  (`eval/subelements.ts`.)

Interior view (request of 2026-10-11: hide exterior walls, roofs, ceilings and
see every floor; sources: Revit Visibility/Graphics model categories, section
box and Displace Elements (exploded axonometric), Matterport dollhouse floors,
the 1.2 m plan cut plane):
- [x] Hollow buildings on demand (`eval/interior.ts`): one void per floor inset
  by the wall (0.2 m), slabs 0.25 m, openings through the wall, cutters keep their
  walls; the fake rooms behind the glass are left out. Evaluated only while the
  interior view is on.
- [x] "Interior view" on the View island: eyes for exterior walls, interior walls,
  roofs, floors, ceilings (only the shell mesh is rebuilt); parts hosted on a
  hidden wall or roof go with it.
- [x] Walls and slabs keep their volume: hidden exterior walls are cut away as a
  solid, so slab edges and wall ends show the dark section (poché).
- [x] Cut at a floor (1.2 m above it, ground floor included), only that floor,
  and exploded floors: each floor from its slab to its plan cut, lifted by a
  gap the slider changes without re-evaluating (36 ms); the roof goes on top.
  Editing is blocked while exploded (the floors are drawn apart).
- [x] Room-side walls cast shadows only toward the sun (three.js shadowSide);
  curtain shader chained (a procedural fabric showed its raw channels, magenta).
- [ ] Exploded evaluation costs ~1.2 s for the 11 samples (one intersection per
  floor): measure on big projects and move it to the worker if needed.

## Audit follow-up (2026-10-12): relations, composition, roofs, openings

Defects of the full audit (`forma-audit/CONSTRUCOES.md`, `AUDITORIA.md`) fixed at their cause.
Measured on the player's machine (visible Chrome, RTX 3060, D3D11) and in Node.

- [x] Persistent relations kept on every edit path (`model/relations.ts`, run by the Store on each
  touch and commit, so drags, panel fields, menus, undo and opened files behave the same):
  a volume resting on another (`on`) goes up and down with it and keeps its height (D3; before only
  some paths called `carryRiders`); a volume's top on a floor (`topLevel`, Revit Top Constraint +
  Top Offset) follows the floors exactly, the height above the last floor stays what it was (before,
  `setLevelHeights` scaled it by the floor ratio: 8 → 12.06 m, 25 → 32.58 m); a cutter through a
  wall (`through`) keeps going through when the wall bulges or moves out (D2); a part on a side keeps
  its distance to its anchor (start, middle, end; Lipp et al. 2008), so a centered window stays
  centered (E2). A relation that cannot hold (support deleted, rider off its support) stays in the
  file, shows as a warning and comes back with undo. Tests: `test/unit/f3-relations.test.ts`.
- [x] One path for the floor count: the panel field calls `changeLevels` like Floor ± (B1: with a
  setback, 8 → 12 said "Floors changed." and nothing grew). Every floor change says the resulting
  height. A volume drawn alone gets floors that fill its typed height (A1/C1: a 3 m house had a
  3.4 m floor).
- [x] Facade exceptions with anchored locators (`eval/facade.ts`, `rowLocators`): the middle window
  stays the middle one and a window by a corner stays by it when the spacing or the width changes;
  an exception without a window in the new layout is reported and kept, and comes back; cutting a
  side moves the end-anchored ones with the end (E1, E4). Tests: `test/unit/f3-exceptions.test.ts`.
- [x] Composition by contact (`model/compose.ts`): a volume drawn through a building, or a building
  dropped through another, joins it (one body, the booleans join walls and roofs); Alt while dropping
  keeps them apart; touching side by side stays apart (an annex may have other floors).
- [x] One roof over adjacent volumes with the same top and sloped roof (`eval/roofgroups.ts`): the
  union outline gets the straight skeleton, like an L drawn as one plan (before: a V gap with hip, a
  gable end against the slope with gable). Tests: `test/unit/f3-roofgroups.test.ts`.
- [x] Openings without the big boolean (`eval/rooms.ts`): the rooms behind the windows of a facade
  row are built as one closed mesh (their exact 2D union, a skyline, cut in slabs, each face keeping
  its room's ID for the night lights), cutters are subtracted in layers that do not touch (A − (B ∪
  C) = (A − B) − C). Same solid as the old union (symmetric difference ≤ 2·10⁻⁶ m³); photos before
  and after differ by ≤ 0.32/255 on average. Evaluation of a 30×30 m, 20-floor tower 294 → 155 ms,
  a 40-floor one 541 → 304 ms (Node, median of 5); vertex merging with numeric keys.
- [x] A view change never freezes the interface (`editor/view.ts`): when only the view changed
  (interior view, cut, exploded), the buildings are drawn a few per frame, nearest first, with the
  count in the status bar; each building keeps the drawing of the other view, so going back is a
  swap. 200 buildings on the RTX 3060 (visible Chrome): Cutaway 6.25 s frozen → the click answers in
  128 ms, but drawing it all still took 3.9–8.4 s with frames of 83–146 ms (that number was the click,
  not the work, and the work was not less than before); Show all 7.2 s → 34 ms (a swap); reopening
  6.8 → 4.5 s, full evaluation 7.1 → 4.0 s.
- [x] View changes in workers, kept per view, batched (`eval/pool.ts`, `worker/eval.worker.ts`,
  `render/batch.ts`, `editor/view.ts`): the buildings of a view change are evaluated by two workers
  (Manifold in each), the main thread only builds meshes within 8 ms a frame; each building keeps up
  to three drawings (whole, cutaway, exploded) by revision, in the batches too (hidden), so going back
  is a visibility switch; buildings at rest are drawn by BatchedMesh per material in chunks of at
  most 262 144 vertices and 2 048 instances (one growth never uploads more than 9 MB), culled per
  building and per pass (camera, sun shadow); a new shader variant compiles off-scene first
  (KHR_parallel_shader_compile) while the old drawing stays. 200 buildings, frozen build, headless
  Chrome on the RTX 3060 (D3D11): Cutaway click 9–14 ms, drawn in 3.5 s, frame p95 16.8 ms, worst
  83 ms (2 of 205 frames over 33 ms), no long task; Show all and Cutaway again 14–16 ms, worst frame
  ≤ 33 ms; Exploded drawn in 5.4 s, p95 33.4 ms, worst 50 ms. At rest: draw calls 1 847 → 189, render
  CPU 9.0 → 3.5 ms, GPU 8.5 → 4.6 ms (whole), 7.6 → 6.4 ms (exploded).
- [x] View-only changes are view updates (`render/parts.ts` `setHidden`, `editor/view.ts`): a component
  category hidden or shown switches meshes (and batch instances) by category, nothing is rebuilt
  (200 buildings: click 137–180 ms → 10–11 ms, no frame over 33 ms); a hidden building is not
  evaluated for a view it is not seen in (hiding a layer evaluated all its buildings); other parts
  changes go a few buildings per frame. Measured with no evaluation and no new mesh: hover, select,
  rename, time of day, lock, hide, deselect, layer eye; finishes only redraw the shell (above).
  Picking goes through parts of a hidden category.

## Queue (2026-10-11, in this order)

1. [x] Panels organized and standardized (user request): one row pattern in every
   panel (properties, last operation, paint, interior view), related values side by
   side (Position X·Y·Z, Size W·D·H, …), axis letters and icons in the fields, equal
   columns of action buttons; shortcut modal headings aligned (audit D13). Details in
   `docs/INTERFACE.md`, "Panel standard". Panel build 3.6 ms (was 3.4 ms), only on a
   selection change.
2. [x] Defects found by the end-user audit (`forma-qa`, report outside the repo):
   D1–D38 of the first audit and N1–N7 of the second fixed (tests in
   `e2e/f3.spec.ts` and `test/unit`). Open: D27 (windows on a rounded corner arc;
   only the radius is clamped to half the shorter side); D16 after a real drag and
   D3 wait for the user (questions in item 3).
   - [x] Undo/redo re-evaluate only the buildings that differ (`Store.restore`, like
     `revert()`): one edit undone on the 11 samples, 11 → 1 building re-evaluated,
     Ctrl+Z 265–310 ms → 59–68 ms, redo 47–55 ms (5792, in-app pane).
   - [x] A panel value applied with Enter was applied again when the field was left
     (Chrome blurs the focused field the redraw removes): two history steps for one
     edit, the first Ctrl+Z doing nothing, and one more evaluation of the building
     (up to 56 ms on the samples). The panel drops a change fired by its own redraw.
   - [x] Floors keep their ID (and a name the user gave) when the count or the
     heights change (panel field, ± floor, a block above the top); the interiors of
     floors that go are removed (a saved file refused "interior on a missing level").
     The same count typed again is no change.
   - [x] The balloon of a field never shows while typing in it (it covered the row
     below after each redraw).
   - [x] Exploded gap without rebuilding: the floors are lifted in place (only the Y
     of shell and part positions and of instance matrices; bounds from each floor's
     own Y range, `render/lift.ts`) and the gap left the visibility keys. Same meshes
     and draw calls (a group per floor would multiply them by the floors). Per gap
     input: S 28.6 → 2.6 ms; L (200 buildings, 356k shell triangles) 531 ms (agent,
     headless) → 6.9 ms, the two frames after it 26.5 ms; through 0 mid-drag no
     longer re-evaluates everything (S 266/305 ms → 2.6 ms). UVs come from the floors
     in place (the finish keeps its courses at any gap).
   - [x] Undo of a view-only step (gap, cut, hidden parts, layers) leaves it to the
     view keys, like its commit: nothing re-evaluated for a gap; L undo of one edit
     66–70 ms (agent: 4 479 ms).
   - [x] A click on a building while exploded only selects it; the "set Floors apart
     to 0" message waits for a real drag (4 px). Disabled controls let the click
     through (`pointer-events: none`; Chrome sends them no pointer event): a click on
     the disabled Redo closed no menu.
   - [x] Keep the normal evaluation for the interior view (agent proposal 3: each building keeps
     the drawing of every view by revision, `editor/view.ts` stash); [ ] cut the parts per band once
     (proposal 4).
   - [x] User reports (2026-10-11 night) and third audit F1–F10: a niche's depth goes
     through its wall (out = projection, in = niche; volumes remember their wall,
     `host`, inferred for saved projects); plinth and parapet are chosen by clicking;
     a cutter offers "Top of the cut" instead of roof chips (Hip on a selected niche
     carved a wedge); Cut tool (U): a wall into two faces, Shift across at a height,
     two points on a top cut the volume; Extrude on a chosen top; bevel segments kept
     without a width; arrows on rule fields; honest messages for Back to rule,
     distribute (needs three) and Isolate; the contextual bar avoids the warning;
     Podium under a one-floor volume lifts it. The full functional sweep by the
     agent continues (`forma-audit/RELATORIO-3.md`).
3. Workspaces (Phase 1). Questions for the user before starting: which workspace set
   (audit list or INTERFACE.md list); interior view state in the project or only in
   the workspace; sub-element edits on a clean volume written in place or as nodes;
   split side and facade rules; old derived volumes; shortcut if Chrome keeps
   Ctrl+PageUp/PageDown; D16 (1/2/3 after a drag: digits or modes); D3 (building
   label with or without awnings).
