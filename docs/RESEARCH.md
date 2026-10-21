# FORMA 3: research and decisions

A short record of what was read and what was decided. Each decision points to its source.

## Sources read

Direct modeling
- SketchUp, inference and axis locks: https://help.sketchup.com/en/sketchup/introducing-drawing-basics-and-concepts
- SketchUp, Push/Pull: https://help.sketchup.com/en/sketchup/pushing-and-pulling-shapes-3d
- SketchUp, measurements box (`5x`, `5/`): https://help.sketchup.com/using-measurements-box
- SketchUp, rotate, mirror, arrays: https://help.sketchup.com/en/sketchup/flipping-mirroring-rotating-and-arrays
- SketchUp, components (Glue To, Cut Opening): https://help.sketchup.com/sketchup/creating-basic-component
- SketchUp, dynamic components (copies by length): https://help.sketchup.com/en/sketchup/repeating-sub-component-within-dynamic-component-1-dimension
- SketchUp, Solid Tools: https://help.sketchup.com/sketchup-ipad/solid-tools
- Blender, modifiers, Boolean, Array, Bevel, Solidify: https://docs.blender.org/manual/en/latest/modeling/modifiers/introduction.html
- Blender, snapping and numeric input: https://docs.blender.org/manual/en/latest/editors/3dview/controls/snapping.html, https://docs.blender.org/manual/en/latest/scene_layout/object/editing/transform/control/numeric_input.html
- Archipack (walls, windows with automatic holes, roofs): https://github.com/s-leger/archipack/wiki
- Rhino 8, Gumball: https://docs.mcneel.com/rhino/8/help/en-us/commands/gumball.htm
- Rhino 8, PushPull, Osnaps, History, ArrayCrv, Loft: https://docs.mcneel.com/rhino/8/help/en-us/commands/
- Townscaper (blocks that resolve corners and roofs from their neighbors): https://www.gamedeveloper.com/game-platforms/how-townscaper-works-a-story-four-games-in-the-making

Parametric architecture
- Revit, families, type × instance, nesting: https://help.autodesk.com/cloudhelp/2024/ENU/Revit-Customize/files/GUID-921F7A15-D191-4F75-8243-4989C482E253.htm
- Revit, curtain wall (Fixed Distance, Fixed Number, Maximum Spacing, Justification): https://help.autodesk.com/cloudhelp/2018/ENU/Revit-Model/files/GUID-B9263125-74EA-4C78-AAAA-F40916EFE2DB.htm
- Revit, roof by footprint (slope and overhang per edge): https://help.autodesk.com/cloudhelp/2016/ENU/Revit-Model/files/GUID-682B3B19-A4F7-4EE7-B994-F3EA3154BB08.htm
- Revit, railing (pattern, Spread Pattern to Fit, excess): https://help.autodesk.com/cloudhelp/2023/ENU/Revit-ArchDesign/files/GUID-426BE12E-A906-457B-A205-A5DFF08B07D7.htm
- Revit, hosted part that does not fit ("Can't cut instance out of wall"): https://help.autodesk.com/cloudhelp/2019/ENU/Revit-Troubleshooting/files/GUID-3C9C035F-BFA8-44A5-923A-C4E75F5D5E1C.htm
- Archicad, Curtain Wall Scheme (Best Division, locks): https://help.graphisoft.com/AC/26/INT/_AC26_Help/040_ElementsVB/040_ElementsVB-157.htm
- Archicad, multi-plane Roof and Shell (extruded, revolved, ruled): https://help.graphisoft.com/AC/29/INT/_AC29_Help/150_UserInterfaceToolSettings/150_UserInterfaceToolSettings-4.htm, ...-5.htm
- Archicad GDL, hotspots that edit parameters: https://gdl.graphisoft.com/gdl-basics/hotspots-graphical-editing
- Vectorworks, window parameters: https://app-help.vectorworks.net/2021/eng/VW2021_Guide/Windows/Inserting_windows.htm
- Chief Architect, automatic roof per wall: https://www.chiefarchitect.com/support/article/KB-00758/generating-automatic-hip-and-gable-roofs.html
- FreeCAD BIM (window, wall, roof per edge, stair with Blondel, arrays): https://github.com/FreeCAD/FreeCAD-documentation/tree/main/wiki
- Autodesk Forma, 3D sketch and floors by function: https://blogs.autodesk.com/forma/2026/04/21/how-to-create-a-3d-sketch-building-in-forma-site-design/
- CityEngine CGA, split/repeat/comp and roofs: https://doc.arcgis.com/en/cityengine/latest/cga/cga-split.htm

Technique
- Manifold (robust 3D booleans, face IDs preserved): https://github.com/elalish/manifold, https://manifoldcad.org/docs/jsapi/classes/manifold.Manifold.html
- three-bvh-csg, problems with coplanar faces: https://github.com/gkjohnson/three-bvh-csg/issues/199, /issues/210
- three.js TransformControls r170 and r186 (source compared), ExtrudeGeometry, LatheGeometry, Path
- three.js, async render target read: `WebGLRenderer.readRenderTargetPixelsAsync`; MDN WebGL best practices: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices
- That Open Components, `SnapResolver` (points, lines, faces): https://github.com/ThatOpen/engine_components

## Measurement

manifold-3d 3.5.4 in Node (10 ms startup). A building from scratch, with a union, a courtyard, openings and per-floor voids:

| volumes | floors | openings | time |
|---|---|---|---|
| 20 | 6 | 120 | 30 ms |
| 20 | 10 | 400 | 45 ms |
| 40 | 15 | 900 | 92 ms |

## Decisions

1. **Real solids with 3D booleans (Manifold).** Each volume becomes a closed solid. Union, difference and intersection stay in the document as live operands, and the result is recomputed (a Blender modifier, not SketchUp's destructive Solid Tools). This also resolves volumes meeting: the upper volume and the lower roof become a single solid, with no parts passing through.
2. **Roofs as solids** joined to the body: straight skeleton (hip, gable, mansard), shed, gambrel, dome by revolution, vault by extruding an arc, pyramid and cone.
3. **Plan with arcs** (a vertex with a `bulge`, like a CAD polyline), rounded and chamfered corners per vertex. Taper and leaning walls per side: the top is an offset of the base, and the volume is the solid between the two rings (Rhino Loft with straight sections).
4. **Facade by the visible region of each face.** Manifold keeps the source face ID on each triangle of the result. The part of each face left after the booleans defines where windows fit: a wall hidden inside another volume gets no window.
5. **Components that open their own gap** (SketchUp Cut Opening, Archipack AutoBoolean): windows, doors and gates attached to a face carry the cut and follow the face when it changes.
6. **Repeat by length** (SketchUp dynamic component, Blender Array): count = floor(length / step), by count, distance or between ends. Stretching the facade adds parts instead of stretching them.
7. **Shared definition**: editing the type changes every occurrence; "make unique" creates a new type for that occurrence.
8. **One manipulation widget** (Rhino Gumball): arrows to move on the ground, an arc to rotate around Y, a height handle, push and pull faces with a live preview and dimensions.
9. **Inference and measurements box** (SketchUp, Blender): snapping to vertex, midpoint, edge, axis, parallel and same height; locks by key; type the value during or right after the operation, with `5x` and `5/` for copies.
11. **Family → type → occurrence** (Revit, FreeCAD): the family is a pure function `parameters → parts` with a declared schema (unit, range, type or occurrence). The occurrence keeps its position and overrides, marked in the interface with "back to type".
12. **A hosted part never moves on its own** (Revit): it keeps the distance along the face and the elevation; if the face changes and it does not fit, it is marked invalid and reported, never silently repositioned.
13. **Four distribution modes** for windows, columns, brise-soleil, balusters and posts (Revit, Archicad): fixed distance with justification, maximum spacing, fixed count and best division.
14. **Roof with per-edge parameters** (Revit, FreeCAD, Chief): each edge chooses whether it slopes, with which pitch and overhang; with nothing set, all slope. Vaults and domes by extrusion and revolution (Archicad Shell).
15. **Stair derived from the height** (FreeCAD, Revit): `n = ceil(rise / max riser)`, railing generated along.
16. **Computation in the worker.** The document goes to the worker, which returns arrays; the screen never freezes. During a drag, only the body is rebuilt.
