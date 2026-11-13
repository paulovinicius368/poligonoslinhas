export type Point2D = [number, number];

export type Ring = Point2D[];
export type PolygonCoords = Ring[]; // [outerRing, ...holeRings]
export type MultiPolygonCoords = PolygonCoords[];

export interface GeoFeaturePolygon {
  id: string;
  name?: string;
  properties: Record<string, unknown>;
  coordinates: PolygonCoords; // in original CRS (lon/lat or planar)
}

export interface ProjectionFrame {
  isGeographic: boolean;
  originLon: number;
  originLat: number;
  cosLat: number;
  boundsMeters: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
  };
}

export interface CenterlineParams {
  /** Boundary resampling spacing in meters (smaller = higher precision) */
  sampleStepMeters: number;
  /** Multiplier on local junction half-width to prune corner spurs (1.1 - 3.0) */
  spurFactor: number;
  /** Minimum absolute branch length in meters to survive pruning */
  minBranchMeters: number;
  /** Multiplier on local radius to merge nearby junction nodes at X-crossings */
  junctionMergeFactor: number;
  /** Chaikin / Laplacian smoothing iterations (0 - 5) */
  smoothingIterations: number;
  /** Ramer-Douglas-Peucker simplification tolerance in meters (0 - 2.0) */
  simplificationMeters: number;
  /** Auto-bridge disconnected components within maxBridgeMeters */
  autoBridgeSectors: boolean;
  /** Maximum bridge distance in meters to connect separated sectors */
  maxBridgeMeters: number;
  /** Extend dead-end branches cleanly toward flat end-caps */
  extendDeadEnds: boolean;
}

export interface GraphNode {
  id: string;
  point: Point2D; // local meters
  geoPoint: Point2D; // original CRS
  degree: number;
  kind: 'endpoint' | 'junction' | 'bridge';
  halfWidthMeters: number;
  componentId: number;
}

export interface GraphEdge {
  id: string;
  startNodeId: string;
  endNodeId: string;
  points: Point2D[]; // smoothed polyline in local meters
  geoPoints: Point2D[]; // smoothed polyline in original CRS
  rawPoints: Point2D[]; // pre-smoothed medial points in local meters
  widths: number[]; // local road full width (m) at vertices
  lengthMeters: number;
  avgWidthMeters: number;
  minWidthMeters: number;
  maxWidthMeters: number;
  isBridge: boolean;
  componentId: number;
  roadClass: 'principal' | 'secundario' | 'ponte';
}

export interface ComponentSummary {
  id: number;
  edgeCount: number;
  nodeCount: number;
  totalLengthMeters: number;
  centroid: Point2D;
}

export interface NetworkResult {
  projection: ProjectionFrame;
  dissolvedPolygonsMeters: MultiPolygonCoords;
  rawPolygonsMeters: MultiPolygonCoords;
  nodes: GraphNode[];
  edges: GraphEdge[];
  components: ComponentSummary[];
  stats: {
    inputPolygonCount: number;
    dissolvedPolygonCount: number;
    totalLengthMeters: number;
    junctionCount: number;
    endpointCount: number;
    bridgeCount: number;
    componentCount: number;
    avgWidthMeters: number;
    minWidthMeters: number;
    maxWidthMeters: number;
    processingMs: number;
  };
}

export interface RouteResult {
  found: boolean;
  reason?: string;
  startNodeId: string;
  endNodeId: string;
  nodeIds: string[];
  edgeIds: string[];
  polylineMeters: Point2D[];
  polylineGeo: Point2D[];
  totalLengthMeters: number;
  minWidthMeters: number;
  avgWidthMeters: number;
  turnCount: number;
}

export interface LayerVisibility {
  polygons: boolean;
  centerlines: boolean;
  widthHeatmap: boolean;
  nodes: boolean;
  bridges: boolean;
  lengthLabels: boolean;
  rawSkeleton: boolean;
}

export type WorkspaceView = 'map' | 'connectivity' | 'routing' | 'segments';

export interface SampleFarmDataset {
  id: string;
  name: string;
  subtitle: string;
  region: string;
  description: string;
  features: GeoFeaturePolygon[];
}
