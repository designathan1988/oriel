// Wall types (Revit's compound wall structure, ArchiCAD's composites): the layers of a wall from the outside
// in, each with its thickness. A volume built from walls takes one; its wall thickness is the sum of the
// layers and the floor plan draws the boundaries between them inside the cut walls. The presets are the
// usual Brazilian walls (ceramic block, concrete block, drywall, concrete, insulated double wall). Pure.
import type { WallLayer } from './schema';

export interface WallType {
  id: string;
  name: string;
  layers: WallLayer[];
}

const L = (name: string, thickness: number): WallLayer => ({ name, thickness });

export const WALL_TYPES: WallType[] = [
  { id: 'block14', name: 'Ceramic block 14 cm', layers: [L('Plaster', 0.025), L('Ceramic block', 0.09), L('Plaster', 0.025)] },
  { id: 'block19', name: 'Ceramic block 19 cm', layers: [L('Plaster', 0.025), L('Ceramic block', 0.14), L('Plaster', 0.025)] },
  { id: 'block24', name: 'Ceramic block 24 cm', layers: [L('Plaster', 0.025), L('Ceramic block', 0.19), L('Plaster', 0.025)] },
  { id: 'concreteblock19', name: 'Concrete block 19 cm', layers: [L('Plaster', 0.02), L('Concrete block', 0.14), L('Plaster', 0.02)] },
  { id: 'concrete20', name: 'Concrete 20 cm', layers: [L('Concrete', 0.2)] },
  { id: 'drywall10', name: 'Drywall 10 cm', layers: [L('Gypsum board', 0.0125), L('Studs and wool', 0.075), L('Gypsum board', 0.0125)] },
  { id: 'insulated30', name: 'Insulated double wall 30 cm', layers: [L('Plaster', 0.025), L('Ceramic block', 0.09), L('Insulation', 0.05), L('Ceramic block', 0.11), L('Plaster', 0.025)] },
];

/** The thickness of a set of layers (m, to the millimetre). */
export const layersThickness = (layers: WallLayer[]): number => Math.round(layers.reduce((a, l) => a + l.thickness, 0) * 1000) / 1000;
