// Registry of the families and built-in types. A type is a family with
// named values; occurrences and facade rules point to types.
import type { ComponentType, ID, Project3 } from '../model/schema';
import type { Family } from './family';
import { BAY_WINDOW, WINDOW } from './windows';
import { CURTAIN_WALL } from './curtainwall';
import { PARKING } from './parking';
import { ELEVATOR } from './elevator';
import { DOOR, GARAGE_DOOR, LOADING_DOOR, SHOPFRONT } from './doors';
import { BALCONY, VERANDA } from './balconies';
import { FENCE, GATE, HEDGE, SWEEP, WALL_RUN } from './fences';
import { JULIETTE, RAILING } from './railings';
import { BEAM, COLUMN, PERGOLA, PORTICO } from './structure';
import { RAMP, STAIR } from './stairs';
import { AWNING, BRISE, CANOPY, COBOGO, PORCH_ROOF, ROLL_SHUTTER } from './canopies';
import { BAND, CLOCK, CORNICE, DOWNPIPE, PEDIMENT, PILASTER, QUOINS, SIGN } from './ornament';
import { CHIMNEY, CUPOLA, DORMER, LADDER, SILO, SKYLIGHT, SOLAR, STACK, TANK, VENT, WATER_TANK } from './roofgear';
import { CLADDING, IMAGE_DECAL } from './decal';
import { STREET_LAMP, WALL_LAMP } from './lights';
import { ARMCHAIR, BATHTUB, BED, BOOKSHELF, CHAIR, DESK, DINING_TABLE, FRIDGE, KITCHEN_COUNTER, OFFICE_CHAIR, SHOWER, SINK, SOFA, STOVE, TOILET, TV_UNIT, WARDROBE } from './furniture';
import { BUSH, FERN, FLOWER_BED, GRASS_PATCH, ORNAMENTAL_GRASS, PALM, PLANTER, TREE_CONIFER, TREE_DECIDUOUS } from './vegetation';
import { BENCH, BIKE_RACK, BOLLARD, BUS_SHELTER, FOUNTAIN, SWIMMING_POOL, TRASH_BIN } from './street';
import { GRILLE } from './grille';
import { ASSEMBLY } from './assembly';

const families = new Map<string, Family>();

export function registerFamily(f: Family): void {
  families.set(f.id, f);
}

export function family(id: string): Family | undefined {
  return families.get(id);
}

export function allFamilies(): Family[] {
  return [...families.values()];
}

for (const f of [WINDOW, BAY_WINDOW, CURTAIN_WALL, PARKING, ELEVATOR, DOOR, GARAGE_DOOR, LOADING_DOOR, SHOPFRONT, BALCONY, VERANDA, RAILING, JULIETTE, WALL_RUN, FENCE, GATE, HEDGE, SWEEP, COLUMN, BEAM, PERGOLA, PORTICO, STAIR, RAMP, CANOPY, AWNING, PORCH_ROOF, BRISE, COBOGO, ROLL_SHUTTER, CORNICE, PILASTER, QUOINS, PEDIMENT, BAND, SIGN, CLOCK, DOWNPIPE, CHIMNEY, SKYLIGHT, SOLAR, WATER_TANK, VENT, CUPOLA, DORMER, SILO, STACK, LADDER, TANK, IMAGE_DECAL, CLADDING, WALL_LAMP, STREET_LAMP]) registerFamily(f);
// Interior, planting, street furniture and facade grilles.
for (const f of [SOFA, ARMCHAIR, BED, DINING_TABLE, CHAIR, DESK, OFFICE_CHAIR, KITCHEN_COUNTER, WARDROBE, BOOKSHELF, TV_UNIT, TOILET, SINK, BATHTUB, SHOWER, FRIDGE, STOVE]) registerFamily(f);
for (const f of [TREE_DECIDUOUS, TREE_CONIFER, PALM, BUSH, PLANTER, FLOWER_BED, GRASS_PATCH, ORNAMENTAL_GRASS, FERN]) registerFamily(f);
for (const f of [BENCH, TRASH_BIN, BIKE_RACK, BUS_SHELTER, BOLLARD, FOUNTAIN, SWIMMING_POOL]) registerFamily(f);
registerFamily(GRILLE);
registerFamily(ASSEMBLY);

const t = (id: string, fam: string, name: string, params: ComponentType['params'] = {}): ComponentType => ({ id, family: fam, name, params });

/** Built-in types (ready-made variations of each family). */
export const BUILTIN_TYPES: ComponentType[] = [
  t('lamp-lantern', 'wall-lamp', 'Lantern wall light'),
  t('lamp-box', 'wall-lamp', 'Modern wall light', { style: 'box' }),
  t('lamp-globe', 'wall-lamp', 'Globe wall light', { style: 'globe', lightColor: '#fff1d8' }),
  t('street-modern', 'street-lamp', 'Modern street lamp'),
  t('street-classic', 'street-lamp', 'Classic street lamp', { style: 'classic', height: 3.6 }),
  t('garden-bollard', 'street-lamp', 'Garden bollard', { style: 'garden', height: 0.8 }),
  t('area-stone', 'cladding', 'Stone cladding'),
  t('area-brick', 'cladding', 'Brick cladding', { finish: 'brick', color: '#a8553a', color2: '#d8d2c6', thick: 0.02 }),
  t('area-wood', 'cladding', 'Wood cladding', { finish: 'wood', color: '#8a5f3e', color2: '#2c241d', thick: 0.025 }),
  t('area-tile', 'cladding', 'Ceramic cladding', { finish: 'floor', color: '#e9e5dd', color2: '#bdb6aa', thick: 0.012 }),
  t('win-casement', 'window', 'Casement window, 2 leaves'),
  t('win-sash', 'window', 'Colonial sash window', { operation: 'sash', leaves: 1, muntins: 'colonial', width: 1.0, height: 1.7, shutters: 'louvered', frameColor: '#ffffff' }),
  t('win-sliding', 'window', 'Sliding window', { operation: 'sliding', leaves: 2, width: 1.6, height: 1.2, frameColor: '#cfd2d3', frameFinish: 'metal', trim: 0, sill: true }),
  t('win-arched', 'window', 'Arched window', { shape: 'arch', width: 1.1, height: 2.0, leaves: 2, muntins: 'grid', muntinRows: 3, transom: false }),
  t('win-segment', 'window', 'Segmental arch window', { shape: 'segment', width: 1.2, height: 1.6, leaves: 2, trim: 0.14 }),
  t('win-oculus', 'window', 'Oculus', { shape: 'round', width: 0.8, height: 0.8, leaves: 1, operation: 'fixed', sillH: 1.4, sill: false, trim: 0.12 }),
  t('win-ribbon', 'window', 'Ribbon window', { width: 4.2, height: 1.1, leaves: 4, operation: 'fixed', frameColor: '#3a3f42', frameFinish: 'metal', trim: 0, sill: false, sillH: 1.0 }),
  t('win-industrial', 'window', 'Industrial window', { width: 2.4, height: 1.8, leaves: 1, operation: 'fixed', muntins: 'grid', muntinCols: 6, muntinRows: 4, frameColor: '#2d3236', frameFinish: 'metal', trim: 0, sillH: 1.6 }),
  t('win-louvre', 'window', 'Wooden louvre window', { operation: 'louvre', leaves: 2, width: 1.1, height: 1.4, frameColor: '#7a4a2c', frameFinish: 'wood', shutterColor: '#7a4a2c' }),
  t('win-hopper', 'window', 'Up-and-over', { operation: 'awning', width: 0.8, height: 0.6, leaves: 1, sillH: 1.6, trim: 0 }),
  t('win-tall', 'window', 'Floor-to-ceiling window', { width: 1.4, height: 2.4, sillH: 0.1, leaves: 2, operation: 'sliding', frameColor: '#2f3437', frameFinish: 'metal', trim: 0, sill: false }),
  t('win-bay', 'baywindow', 'Bay window'),
  t('curtain-wall', 'curtainwall', 'Curtain wall'),
  t('parking-90', 'parking', 'Parking, square stalls'),
  t('parking-45', 'parking', 'Parking, 45° stalls', { angle: '45' }),
  t('parking-both', 'parking', 'Parking, both sides', { sides: 'both' }),
  t('curtain-wall-clear', 'curtainwall', 'Curtain wall, all glass', { spandrel: false, glassColor: '#7f9cab' }),
  t('door-panel', 'door', 'Panelled door'),
  t('door-double', 'door', 'Double door with transom', { leaves: 2, width: 1.6, leaf: 'half', transom: true }),
  t('door-french', 'door', 'Balcony door', { leaves: 2, width: 1.4, height: 2.3, leaf: 'french', leafColor: '#f4f2ec', leafFinish: 'paint', step: false }),
  t('door-glass', 'door', 'Glass door', { leaf: 'glass', width: 1.0, leafColor: '#2c3134', leafFinish: 'metal', frameColor: '#2c3134', frameFinish: 'metal', trim: 0 }),
  t('door-plank', 'door', 'Board door', { leaf: 'plank', leafColor: '#7b5634' }),
  t('door-arched', 'door', 'Arched door', { shape: 'arch', leaves: 2, width: 1.5, height: 2.6, leaf: 'panel' }),
  t('door-entrance', 'door', 'Entrance with sidelights', { sidelights: true, transom: true, leaf: 'half' }),
  t('garage-sectional', 'garage', 'Sectional garage door'),
  t('garage-roller', 'garage', 'Roller garage door', { kind: 'roller' }),
  t('garage-carriage', 'garage', 'Wooden garage door', { kind: 'carriage', doorColor: '#6e4c32', windows: true }),
  t('loading-dock', 'loading', 'Dock door'),
  t('shopfront', 'shopfront', 'Shopfront with awning'),
  t('shopfront-plain', 'shopfront', 'Plain shopfront', { awning: false, bays: 4 }),
  t('balcony-bars', 'balcony', 'Balcony with railing'),
  t('balcony-glass', 'balcony', 'Glass balcony', { infill: 'glass' }),
  t('balcony-balusters', 'balcony', 'Balcony with balusters', { infill: 'balusters', support: 'corbels' }),
  t('balcony-solid', 'balcony', 'Balcony with parapet', { guard: 'solid' }),
  t('juliette', 'juliette', 'Window railing'),
  t('veranda', 'veranda', 'Covered veranda'),
  t('railing-bars', 'railing', 'Bar railing'),
  t('railing-glass', 'railing', 'Glass railing', { infill: 'glass' }),
  t('railing-balusters', 'railing', 'Balustrade', { infill: 'balusters' }),
  t('wall-run', 'wallrun', 'Masonry wall'),
  t('fence-picket', 'fence', 'Picket fence'),
  t('fence-slats', 'fence', 'Slat fence', { style: 'slats' }),
  t('fence-mesh', 'fence', 'Chain-link fence', { style: 'mesh' }),
  t('fence-wrought', 'fence', 'Iron railing', { style: 'wrought' }),
  t('gate-double', 'gate', 'Two-leaf gate'),
  t('gate-sliding', 'gate', 'Sliding gate', { operation: 'sliding' }),
  t('hedge', 'hedge', 'Hedge'),
  t('column-square', 'column', 'Square column'),
  t('column-round', 'column', 'Round column', { kind: 'round' }),
  t('column-classical', 'column', 'Classical column', { kind: 'classical' }),
  t('column-steel', 'column', 'Steel column', { kind: 'ibeam' }),
  t('beam', 'beam', 'Beam'),
  t('pergola', 'pergola', 'Pergola'),
  t('portico', 'portico', 'Portico with pediment'),
  t('stair-straight', 'stair', 'Straight stair'),
  t('stair-L', 'stair', 'L stair', { shape: 'L' }),
  t('stair-U', 'stair', 'U stair', { shape: 'U' }),
  t('stair-L-winders', 'stair', 'L stair with winders', { shape: 'L', turn: 'winders' }),
  t('stair-spiral', 'stair', 'Spiral stair', { shape: 'spiral', structure: 'center', treadColor: '#4a4f52', treadFinish: 'metal' }),
  t('stair-steel', 'stair', 'Steel stair', { structure: 'stringers', treadColor: '#5b6064', treadFinish: 'metal', structColor: '#3a3e41' }),
  t('ramp', 'ramp', 'Accessible ramp'),
  t('elevator', 'elevator', 'Elevator'),
  t('canopy-concrete', 'canopy', 'Concrete canopy'),
  t('canopy-glass', 'canopy', 'Glass canopy', { kind: 'glass', thick: 0.04, rods: true }),
  t('canopy-metal', 'canopy', 'Metal canopy', { kind: 'metal', color: '#3b3f43', tilt: 8 }),
  t('awning-green', 'awning', 'Green striped awning'),
  t('awning-red', 'awning', 'Red striped awning', { color: '#a8332c' }),
  t('awning-plain', 'awning', 'Plain awning', { striped: false, color: '#c9a66b', scallop: false }),
  t('porch', 'porchroof', 'Porch roof'),
  t('brise-h', 'brise', 'Horizontal brise-soleil'),
  t('brise-v', 'brise', 'Vertical brise-soleil', { dir: 'v', angle: 25, color: '#a87b54', finish: 'wood' }),
  t('cobogo', 'cobogo', 'Breeze block'),
  t('cobogo-round', 'cobogo', 'Round breeze block', { pattern: 'round' }),
  t('rollshutter', 'rollshutter', 'Roller shutter'),
  t('cornice-classic', 'cornice', 'Classical cornice'),
  t('cornice-modern', 'cornice', 'Modern cornice', { profile: 'modern' }),
  t('cornice-dentil', 'cornice', 'Dentil cornice', { dentils: true }),
  t('pilaster', 'pilaster', 'Pilaster'),
  t('pilaster-fluted', 'pilaster', 'Fluted pilaster', { fluted: true }),
  t('quoins', 'quoins', 'Stone quoins'),
  t('pediment-tri', 'pediment', 'Triangular pediment'),
  t('pediment-seg', 'pediment', 'Arched pediment', { shape: 'segment' }),
  t('band', 'band', 'String course'),
  t('sign-panel', 'sign', 'Sign'),
  t('sign-blade', 'sign', 'Projecting sign', { kind: 'blade', width: 1, height: 0.8 }),
  t('sign-letters', 'sign', 'Channel letters', { kind: 'letters' }),
  t('clock', 'clock', 'Clock'),
  t('downpipe', 'downpipe', 'Downpipe'),
  t('chimney', 'chimney', 'Brick chimney'),
  t('skylight', 'skylight', 'Skylight'),
  t('skylight-dome', 'skylight', 'Dome skylight', { kind: 'dome' }),
  t('solar', 'solar', 'Solar panels'),
  t('watertank', 'watertank', 'Water tank'),
  t('watertank-box', 'watertank', 'Rectangular water tank', { shape: 'box', color: '#d9d9d4', stand: 0 }),
  t('vent-turbine', 'vent', 'Wind turbine vent'),
  t('vent-ac', 'vent', 'AC condenser', { kind: 'ac', width: 0.8 }),
  t('cupola-dome', 'cupola', 'Cupola lantern'),
  t('cupola-spire', 'cupola', 'Spire tower', { top: 'spire', flag: true, color: '#e8dcc4', roofColor: '#4a4f55' }),
  t('cupola-onion', 'cupola', 'Onion dome', { top: 'onion', roofColor: '#c8a85a' }),
  t('dormer-gable', 'dormer', 'Gable dormer'),
  t('dormer-shed', 'dormer', 'Shed dormer', { roof: 'shed' }),
  t('dormer-round', 'dormer', 'Eyebrow dormer', { roof: 'round' }),
  t('silo', 'silo', 'Silo'),
  t('stack', 'stack', 'Industrial chimney'),
  t('ladder', 'ladder', 'Ship ladder'),
  t('tank', 'tank', 'Horizontal tank'),
  t('sofa-3', 'sofa', 'Three-seat sofa', { seats: 3, width: 2.1 }),
  t('sofa-2', 'sofa', 'Two-seat sofa', { seats: 2, width: 1.6 }),
  t('armchair', 'armchair', 'Armchair'),
  t('armchair-lounge', 'armchair', 'Lounge armchair', { width: 1.1, depth: 0.95, height: 0.78, color: '#5f6b72' }),
  t('bed-single', 'bed', 'Single bed', { width: 0.9, length: 2 }),
  t('bed-double', 'bed', 'Double bed', { width: 1.6, length: 2 }),
  t('bed-king', 'bed', 'King bed', { width: 1.8, length: 2.1, duvetColor: '#d8cdb9' }),
  t('table-dining', 'dining-table', 'Dining table'),
  t('table-round', 'dining-table', 'Round table', { shape: 'round', width: 1.2 }),
  t('chair', 'chair', 'Chair'),
  t('chair-modern', 'chair', 'Modern chair', { material: 'metal', color: '#3a3f43', finish: 'metal', tilt: 10 }),
  t('desk', 'desk', 'Desk'),
  t('desk-compact', 'desk', 'Compact desk', { width: 1.1, drawers: 2 }),
  t('office-chair', 'office-chair', 'Office chair'),
  t('kitchen-counter', 'kitchen-counter', 'Kitchen counter'),
  t('kitchen-island', 'kitchen-counter', 'Kitchen island', { width: 2, depth: 0.9 }),
  t('kitchen-planned', 'kitchen-counter', 'Planned kitchen (cooktop and wall cabinets)', { width: 3, cooktop: true, cooktopAt: 0.8, sinkAt: 0.3, upper: true }),
  t('wardrobe', 'wardrobe', 'Wardrobe'),
  t('wardrobe-wide', 'wardrobe', 'Wide wardrobe', { width: 2.4, doors: 4 }),
  t('wardrobe-sliding', 'wardrobe', 'Sliding-door wardrobe', { width: 2, doors: 2, doorKind: 'sliding' }),
  t('wardrobe-mirror', 'wardrobe', 'Sliding wardrobe with mirror', { width: 2.4, doors: 3, doorKind: 'sliding', mirror: true }),
  t('bookshelf', 'bookshelf', 'Bookshelf'),
  t('bookshelf-tall', 'bookshelf', 'Tall bookshelf', { height: 2.4, shelves: 6 }),
  t('tv-unit', 'tv-unit', 'TV unit'),
  t('tv-unit-wall', 'tv-unit', 'TV unit without TV', { tv: false, width: 2.2 }),
  t('toilet', 'toilet', 'Toilet'),
  t('sink-vanity', 'sink', 'Vanity unit'),
  t('sink-pedestal', 'sink', 'Pedestal basin', { kind: 'pedestal' }),
  t('bathtub', 'bathtub', 'Bathtub'),
  t('bathtub-spa', 'bathtub', 'Whirlpool bath', { width: 1.8, depth: 0.9, height: 0.62, water: false }),
  t('shower', 'shower', 'Shower'),
  t('fridge', 'fridge', 'Fridge'),
  t('stove', 'stove', 'Stove'),
  t('sweep-lowwall', 'sweep', 'Low wall (profile)'),
  t('sweep-coping', 'sweep', 'Wall with coping', { profile: 'coping', height: 1.1, width: 0.2 }),
  t('sweep-cornice', 'sweep', 'Cornice along a path', { profile: 'cornice', height: 0.45, width: 0.3, finish: 'stone', wallColor: '#e3dccd' }),
  t('sweep-kerb', 'sweep', 'Kerb', { profile: 'kerb', height: 0.15, width: 0.15, finish: 'concrete', wallColor: '#b5b1a8' }),
  t('tree-oak', 'tree-deciduous', 'Oak', { species: 'oak', height: 8, crown: 7, seed: 3, leafColor: '#4a7a3a' }),
  t('tree-birch', 'tree-deciduous', 'Birch', { species: 'birch', height: 9, crown: 4, seed: 7, leafColor: '#93b45a', trunkColor: '#d8d4c8' }),
  t('tree-maple', 'tree-deciduous', 'Maple', { species: 'maple', height: 7, crown: 6, seed: 5, leafColor: '#7f8f3a' }),
  t('tree-willow', 'tree-deciduous', 'Weeping willow', { species: 'willow', height: 8, crown: 7, seed: 4, leafColor: '#86a046', trunkColor: '#5e5040' }),
  t('tree-poplar', 'tree-deciduous', 'Poplar', { species: 'poplar', height: 14, crown: 3, seed: 2, leafColor: '#5e8a3e' }),
  t('tree-cherry', 'tree-deciduous', 'Cherry in blossom', { species: 'cherry', height: 5, crown: 5, seed: 6, leafColor: '#6e8a44', blossom: true, flowerColor: '#f4bccb', trunkColor: '#4e3a30' }),
  t('tree-olive', 'tree-deciduous', 'Olive', { species: 'olive', height: 4.5, crown: 4.5, seed: 8, leafColor: '#7d8f68', trunkColor: '#7a6e60' }),
  t('tree-pine', 'tree-conifer', 'Pine', { species: 'pine', height: 11, crown: 5, seed: 2 }),
  t('tree-spruce', 'tree-conifer', 'Spruce', { species: 'spruce', height: 12, crown: 4.5, seed: 6, leafColor: '#2f5a3a' }),
  t('tree-fir', 'tree-conifer', 'Fir', { species: 'fir', height: 10, crown: 4, seed: 3, leafColor: '#36603f' }),
  t('tree-cypress', 'tree-conifer', 'Italian cypress', { species: 'cypress', height: 10, crown: 1.6, seed: 5, leafColor: '#34553a' }),
  t('palm-tree', 'palm', 'Palm'),
  t('palm-coconut', 'palm', 'Coconut palm', { height: 8, bend: 0.9, fronds: 10 }),
  t('bush', 'bush', 'Bush'),
  t('bush-flowering', 'bush', 'Flowering bush', { flowers: true, width: 1.4, flowerColor: '#c86a86' }),
  t('bush-boxwood', 'bush', 'Boxwood', { shape: 'boxwood', width: 0.9, height: 0.8, leafColor: '#3e6634' }),
  t('bush-upright', 'bush', 'Upright shrub', { shape: 'upright', width: 0.9, height: 1.5, leafColor: '#55803f' }),
  t('grass-ornamental', 'ornamental-grass', 'Ornamental grass'),
  t('grass-pampas', 'ornamental-grass', 'Pampas grass', { height: 2, width: 1.6, blades: 14, leafColor: '#8a9a62', plumeColor: '#efe5cc' }),
  t('fern', 'fern', 'Fern'),
  t('planter', 'planter', 'Planter'),
  t('planter-stone', 'planter', 'Stone planter', { material: 'stone', color: '#c9c3b6', width: 1.2 }),
  t('flower-bed', 'flower-bed', 'Flower bed'),
  t('flower-bed-rose', 'flower-bed', 'Rose bed', { flowerColor: '#b8455c', flowers: 12 }),
  t('grass-patch', 'grass-patch', 'Grass patch'),
  t('meadow', 'grass-patch', 'Meadow with wildflowers', { tuftHeight: 0.4, wildflowers: true, color: '#6a8c45' }),
  t('bench-park', 'bench', 'Park bench'),
  t('bench-modern', 'bench', 'Modern bench', { material: 'metal', back: false, color: '#3f4448', legColor: '#2c3033' }),
  t('trash-bin', 'trash-bin', 'Litter bin'),
  t('trash-bin-square', 'trash-bin', 'Square litter bin', { shape: 'square' }),
  t('bike-rack', 'bike-rack', 'Bike rack'),
  t('bike-rack-6', 'bike-rack', 'Bike rack, 6 hoops', { hoops: 6 }),
  t('bus-shelter', 'bus-shelter', 'Bus shelter'),
  t('bollard', 'bollard', 'Bollard'),
  t('bollard-stone', 'bollard', 'Stone bollard', { material: 'stone', shape: 'square', diameter: 0.22, color: '#b8b2a6' }),
  t('fountain', 'fountain', 'Fountain'),
  t('fountain-tiered', 'fountain', 'Tiered fountain', { diameter: 3, height: 1.6 }),
  t('pool-rect', 'swimming-pool', 'Rectangular pool', { width: 4, length: 8, ladder: false }),
  t('pool-family', 'swimming-pool', 'Family pool', { width: 5, length: 10, depth: 1.6 }),
  t('grille-vertical', 'grille', 'Vertical window grille'),
  t('grille-grid', 'grille', 'Grid window grille', { style: 'grid', bars: 5 }),
  t('grille-diagonal', 'grille', 'Diagonal window grille', { style: 'diagonal', bars: 5 }),
];

const builtinById = new Map(BUILTIN_TYPES.map((x) => [x.id, x]));

/** Type by ID: the project's first, then the built-in ones. */
export function typeById(id: ID, project?: Pick<Project3, 'types'>): ComponentType | undefined {
  return project?.types.find((x) => x.id === id) ?? builtinById.get(id);
}
