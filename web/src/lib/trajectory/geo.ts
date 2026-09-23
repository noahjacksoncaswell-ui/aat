// v6.0 Section 5.1 - flat-earth (equirectangular) approximation for
// converting between the local ENU simulation frame and lat/lon, explicitly
// sufficient per the directive at the short ranges involved here.

const EARTH_RADIUS_M = 6371000;

export function enuToLatLon(originLat: number, originLon: number, eastM: number, northM: number): { lat: number; lon: number } {
  const dLat = northM / EARTH_RADIUS_M;
  const dLon = eastM / (EARTH_RADIUS_M * Math.cos((originLat * Math.PI) / 180));
  return {
    lat: originLat + (dLat * 180) / Math.PI,
    lon: originLon + (dLon * 180) / Math.PI,
  };
}
