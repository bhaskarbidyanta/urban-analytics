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
