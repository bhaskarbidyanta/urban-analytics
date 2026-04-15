import { readFile } from "fs/promises";
import path from "path";
import {
  normalizeFireIncidents,
  normalizeFireStationMetrics,
  normalizeFireStations,
  normalizeRecommendedFireStations,
  parseCsv,
} from "./csv";

function getDataPath(fileName) {
  return path.join(process.cwd(), "public", "data", "fire", fileName);
}

export async function readFireCsv(fileName) {
  const text = await readFile(getDataPath(fileName), "utf8");
  return parseCsv(text);
}

export async function readFireIncidents() {
  return normalizeFireIncidents(await readFireCsv("fire-incidents.csv"));
}

export async function readFireStations() {
  return normalizeFireStations(await readFireCsv("fire-stations.csv"));
}

export async function readFireStationMetrics() {
  return normalizeFireStationMetrics(await readFireCsv("fire-station-metrics.csv"));
}

export async function readRecommendedFireStations() {
  return normalizeRecommendedFireStations(
    await readFireCsv("fire-recommended-stations.csv")
  );
}

export function getScenarioMultiplier(scenario, summary) {
  if (scenario === "night") {
    return Number(summary?.nightHourMultiplier) || 0.85;
  }

  if (scenario === "peak") {
    return Number(summary?.peakHourMultiplier) || 1.1;
  }

  return 1;
}

export function haversineMeters(from, to) {
  const earthRadius = 6371000;
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const deltaLat = ((to.lat - from.lat) * Math.PI) / 180;
  const deltaLng = ((to.lng - from.lng) * Math.PI) / 180;

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadius * c;
}
