// The one registry of the tools: the tool bar (groups, icons, flyouts), the single-key shortcuts and
// the command search (Ctrl+K) all read it, so a tool, its icon, its name and its key are written once.
// `find` is the longer name the command search shows and matches (what the tool does).

export interface ToolDef {
  /** A Tool of the editor, or 'catalog' / 'door' / 'window' (library, door and window placing). */
  id: string;
  ic: string;
  label: string;
  /** Shortcut as shown: a letter, or Shift+letter. */
  key: string;
  /** Tooltip line under the name. */
  tip: string;
  /** Name in the command search. */
  find?: string;
}

const T = (id: string, ic: string, label: string, key: string, tip: string, find?: string): ToolDef => ({ id, ic, label, key, tip, ...(find ? { find } : {}) });

/**
 * Groups of the tool bar, in the order a building is made: icons only, the name and key on hover.
 * Tools of the same kind share one button whose other tools open from it (press and hold, or a right
 * click). Nothing is hidden by a mode and no tool appears twice.
 */
export const TOOL_GROUPS: { id: string; tools: ToolDef[] }[] = [
  { id: 'select', tools: [T('select', 'cursor', 'Select', 'V', 'Click to select; drag the arrows to move, rotate or size', 'Select and move')] },
  {
    id: 'move',
    tools: [
      T('move', 'move', 'Move', 'M', 'Drag to move; type a distance'),
      T('rotate', 'rotate', 'Rotate', 'Q', 'Drag to rotate; type an angle'),
      T('scale', 'scale', 'Scale', 'S', 'Drag a corner to size; type a factor', 'Scale and size'),
    ],
  },
  { id: 'walls', tools: [T('walls', 'wall', 'Wall', 'W', 'Click point to point and type the lengths; inside a building it divides the floor', 'Walls (outside: a building; inside: divides the floor)')] },
  {
    id: 'door',
    tools: [
      T('door', 'door', 'Door', 'D', 'Click a wall to put a door'),
      T('opening', 'opening', 'Opening', 'O', 'Drag a rectangle on a wall: balcony, canopy, niche, shopfront', 'Opening on a wall (window, door, balcony, annex, niche)'),
    ],
  },
  { id: 'window', tools: [T('window', 'window', 'Window', 'J', 'Click a wall to put a window')] },
  { id: 'room', tools: [T('room', 'room', 'Room', 'Shift+R', 'Click inside walls: a named room with its area', 'Room (click inside walls: name and area)')] },
  {
    id: 'slab',
    tools: [
      T('slab', 'flat', 'Slab', 'Shift+F', 'Click the corners of a slab on the floor shown'),
      T('column', 'pillar', 'Column', 'Shift+K', 'Click on the floor shown'),
      T('beam', 'row', 'Beam', 'Shift+B', 'Click its two ends'),
    ],
  },
  { id: 'stair', tools: [T('stair', 'floorUp', 'Stair', 'Shift+I', 'Click the foot, then where it ends', 'Stair (foot, end, then the height)')] },
  {
    id: 'shape',
    tools: [
      T('rect', 'rect', 'Rectangle', 'R', 'A volume: two corners, or type 10x8', 'Draw rectangle'),
      T('circle', 'circle', 'Circle', 'C', 'A round volume: centre, then the radius', 'Draw circle'),
      T('polygon', 'polygon', 'Polygon', 'L', 'A volume: click its corners', 'Draw polygon'),
      T('arc', 'arc', 'Arc', 'Shift+C', 'The two ends, then a point of the arc', 'Draw arc (chord ends, then a point of the arc)'),
      T('spline', 'path', 'Curve', 'Shift+P', 'A smooth outline through the points', 'Draw spline (smooth outline through the points)'),
    ],
  },
  {
    id: 'push',
    tools: [
      T('push', 'push', 'Push', 'P', 'Drag a face in or out; type the distance', 'Push / pull face'),
      T('extrude', 'extrude', 'Extrude', 'E', 'A new volume from a face', 'Extrude face (tool)'),
      T('cut', 'knife', 'Cut', 'U', 'Split a face or a volume', 'Cut a face or a volume'),
    ],
  },
  {
    id: 'site',
    tools: [
      T('lot', 'lot', 'Lot', 'Shift+L', 'Drag the lot on the ground; its setbacks show where to build', 'Lot (drag a rectangle on the ground)'),
      T('street', 'street', 'Street', 'Shift+S', 'Click the points of its centre line', 'Street (click its points, Enter ends)'),
      T('terrain', 'terrain', 'Terrain', 'Shift+T', 'Click the ground to set its height there', 'Terrain (click the ground to set its height)'),
      T('axis', 'axis', 'Grid axis', 'Shift+A', 'Click the two ends of a grid line', 'Grid axis (click its two ends)'),
      T('mirror', 'mirror', 'Mirror', 'Shift+M', 'Click two points of the mirror line; Ctrl keeps the original', 'Mirror about a drawn line (Ctrl keeps the original)'),
    ],
  },
  { id: 'catalog', tools: [T('catalog', 'catalog', 'Library', 'K', 'Furniture, doors, windows, plants and blocks')] },
  { id: 'paint', tools: [T('paint', 'paint', 'Paint', 'B', 'Click a surface with the chosen material (Alt: pick one)')] },
  { id: 'tape', tools: [T('tape', 'tape', 'Measure', 'T', 'Click two points: a dimension; Shift+click: a label', 'Tape and dimensions')] },
];

/** Every tool of the bar, in order. */
export const TOOLS: ToolDef[] = TOOL_GROUPS.flatMap((g) => g.tools);

/** Keys that are a second name for a tool (I drew interior walls before the one wall tool). */
const ALIASES: Record<string, string> = { i: 'walls' };

/** The tool a key starts (`k` lower case), or null. */
export function toolForKey(k: string, shift: boolean): string | null {
  const want = (shift ? 'Shift+' : '') + k.toUpperCase();
  const t = TOOLS.find((x) => x.key === want);
  if (t) return t.id;
  return !shift ? (ALIASES[k] ?? null) : null;
}
