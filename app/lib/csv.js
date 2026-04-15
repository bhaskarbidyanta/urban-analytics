export function parseCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [];
  }

  const headers = lines[0].split(",").map((header) => header.trim());

  return lines.slice(1).map((line) => {
    const values = line.split(",").map((value) => value.trim());
    const row = {};

    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });

    return row;
  });
}

export function normalizeStations(rows) {
  return rows.map((row) => ({
    id: Number(row.id),
    stationType: row.station_type,
    lat: Number(row.lat),
    lng: Number(row.lng),
  }));
}

export function normalizeIncidents(rows) {
  return rows.map((row) => ({
    id: Number(row.id),
    type: row.type,
    lat: Number(row.lat),
    lng: Number(row.lng),
  }));
}

export function normalizePopulationCells(rows) {
  return rows.map((row, index) => ({
    id: row.h3_index || `cell-${index + 1}`,
    h3Index: row.h3_index || "",
    h3Resolution: Number(row.h3_resolution),
    areaKm2: Number(row.approx_cell_area_km2),
    lat: Number(row.center_lat),
    lng: Number(row.center_lng),
    regionName: row.region_name || `Region ${index + 1}`,
    population: Number(row.population_estimate),
    densityBand: row.density_band || "",
    note: row.note || "",
  }));
}

export function normalizeFireStations(rows) {
  return rows.map((row) => ({
    stationId: row.station_id,
    stationName: row.station_name,
    lat: Number(row.lat),
    lng: Number(row.lng),
    area: row.area || "",
    capacity: Number(row.capacity || 0),
  }));
}

export function normalizeFireIncidents(rows) {
  return rows.map((row) => ({
    incidentId: row.incident_id,
    incidentTime: row.incident_time,
    incidentStart: row.incident_start,
    incidentEnd: row.incident_end,
    responseTimeSeconds: Number(row.response_time_seconds),
    lat: Number(row.lat),
    lng: Number(row.lng),
    stationId: row.station_id,
    stationName: row.station_name || "",
    callType: row.call_type || "",
    alarmLevel: Number(row.alarm_level || 0),
    priorityCode: Number(row.priority_code || 0),
    dispatchZone: row.dispatch_zone || "",
    locality: row.locality || "",
    distanceKmEst: Number(row.distance_km_est || 0),
    routeDistanceMeters: Number(row.route_distance_meters || 0),
    routeDurationSeconds: Number(row.route_duration_seconds || 0),
    modeledCurrentResponseSeconds: Number(row.modeled_current_response_seconds || 0),
  }));
}

export function normalizeFireStationMetrics(rows) {
  return rows.map((row) => ({
    stationId: row.station_id,
    stationName: row.station_name || "",
    incidentCount: Number(row.incident_count || 0),
    avgDistanceKm: Number(row.avg_distance_km || 0),
    avgResponseSeconds: Number(row.avg_response_seconds || 0),
    avgSpeedKmph: Number(row.avg_speed_kmph || 0),
  }));
}

export function normalizeRecommendedFireStations(rows) {
  return rows.map((row) => ({
    recommendedStationId: row.recommended_station_id,
    clusterId: Number(row.cluster_id),
    lat: Number(row.lat),
    lng: Number(row.lng),
    incidentCoverage: Number(row.incident_coverage || 0),
    avgDistanceKm: Number(row.avg_distance_km || 0),
    estimatedResponseSeconds: Number(row.estimated_response_seconds || 0),
    dominantLocality: row.dominant_locality || "",
    inheritedStationId: row.inherited_station_id || "",
    inheritedSpeedKmph: Number(row.inherited_speed_kmph || 0),
  }));
}

export function stringifyCsv(rows) {
  if (!rows.length) {
    return "";
  }

  const headers = Object.keys(rows[0]);
  const escapeValue = (value) => {
    const text = value == null ? "" : String(value);
    const escaped = text.replace(/"/g, '""');

    return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
  };

  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => escapeValue(row[header])).join(",")),
  ];

  return lines.join("\n");
}
