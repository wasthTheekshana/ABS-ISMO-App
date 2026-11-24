/** Great-circle helpers for site visits (SRS FR-14). Points are { lat, lng } in decimal degrees. */

const EARTH_RADIUS_M = 6371008.8;
const toRad = (deg) => (deg * Math.PI) / 180;

/** Distance in metres between two points (haversine). */
export const haversineMeters = (a, b) => {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
};

/** Length in kilometres of the path through the points, in order. Fewer than two points = 0. */
export const pathKm = (points) => {
  let metres = 0;
  for (let i = 1; i < points.length; i += 1) metres += haversineMeters(points[i - 1], points[i]);
  return metres / 1000;
};

/** True for a finite number inside [-limit, limit]. Accepts numeric strings (JSON from Postgres decimals). */
export const validCoordinate = (value, limit) => {
  if (value === null || value === undefined || value === '') return false;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= limit;
};

/** Parses { lat, lng } from loose input; returns null unless both are valid coordinates. */
export const parsePoint = (lat, lng) =>
  validCoordinate(lat, 90) && validCoordinate(lng, 180) ? { lat: Number(lat), lng: Number(lng) } : null;

/** Metres within which an arrival counts as "on site". */
export const GEOFENCE_METERS = Number(process.env.GEOFENCE_METERS) > 0 ? Number(process.env.GEOFENCE_METERS) : 150;
