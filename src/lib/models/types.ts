export interface Point { x: number; y: number; }

export interface Wall {
  id: string;
  start: Point;
  end: Point;
  thickness: number;
  height: number;
  color: string;
  /** Optional quadratic bezier control point for curved walls */
  curvePoint?: Point;
  texture?: string;
  /** Interior-specific overrides (if different from exterior) */
  interiorColor?: string;
  interiorTexture?: string;
  /** Exterior-specific overrides */
  exteriorColor?: string;
  exteriorTexture?: string;
}

export type RoomCategory = 'indoor' | 'outdoor' | 'garage' | 'utility';

export interface Room {
  id: string;
  name: string;
  walls: string[];
  floorTexture: string;
  area: number;
  color?: string;
  roomType?: RoomCategory;
  /** Custom label position offset from centroid (in world units) */
  labelOffset?: Point;
}

export interface Door {
  id: string;
  wallId: string;
  position: number; // 0-1 along wall
  width: number;
  height: number;
  type: 'single' | 'double' | 'sliding' | 'french' | 'pocket' | 'bifold' | 'opening' | 'garage';
  swingDirection: 'left' | 'right';
  flipSide: boolean; // flip which side of wall the door opens to (vertical flip)
}

export interface Window {
  id: string;
  wallId: string;
  position: number; // 0-1 along wall
  width: number;
  height: number;
  sillHeight: number;
  type: 'standard' | 'fixed' | 'casement' | 'sliding' | 'bay';
}

export interface FurnitureItem {
  id: string;
  catalogId: string;
  position: Point;
  rotation: number;
  scale: { x: number; y: number; z: number };
  // Per-item overrides (optional — falls back to catalog defaults)
  color?: string;
  width?: number;   // cm
  depth?: number;   // cm
  height?: number;  // cm
  material?: string; // material name/id
  locked?: boolean;
}

export interface ElementGroup {
  id: string;
  elementIds: string[];
}

export type StairType = 'straight' | 'l-shaped' | 'u-shaped' | 'spiral';

export interface Stair {
  id: string;
  position: Point;
  rotation: number;
  width: number;   // default 100cm
  depth: number;   // default 300cm
  riserCount: number; // default 14
  direction: 'up' | 'down';
  stairType: StairType; // default 'straight'
}

export interface Column {
  id: string;
  position: Point;
  rotation: number;
  shape: 'round' | 'square';
  diameter: number;  // cm (for round) or side length (for square)
  height: number;    // cm
  color: string;
}

export interface Measurement {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Annotation {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label?: string;
  offset: number; // perpendicular offset for dimension line (default 40)
}

export interface TextAnnotation {
  id: string;
  x: number;
  y: number;
  text: string;
  fontSize: number;
  color: string;
  rotation: number;
}

export interface GuideLine {
  id: string;
  orientation: 'horizontal' | 'vertical';
  position: number; // world coordinate (x for vertical, y for horizontal)
}

export interface BackgroundImage {
  dataUrl: string;
  position: Point;
  scale: number;
  opacity: number;
  rotation: number;
  locked: boolean;
}

/** A placed 2D entourage symbol (person, car, tree, …) for presentation plans */
export interface EntourageItem {
  id: string;
  defId: string; // id of a built-in EntourageDef or a project CustomEntourageDef
  position: Point; // center, world cm
  width: number; // real-world width in cm
  rotation: number; // degrees
  opacity?: number; // 0–1, default 1
  locked?: boolean;
}

/** User-uploaded PNG entourage symbol, stored on the project */
export interface CustomEntourageDef {
  id: string;
  name: string;
  dataUrl: string; // PNG as data URL
  aspect: number; // height / width
}

export interface Floor {
  id: string;
  name: string;
  level: number;
  walls: Wall[];
  rooms: Room[];
  doors: Door[];
  windows: Window[];
  furniture: FurnitureItem[];
  stairs: Stair[];
  columns: Column[];
  backgroundImage?: BackgroundImage;
  guides: GuideLine[];
  measurements: Measurement[];
  annotations: Annotation[];
  textAnnotations: TextAnnotation[];
  groups: ElementGroup[];
  entourage?: EntourageItem[];
  beams?: Beam[];
  slabs?: Slab[];
  roofs?: Roof[];
  /**
   * Optional per-floor alignment transform, applied when floors are shown
   * stacked in the 3D "all layers" view. Lets a misaligned (e.g. imported)
   * story be nudged into place relative to the others. The terrain is global
   * and is NOT affected by this. All default to 0 / unset = identity.
   */
  /** Horizontal offset along plan X, in cm. */
  offsetX?: number;
  /** Horizontal offset along plan Y/Z, in cm. */
  offsetZ?: number;
  /** Extra vertical offset added on top of the floor's stacking height, in cm. */
  elevationOffset?: number;
  /** Horizontal (yaw) rotation about the floor's plan centroid, in degrees. */
  yaw?: number;
}

/**
 * Sculpted terrain heightfield for the plot around the building.
 * A regular grid of elevation samples in plan space. `heights` are in cm
 * relative to base grade (0 = flat ground at the building's y=0 level),
 * stored row-major (row r, col c → index r * cols + c). Absent terrain means
 * a flat plot.
 */
export interface Terrain {
  /** Plan-space position of grid sample (col 0, row 0), in cm. */
  origin: Point;
  /** Spacing between adjacent samples, in cm. */
  cellSize: number;
  /** Number of samples along X (columns). */
  cols: number;
  /** Number of samples along Y (rows). */
  rows: number;
  /** rows*cols elevations in cm; 0 = base grade. */
  heights: number[];
}

/**
 * Georeference / site configuration. All site-level geometry (terrain points,
 * GIS features) is stored in S-JTSK / Krovak East-North (EPSG:5514) meters with
 * Bpv elevations. S-JTSK coordinates are large negative numbers, so renderers
 * and the 2D plan work in "plan space": cm offsets from `renderOrigin`
 * (plan X = east, plan Y = south so north points up on screen — the conversion
 * lives in src/lib/utils/geo.ts and nowhere else).
 */
export interface SiteConfig {
  /** S-JTSK meters (x east, y north) + Bpv elevation z of plan origin (0,0). */
  renderOrigin: { x: number; y: number; z: number };
  /** Ellipsoidal − orthometric height offset in meters (~44.5 in CZ), for GPS use. */
  geoidOffset?: number;
}

/**
 * Site terrain as exact survey/design points; the surface is their Delaunay
 * triangulation (TIN). `xyz` holds consecutive [x, y, z] triples in S-JTSK
 * meters (mm precision). Precision is point density: sculpt tools densify the
 * edited area to a 25 cm lattice before modifying it.
 */
export interface TerrainModel {
  xyz: number[];
  /** Optional id of the archived raw RTK upload in the assets table. */
  sourceAssetId?: string;
}

export type GisFeatureKind = 'point' | 'line' | 'polygon';

export interface GisLayer {
  id: string;
  name: string;
  color: string;
  lineStyle?: 'solid' | 'dashed' | 'dotted';
  visible: boolean;
  locked?: boolean;
}

/** Vertex of a GIS feature, S-JTSK meters; z is optional absolute Bpv elevation. */
export interface GisVertex { x: number; y: number; z?: number; }

export interface GisFeature {
  id: string;
  layerId: string;
  kind: GisFeatureKind;
  vertices: GisVertex[];
  /** Depth in cm below the terrain surface (buried pipes/cables); overrides z. */
  depth?: number;
  label?: string;
  props?: Record<string, string>;
}

/** Horizontal structural member; plan-space cm like walls. */
export interface Beam {
  id: string;
  start: Point;
  end: Point;
  width: number;      // section width, cm
  depth: number;      // section height, cm
  elevation: number;  // bottom of beam above floor level, cm
  color: string;
}

export interface Slab {
  id: string;
  outline: Point[];   // plan-space cm polygon
  thickness: number;  // cm
  elevation: number;  // top surface above floor level, cm
  kind?: 'floor' | 'terrace' | 'foundation';
  color: string;
}

export type RoofKind = 'gable' | 'hip' | 'shed' | 'flat';

export interface Roof {
  id: string;
  outline: Point[];        // plan-space cm footprint (rectangle-ish for gable/hip)
  kind: RoofKind;
  pitchDeg: number;
  /** Ridge direction in degrees (plan-space, 0 = +X); auto = longest edge when unset. */
  ridgeAzimuthDeg?: number;
  overhang: number;        // cm beyond outline
  baseElevation: number;   // eave height above floor level, cm
  thickness: number;       // cm
  color: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  floors: Floor[];
  activeFloorId: string;
  createdAt: Date;
  updatedAt: Date;
  customEntourage?: CustomEntourageDef[];
  /**
   * Legacy sculpted grid terrain. Converted to `terrainModel` on load by
   * normalizeProject and no longer written.
   */
  terrain?: Terrain;
  /** Georeference / render-origin configuration for the site. */
  site?: SiteConfig;
  /** Site terrain as a TIN of exact points (canonical terrain model). */
  terrainModel?: TerrainModel;
  gisLayers?: GisLayer[];
  gisFeatures?: GisFeature[];
}
