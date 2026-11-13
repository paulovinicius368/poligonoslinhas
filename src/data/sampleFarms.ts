import type { GeoFeaturePolygon, Point2D, Ring, SampleFarmDataset } from '../types/gis';

const EARTH_RADIUS_M = 6378137;

function metersToWGS84(pt: Point2D, originLon: number, originLat: number): Point2D {
  const cosLat = Math.cos((originLat * Math.PI) / 180);
  const radToDeg = 180 / Math.PI;
  return [
    originLon + (pt[0] / (EARTH_RADIUS_M * cosLat)) * radToDeg,
    originLat + (pt[1] / EARTH_RADIUS_M) * radToDeg,
  ];
}

function sampleCubicBezier(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  steps = 28
): Point2D[] {
  const pts: Point2D[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const x =
      mt * mt * mt * p0[0] +
      3 * mt * mt * t * p1[0] +
      3 * mt * t * t * p2[0] +
      t * t * t * p3[0];
    const y =
      mt * mt * mt * p0[1] +
      3 * mt * mt * t * p1[1] +
      3 * mt * t * t * p2[1] +
      t * t * t * p3[1];
    pts.push([x, y]);
  }
  return pts;
}

/**
 * Generates a realistic variable-width road corridor polygon (in WGS84)
 * with flat or rounded end caps so overlapping crossings test polygon union & skeletonization.
 */
function createRoadCorridorFeature(
  id: string,
  name: string,
  centerlineMeters: Point2D[],
  widthAtIndex: number | ((idx: number, total: number) => number),
  originLon: number,
  originLat: number,
  extraProps: Record<string, unknown> = {}
): GeoFeaturePolygon {
  const leftSide: Point2D[] = [];
  const rightSide: Point2D[] = [];
  const n = centerlineMeters.length;

  for (let i = 0; i < n; i++) {
    const prev = centerlineMeters[Math.max(0, i - 1)];
    const next = centerlineMeters[Math.min(n - 1, i + 1)];
    const tx = next[0] - prev[0];
    const ty = next[1] - prev[1];
    const len = Math.hypot(tx, ty) || 1;
    const nx = -ty / len;
    const ny = tx / len;

    const w =
      typeof widthAtIndex === 'function' ? widthAtIndex(i, n) : widthAtIndex;
    const hw = w * 0.5;

    leftSide.push([centerlineMeters[i][0] + nx * hw, centerlineMeters[i][1] + ny * hw]);
    rightSide.push([centerlineMeters[i][0] - nx * hw, centerlineMeters[i][1] - ny * hw]);
  }

  const ringMeters: Ring = [...leftSide, ...rightSide.reverse(), leftSide[0]];
  const ringWGS: Ring = ringMeters.map((p) => metersToWGS84(p, originLon, originLat));

  return {
    id,
    name,
    properties: { nome: name, ...extraProps },
    coordinates: [ringWGS],
  };
}

/**
 * Creates a maneuver roundabout / junction plaza with a central island hole
 */
function createRoundaboutFeature(
  id: string,
  name: string,
  center: Point2D,
  outerRadius: number,
  innerRadius: number,
  originLon: number,
  originLat: number
): GeoFeaturePolygon {
  const segments = 36;
  const outer: Ring = [];
  const inner: Ring = [];

  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    outer.push(
      metersToWGS84(
        [center[0] + Math.cos(a) * outerRadius, center[1] + Math.sin(a) * outerRadius],
        originLon,
        originLat
      )
    );
    const revA = ((segments - i) / segments) * Math.PI * 2;
    inner.push(
      metersToWGS84(
        [center[0] + Math.cos(revA) * innerRadius, center[1] + Math.sin(revA) * innerRadius],
        originLon,
        originLat
      )
    );
  }

  return {
    id,
    name,
    properties: { nome: name, tipo: 'rotatoria' },
    coordinates: [outer, inner],
  };
}

function buildFazendaSantaHelena(): SampleFarmDataset {
  // Sorriso - MT region
  const originLon = -55.7245;
  const originLat = -12.5482;

  // Main arterial avenue (variable 11m - 14m width, gentle S-curve crossing the whole farm)
  const arterialPts = [
    ...sampleCubicBezier([-340, -180], [-190, -120], [-80, -30], [40, 10], 24),
    ...sampleCubicBezier([40, 10], [160, 50], [240, 140], [360, 190], 24).slice(1),
  ];
  const arterial = createRoadCorridorFeature(
    'sh-arterial',
    'Carreador Principal Central',
    arterialPts,
    (i, total) => 11.5 + Math.sin((i / total) * Math.PI) * 2.5,
    originLon,
    originLat,
    { setor: 'Eixo Central' }
  );

  // North-South crossing avenue (8.5m width) creating an X-crossing around (40, 10)
  const nsCrossingPts = sampleCubicBezier(
    [-10, -250],
    [15, -120],
    [65, 110],
    [110, 260],
    30
  );
  const nsCrossing = createRoadCorridorFeature(
    'sh-ns',
    'Carreador Transversal Norte-Sul',
    nsCrossingPts,
    8.5,
    originLon,
    originLat,
    { setor: 'Talhões A/B' }
  );

  // Secondary western sector road (6m width) branching in T/Y from arterial
  const westBranchPts = sampleCubicBezier(
    [-165, -90],
    [-195, 25],
    [-250, 115],
    [-310, 210],
    24
  );
  const westBranch = createRoadCorridorFeature(
    'sh-west',
    'Carreador Setor Oeste',
    westBranchPts,
    6.2,
    originLon,
    originLat,
    { setor: 'Talhão C' }
  );

  // Narrow eastern contour road (4.8m width) connecting NS crossing to Eastern Arterial
  const eastLoopPts = [
    ...sampleCubicBezier([75, 140], [165, 165], [220, 120], [270, 95], 20),
    ...sampleCubicBezier([270, 95], [305, 15], [260, -90], [170, -135], 20).slice(1),
    ...sampleCubicBezier([170, -135], [100, -155], [40, -145], [8, -125], 16).slice(1),
  ];
  const eastLoop = createRoadCorridorFeature(
    'sh-east-loop',
    'Contorno Talhão Leste',
    eastLoopPts,
    5.0,
    originLon,
    originLat,
    { setor: 'Talhão D' }
  );

  // Southern feeder (5.5m) with T-junction onto NS avenue
  const southFeederPts = sampleCubicBezier(
    [15, -140],
    [-95, -170],
    [-190, -220],
    [-280, -245],
    22
  );
  const southFeeder = createRoadCorridorFeature(
    'sh-south',
    'Ramal Sul da Sede',
    southFeederPts,
    5.6,
    originLon,
    originLat,
    { setor: 'Sede / Silos' }
  );

  // Maneuver roundabout at main X-intersection (40, 10)
  const roundabout = createRoundaboutFeature(
    'sh-rotatoria',
    'Rotatória de Manobra Central',
    [40, 10],
    24,
    9.5,
    originLon,
    originLat
  );

  return {
    id: 'santa-helena',
    name: 'Fazenda Santa Helena',
    subtitle: 'Larguras variadas (5–14 m) · Cruzamentos e Rotatória',
    region: 'Sorriso, MT',
    description:
      'Malha de carreadores com eixo principal largo, ramais secundários curvos, cruzamento em X com rotatória de manobra e contorno de talhão.',
    features: [arterial, nsCrossing, westBranch, eastLoop, southFeeder, roundabout],
  };
}

function buildComplexoCerradoGaps(): SampleFarmDataset {
  // Rio Verde - GO region
  const originLon = -50.9218;
  const originLat = -17.7945;

  // Sector 1 (North-West arterial + fork)
  const s1Main = createRoadCorridorFeature(
    'cc-s1-main',
    'Setor 1 — Eixo Norte',
    sampleCubicBezier([-320, 180], [-180, 155], [-85, 110], [10, 65], 24),
    10.5,
    originLon,
    originLat
  );
  const s1Branch = createRoadCorridorFeature(
    'cc-s1-branch',
    'Setor 1 — Ramal Talhão 01',
    sampleCubicBezier([-145, 138], [-150, 45], [-190, -20], [-250, -65], 20),
    6.0,
    originLon,
    originLat
  );

  // Sector 2 (Central sector separated by an ~11m digitization gap near (10, 65) -> (21, 59))
  const s2Main = createRoadCorridorFeature(
    'cc-s2-main',
    'Setor 2 — Eixo Central',
    sampleCubicBezier([21, 59], [115, 12], [195, -45], [295, -95], 26),
    9.5,
    originLon,
    originLat
  );
  const s2Cross = createRoadCorridorFeature(
    'cc-s2-cross',
    'Setor 2 — Transversal',
    sampleCubicBezier([110, -145], [140, -55], [155, 40], [195, 150], 24),
    5.8,
    originLon,
    originLat
  );

  // Sector 3 (South-West sector separated by a ~14m gap from s1Branch and ~16m gap from s2Cross)
  const s3Road = createRoadCorridorFeature(
    'cc-s3-main',
    'Setor 3 — Talhão Sul',
    [
      ...sampleCubicBezier([-240, -82], [-135, -130], [-30, -155], [92, -148], 26),
    ],
    5.2,
    originLon,
    originLat
  );

  // Sector 4 (Isolated East spur with 9m gap to s2Main)
  const s4East = createRoadCorridorFeature(
    'cc-s4-east',
    'Setor 4 — Captação Leste',
    sampleCubicBezier([245, -55], [275, 25], [310, 95], [335, 170], 20),
    6.5,
    originLon,
    originLat
  );

  return {
    id: 'complexo-cerrado',
    name: 'Complexo Cerrado (Setores)',
    subtitle: '4 setores com lacunas de digitalização (9–16 m)',
    region: 'Rio Verde, GO',
    description:
      'Demonstra o diagnóstico de setores desconectados e o fechamento topológico automático por pontes entre talhões.',
    features: [s1Main, s1Branch, s2Main, s2Cross, s3Road, s4East],
  };
}

function buildTalhaoCurvasNivel(): SampleFarmDataset {
  // Ribeirão Preto - SP (Sugarcane contour roads)
  const originLon = -47.8103;
  const originLat = -21.1775;

  // Spine collector road (12m wide)
  const spine = createRoadCorridorFeature(
    'cn-spine',
    'Carreador Mestre Coletor',
    sampleCubicBezier([-290, -210], [-140, -100], [60, 40], [280, 210], 32),
    (i, total) => 10.0 + (i / total) * 3.0,
    originLon,
    originLat
  );

  // Three parallel sinuous contour roads (5.2m wide) crossing the spine
  const contour1 = createRoadCorridorFeature(
    'cn-c1',
    'Curva de Nível Superior',
    sampleCubicBezier([-280, 175], [-110, 215], [20, 75], [220, 140], 32),
    5.2,
    originLon,
    originLat
  );

  const contour2 = createRoadCorridorFeature(
    'cn-c2',
    'Curva de Nível Média',
    sampleCubicBezier([-310, 15], [-120, 65], [40, -85], [275, -15], 34),
    5.5,
    originLon,
    originLat
  );

  const contour3 = createRoadCorridorFeature(
    'cn-c3',
    'Curva de Nível Inferior',
    sampleCubicBezier([-220, -140], [-50, -90], [90, -225], [300, -165], 32),
    4.8,
    originLon,
    originLat
  );

  // Perimeter west connector closing the sector loop
  const westConnector = createRoadCorridorFeature(
    'cn-west',
    'Carreador de Divisa Oeste',
    sampleCubicBezier([-280, 175], [-325, 90], [-320, -40], [-290, -210], 26),
    7.5,
    originLon,
    originLat
  );

  return {
    id: 'curvas-nivel',
    name: 'Talhão Curvas de Nível',
    subtitle: 'Traçados sinuosos · Cruzamentos oblíquos',
    region: 'Ribeirão Preto, SP',
    description:
      'Carreadores em curvas de nível para colheita mecanizada com cruzamentos oblíquos no eixo coletor mestre.',
    features: [spine, contour1, contour2, contour3, westConnector],
  };
}

export const SAMPLE_FARMS: SampleFarmDataset[] = [
  buildFazendaSantaHelena(),
  buildComplexoCerradoGaps(),
  buildTalhaoCurvasNivel(),
];
