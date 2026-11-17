import crypto from 'crypto';

export type LatLng = [number, number]; // [lat, lng]

export interface GisValidationResult {
  stIsValid: boolean;
  stIntersects: boolean;
  validationReason: string;
  areaSqm: number;
  areaHectares: number;
  centroid: LatLng;
  geoHash: string;
  wkt: string;
  geojson: {
    type: 'Polygon';
    coordinates: [number, number][][];
  };
  overlappingParcels: Array<{
    parcelRef: string;
    locationText: string;
    status: string;
    overlapEstimatePct: number;
  }>;
  duplicateGeoClaim: boolean;
  diagnostics: string[];
}

export interface ExistingParcelGeometry {
  id: string;
  parcelRef: string;
  locationText: string;
  status: string;
  geoHash: string;
  coordinates: LatLng[];
}

const EARTH_RADIUS_M = 6371000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Projects [lat, lng] to local planar meters relative to a reference origin
 * for accurate small-parcel planar geometry tests (ST_IsValid / ST_Intersects).
 */
function projectToMeters(point: LatLng, origin: LatLng): [number, number] {
  const latScale = EARTH_RADIUS_M * toRadians(1);
  const lngScale = EARTH_RADIUS_M * Math.cos(toRadians(origin[0])) * toRadians(1);
  return [(point[1] - origin[1]) * lngScale, (point[0] - origin[0]) * latScale];
}

export function normalizeRing(raw: LatLng[]): LatLng[] {
  const cleaned = raw
    .filter((pt) => Array.isArray(pt) && pt.length >= 2 && Number.isFinite(pt[0]) && Number.isFinite(pt[1]))
    .map(([lat, lng]) => [Number(lat.toFixed(7)), Number(lng.toFixed(7))] as LatLng);

  if (cleaned.length < 2) return cleaned;
  const first = cleaned[0];
  const last = cleaned[cleaned.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    cleaned.push([first[0], first[1]]);
  }
  return cleaned;
}

function orient(a: [number, number], b: [number, number], c: [number, number]): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a: [number, number], b: [number, number], p: [number, number]): boolean {
  const eps = 1e-9;
  return (
    p[0] <= Math.max(a[0], b[0]) + eps &&
    p[0] >= Math.min(a[0], b[0]) - eps &&
    p[1] <= Math.max(a[1], b[1]) + eps &&
    p[1] >= Math.min(a[1], b[1]) - eps
  );
}

function segmentsIntersect(
  p1: [number, number],
  p2: [number, number],
  q1: [number, number],
  q2: [number, number],
  strictOnly = false
): boolean {
  const o1 = orient(p1, p2, q1);
  const o2 = orient(p1, p2, q2);
  const o3 = orient(q1, q2, p1);
  const o4 = orient(q1, q2, p2);
  const eps = 1e-7;

  if (strictOnly) {
    return ((o1 > eps && o2 < -eps) || (o1 < -eps && o2 > eps)) && ((o3 > eps && o4 < -eps) || (o3 < -eps && o4 > eps));
  }

  if (((o1 > eps && o2 < -eps) || (o1 < -eps && o2 > eps)) && ((o3 > eps && o4 < -eps) || (o3 < -eps && o4 > eps))) {
    return true;
  }
  if (Math.abs(o1) <= eps && onSegment(p1, p2, q1)) return true;
  if (Math.abs(o2) <= eps && onSegment(p1, p2, q2)) return true;
  if (Math.abs(o3) <= eps && onSegment(q1, q2, p1)) return true;
  if (Math.abs(o4) <= eps && onSegment(q1, q2, p2)) return true;
  return false;
}

function pointInPolygon(pt: [number, number], poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const intersect = yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function computePolygonAreaSqm(ring: LatLng[]): number {
  if (ring.length < 4) return 0;
  const origin = ring[0];
  const pts = ring.map((p) => projectToMeters(p, origin));
  let sum = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    sum += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
  }
  return Math.abs(sum) / 2;
}

export function computeCentroid(ring: LatLng[]): LatLng {
  const unique = ring.slice(0, -1);
  if (unique.length === 0) return [9.0765, 7.3986];
  const lat = unique.reduce((acc, p) => acc + p[0], 0) / unique.length;
  const lng = unique.reduce((acc, p) => acc + p[1], 0) / unique.length;
  return [Number(lat.toFixed(6)), Number(lng.toFixed(6))];
}

function hasSelfIntersection(ring: LatLng[]): boolean {
  if (ring.length < 4) return true;
  const origin = ring[0];
  const pts = ring.map((p) => projectToMeters(p, origin));
  const edgeCount = pts.length - 1;

  for (let i = 0; i < edgeCount; i++) {
    for (let j = i + 1; j < edgeCount; j++) {
      // Adjacent edges share a vertex; skip adjacent pairs and wrap-around first/last
      if (Math.abs(i - j) <= 1 || (i === 0 && j === edgeCount - 1)) continue;
      if (segmentsIntersect(pts[i], pts[i + 1], pts[j], pts[j + 1], false)) {
        return true;
      }
    }
  }
  return false;
}

function polygonsIntersect(aRing: LatLng[], bRing: LatLng[]): { intersects: boolean; overlapPct: number } {
  const origin = aRing[0];
  const polyA = aRing.slice(0, -1).map((p) => projectToMeters(p, origin));
  const polyB = bRing.slice(0, -1).map((p) => projectToMeters(p, origin));

  if (polyA.length < 3 || polyB.length < 3) return { intersects: false, overlapPct: 0 };

  // Quick bounding box rejection
  const minAx = Math.min(...polyA.map((p) => p[0]));
  const maxAx = Math.max(...polyA.map((p) => p[0]));
  const minAy = Math.min(...polyA.map((p) => p[1]));
  const maxAy = Math.max(...polyA.map((p) => p[1]));

  const minBx = Math.min(...polyB.map((p) => p[0]));
  const maxBx = Math.max(...polyB.map((p) => p[0]));
  const minBy = Math.min(...polyB.map((p) => p[1]));
  const maxBy = Math.max(...polyB.map((p) => p[1]));

  if (maxAx < minBx || maxBx < minAx || maxAy < minBy || maxBy < minAy) {
    return { intersects: false, overlapPct: 0 };
  }

  let hit = false;
  for (let i = 0; i < polyA.length; i++) {
    const a1 = polyA[i];
    const a2 = polyA[(i + 1) % polyA.length];
    for (let j = 0; j < polyB.length; j++) {
      const b1 = polyB[j];
      const b2 = polyB[(j + 1) % polyB.length];
      if (segmentsIntersect(a1, a2, b1, b2, true)) {
        hit = true;
        break;
      }
    }
    if (hit) break;
  }

  if (!hit) {
    if (polyA.some((pt) => pointInPolygon(pt, polyB)) || polyB.some((pt) => pointInPolygon(pt, polyA))) {
      hit = true;
    }
  }

  if (!hit) return { intersects: false, overlapPct: 0 };

  // Monte-Carlo / uniform grid sampling inside PolyA for crisp overlap % estimate
  const gridSteps = 18;
  let insideA = 0;
  let insideBoth = 0;
  for (let gx = 0; gx <= gridSteps; gx++) {
    for (let gy = 0; gy <= gridSteps; gy++) {
      const px = minAx + ((maxAx - minAx) * (gx + 0.5)) / (gridSteps + 1);
      const py = minAy + ((maxAy - minAy) * (gy + 0.5)) / (gridSteps + 1);
      if (pointInPolygon([px, py], polyA)) {
        insideA++;
        if (pointInPolygon([px, py], polyB)) {
          insideBoth++;
        }
      }
    }
  }

  const overlapPct = insideA > 0 ? Number(((insideBoth / insideA) * 100).toFixed(1)) : 100;
  if (overlapPct === 0 && hit) {
    return { intersects: true, overlapPct: 1.5 };
  }
  return { intersects: true, overlapPct };
}

/**
 * Evaluates spatial geometry mirroring PostGIS ST_IsValid and ST_Intersects.
 */
export function evaluateParcelGeometry(
  rawCoordinates: LatLng[],
  existingParcels: ExistingParcelGeometry[],
  excludeParcelId?: string
): GisValidationResult {
  const diagnostics: string[] = [];
  const ring = normalizeRing(rawCoordinates);

  if (ring.length < 4) {
    diagnostics.push('ST_IsValid failed: polygon requires at least 3 distinct boundary vertices.');
    return {
      stIsValid: false,
      stIntersects: false,
      validationReason: 'Insufficient vertices for a closed polygon (minimum 3 points).',
      areaSqm: 0,
      areaHectares: 0,
      centroid: [9.0765, 7.3986],
      geoHash: '',
      wkt: 'POLYGON EMPTY',
      geojson: { type: 'Polygon', coordinates: [[]] },
      overlappingParcels: [],
      duplicateGeoClaim: false,
      diagnostics,
    };
  }

  // Check Nigerian geographic bounding envelope (approx Lat 4.0..14.0, Lng 2.5..15.0)
  const outOfNigeria = ring.some(([lat, lng]) => lat < 4.0 || lat > 14.2 || lng < 2.4 || lng > 15.0);
  if (outOfNigeria) {
    diagnostics.push('Warning: coordinate pair lies outside standard Nigerian WGS84 cadastral bounds (4°N–14.2°N, 2.4°E–15°E).');
  }

  const areaSqm = Number(computePolygonAreaSqm(ring).toFixed(2));
  const areaHectares = Number((areaSqm / 10000).toFixed(4));
  const selfIntersects = hasSelfIntersection(ring);

  let stIsValid = true;
  let validationReason = 'Valid simple closed polygon (PostGIS ST_IsValid = TRUE).';

  if (selfIntersects) {
    stIsValid = false;
    validationReason = 'Self-intersecting boundary ring (bowtie/crossing segments detected).';
    diagnostics.push('ST_IsValid = FALSE: Ring self-intersection detected.');
  } else if (areaSqm < 25) {
    stIsValid = false;
    validationReason = 'Degenerate polygon area (< 25 m²). Check coordinate precision.';
    diagnostics.push('ST_IsValid = FALSE: Computed parcel area is below minimum 25 m² threshold.');
  } else {
    diagnostics.push(`ST_IsValid = TRUE: Simple closed ring (${ring.length - 1} vertices, ${areaSqm.toLocaleString()} m²).`);
  }

  const centroid = computeCentroid(ring);
  const wktCoords = ring.map(([lat, lng]) => `${lng} ${lat}`).join(', ');
  const wkt = `POLYGON((${wktCoords}))`;
  const geojson: { type: 'Polygon'; coordinates: [number, number][][] } = {
    type: 'Polygon',
    coordinates: [ring.map(([lat, lng]) => [lng, lat])],
  };

  // Canonical geoHash sorted by vertex coordinates to detect reordered duplicate claims
  const canonicalPoints = [...ring.slice(0, -1)].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const geoHash = '0x' + crypto.createHash('sha256').update(JSON.stringify(canonicalPoints)).digest('hex');

  const overlappingParcels: GisValidationResult['overlappingParcels'] = [];
  let duplicateGeoClaim = false;

  for (const existing of existingParcels) {
    if (excludeParcelId && existing.id === excludeParcelId) continue;
    if (existing.status === 'Rejected' || existing.status === 'Cancelled') continue;

    if (existing.geoHash === geoHash) {
      duplicateGeoClaim = true;
      overlappingParcels.push({
        parcelRef: existing.parcelRef,
        locationText: existing.locationText,
        status: existing.status,
        overlapEstimatePct: 100,
      });
      continue;
    }

    const existingRing = normalizeRing(existing.coordinates);
    const { intersects, overlapPct } = polygonsIntersect(ring, existingRing);
    if (intersects && overlapPct > 0.5) {
      overlappingParcels.push({
        parcelRef: existing.parcelRef,
        locationText: existing.locationText,
        status: existing.status,
        overlapEstimatePct: overlapPct,
      });
    }
  }

  const stIntersects = overlappingParcels.length > 0;
  if (duplicateGeoClaim) {
    diagnostics.push('DUPLICATE CLAIM DETECTED: Exact coordinate geometry matches an existing parcel.');
  } else if (stIntersects) {
    diagnostics.push(
      `ST_Intersects = TRUE: Overlaps ${overlappingParcels.length} parcel(s): ${overlappingParcels
        .map((p) => `${p.parcelRef} (${p.overlapEstimatePct}%)`)
        .join(', ')}.`
    );
  } else {
    diagnostics.push('ST_Intersects = FALSE: No boundary encroachment detected against active registry parcels.');
  }

  return {
    stIsValid,
    stIntersects,
    validationReason,
    areaSqm,
    areaHectares,
    centroid,
    geoHash,
    wkt,
    geojson,
    overlappingParcels,
    duplicateGeoClaim,
    diagnostics,
  };
}
