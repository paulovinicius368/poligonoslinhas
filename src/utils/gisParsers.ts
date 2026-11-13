import shp from 'shpjs';
import type {
  GeoFeaturePolygon,
  NetworkResult,
  Point2D,
  PolygonCoords,
  Ring,
  RouteResult,
} from '../types/gis';

function normalizeRing(raw: unknown): Ring | null {
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const ring: Ring = [];
  for (const pt of raw) {
    if (!Array.isArray(pt) || pt.length < 2) continue;
    const x = Number(pt[0]);
    const y = Number(pt[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const prev = ring[ring.length - 1];
    if (!prev || Math.hypot(x - prev[0], y - prev[1]) > 1e-11) {
      ring.push([x, y]);
    }
  }
  if (ring.length < 3) return null;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (Math.hypot(first[0] - last[0], first[1] - last[1]) > 1e-11) {
    ring.push([first[0], first[1]]);
  }
  if (ring.length < 4) return null;
  return ring;
}

function normalizePolygon(raw: unknown): PolygonCoords | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const rings: PolygonCoords = [];
  for (const r of raw) {
    const nr = normalizeRing(r);
    if (nr) rings.push(nr);
  }
  return rings.length > 0 ? rings : null;
}

export function extractPolygonsFromGeoJSON(geojson: unknown): GeoFeaturePolygon[] {
  const result: GeoFeaturePolygon[] = [];
  if (!geojson || typeof geojson !== 'object') return result;

  const obj = geojson as Record<string, unknown>;
  const collections = Array.isArray(obj) ? obj : [obj];

  let idx = 1;
  const pushGeometry = (
    geom: Record<string, unknown> | null | undefined,
    props: Record<string, unknown>
  ) => {
    if (!geom || typeof geom !== 'object') return;
    const gType = geom.type;
    const coords = geom.coordinates;
    if (gType === 'Polygon') {
      const poly = normalizePolygon(coords);
      if (poly) {
        result.push({
          id: `poly-${idx++}`,
          name: String(props.name ?? props.Name ?? props.nome ?? props.id ?? `Polígono ${idx - 1}`),
          properties: props,
          coordinates: poly,
        });
      }
    } else if (gType === 'MultiPolygon' && Array.isArray(coords)) {
      for (const polyRaw of coords) {
        const poly = normalizePolygon(polyRaw);
        if (poly) {
          result.push({
            id: `poly-${idx++}`,
            name: String(
              props.name ?? props.Name ?? props.nome ?? props.id ?? `Polígono ${idx - 1}`
            ),
            properties: props,
            coordinates: poly,
          });
        }
      }
    } else if (gType === 'GeometryCollection' && Array.isArray(geom.geometries)) {
      for (const child of geom.geometries) {
        pushGeometry(child as Record<string, unknown>, props);
      }
    }
  };

  for (const item of collections) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    if (rec.type === 'FeatureCollection' && Array.isArray(rec.features)) {
      for (const feat of rec.features) {
        if (!feat || typeof feat !== 'object') continue;
        const f = feat as Record<string, unknown>;
        pushGeometry(
          f.geometry as Record<string, unknown>,
          (f.properties as Record<string, unknown>) ?? {}
        );
      }
    } else if (rec.type === 'Feature') {
      pushGeometry(
        rec.geometry as Record<string, unknown>,
        (rec.properties as Record<string, unknown>) ?? {}
      );
    } else if (typeof rec.type === 'string') {
      pushGeometry(rec, {});
    }
  }

  return result;
}

function parseKmlCoords(text: string): Ring | null {
  const tokens = text.trim().split(/\s+/);
  const pts: Ring = [];
  for (const tok of tokens) {
    const parts = tok.split(',');
    if (parts.length < 2) continue;
    const lon = Number(parts[0]);
    const lat = Number(parts[1]);
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      pts.push([lon, lat]);
    }
  }
  return normalizeRing(pts);
}

export function parseKMLPolygons(kmlText: string): GeoFeaturePolygon[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(kmlText, 'application/xml');
  const polygons = Array.from(doc.getElementsByTagName('Polygon'));
  const result: GeoFeaturePolygon[] = [];

  polygons.forEach((polyEl, idx) => {
    const outerBoundary = polyEl.getElementsByTagName('outerBoundaryIs')[0];
    if (!outerBoundary) return;
    const outerCoordsEl = outerBoundary.getElementsByTagName('coordinates')[0];
    if (!outerCoordsEl?.textContent) return;
    const outerRing = parseKmlCoords(outerCoordsEl.textContent);
    if (!outerRing) return;

    const coords: PolygonCoords = [outerRing];
    const innerBoundaries = Array.from(polyEl.getElementsByTagName('innerBoundaryIs'));
    for (const inner of innerBoundaries) {
      const innerCoordsEl = inner.getElementsByTagName('coordinates')[0];
      if (!innerCoordsEl?.textContent) continue;
      const hole = parseKmlCoords(innerCoordsEl.textContent);
      if (hole) coords.push(hole);
    }

    let name = `Polígono ${idx + 1}`;
    let parent: Node | null = polyEl.parentNode;
    while (parent && parent.nodeType === 1) {
      const el = parent as Element;
      if (el.tagName === 'Placemark') {
        const nameEl = el.getElementsByTagName('name')[0];
        if (nameEl?.textContent?.trim()) {
          name = nameEl.textContent.trim();
        }
        break;
      }
      parent = parent.parentNode;
    }

    result.push({
      id: `kml-${idx + 1}`,
      name,
      properties: { name },
      coordinates: coords,
    });
  });

  return result;
}

function parseWktRing(ringText: string): Ring | null {
  const pairs = ringText
    .replace(/[()]/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const pts: Point2D[] = [];
  for (const pair of pairs) {
    const nums = pair.split(/\s+/);
    if (nums.length < 2) continue;
    const x = Number(nums[0]);
    const y = Number(nums[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      pts.push([x, y]);
    }
  }
  return normalizeRing(pts);
}

function extractParenGroups(str: string): string[] {
  const groups: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '(') {
      if (depth === 0) start = i;
      depth++;
    } else if (str[i] === ')') {
      depth--;
      if (depth === 0 && start !== -1) {
        groups.push(str.slice(start + 1, i));
        start = -1;
      }
    }
  }
  return groups;
}

export function parseWKTPolygons(wktText: string): GeoFeaturePolygon[] {
  const result: GeoFeaturePolygon[] = [];
  const regex = /(MULTIPOLYGON|POLYGON)\s*(\(\([\s\S]*?\)\)(?:\s*,\s*\(\([\s\S]*?\)\))*)/gi;
  let match: RegExpExecArray | null;
  let idx = 1;

  while ((match = regex.exec(wktText)) !== null) {
    const kind = match[1].toUpperCase();
    const body = match[2];

    if (kind === 'POLYGON') {
      const inner = body.trim().slice(1, -1);
      const ringGroups = extractParenGroups(inner);
      const poly: PolygonCoords = [];
      for (const rg of ringGroups) {
        const ring = parseWktRing(rg);
        if (ring) poly.push(ring);
      }
      if (poly.length > 0) {
        result.push({
          id: `wkt-${idx}`,
          name: `Polígono WKT ${idx}`,
          properties: { source: 'WKT' },
          coordinates: poly,
        });
        idx++;
      }
    } else {
      const polyGroups = extractParenGroups(body.trim().slice(1, -1));
      for (const pg of polyGroups) {
        const ringGroups = extractParenGroups(pg);
        const poly: PolygonCoords = [];
        for (const rg of ringGroups) {
          const ring = parseWktRing(rg);
          if (ring) poly.push(ring);
        }
        if (poly.length > 0) {
          result.push({
            id: `wkt-${idx}`,
            name: `Polígono WKT ${idx}`,
            properties: { source: 'WKT' },
            coordinates: poly,
          });
          idx++;
        }
      }
    }
  }

  return result;
}

export async function parseVectorFile(file: File): Promise<GeoFeaturePolygon[]> {
  const name = file.name.toLowerCase();

  if (name.endsWith('.zip')) {
    const buffer = await file.arrayBuffer();
    const parsed = await shp(buffer);
    const polys = extractPolygonsFromGeoJSON(parsed);
    if (polys.length === 0) {
      throw new Error('O Shapefile (.zip) não contém geometrias do tipo Polygon ou MultiPolygon.');
    }
    return polys;
  }

  const text = await file.text();

  if (name.endsWith('.geojson') || name.endsWith('.json')) {
    const json = JSON.parse(text);
    const polys = extractPolygonsFromGeoJSON(json);
    if (polys.length === 0) {
      throw new Error('O arquivo GeoJSON não contém geometrias do tipo Polygon ou MultiPolygon.');
    }
    return polys;
  }

  if (name.endsWith('.kml')) {
    const polys = parseKMLPolygons(text);
    if (polys.length === 0) {
      throw new Error('O arquivo KML não contém polígonos válidos (<Polygon>).');
    }
    return polys;
  }

  if (name.endsWith('.wkt') || name.endsWith('.txt')) {
    const polys = parseWKTPolygons(text);
    if (polys.length === 0) {
      throw new Error('Nenhum POLYGON ou MULTIPOLYGON WKT válido encontrado no arquivo.');
    }
    return polys;
  }

  throw new Error('Formato não suportado. Envie .geojson, .json, .zip (Shapefile), .kml ou .wkt.');
}

export function exportNetworkToGeoJSON(
  network: NetworkResult,
  includeNodes = true,
  route?: RouteResult | null
): string {
  const features: Array<Record<string, unknown>> = network.edges.map((edge) => ({
    type: 'Feature',
    properties: {
      id: edge.id,
      classe: edge.roadClass,
      comprimento_m: Number(edge.lengthMeters.toFixed(2)),
      largura_media_m: Number(edge.avgWidthMeters.toFixed(2)),
      largura_min_m: Number(edge.minWidthMeters.toFixed(2)),
      largura_max_m: Number(edge.maxWidthMeters.toFixed(2)),
      ponte_setor: edge.isBridge,
      no_inicio: edge.startNodeId,
      no_fim: edge.endNodeId,
      componente: edge.componentId + 1,
    },
    geometry: {
      type: 'LineString',
      coordinates: edge.geoPoints.map(([x, y]) => [
        Number(x.toFixed(7)),
        Number(y.toFixed(7)),
      ]),
    },
  }));

  if (includeNodes) {
    for (const node of network.nodes) {
      features.push({
        type: 'Feature',
        properties: {
          id: node.id,
          tipo_no: node.kind,
          grau: node.degree,
          largura_local_m: Number((node.halfWidthMeters * 2).toFixed(2)),
          componente: node.componentId + 1,
        },
        geometry: {
          type: 'Point',
          coordinates: [
            Number(node.geoPoint[0].toFixed(7)),
            Number(node.geoPoint[1].toFixed(7)),
          ],
        },
      });
    }
  }

  if (route && route.found) {
    features.push({
      type: 'Feature',
      properties: {
        id: 'rota_ativa',
        classe: 'rota',
        comprimento_m: Number(route.totalLengthMeters.toFixed(2)),
        largura_min_m: Number(route.minWidthMeters.toFixed(2)),
        conversoes: route.turnCount,
      },
      geometry: {
        type: 'LineString',
        coordinates: route.polylineGeo.map(([x, y]) => [
          Number(x.toFixed(7)),
          Number(y.toFixed(7)),
        ]),
      },
    });
  }

  return JSON.stringify(
    {
      type: 'FeatureCollection',
      name: 'eixorural_carreadores',
      features,
    },
    null,
    2
  );
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function exportNetworkToKML(network: NetworkResult, route?: RouteResult | null): string {
  const placemarks = network.edges
    .map((edge) => {
      const coordsStr = edge.geoPoints
        .map(([x, y]) => `${x.toFixed(7)},${y.toFixed(7)},0`)
        .join(' ');
      const styleId = edge.isBridge
        ? '#styleBridge'
        : edge.roadClass === 'principal'
          ? '#stylePrincipal'
          : '#styleSecundario';
      return `    <Placemark>
      <name>${escapeXml(edge.id)}</name>
      <description>Classe: ${edge.roadClass} | Comp: ${edge.lengthMeters.toFixed(1)} m | Largura média: ${edge.avgWidthMeters.toFixed(1)} m</description>
      <styleUrl>${styleId}</styleUrl>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>${coordsStr}</coordinates>
      </LineString>
    </Placemark>`;
    })
    .join('\n');

  const routePlacemark =
    route && route.found
      ? `\n    <Placemark>
      <name>Rota Calculada</name>
      <description>Distância: ${route.totalLengthMeters.toFixed(1)} m | Largura mínima: ${route.minWidthMeters.toFixed(1)} m</description>
      <styleUrl>#styleRoute</styleUrl>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>${route.polylineGeo
          .map(([x, y]) => `${x.toFixed(7)},${y.toFixed(7)},0`)
          .join(' ')}</coordinates>
      </LineString>
    </Placemark>`
      : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Rede de Carreadores EixoRural</name>
    <Style id="stylePrincipal">
      <LineStyle><color>ff3d8015</color><width>3.5</width></Style>
    </Style>
    <Style id="styleSecundario">
      <LineStyle><color>ff6e760f</color><width>2.2</width></Style>
    </Style>
    <Style id="styleBridge">
      <LineStyle><color>ff0677d9</color><width>2.5</width></Style>
    </Style>
    <Style id="styleRoute">
      <LineStyle><color>ff0b9ef5</color><width>4.5</width></Style>
    </Style>
${placemarks}${routePlacemark}
  </Document>
</kml>`;
}

export function exportNetworkToGPX(network: NetworkResult, route?: RouteResult | null): string {
  const tracks: string[] = [];

  if (route && route.found) {
    const pts = route.polylineGeo
      .map(
        ([lon, lat]) =>
          `      <trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"></trkpt>`
      )
      .join('\n');
    tracks.push(`  <trk>
    <name>Rota Carreador (${route.totalLengthMeters.toFixed(0)} m)</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>`);
  }

  for (const edge of network.edges) {
    const pts = edge.geoPoints
      .map(
        ([lon, lat]) =>
          `      <trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"></trkpt>`
      )
      .join('\n');
    tracks.push(`  <trk>
    <name>${escapeXml(edge.id)} (${edge.avgWidthMeters.toFixed(1)} m)</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="EixoRural" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>Eixos de Carreadores Agrícolas</name>
  </metadata>
${tracks.join('\n')}
</gpx>`;
}

export function exportNetworkToCSV(network: NetworkResult): string {
  const header =
    'id_trecho,classe,comprimento_m,largura_media_m,largura_min_m,largura_max_m,ponte_setor,no_inicio,no_fim,componente,lon_inicio,lat_inicio,lon_fim,lat_fim';
  const rows = network.edges.map((e) => {
    const start = e.geoPoints[0] ?? [0, 0];
    const end = e.geoPoints[e.geoPoints.length - 1] ?? [0, 0];
    return [
      e.id,
      e.roadClass,
      e.lengthMeters.toFixed(2),
      e.avgWidthMeters.toFixed(2),
      e.minWidthMeters.toFixed(2),
      e.maxWidthMeters.toFixed(2),
      e.isBridge ? 'sim' : 'nao',
      e.startNodeId,
      e.endNodeId,
      e.componentId + 1,
      start[0].toFixed(7),
      start[1].toFixed(7),
      end[0].toFixed(7),
      end[1].toFixed(7),
    ].join(',');
  });
  return [header, ...rows].join('\n');
}
