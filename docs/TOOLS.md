# FORMA: tool arsenal

Inventory of everything a builder needs to make any building, with the real
state in the code (checked on 2026-10-10) and how each tool enters FORMA. Sources
at the end. State: **ok** exists and was used in the browser; **partial** exists
with gaps; **missing** does not exist. Updated 2026-10-21: every row is now **ok**.

## Principle

FORMA stores parametric volumes (plan + height + roof + rules), combined by
booleans in list order. Mesh tools from modelers (Blender, 3ds Max, SketchUp)
enter as **non-destructive operations in the document**, like Blender
modifiers: the result stays editable by numbers in the properties panel and is
rebuilt on every change. Nothing becomes a loose mesh.

## 1. Create

| tool | reference | state | in FORMA |
|---|---|---|---|
| Rectangle, circle, polygon on the ground or on a slab | SketchUp | ok | tools R, C, L |
| Ready blocks (L, U, T, cross, cylinder…) | Townscaper, Forma | ok | Blocks catalog |
| Arc / free curve in plan | Rhino, SketchUp | ok | Arc (Shift+C), Curve (Shift+P, free-hand drag), bend a side |
| Spin a profile (revolve) | Blender Spin, Rhino Revolve | ok | revolved volume (profile points, sides) |
| Sweep a profile along a path (continuous cornice) | SketchUp Follow Me | ok | sweep family (low wall, coping, cornice along a path) |

## 2. Model volumes (face, edge and vertex operations)

| tool | reference | state | in FORMA |
|---|---|---|---|
| Push/pull a side face | SketchUp Push/Pull | ok | handle and "Push" field |
| Height (pull the top) | SketchUp | ok | green handle and field |
| **Extrude face** (new volume from the face) | 3ds Max Extrude, SketchUp Ctrl+Push/Pull | ok | side face → annex (add) or recess (subtract) the size of the face; top → new stacked volume |
| **Inset face** (with depth) | Blender Inset (thickness + depth), Max Inset/Bevel | ok | side face → projection or loggia with margins; top → setback volume (depth > 0) or well/atrium (< 0) |
| **Plan offset** (parallel outline) | SketchUp Offset, Rhino Offset (sharp/round/chamfer corners) | ok | moves the plan inward/outward keeping arcs; apply to the volume or create a new volume |
| **Bevel of horizontal edges** | Blender Bevel (width, segments, profile) | ok | volume parameter: bevel at the top and base, segments, straight↔round profile, per side |
| Chamfer/round vertical corners | Blender Bevel Vertices, Rhino Fillet | ok | all corners or the chosen corner |
| Lean a wall | Max Hinge | ok | per-face field |
| Taper the top | Max Taper | ok | field |
| **Scale** the volume (width, depth) | SketchUp Scale | ok | width and depth fields of the bounding box |
| **Split volume** at a height | Blender Bisect, Max Slice | ok | splits into two editable volumes (different materials and setbacks) |
| Move vertex, split side, delete vertex | SketchUp, Blender | ok | vertex handles, "Split side" |
| Add/subtract/intersect booleans | Rhino, Blender Boolean | ok | per volume, editable |
| Mirror, duplicate, array | all | ok | Ctrl+D, 5x, 5/ |
| Bridge between volumes | Max Bridge | ok | Bridge (two selected volumes), loft |

## 3. Parametric elements

| tool | reference | state | in FORMA |
|---|---|---|---|
| Families with parameters (window, door, balcony…) | Revit families | ok | ~75 types |
| Type × occurrence (changing the type changes all) | Revit type/instance | ok | facade and free parts show type and instance parameters |
| Fully editable facade rule | Revit curtain grid, Archicad | ok | type, floors, mode, value, margin, sill, alignment, sides, parameters, exceptions |
| Variation of a group | Revit duplicate type | ok | "Edit only these" |

## 4. Organize

| tool | reference | state | in FORMA |
|---|---|---|---|
| **Layers** (visible, locked, color, active) | SketchUp Tags, Rhino Layers | ok | project layers; volumes and free parts have a layer; locked = visible and not selectable |
| **Visibility by category** | Revit Visibility/Graphics | ok | hide windows, doors, balconies… in the view |
| **Element tree** | SketchUp Outliner | ok | building → volumes → parts; click selects; eye and lock |
| Hide / isolate selection | Revit Hide/Isolate | ok | eye in the tree; isolate volume |

## 5. Precision and measurement

| tool | reference | state | in FORMA |
|---|---|---|---|
| Measurements box (10, 10x8, 5x, 5/) | SketchUp VCB | ok | |
| Inference (vertex, midpoint, axis, parallel) | SketchUp | ok | |
| Grid and stepped rotation | all | ok | status bar |
| Tape measure and dimensions | SketchUp Tape/Dimension | ok | T |
| Align and distribute | Illustrator, Max Align | ok | |

## Implementation order

1. Parameters visible when clicking any element; complete facade rule.
2. Extrude face, Inset face, Offset, Bevel (top/base/per side/one corner), Scale, Split at height.
3. Layers, visibility by category, element tree, hide/isolate.
4. The five validation buildings with these tools.

## Sources

- Blender Inset Faces: https://docs.blender.org/manual/en/latest/modeling/meshes/editing/face/inset_faces.html
- Blender Bevel: https://docs.blender.org/manual/en/latest/modeling/meshes/editing/edge/bevel.html
- 3ds Max Edit Poly (polygon): https://help.autodesk.com/cloudhelp/2026/ENU/3DSMax-Modeling/files/GUID-FF7D7633-03AD-4427-821A-65F8AC484CDD.htm
- SketchUp Offset + Push/Pull: https://sketchup.trimble.com/en/blog/article/thick-walls-offset-tool
- Rhino Offset: https://docs.mcneel.com/rhino/8/help/en-us/commands/offset.htm
- SketchUp Tags: https://help.sketchup.com/en/sketchup/controlling-visibility-tags
- Rhino Layer: https://docs.mcneel.com/rhino/8/help/en-us/commands/layer.htm
- Revit Visibility/Graphics: https://help.autodesk.com/cloudhelp/2023/ENU/Revit-GetStarted/files/GUID-FB8D0ABE-8521-4EA0-A47E-FF3DEBC403A5.htm

## Request queue (2026-10-10, in this order)

1. Real textures (PBR) and quality glass/doors without losing performance. (done: procedural on the GPU + photographed)
2. Materials panel: colors and textures with thumbnails, search and free color; apply with the bucket on a face, area, volume or part; paint over buildings and apply images (decals); a floor of its own for terraces. (done)
3. Night: night mode, lit windows (by floor, random or chosen), facade lights and street lamps. (done: time of day, rooms by the awake fraction, wall lights and street lamps; face parts in a right-handed frame)
3b. Manipulation and selection (urgent, 2026-10-10): size handles, pre-selection, roof items on the roof, multiple selection (box, Ctrl/Shift), automatic element groups, detach/back to rule. (done: docs/SELECTION.md)
4. Easy interiors: view section by floor, interior walls, interior doors and windows, slabs, stairs; replicate floors. Walk mode inside (first person, open doors and windows, climb stairs). (done: E in walk mode opens or closes the door or window looked at; doors have an opening angle, casement, sliding and sash windows a share open)
5. Indoor and outdoor objects (furniture, trees, vegetation, street furniture) from ready libraries.
6. Validations 2 to 5 (apartment block with verandas, factory, curved, irregular with a courtyard), save/open/export.
7. Complete interface redesign (less text, right-sized icons, well-used space).
