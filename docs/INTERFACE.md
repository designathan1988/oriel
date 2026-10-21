# FORMA: interface redesign

Goal: the look of a professional application (Figma, Shapr3D, Plasticity,
Spline), not of a form. The 3D view fills the screen; the interface floats in
compact islands and only shows what the selection asks for.

## What is wrong today (analyzed on 2026-10-10)

1. The fixed catalog at the bottom takes ~25 % of the height: 96 px cards with
   32 px icons, tabs with a scrollbar, two visible scrollbars.
2. The side panel is a form: a label above each field (two lines per value),
   uppercase titles, large outlined buttons, help paragraphs ("3 volume(s)…",
   "The eye hides…"), boxes inside boxes, the bottom half empty.
3. The left toolbar has no groups: 12 loose icons with letters.
4. The top bar has text buttons (Templates, New, Open, Save) like a website.
5. The status bar has a long hint, two selects, statistics and the measurements
   box fighting for space.
6. The contextual bar has text labels ("Add Subtract Intersect").
7. Notices and messages in the middle of the view, over the model.

## Principles

- Screen first: nothing fixed takes the view except a thin bar at the top.
- Floating islands, 10 px corners, soft shadow, graphite theme (translucent
  dark panels over the light scene); light theme optional later.
- Density: 26 px rows, 12 px font (11 px labels), 16 px icons, 4/8 px spacing.
  No paragraphs: hints in tooltips and in the `?` shortcut.
- Inline properties: a short label on the left or inside the field
  ("W 8.00 m"), dragging the label changes the number, Enter applies, arrows
  change by the step. Pairs (X/Z, W/D) on the same row.
- Collapsible sections, remembered per selection kind.
- Option buttons become segmented icon groups (operation, roof, alignment)
  with tooltips.
- Context rules: the selection defines the floating bar near the object and
  the inspector sections; tools that do not apply disappear.
- Command search (Ctrl+K): any tool, command, component or material by name.

## Layout

```
┌ bar (40 px): ◆ FORMA · project name · saved   [Model|Materials|Interior|Light|Walk]   ↶ ↷ · ⌘K · Export ┐
│ ┌tool     │                                                                     ┌ inspector (280 px) ──┐ │
│ │island   │                       3D VIEW                                       │ Properties|Layers    │ │
│ │ (36 px) │                                                                     │ collapsible sections │ │
│ │ groups  │          [contextual bar next to the selection]                     │                      │ │
│ │ submenu │                                                                     │                      │ │
│ └─────────┘                                                                     └──────────────────────┘ │
│  [breadcrumb: Project › Building 2 › Tower]         [Library ▴]       [measure 10x8] [grid ▾] [cube]     │
└───────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Top bar**: brand, editable name with state (saved/saving), work modes in
  the center (Model, Materials, Interior, Light, Walk), on the right undo/redo,
  command search and Export; New/Open/Save/Templates go to the project menu
  (click the brand).
- **Tool island** (left, floating): groups with a submenu on press and hold —
  Select; Draw (rectangle, circle, polygon, arc); Modify (push, extrude, inset,
  offset, bevel, split); Place (library); Paint; Measure (tape, dimension,
  protractor); Section.
- **Inspector** (right, floating, collapsible, adjustable width): Properties
  and Layers tabs; a header with an editable name and type; collapsible
  sections with compact rows.
- **Library** (a drawer that rises from the bottom on click or with K):
  categories in a column on the left, search, a grid of 72 px thumbnails with
  short names, favorites; Blocks, Components, Materials and Objects in the same
  drawer.
- **Contextual bar**: icons only (with tooltips) next to the selection.
- **Bottom right corner**: compact measurements box, grid/snapping and a view
  cube (top, front, sides, perspective, frame).
- **Messages**: a small toast in the bottom left corner; warnings in an icon
  with a counter that opens the list.

## Interface components (ui/kit.ts)

`row(label, control)`, `num(key, value, unit, step)` with label dragging,
`pair(a, b)`, `seg(options)` with icons, `color(key)`, `section(id, title,
body, open)`, `iconButton`, `menu`, `popover`, `tooltip`. Every panel uses the
kit; no loose HTML with inline styles.

## Implementation order

1. Theme and kit (tokens, typography, rows, sections, segmented controls, tooltips).
2. Shell: top bar with modes, tool island with groups, floating inspector with
   tabs, corners (measurements, grid, cube), toast and warnings.
3. Inspector rebuilt on the kit (building, volume, face, corner, component,
   elements, rules, bands, align).
4. Library as a drawer (blocks, components; then materials and objects).
5. Command search (Ctrl+K).
6. Layers rebuilt on the kit.
7. Browser check, picture by picture, at 1280×720 and 1920×1080.

After that, already on the new interface: procedural materials, light and
night, interiors and walking, objects.


## v2 (2026-10-10): tools in view

Request: "an interface has to have tools"; nothing hidden in a collapsed
section, submenu or bottom bar. References: the Blender edit mode toolbar
(docs.blender.org/manual/en/latest/modeling/meshes/tools/toolbar.html: Move,
Rotate, Scale, Extrude, Inset, Bevel, Loop Cut, Knife… all visible) and the
Revit contextual Modify tab (selection actions grouped, icon and name).

- Left bar: Select, Move (M), Rotate (Q), Scale (S) | Push (P), Extrude (E) |
  Rectangle, Circle, Polygon, Add/Subtract | Library, Paint, Tape. Move/Rotate/
  Scale show only the handles of that action.
- Select is enough: the selection shows move, rotate, corners, an arrow on each
  face and the green vertical arrow; a visible handle is a clickable handle in
  any tool.
- Actions (ui/actions.ts) in a single list for the contextual bar, the right
  click menu and the search: building (edit, floors, duplicate, rotate,
  delete), several (align, distribute), volume (add, subtract, intersect,
  extrude, inset, offset, split, bevel, round, chamfer, setback, podium,
  courtyard, floors, duplicate, mirror, delete), windows (row, column, same
  type, face, detach/back to rule, swap, remove), component. An action with a
  value applies the default and accepts retyping.
- Right button without moving: a menu with the same actions; dragging orbits
  the view.
- "View" island (grid, rotation, time, snapping, frame) on the right; the
  bottom bar only has the hint, the value and the count. Panel sections are not
  collapsed by default. Cut-off text checked in the DOM in 8 states.
- 2026-10-11: the fixed "Modify" strip was replaced by the contextual bar next
  to the selection (docked panels, Figma UI3) and the last operation panel.

## Panel standard (2026-10-11)

Request: fields organized and always the same way; related values side by side
(before, Height sat above Width and next to Base); icons where they help.
Sources: Figma pairs X/Y and W/H with a short label inside each field and
dragging the label changes the value
(help.figma.com, "Adjust alignment, rotation, position and dimensions");
Blender groups each property's X/Y/Z with a lock per axis
(docs.blender.org, Object Properties > Transform).

- **One row pattern** (`ui/kit.ts`: `prow`, `numCell`, `selectCell`,
  `colorCell`): a short label with a 14 px icon in a fixed column, then one to
  three cells on a single 6-column grid (one cell = half, two = half each,
  three = a third each, `wide` = the whole width), so columns line up from row
  to row and section to section. No free-flowing grid of fields.
- **Related values share a row**: Position X·Y·Z (a building's Y is its
  elevation, a volume's Y its base), Size W·D·H, Corners round·chamfer,
  Bevel top·base, Slope·overhang, Copies·distance, Rows·spacing, Floor height
  ground·upper, Spread mode·value, Place justify·margin, the W·H(·D) of a
  component.
- **Glyph inside each cell**: the axis letter colored like the gizmo arrow
  (X red, Y green, Z blue), a letter (W, D, H) or an icon; dragging the glyph
  changes the number (Shift ×10, Alt ÷10); the full name is the tooltip and the
  accessible name.
- **Units**: lengths are in meters and are not written (like Figma's px); only
  degrees (°) and percentages show a unit. The dimensions in the view say "m".
- **Section order**: title (name and kind) → what is selected inside (face,
  corner) → Transform → Size → Shape/Floors → Edges → Roof → Bands → Facade →
  Materials; a building: Transform → Floors → Use.
- **Action buttons**: equal columns (`.f3-btns`, 3 or 2 per row), icon and a
  short label, the full name in the tooltip; never a ragged wrap. Segmented
  choices wrap instead of shrinking their text.
- **Narrow panel** (under 268 px of content): the label goes above its cells
  and action buttons drop to 2 columns; nothing is cut.
- **Fields and tooltips**: a value applied with Enter is applied once (the change
  Chrome fires when a redraw removes the focused field is dropped). A tooltip
  never shows over the field being typed in, nor after a click or a key until
  the mouse really moves (like the native title). A disabled control lets the
  click through to what is behind (it closes menus); why it is disabled is the
  tooltip of its label.
- The same rows are used by the properties panel, the last operation panel,
  the paint (material) panel and the interior view panel; popover titles use
  the section heading style, not a menu caption.
- Test: `e2e/f3.spec.ts` "panels: related values share a row…" (every sample,
  volume, face, corner, elements, align and paint at 240 and 300 px: no label,
  value, choice or button cut; X·Y·Z and W·D·H in one row each).
