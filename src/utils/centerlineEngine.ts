import { Delaunay } from 'd3-delaunay';
import { union } from 'polygon-clipping';
import type {
  CenterlineParams,
  ComponentSummary,
  GeoFeaturePolygon,
  GraphEdge,
  GraphNode,
  MultiPolygonCoords,
  NetworkResult,
  Point2D,
  PolygonCoords,
  ProjectionFrame,
  Ring,
  RouteResult,
} from '../types/gis';

const EARTH_RADIUS_M = 6378137;

function dist2(a: Point2D, b: Point2D): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function dist(a: Point2D, b: Point2D): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function polylineLength(pts: Point2D[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += dist(pts[i - 1], pts[i]);
  }
  return len;
}

function ringAreaSigned(ring: Ring): number {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return area * 0.5;
}

function detectProjectionFrame(features: GeoFeaturePolygon[]): ProjectionFrame {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const f of features) {
    for (const ring of f.coordinates) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (!Number.isFinite(minX)) {
    return {
      isGeographic: true,
      originLon: 0,
      originLat: 0,
      cosLat: 1,
      boundsMeters: { minX: 0, minY: 0, maxX: 100, maxY: 100, width: 100, height: 100 },
    };
  }

  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const inLonLatBounds = minX >= -180 && maxX <= 180 && minY >= -90 && maxY <= 90;
  const looksLikeLocalMeters =
    Math.abs(minX) < 10 && Math.abs(minY) < 10 && (spanX > 2 || spanY > 2);
  const isGeographic = inLonLatBounds && !looksLikeLocalMeters && spanX < 5 && spanY < 5;

  const originLon = (minX + maxX) * 0.5;
  const originLat = (minY + maxY) * 0.5;
  const cosLat = isGeographic ? Math.cos((originLat * Math.PI) / 180) : 1;

  return {
    isGeographic,
    originLon,
    originLat,
    cosLat,
    boundsMeters: { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 },
  };
}

export function toMeters(pt: Point2D, frame: ProjectionFrame): Point2D {
  if (!frame.isGeographic) return [pt[0], pt[1]];
  const degToRad = Math.PI / 180;
  const x = (pt[0] - frame.originLon) * degToRad * EARTH_RADIUS_M * frame.cosLat;
  const y = (pt[1] - frame.originLat) * degToRad * EARTH_RADIUS_M;
  return [x, y];
}

export function toGeo(pt: Point2D, frame: ProjectionFrame): Point2D {
  if (!frame.isGeographic) return [pt[0], pt[1]];
  const radToDeg = 180 / Math.PI;
  const lon = frame.originLon + (pt[0] / (EARTH_RADIUS_M * frame.cosLat)) * radToDeg;
  const lat = frame.originLat + (pt[1] / EARTH_RADIUS_M) * radToDeg;
  return [lon, lat];
}

function cleanRing(ring: Ring): Ring | null {
  const cleaned: Ring = [];
  for (const pt of ring) {
    const prev = cleaned[cleaned.length - 1];
    if (!prev || dist2(prev, pt) > 1e-8) {
      cleaned.push([pt[0], pt[1]]);
    }
  }
  if (cleaned.length < 3) return null;
  if (dist2(cleaned[0], cleaned[cleaned.length - 1]) > 1e-8) {
    cleaned.push([cleaned[0][0], cleaned[0][1]]);
  }
  if (cleaned.length < 4) return null;
  if (Math.abs(ringAreaSigned(cleaned)) < 1e-4) return null;
  return cleaned;
}

function dissolvePolygons(polygons: MultiPolygonCoords): MultiPolygonCoords {
  if (polygons.length === 0) return [];
  if (polygons.length === 1) return polygons;

  // Balanced tree merge for speed & numerical stability
  let current: MultiPolygonCoords[] = polygons.map((p) => [p]);
  while (current.length > 1) {
    const next: MultiPolygonCoords[] = [];
    for (let i = 0; i < current.length; i += 2) {
      if (i + 1 >= current.length) {
        next.push(current[i]);
      } else {
        try {
          const merged = union(current[i], current[i + 1]);
          next.push(merged as MultiPolygonCoords);
        } catch {
          next.push([...current[i], ...current[i + 1]]);
        }
      }
    }
    current = next;
  }

  const dissolved = current[0] ?? [];
  const valid: MultiPolygonCoords = [];
  for (const poly of dissolved) {
    const rings: PolygonCoords = [];
    for (const r of poly) {
      const cr = cleanRing(r as Ring);
      if (cr) rings.push(cr);
    }
    if (rings.length > 0) valid.push(rings);
  }
  return valid;
}

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface IndexedPolygon {
  bbox: BBox;
  rings: Array<{ ring: Ring; bbox: BBox }>;
}

function buildSpatialPolygons(multi: MultiPolygonCoords): IndexedPolygon[] {
  return multi.map((poly) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    const rings = poly.map((ring) => {
      let rMinX = Infinity;
      let rMinY = Infinity;
      let rMaxX = -Infinity;
      let rMaxY = -Infinity;
      for (const [x, y] of ring) {
        if (x < rMinX) rMinX = x;
        if (y < rMinY) rMinY = y;
        if (x > rMaxX) rMaxX = x;
        if (y > rMaxY) rMaxY = y;
      }
      if (rMinX < minX) minX = rMinX;
      if (rMinY < minY) minY = rMinY;
      if (rMaxX > maxX) maxX = rMaxX;
      if (rMaxY > maxY) maxY = rMaxY;
      return {
        ring,
        bbox: { minX: rMinX, minY: rMinY, maxX: rMaxX, maxY: rMaxY },
      };
    });

    return {
      bbox: { minX, minY, maxX, maxY },
      rings,
    };
  });
}

function pointInRing(pt: Point2D, ring: Ring, bbox: BBox): boolean {
  const [x, y] = pt;
  if (x < bbox.minX || x > bbox.maxX || y < bbox.minY || y > bbox.maxY) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-18) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInIndexedMultiPolygon(pt: Point2D, indexed: IndexedPolygon[]): boolean {
  for (const poly of indexed) {
    if (
      pt[0] < poly.bbox.minX ||
      pt[0] > poly.bbox.maxX ||
      pt[1] < poly.bbox.minY ||
      pt[1] > poly.bbox.maxY
    ) {
      continue;
    }
    if (!pointInRing(pt, poly.rings[0].ring, poly.rings[0].bbox)) continue;
    let inHole = false;
    for (let h = 1; h < poly.rings.length; h++) {
      if (pointInRing(pt, poly.rings[h].ring, poly.rings[h].bbox)) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}

function computeTotalPerimeter(multi: MultiPolygonCoords): number {
  let perim = 0;
  for (const poly of multi) {
    for (const ring of poly) {
      perim += polylineLength(ring);
    }
  }
  return perim;
}

function resampleRing(ring: Ring, step: number): Point2D[] {
  const pts: Point2D[] = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    const segLen = dist(a, b);
    if (segLen < 1e-6) continue;
    const steps = Math.max(1, Math.ceil(segLen / step));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const p: Point2D = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const prev = pts[pts.length - 1];
      if (!prev || dist2(prev, p) > 1e-6) {
        pts.push(p);
      }
    }
  }
  if (pts.length > 1 && dist2(pts[0], pts[pts.length - 1]) < 1e-6) {
    pts.pop();
  }
  return pts;
}

function triangleCircumcircle(
  a: Point2D,
  b: Point2D,
  c: Point2D
): { center: Point2D; radius: number } | null {
  const ax = a[0];
  const ay = a[1];
  const bx = b[0];
  const by = b[1];
  const cx = c[0];
  const cy = c[1];

  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return null;

  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;

  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  const r = Math.hypot(ux - ax, uy - ay);
  if (!Number.isFinite(ux) || !Number.isFinite(uy) || !Number.isFinite(r)) return null;
  return { center: [ux, uy], radius: r };
}

function triangleIncircle(
  a: Point2D,
  b: Point2D,
  c: Point2D
): { center: Point2D; radius: number } {
  const la = dist(b, c);
  const lb = dist(a, c);
  const lc = dist(a, b);
  const perim = la + lb + lc;
  if (perim < 1e-9) {
    return { center: [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3], radius: 0.1 };
  }
  const ix = (la * a[0] + lb * b[0] + lc * c[0]) / perim;
  const iy = (la * a[1] + lb * b[1] + lc * c[1]) / perim;
  const area2 = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]));
  const r = area2 / perim;
  return { center: [ix, iy], radius: Math.max(0.05, r) };
}

interface RawNode {
  id: number;
  point: Point2D;
  radius: number;
  neighbors: Set<number>;
  active: boolean;
}

function pruneCornerSpurs(
  nodes: RawNode[],
  params: CenterlineParams
): void {
  let changed = true;
  let guard = 0;

  while (changed && guard < 20000) {
    changed = false;
    guard++;

    // Collect candidate leaf branches and score them
    const candidates: Array<{
      leafId: number;
      chainIds: number[];
      junctionId: number;
      score: number;
      branchLen: number;
      straightDist: number;
      junctionRadius: number;
      tipRatio: number;
    }> = [];

    for (const node of nodes) {
      if (!node.active || node.neighbors.size !== 1) continue;

      const chainIds: number[] = [node.id];
      let prev = node.id;
      let curr = Array.from(node.neighbors)[0];
      let branchLen = dist(node.point, nodes[curr].point);

      while (nodes[curr].active && nodes[curr].neighbors.size === 2) {
        chainIds.push(curr);
        const nbrs = Array.from(nodes[curr].neighbors);
        const next = nbrs[0] === prev ? nbrs[1] : nbrs[0];
        branchLen += dist(nodes[curr].point, nodes[next].point);
        prev = curr;
        curr = next;
      }

      if (!nodes[curr].active || nodes[curr].neighbors.size < 3) continue;

      const jNode = nodes[curr];
      const junctionRadius = Math.max(0.25, jNode.radius);
      const straightDist = dist(node.point, jNode.point);
      const tipRatio = node.radius / junctionRadius;

      const isShortSpur =
        branchLen < params.minBranchMeters ||
        (straightDist < params.spurFactor * junctionRadius && tipRatio < 0.72) ||
        branchLen < params.spurFactor * 0.9 * junctionRadius;

      if (isShortSpur) {
        candidates.push({
          leafId: node.id,
          chainIds,
          junctionId: curr,
          score: branchLen / junctionRadius,
          branchLen,
          straightDist,
          junctionRadius,
          tipRatio,
        });
      }
    }

    if (candidates.length === 0) break;

    // Prune the smallest relative spur first, checking that its junction still has >= 3 neighbors
    candidates.sort((a, b) => a.score - b.score);

    for (const cand of candidates) {
      const jNode = nodes[cand.junctionId];
      if (!jNode.active || jNode.neighbors.size < 3) continue;
      // Ensure chain is still intact
      const firstId = cand.chainIds[0];
      if (!nodes[firstId].active || nodes[firstId].neighbors.size !== 1) continue;

      for (const id of cand.chainIds) {
        const n = nodes[id];
        for (const nb of n.neighbors) {
          nodes[nb].neighbors.delete(id);
        }
        n.neighbors.clear();
        n.active = false;
      }
      changed = true;
      break;
    }
  }
}

function raySegmentIntersect(
  origin: Point2D,
  dir: Point2D,
  a: Point2D,
  b: Point2D
): number | null {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const denom = dir[0] * vy - dir[1] * vx;
  if (Math.abs(denom) < 1e-10) return null;
  const ox = a[0] - origin[0];
  const oy = a[1] - origin[1];
  const t = (ox * vy - oy * vx) / denom;
  const u = (ox * dir[1] - oy * dir[0]) / denom;
  if (t > 1e-4 && u >= -1e-6 && u <= 1 + 1e-6) {
    return t;
  }
  return null;
}

function trimAndExtendDeadEnds(
  nodes: RawNode[],
  polygons: MultiPolygonCoords,
  extendDeadEnds: boolean
): void {
  const boundarySegments: Array<[Point2D, Point2D]> = [];
  if (extendDeadEnds) {
    for (const poly of polygons) {
      for (const ring of poly) {
        for (let i = 0; i < ring.length - 1; i++) {
          boundarySegments.push([ring[i], ring[i + 1]]);
        }
      }
    }
  }

  const leaves = nodes.filter((n) => n.active && n.neighbors.size === 1);

  for (const leaf of leaves) {
    if (!leaf.active || leaf.neighbors.size !== 1) continue;

    // Walk inward from leaf along degree-2 chain
    const path: number[] = [leaf.id];
    let prev = leaf.id;
    let curr = Array.from(leaf.neighbors)[0];
    let walked = dist(leaf.point, nodes[curr].point);

    while (nodes[curr].active && nodes[curr].neighbors.size === 2 && walked < 60) {
      path.push(curr);
      const nbrs = Array.from(nodes[curr].neighbors);
      const next = nbrs[0] === prev ? nbrs[1] : nbrs[0];
      walked += dist(nodes[curr].point, nodes[next].point);
      prev = curr;
      curr = next;
    }
    if (nodes[curr].active) path.push(curr);
    if (path.length < 3) continue;

    // Find stable local radius behind the tip (nodes 2..min(path.length, 10))
    const sampleRadii = path
      .slice(1, Math.min(path.length, 10))
      .map((id) => nodes[id].radius)
      .sort((a, b) => a - b);
    const stableR = sampleRadii[Math.floor(sampleRadii.length * 0.7)] ?? leaf.radius;

    // Trim corner-hook nodes where radius tapers sharply (< 0.72 * stableR)
    let trimCount = 0;
    let trimmedLen = 0;
    while (
      trimCount < path.length - 2 &&
      nodes[path[trimCount]].radius < 0.72 * stableR &&
      trimmedLen < 1.8 * stableR
    ) {
      trimmedLen += dist(nodes[path[trimCount]].point, nodes[path[trimCount + 1]].point);
      trimCount++;
    }

    if (trimCount > 0 && trimCount < path.length - 1) {
      for (let i = 0; i < trimCount; i++) {
        const rmId = path[i];
        const rmNode = nodes[rmId];
        for (const nb of rmNode.neighbors) {
          nodes[nb].neighbors.delete(rmId);
        }
        rmNode.neighbors.clear();
        rmNode.active = false;
      }
    }

    const newTipId = path[trimCount];
    const newTip = nodes[newTipId];
    if (!newTip.active || newTip.neighbors.size !== 1) continue;

    if (extendDeadEnds && path.length - trimCount >= 2) {
      // Compute stable inward-to-tip direction vector
      const backIdx = Math.min(path.length - 1, trimCount + 3);
      const backPt = nodes[path[backIdx]].point;
      const dx = newTip.point[0] - backPt[0];
      const dy = newTip.point[1] - backPt[1];
      const len = Math.hypot(dx, dy);
      if (len > 1e-4) {
        const dir: Point2D = [dx / len, dy / len];
        let minHit = Infinity;
        for (const [sa, sb] of boundarySegments) {
          const hit = raySegmentIntersect(newTip.point, dir, sa, sb);
          if (hit !== null && hit < minHit) {
            minHit = hit;
          }
        }
        if (minHit > 0.25 && minHit <= Math.max(2.2 * stableR, 4)) {
          const extLen = Math.max(0.1, minHit - 0.15);
          const extPt: Point2D = [
            newTip.point[0] + dir[0] * extLen,
            newTip.point[1] + dir[1] * extLen,
          ];
          const newId = nodes.length;
          nodes.push({
            id: newId,
            point: extPt,
            radius: stableR,
            neighbors: new Set([newTipId]),
            active: true,
          });
          newTip.neighbors.add(newId);
        }
      }
    }
  }
}

function removeSpuriousLoops(
  nodes: RawNode[],
  indexedPolys: IndexedPolygon[]
): void {
  // Remove self-loops or short parallel paths between two junctions that do NOT enclose a polygon hole
  const edgeKey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);

  let changed = true;
  let guard = 0;
  while (changed && guard < 500) {
    changed = false;
    guard++;

    for (const u of nodes) {
      if (!u.active || u.neighbors.size < 3) continue;

      // Walk from each neighbor of u to see if it returns to u or shares another path to the same junction v
      const pathsToTarget = new Map<
        number,
        Array<{ chain: number[]; len: number; firstNbr: number }>
      >();

      for (const firstNbr of Array.from(u.neighbors)) {
        if (!nodes[firstNbr].active) continue;
        const chain: number[] = [u.id, firstNbr];
        let prev = u.id;
        let curr = firstNbr;
        let len = dist(u.point, nodes[curr].point);

        while (nodes[curr].active && nodes[curr].neighbors.size === 2 && len < 120) {
          const nbrs = Array.from(nodes[curr].neighbors);
          const next = nbrs[0] === prev ? nbrs[1] : nbrs[0];
          if (next === undefined) break;
          chain.push(next);
          len += dist(nodes[curr].point, nodes[next].point);
          prev = curr;
          curr = next;
          if (curr === u.id) break;
        }

        if (!nodes[curr].active) continue;
        if (curr === u.id || nodes[curr].neighbors.size >= 3) {
          if (!pathsToTarget.has(curr)) pathsToTarget.set(curr, []);
          pathsToTarget.get(curr)!.push({ chain, len, firstNbr });
        }
      }

      // 1. Self-loops u -> ... -> u that don't enclose a hole
      const selfLoops = pathsToTarget.get(u.id);
      if (selfLoops && selfLoops.length > 0) {
        for (const sl of selfLoops) {
          const pts = sl.chain.map((id) => nodes[id].point);
          const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
          const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
          // If centroid of loop is inside the polygon, it does NOT enclose an island hole -> spurious loop
          if (pointInIndexedMultiPolygon([cx, cy], indexedPolys) || sl.len < 3.0 * Math.max(1, u.radius)) {
            if (sl.chain.length <= 2) {
              u.neighbors.delete(sl.firstNbr);
            } else {
              // Remove interior nodes of this spurious loop
              for (let k = 1; k < sl.chain.length - 1; k++) {
                const rm = nodes[sl.chain[k]];
                for (const nb of rm.neighbors) nodes[nb].neighbors.delete(rm.id);
                rm.neighbors.clear();
                rm.active = false;
              }
            }
            changed = true;
            break;
          }
        }
        if (changed) break;
      }

      // 2. Parallel short edges u -> v that don't enclose a hole
      for (const [targetId, list] of pathsToTarget.entries()) {
        if (targetId === u.id || list.length < 2) continue;
        // Sort longest to shortest, remove shorter duplicate paths if interior centroid is inside polygon
        list.sort((a, b) => b.len - a.len);
        for (let i = 1; i < list.length; i++) {
          const pA = list[0].chain.map((id) => nodes[id].point);
          const pB = list[i].chain.map((id) => nodes[id].point);
          const combined = [...pA, ...pB];
          const cx = combined.reduce((a, p) => a + p[0], 0) / combined.length;
          const cy = combined.reduce((a, p) => a + p[1], 0) / combined.length;
          if (
            pointInIndexedMultiPolygon([cx, cy], indexedPolys) &&
            list[i].len < 4.5 * Math.max(1, u.radius, nodes[targetId].radius)
          ) {
            const chain = list[i].chain;
            if (chain.length === 2) {
              u.neighbors.delete(targetId);
              nodes[targetId].neighbors.delete(u.id);
            } else {
              for (let k = 1; k < chain.length - 1; k++) {
                const rm = nodes[chain[k]];
                for (const nb of rm.neighbors) nodes[nb].neighbors.delete(rm.id);
                rm.neighbors.clear();
                rm.active = false;
              }
            }
            changed = true;
            break;
          }
        }
        if (changed) break;
      }
      if (changed) break;
    }
  }
  void edgeKey;
}

function clusterJunctions(
  nodes: RawNode[],
  indexedPolys: IndexedPolygon[],
  junctionMergeFactor: number
): void {
  if (junctionMergeFactor <= 0.1) return;

  let mergedAny = true;
  let guard = 0;

  while (mergedAny && guard < 1000) {
    mergedAny = false;
    guard++;

    for (const u of nodes) {
      if (!u.active || u.neighbors.size < 3) continue;

      // Search paths from u to any other junction v (degree >= 3)
      for (const firstNbr of Array.from(u.neighbors)) {
        if (!nodes[firstNbr].active) continue;
        const pathIds: number[] = [];
        let prev = u.id;
        let curr = firstNbr;
        let pathLen = dist(u.point, nodes[curr].point);

        while (nodes[curr].active && nodes[curr].neighbors.size === 2 && pathLen < 80) {
          pathIds.push(curr);
          const nbrs = Array.from(nodes[curr].neighbors);
          const next = nbrs[0] === prev ? nbrs[1] : nbrs[0];
          pathLen += dist(nodes[curr].point, nodes[next].point);
          prev = curr;
          curr = next;
        }

        if (curr === u.id || !nodes[curr].active || nodes[curr].neighbors.size < 3) continue;

        const v = nodes[curr];
        const localR = Math.max(u.radius, v.radius, 0.5);
        const threshold = junctionMergeFactor * localR;

        if (pathLen <= threshold) {
          // Merge v and intermediate pathIds into u
          const wu = Math.max(0.1, u.radius);
          const wv = Math.max(0.1, v.radius);
          const mergedPt: Point2D = [
            (u.point[0] * wu + v.point[0] * wv) / (wu + wv),
            (u.point[1] * wu + v.point[1] * wv) / (wu + wv),
          ];
          if (pointInIndexedMultiPolygon(mergedPt, indexedPolys)) {
            u.point = mergedPt;
          }
          u.radius = Math.max(u.radius, v.radius);

          // Remove intermediate nodes
          for (const midId of pathIds) {
            const m = nodes[midId];
            for (const nb of m.neighbors) {
              nodes[nb].neighbors.delete(midId);
            }
            m.neighbors.clear();
            m.active = false;
          }

          // Rewire v's neighbors to u
          u.neighbors.delete(v.id);
          v.neighbors.delete(u.id);
          for (const nb of Array.from(v.neighbors)) {
            nodes[nb].neighbors.delete(v.id);
            if (nb !== u.id && nodes[nb].active) {
              nodes[nb].neighbors.add(u.id);
              u.neighbors.add(nb);
            }
          }
          v.neighbors.clear();
          v.active = false;
          mergedAny = true;
          break;
        }
      }
      if (mergedAny) break;
    }
  }
}

function laplacianSmooth(pts: Point2D[], passes: number, weight = 0.35): Point2D[] {
  if (pts.length <= 2 || passes <= 0) return pts.map((p) => [p[0], p[1]]);
  let cur = pts.map((p) => [p[0], p[1]] as Point2D);
  for (let p = 0; p < passes; p++) {
    const next: Point2D[] = [cur[0]];
    for (let i = 1; i < cur.length - 1; i++) {
      const avgX = (cur[i - 1][0] + cur[i + 1][0]) * 0.5;
      const avgY = (cur[i - 1][1] + cur[i + 1][1]) * 0.5;
      next.push([
        cur[i][0] * (1 - weight) + avgX * weight,
        cur[i][1] * (1 - weight) + avgY * weight,
      ]);
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}

function chaikinSmoothPinned(pts: Point2D[], iterations: number): Point2D[] {
  if (pts.length <= 2 || iterations <= 0) return pts.map((p) => [p[0], p[1]]);
  let cur = pts.map((p) => [p[0], p[1]] as Point2D);
  for (let iter = 0; iter < iterations; iter++) {
    const next: Point2D[] = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) {
      const a = cur[i];
      const b = cur[i + 1];
      if (i === 0) {
        next.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
      } else if (i === cur.length - 2) {
        next.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      } else {
        next.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
        next.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
      }
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}

function perpendicularDistance(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  const projX = a[0] + t * dx;
  const projY = a[1] + t * dy;
  return Math.hypot(p[0] - projX, p[1] - projY);
}

function simplifyRDP(pts: Point2D[], epsilon: number): Point2D[] {
  if (pts.length <= 2 || epsilon <= 0.001) return pts;
  let maxD = 0;
  let maxIdx = 0;
  const first = pts[0];
  const last = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpendicularDistance(pts[i], first, last);
    if (d > maxD) {
      maxD = d;
      maxIdx = i;
    }
  }
  if (maxD > epsilon) {
    const left = simplifyRDP(pts.slice(0, maxIdx + 1), epsilon);
    const right = simplifyRDP(pts.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

function clampPolylineToCorridor(
  smoothed: Point2D[],
  raw: Point2D[],
  indexedPolys: IndexedPolygon[]
): Point2D[] {
  if (raw.length === 0) return smoothed;
  return smoothed.map((pt, idx) => {
    if (idx === 0 || idx === smoothed.length - 1) return pt;
    if (pointInIndexedMultiPolygon(pt, indexedPolys)) return pt;

    // Find nearest raw point inside corridor and binary-search inward
    let nearest = raw[0];
    let bestD2 = dist2(pt, nearest);
    for (let i = 1; i < raw.length; i++) {
      const d2 = dist2(pt, raw[i]);
      if (d2 < bestD2) {
        bestD2 = d2;
        nearest = raw[i];
      }
    }
    let lo = 0;
    let hi = 1;
    let safePt = nearest;
    for (let step = 0; step < 5; step++) {
      const mid = (lo + hi) * 0.5;
      const cand: Point2D = [
        pt[0] * (1 - mid) + nearest[0] * mid,
        pt[1] * (1 - mid) + nearest[1] * mid,
      ];
      if (pointInIndexedMultiPolygon(cand, indexedPolys)) {
        safePt = cand;
        hi = mid;
      } else {
        lo = mid;
      }
    }
    return safePt;
  });
}

function closestPointOnSegment(p: Point2D, a: Point2D, b: Point2D): { point: Point2D; t: number; dist: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return { point: a, t: 0, dist: dist(p, a) };
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  const proj: Point2D = [a[0] + t * dx, a[1] + t * dy];
  return { point: proj, t, dist: dist(p, proj) };
}

function assignComponents(nodes: GraphNode[], edges: GraphEdge[]): ComponentSummary[] {
  const nodeMap = new Map<string, GraphNode>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    n.componentId = -1;
    n.degree = 0;
    nodeMap.set(n.id, n);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    adj.get(e.startNodeId)?.push(e.endNodeId);
    adj.get(e.endNodeId)?.push(e.startNodeId);
    const sn = nodeMap.get(e.startNodeId);
    const en = nodeMap.get(e.endNodeId);
    if (sn) sn.degree++;
    if (en) en.degree++;
  }
  for (const n of nodes) {
    if (n.kind !== 'bridge') {
      n.kind = n.degree >= 3 ? 'junction' : 'endpoint';
    }
  }

  let compId = 0;
  const summaries: ComponentSummary[] = [];

  for (const startNode of nodes) {
    if (startNode.componentId !== -1) continue;
    const queue: GraphNode[] = [startNode];
    startNode.componentId = compId;
    let sumX = 0;
    let sumY = 0;
    let nodeCount = 0;

    while (queue.length > 0) {
      const cur = queue.shift()!;
      sumX += cur.point[0];
      sumY += cur.point[1];
      nodeCount++;
      for (const nbrId of adj.get(cur.id) ?? []) {
        const nbr = nodeMap.get(nbrId);
        if (nbr && nbr.componentId === -1) {
          nbr.componentId = compId;
          queue.push(nbr);
        }
      }
    }

    let edgeCount = 0;
    let totalLengthMeters = 0;
    for (const e of edges) {
      const sn = nodeMap.get(e.startNodeId);
      if (sn && sn.componentId === compId) {
        e.componentId = compId;
        edgeCount++;
        totalLengthMeters += e.lengthMeters;
      }
    }

    summaries.push({
      id: compId,
      edgeCount,
      nodeCount,
      totalLengthMeters,
      centroid: [sumX / Math.max(1, nodeCount), sumY / Math.max(1, nodeCount)],
    });

    compId++;
  }

  return summaries;
}

function bridgeDisconnectedSectors(
  nodes: GraphNode[],
  edges: GraphEdge[],
  maxBridgeMeters: number,
  frame: ProjectionFrame
): void {
  if (maxBridgeMeters <= 0) return;

  let nodeCounter = nodes.length + 1;
  let edgeCounter = edges.length + 1;

  let components = assignComponents(nodes, edges);
  let guard = 0;

  while (components.length > 1 && guard < 100) {
    guard++;
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    let bestDist = Infinity;
    let bestSourceNode: GraphNode | null = null;
    let bestTargetNode: GraphNode | null = null;
    let bestTargetEdge: GraphEdge | null = null;
    let bestSegIdx = -1;
    let bestProjPt: Point2D | null = null;

    // 1. Check node-to-node across different components
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        if (a.componentId === b.componentId) continue;
        const d = dist(a.point, b.point);
        if (d < bestDist) {
          bestDist = d;
          bestSourceNode = a;
          bestTargetNode = b;
          bestTargetEdge = null;
          bestProjPt = b.point;
        }
      }
    }

    // 2. Check node-to-edge-segment across different components (for clean T-bridging)
    for (const a of nodes) {
      for (const edge of edges) {
        if (edge.componentId === a.componentId) continue;
        const pts = edge.points;
        for (let s = 0; s < pts.length - 1; s++) {
          const cp = closestPointOnSegment(a.point, pts[s], pts[s + 1]);
          if (cp.dist < bestDist) {
            bestDist = cp.dist;
            bestSourceNode = a;
            bestTargetNode = null;
            bestTargetEdge = edge;
            bestSegIdx = s;
            bestProjPt = cp.point;
          }
        }
      }
    }

    if (!bestSourceNode || !bestProjPt || bestDist > maxBridgeMeters) {
      break;
    }

    let targetNodeForBridge: GraphNode;

    if (bestTargetNode) {
      targetNodeForBridge = bestTargetNode;
    } else if (bestTargetEdge && bestSegIdx >= 0) {
      // Check if projection is very close to start or end of target edge
      const startNode = nodeMap.get(bestTargetEdge.startNodeId)!;
      const endNode = nodeMap.get(bestTargetEdge.endNodeId)!;
      if (dist(bestProjPt, startNode.point) < 1.5) {
        targetNodeForBridge = startNode;
      } else if (dist(bestProjPt, endNode.point) < 1.5) {
        targetNodeForBridge = endNode;
      } else {
        // Split bestTargetEdge at bestProjPt creating a new T-junction node
        const splitNode: GraphNode = {
          id: `N${nodeCounter++}`,
          point: bestProjPt,
          geoPoint: toGeo(bestProjPt, frame),
          degree: 3,
          kind: 'bridge',
          halfWidthMeters: bestTargetEdge.avgWidthMeters * 0.5,
          componentId: bestTargetEdge.componentId,
        };
        nodes.push(splitNode);

        const pts = bestTargetEdge.points;
        const widths = bestTargetEdge.widths;
        const firstHalfPts = [...pts.slice(0, bestSegIdx + 1), bestProjPt];
        const secondHalfPts = [bestProjPt, ...pts.slice(bestSegIdx + 1)];
        const midWidth = widths[bestSegIdx] ?? bestTargetEdge.avgWidthMeters;
        const firstWidths = [...widths.slice(0, bestSegIdx + 1), midWidth];
        const secondWidths = [midWidth, ...widths.slice(bestSegIdx + 1)];

        const origEndId = bestTargetEdge.endNodeId;
        bestTargetEdge.endNodeId = splitNode.id;
        bestTargetEdge.points = firstHalfPts;
        bestTargetEdge.geoPoints = firstHalfPts.map((p) => toGeo(p, frame));
        bestTargetEdge.widths = firstWidths;
        bestTargetEdge.lengthMeters = polylineLength(firstHalfPts);

        const secondEdge: GraphEdge = {
          id: `T${edgeCounter++}`,
          startNodeId: splitNode.id,
          endNodeId: origEndId,
          points: secondHalfPts,
          geoPoints: secondHalfPts.map((p) => toGeo(p, frame)),
          rawPoints: secondHalfPts,
          widths: secondWidths,
          lengthMeters: polylineLength(secondHalfPts),
          avgWidthMeters: bestTargetEdge.avgWidthMeters,
          minWidthMeters: bestTargetEdge.minWidthMeters,
          maxWidthMeters: bestTargetEdge.maxWidthMeters,
          isBridge: bestTargetEdge.isBridge,
          componentId: bestTargetEdge.componentId,
          roadClass: bestTargetEdge.roadClass,
        };
        edges.push(secondEdge);
        targetNodeForBridge = splitNode;
      }
    } else {
      break;
    }

    const bridgePts: Point2D[] = [bestSourceNode.point, targetNodeForBridge.point];
    const bridgeWidth = Math.max(
      2,
      Math.min(bestSourceNode.halfWidthMeters * 2, targetNodeForBridge.halfWidthMeters * 2)
    );
    edges.push({
      id: `P${edgeCounter++}`,
      startNodeId: bestSourceNode.id,
      endNodeId: targetNodeForBridge.id,
      points: bridgePts,
      geoPoints: bridgePts.map((p) => toGeo(p, frame)),
      rawPoints: bridgePts,
      widths: [bridgeWidth, bridgeWidth],
      lengthMeters: dist(bridgePts[0], bridgePts[1]),
      avgWidthMeters: bridgeWidth,
      minWidthMeters: bridgeWidth,
      maxWidthMeters: bridgeWidth,
      isBridge: true,
      componentId: bestSourceNode.componentId,
      roadClass: 'ponte',
    });

    components = assignComponents(nodes, edges);
  }
}

export function extractCenterlineNetwork(
  features: GeoFeaturePolygon[],
  params: CenterlineParams
): NetworkResult {
  const t0 = performance.now();
  const frame = detectProjectionFrame(features);

  const rawPolygonsMeters: MultiPolygonCoords = features.map((f) =>
    f.coordinates.map((ring) => ring.map((pt) => toMeters(pt, frame)))
  );

  // Clean input rings in meters
  const cleanedMeters: MultiPolygonCoords = [];
  for (const poly of rawPolygonsMeters) {
    const rings: PolygonCoords = [];
    for (const r of poly) {
      const cr = cleanRing(r);
      if (cr) rings.push(cr);
    }
    if (rings.length > 0) cleanedMeters.push(rings);
  }

  // Compute metric bounds
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of cleanedMeters) {
    for (const ring of poly) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 100;
    maxY = 100;
  }
  frame.boundsMeters = {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };

  if (cleanedMeters.length === 0) {
    return {
      projection: frame,
      dissolvedPolygonsMeters: [],
      rawPolygonsMeters: [],
      nodes: [],
      edges: [],
      components: [],
      stats: {
        inputPolygonCount: 0,
        dissolvedPolygonCount: 0,
        totalLengthMeters: 0,
        junctionCount: 0,
        endpointCount: 0,
        bridgeCount: 0,
        componentCount: 0,
        avgWidthMeters: 0,
        minWidthMeters: 0,
        maxWidthMeters: 0,
        processingMs: 0,
      },
    };
  }

  // 1. Dissolve touching/overlapping polygons across intersections & sectors
  const dissolved = dissolvePolygons(cleanedMeters);
  const indexedPolys = buildSpatialPolygons(dissolved);

  // 2. Adaptive dense boundary sampling
  const perimeter = computeTotalPerimeter(dissolved);
  const effectiveStep = Math.max(params.sampleStepMeters, perimeter / 13500, 0.4);
  const boundaryPoints: Point2D[] = [];
  for (const poly of dissolved) {
    for (const ring of poly) {
      const sampled = resampleRing(ring, effectiveStep);
      for (const p of sampled) {
        boundaryPoints.push(p);
      }
    }
  }

  if (boundaryPoints.length < 3) {
    return {
      projection: frame,
      dissolvedPolygonsMeters: dissolved,
      rawPolygonsMeters: cleanedMeters,
      nodes: [],
      edges: [],
      components: [],
      stats: {
        inputPolygonCount: features.length,
        dissolvedPolygonCount: dissolved.length,
        totalLengthMeters: 0,
        junctionCount: 0,
        endpointCount: 0,
        bridgeCount: 0,
        componentCount: 0,
        avgWidthMeters: 0,
        minWidthMeters: 0,
        maxWidthMeters: 0,
        processingMs: performance.now() - t0,
      },
    };
  }

  // 3. Delaunay triangulation & interior Voronoi dual extraction
  const delaunay = Delaunay.from(boundaryPoints);
  const triangles = delaunay.triangles;
  const halfedges = delaunay.halfedges;
  const triCount = triangles.length / 3;
  const maxSpan = Math.max(frame.boundsMeters.width, frame.boundsMeters.height);

  const triToNode = new Int32Array(triCount).fill(-1);
  const rawNodes: RawNode[] = [];

  for (let t = 0; t < triCount; t++) {
    const i0 = triangles[t * 3];
    const i1 = triangles[t * 3 + 1];
    const i2 = triangles[t * 3 + 2];
    const a = boundaryPoints[i0];
    const b = boundaryPoints[i1];
    const c = boundaryPoints[i2];

    const centroid: Point2D = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
    if (!pointInIndexedMultiPolygon(centroid, indexedPolys)) continue;

    const cc = triangleCircumcircle(a, b, c);
    // Strict Voronoi interior medial axis filter: discard obtuse skin-ear triangles whose circumcenter lies outside the polygon
    if (!cc || cc.radius >= maxSpan * 1.2 || !pointInIndexedMultiPolygon(cc.center, indexedPolys)) {
      continue;
    }

    const id = rawNodes.length;
    triToNode[t] = id;
    rawNodes.push({
      id,
      point: cc.center,
      radius: cc.radius,
      neighbors: new Set(),
      active: true,
    });
  }

  // Connect adjacent interior triangles across interior Delaunay edges
  for (let t = 0; t < triCount; t++) {
    const u = triToNode[t];
    if (u === -1) continue;
    for (let k = 0; k < 3; k++) {
      const e = t * 3 + k;
      const opp = halfedges[e];
      if (opp === -1) continue;
      const t2 = Math.floor(opp / 3);
      if (t2 <= t) continue;
      const v = triToNode[t2];
      if (v === -1) continue;

      const p1 = boundaryPoints[triangles[e]];
      const p2 = boundaryPoints[triangles[t * 3 + ((k + 1) % 3)]];
      const edgeMid: Point2D = [(p1[0] + p2[0]) * 0.5, (p1[1] + p2[1]) * 0.5];
      if (!pointInIndexedMultiPolygon(edgeMid, indexedPolys)) continue;

      rawNodes[u].neighbors.add(v);
      rawNodes[v].neighbors.add(u);
    }
  }

  // 4. Prune corner spurs, remove spurious non-hole loops, cluster X-crossings, and cleanly extend dead-ends
  pruneCornerSpurs(rawNodes, params);
  removeSpuriousLoops(rawNodes, indexedPolys);
  pruneCornerSpurs(rawNodes, params);
  clusterJunctions(rawNodes, indexedPolys, params.junctionMergeFactor);
  removeSpuriousLoops(rawNodes, indexedPolys);
  pruneCornerSpurs(rawNodes, params);
  trimAndExtendDeadEnds(rawNodes, dissolved, params.extendDeadEnds);
  pruneCornerSpurs(rawNodes, params);

  // 6. Extract topological chains between anchor nodes (degree !== 2) & closed cycles
  const rawAnchorIds = new Set<number>();
  for (const n of rawNodes) {
    if (n.active && n.neighbors.size !== 2 && n.neighbors.size > 0) {
      rawAnchorIds.add(n.id);
    }
  }

  const visitedEdges = new Set<string>();
  const edgeKey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);

  const extractedChains: Array<{
    startRawId: number;
    endRawId: number;
    nodeIds: number[];
  }> = [];

  for (const anchorId of rawAnchorIds) {
    const anchor = rawNodes[anchorId];
    for (const nbrId of anchor.neighbors) {
      const ek = edgeKey(anchorId, nbrId);
      if (visitedEdges.has(ek)) continue;

      const chain: number[] = [anchorId];
      let prev = anchorId;
      let curr = nbrId;
      visitedEdges.add(edgeKey(prev, curr));

      while (rawNodes[curr].active && !rawAnchorIds.has(curr)) {
        chain.push(curr);
        const nbrs = Array.from(rawNodes[curr].neighbors);
        const next = nbrs[0] === prev ? nbrs[1] : nbrs[0];
        if (next === undefined) break;
        visitedEdges.add(edgeKey(curr, next));
        prev = curr;
        curr = next;
      }
      chain.push(curr);

      extractedChains.push({
        startRawId: anchorId,
        endRawId: curr,
        nodeIds: chain,
      });
    }
  }

  // Handle pure closed cycles (e.g., isolated loop road with no junctions)
  for (const n of rawNodes) {
    if (!n.active || n.neighbors.size !== 2) continue;
    const nbrs = Array.from(n.neighbors);
    if (visitedEdges.has(edgeKey(n.id, nbrs[0]))) continue;

    // Walk full loop
    const loopIds: number[] = [n.id];
    let prev = n.id;
    let curr = nbrs[0];
    visitedEdges.add(edgeKey(prev, curr));

    while (curr !== n.id && rawNodes[curr].active) {
      loopIds.push(curr);
      const cnbrs = Array.from(rawNodes[curr].neighbors);
      const next = cnbrs[0] === prev ? cnbrs[1] : cnbrs[0];
      if (next === undefined) break;
      visitedEdges.add(edgeKey(curr, next));
      prev = curr;
      curr = next;
    }

    if (loopIds.length >= 4) {
      // Split loop into two chains at antipodal nodes so graph routing works seamlessly
      const midIdx = Math.floor(loopIds.length / 2);
      const anchorA = loopIds[0];
      const anchorB = loopIds[midIdx];
      rawAnchorIds.add(anchorA);
      rawAnchorIds.add(anchorB);

      extractedChains.push({
        startRawId: anchorA,
        endRawId: anchorB,
        nodeIds: loopIds.slice(0, midIdx + 1),
      });
      extractedChains.push({
        startRawId: anchorB,
        endRawId: anchorA,
        nodeIds: [...loopIds.slice(midIdx), anchorA],
      });
    }
  }

  // 7. Build GraphNodes & smoothed GraphEdges
  const rawToGraphNode = new Map<number, GraphNode>();
  const graphNodes: GraphNode[] = [];
  let nodeSeq = 1;

  for (const rawId of rawAnchorIds) {
    const rn = rawNodes[rawId];
    const gNode: GraphNode = {
      id: `N${nodeSeq++}`,
      point: [rn.point[0], rn.point[1]],
      geoPoint: toGeo(rn.point, frame),
      degree: rn.neighbors.size,
      kind: rn.neighbors.size >= 3 ? 'junction' : 'endpoint',
      halfWidthMeters: rn.radius,
      componentId: 0,
    };
    rawToGraphNode.set(rawId, gNode);
    graphNodes.push(gNode);
  }

  const graphEdges: GraphEdge[] = [];
  let edgeSeq = 1;

  for (const ch of extractedChains) {
    const startNode = rawToGraphNode.get(ch.startRawId);
    const endNode = rawToGraphNode.get(ch.endRawId);
    if (!startNode || !endNode) continue;

    const rawPts: Point2D[] = ch.nodeIds.map((id) => [rawNodes[id].point[0], rawNodes[id].point[1]]);
    const rawRadii: number[] = ch.nodeIds.map((id) => rawNodes[id].radius);

    // Light Laplacian pre-denoising -> Chaikin curve smoothing -> Corridor safety clamp -> RDP simplification
    let smoothed = laplacianSmooth(rawPts, params.smoothingIterations > 0 ? 2 : 0, 0.35);
    smoothed = chaikinSmoothPinned(smoothed, params.smoothingIterations);
    smoothed = clampPolylineToCorridor(smoothed, rawPts, indexedPolys);
    smoothed = simplifyRDP(smoothed, params.simplificationMeters);

    // Guarantee exact start/end topological coordinates
    if (smoothed.length >= 2) {
      smoothed[0] = [startNode.point[0], startNode.point[1]];
      smoothed[smoothed.length - 1] = [endNode.point[0], endNode.point[1]];
    }

    const len = polylineLength(smoothed);
    if (len < 0.2 && startNode.id === endNode.id) continue;

    // Sample road full widths along smoothed vertices from nearest raw medial point
    const widths: number[] = smoothed.map((pt) => {
      let bestR = rawRadii[0] ?? 2;
      let bestD2 = Infinity;
      for (let i = 0; i < rawPts.length; i++) {
        const d2 = dist2(pt, rawPts[i]);
        if (d2 < bestD2) {
          bestD2 = d2;
          bestR = rawRadii[i];
        }
      }
      return bestR * 2;
    });

    const avgWidth = widths.reduce((acc, w) => acc + w, 0) / Math.max(1, widths.length);
    const minWidth = Math.min(...widths);
    const maxWidth = Math.max(...widths);

    graphEdges.push({
      id: `T${edgeSeq++}`,
      startNodeId: startNode.id,
      endNodeId: endNode.id,
      points: smoothed,
      geoPoints: smoothed.map((p) => toGeo(p, frame)),
      rawPoints: rawPts,
      widths,
      lengthMeters: len,
      avgWidthMeters: avgWidth,
      minWidthMeters: minWidth,
      maxWidthMeters: maxWidth,
      isBridge: false,
      componentId: 0,
      roadClass: 'secundario',
    });
  }

  // Classify main vs secondary carreadores relative to network width distribution
  if (graphEdges.length > 0) {
    const sortedWidths = [...graphEdges].map((e) => e.avgWidthMeters).sort((a, b) => a - b);
    const medianW = sortedWidths[Math.floor(sortedWidths.length * 0.5)];
    const maxW = sortedWidths[sortedWidths.length - 1];
    const hasWidthHierarchy = maxW - sortedWidths[0] > 1.5;

    for (const edge of graphEdges) {
      if (edge.isBridge) {
        edge.roadClass = 'ponte';
      } else if (
        (hasWidthHierarchy && edge.avgWidthMeters >= medianW * 1.18) ||
        edge.avgWidthMeters >= 8.5
      ) {
        edge.roadClass = 'principal';
      } else {
        edge.roadClass = 'secundario';
      }
    }
  }

  // 8. Sector connectivity & optional auto-bridging
  if (params.autoBridgeSectors) {
    bridgeDisconnectedSectors(graphNodes, graphEdges, params.maxBridgeMeters, frame);
  }
  const components = assignComponents(graphNodes, graphEdges);

  const totalLengthMeters = graphEdges.reduce((acc, e) => acc + e.lengthMeters, 0);
  const junctionCount = graphNodes.filter((n) => n.degree >= 3).length;
  const endpointCount = graphNodes.filter((n) => n.degree === 1).length;
  const bridgeCount = graphEdges.filter((e) => e.isBridge).length;

  const nonBridgeEdges = graphEdges.filter((e) => !e.isBridge);
  const avgWidthMeters =
    nonBridgeEdges.length > 0
      ? nonBridgeEdges.reduce((acc, e) => acc + e.avgWidthMeters * e.lengthMeters, 0) /
        Math.max(1, nonBridgeEdges.reduce((acc, e) => acc + e.lengthMeters, 0))
      : 0;
  const minWidthMeters =
    nonBridgeEdges.length > 0 ? Math.min(...nonBridgeEdges.map((e) => e.minWidthMeters)) : 0;
  const maxWidthMeters =
    nonBridgeEdges.length > 0 ? Math.max(...nonBridgeEdges.map((e) => e.maxWidthMeters)) : 0;

  return {
    projection: frame,
    dissolvedPolygonsMeters: dissolved,
    rawPolygonsMeters: cleanedMeters,
    nodes: graphNodes,
    edges: graphEdges,
    components,
    stats: {
      inputPolygonCount: features.length,
      dissolvedPolygonCount: dissolved.length,
      totalLengthMeters,
      junctionCount,
      endpointCount,
      bridgeCount,
      componentCount: components.length,
      avgWidthMeters,
      minWidthMeters,
      maxWidthMeters,
      processingMs: performance.now() - t0,
    },
  };
}

export function findShortestRoute(
  network: NetworkResult,
  startNodeId: string,
  endNodeId: string,
  minVehicleWidthMeters = 0
): RouteResult {
  if (startNodeId === endNodeId) {
    const n = network.nodes.find((x) => x.id === startNodeId);
    return {
      found: Boolean(n),
      startNodeId,
      endNodeId,
      nodeIds: n ? [n.id] : [],
      edgeIds: [],
      polylineMeters: n ? [n.point] : [],
      polylineGeo: n ? [n.geoPoint] : [],
      totalLengthMeters: 0,
      minWidthMeters: n ? n.halfWidthMeters * 2 : 0,
      avgWidthMeters: n ? n.halfWidthMeters * 2 : 0,
      turnCount: 0,
    };
  }

  const adj = new Map<string, Array<{ to: string; edge: GraphEdge }>>();
  for (const n of network.nodes) adj.set(n.id, []);
  for (const e of network.edges) {
    if (minVehicleWidthMeters > 0 && !e.isBridge && e.minWidthMeters < minVehicleWidthMeters) {
      continue;
    }
    adj.get(e.startNodeId)?.push({ to: e.endNodeId, edge: e });
    adj.get(e.endNodeId)?.push({ to: e.startNodeId, edge: e });
  }

  const distMap = new Map<string, number>();
  const prevNode = new Map<string, string>();
  const prevEdge = new Map<string, GraphEdge>();
  const visited = new Set<string>();

  for (const n of network.nodes) distMap.set(n.id, Infinity);
  distMap.set(startNodeId, 0);

  // Clean Dijkstra over network nodes
  const pq: Array<{ id: string; d: number }> = [{ id: startNodeId, d: 0 }];

  while (pq.length > 0) {
    pq.sort((a, b) => a.d - b.d);
    const cur = pq.shift()!;
    if (visited.has(cur.id)) continue;
    visited.add(cur.id);
    if (cur.id === endNodeId) break;

    for (const step of adj.get(cur.id) ?? []) {
      if (visited.has(step.to)) continue;
      const alt = cur.d + step.edge.lengthMeters;
      if (alt < (distMap.get(step.to) ?? Infinity)) {
        distMap.set(step.to, alt);
        prevNode.set(step.to, cur.id);
        prevEdge.set(step.to, step.edge);
        pq.push({ id: step.to, d: alt });
      }
    }
  }

  if (!prevNode.has(endNodeId)) {
    return {
      found: false,
      reason:
        minVehicleWidthMeters > 0
          ? `Nenhum caminho conectado encontrado que comporte largura mínima de ${minVehicleWidthMeters.toFixed(1)} m.`
          : 'Os pontos selecionados pertencem a setores desconectados. Ative a conexão automática entre setores.',
      startNodeId,
      endNodeId,
      nodeIds: [],
      edgeIds: [],
      polylineMeters: [],
      polylineGeo: [],
      totalLengthMeters: 0,
      minWidthMeters: 0,
      avgWidthMeters: 0,
      turnCount: 0,
    };
  }

  const nodeIds: string[] = [];
  const edgeList: GraphEdge[] = [];
  let cur: string | undefined = endNodeId;
  while (cur) {
    nodeIds.unshift(cur);
    const pe = prevEdge.get(cur);
    if (pe) edgeList.unshift(pe);
    cur = prevNode.get(cur);
  }

  const polylineMeters: Point2D[] = [];
  const polylineGeo: Point2D[] = [];

  for (let i = 0; i < edgeList.length; i++) {
    const e = edgeList[i];
    const fromId = nodeIds[i];
    const forward = e.startNodeId === fromId;
    const ptsM = forward ? e.points : [...e.points].reverse();
    const ptsG = forward ? e.geoPoints : [...e.geoPoints].reverse();

    if (i === 0) {
      polylineMeters.push(...ptsM);
      polylineGeo.push(...ptsG);
    } else {
      polylineMeters.push(...ptsM.slice(1));
      polylineGeo.push(...ptsG.slice(1));
    }
  }

  const totalLengthMeters = edgeList.reduce((acc, e) => acc + e.lengthMeters, 0);
  const minWidthMeters = Math.min(...edgeList.map((e) => e.minWidthMeters));
  const avgWidthMeters =
    edgeList.reduce((acc, e) => acc + e.avgWidthMeters * e.lengthMeters, 0) /
    Math.max(1, totalLengthMeters);

  // Count significant direction changes (> 25 deg) at intermediate junctions
  let turnCount = 0;
  for (let i = 1; i < edgeList.length; i++) {
    const e1 = edgeList[i - 1];
    const e2 = edgeList[i];
    const n1 = nodeIds[i - 1];
    const n2 = nodeIds[i];

    const p1 = e1.startNodeId === n1 ? e1.points : [...e1.points].reverse();
    const p2 = e2.startNodeId === n2 ? e2.points : [...e2.points].reverse();
    if (p1.length >= 2 && p2.length >= 2) {
      const a1 = p1[p1.length - 2];
      const b1 = p1[p1.length - 1];
      const a2 = p2[0];
      const b2 = p2[1];
      const v1x = b1[0] - a1[0];
      const v1y = b1[1] - a1[1];
      const v2x = b2[0] - a2[0];
      const v2y = b2[1] - a2[1];
      const l1 = Math.hypot(v1x, v1y);
      const l2 = Math.hypot(v2x, v2y);
      if (l1 > 1e-4 && l2 > 1e-4) {
        const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2)));
        const deg = (Math.acos(cos) * 180) / Math.PI;
        if (deg > 25) turnCount++;
      }
    }
  }

  return {
    found: true,
    startNodeId,
    endNodeId,
    nodeIds,
    edgeIds: edgeList.map((e) => e.id),
    polylineMeters,
    polylineGeo,
    totalLengthMeters,
    minWidthMeters,
    avgWidthMeters,
    turnCount,
  };
}
