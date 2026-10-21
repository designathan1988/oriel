# Multiple selection, element groups and exceptions

Request: select several elements (box, Shift, Ctrl), see the building's
elements grouped (windows, doors…) with parameters, and leave some out of the
rule of the others (their own style, size or position).

State (2026-10-10): everything below is done and was used in the editor (5792):
window and crossing box, modifiers, a group that moves/copies/rotates/deletes
together, automatic groups with pre-highlight, "selected only" variation,
detach from the rule (without reflowing the rule) and back to the rule (with
the variation).

## References read

- SketchUp, *Selecting geometry* (help.sketchup.com/en/sketchup/selecting-geometry):
  Ctrl adds, Shift toggles, Ctrl+Shift removes; dragging to the right picks only
  what is fully inside the box, to the left also what it touches.
- Figma, *Apply overrides to instances*: the instance keeps only the
  differences from the main component; "Reset" undoes; "Detach" takes it out of
  the rule.
- Revit (type × occurrence): the type applies to every occurrence; for some to
  differ, the type is duplicated and their type swapped.
- three.js r170 `SelectionBox`: tests only the center of each object. Here each
  element's box is projected (8 corners) to tell "fully inside" from "touched".

## Model (what already existed and what comes in)

- Element = an occurrence of a facade rule (`r|solid|rule|position`) or a free
  component (`i|item|copy`). Already there: Row, Column, Grow, Shrink, Same
  type, Face; swap type; remove; "selected only" creates a **variation** of the
  type (Revit: duplicate type) just for them.
- **Automatic groups**: the building lists the elements by family category
  (Windows, Doors, Balconies…), and within it by type, with counts. Variations
  appear under the source type. A click selects the group; the modifiers work
  as in the model. The group parameters are the type's ("All of the type");
  changing with "Selected only" creates the variation.
- **Detach from rule** (Figma: detach): the element becomes a free component in
  the same place (the rule leaves the position empty) and is then moved and
  sized on its own. It keeps its origin; **Back to rule** deletes the free part
  and gives the position back to the rule.

## Interaction

| gesture | effect |
|---|---|
| click | replaces the selection |
| Ctrl+click | adds |
| Shift+click | toggles |
| Ctrl+Shift+click | removes |
| Alt+click (element) | the span between the last one and this one |
| drag on empty space, or with Ctrl/Shift anywhere | selection box |
| box →  | window: only what is fully inside (solid border) |
| box ←  | crossing: what it touches (dashed border) |

Outside a building the box picks buildings; inside, elements (only those on
faces facing the camera, so the back is not picked) and components; with no
elements in the box, it picks volumes. The box modifiers are the same as the
click's.

## Commands and selection sets (2026-10-11)

References read: Blender manual, *Selecting* (Select All A, Invert Ctrl+I,
Select Grouped Shift+G by type) and *Show/Hide* (H hides the selection, Shift+H
the rest, Alt+H shows everything); Revit selection sets (Save Selection names a
set kept in the project; a recalled set no longer holds deleted elements).

| key | effect |
|---|---|
| Ctrl+A | everything in the context: buildings outside, volumes inside, elements when elements are selected |
| Ctrl+I | inverts in the same context |
| Shift+G | similar: same use (buildings), same operation, corners and height (volumes), same type (elements) |
| H | hides the selection |
| Shift+H | hides the rest (only adding volumes: hidden cutters would still cut) |
| Alt+H | shows every building, volume, component, layer and category |

Selection sets live in `Project3.selectionSets` (`model/selsets.ts`): a set
keeps the building, the other buildings, volumes, elements and component.
Saving under an existing name replaces that set. Recalling drops what was
deleted, hidden or locked; when the main building is gone, the next one in a
set of buildings leads. The Structure tab lists the sets above the tree (click
recalls, double click renames, the bin deletes the set, not the elements); the
search (Ctrl+K) lists them too.
