import axios from "axios";
import {
  getScenarioMultiplier,
  haversineMeters,
  readFireStationMetrics,
  readFireStations,
  readRecommendedFireStations,
} from "@/app/lib/fire";
import { readFile } from "fs/promises";
import path from "path";

const ORS_MATRIX_URL = "https://api.openrouteservice.org/v2/matrix/driving-car";

function getAverageSpeedMps(metrics, stationId) {
  const metric = metrics.find((item) => item.stationId === stationId);
  const speedKmph = metric?.avgSpeedKmph;
  return speedKmph ? (speedKmph * 1000) / 3600 : null;
}

async function readSummary() {
  const summaryPath = path.join(
    process.cwd(),
    "public",
    "data",
    "fire",
    "fire-summary.json"
  );
  return JSON.parse(await readFile(summaryPath, "utf8"));
}

async function getRouteDistancesMeters(stations, incident) {
  if (!process.env.ORS_API_KEY) {
    return stations.map((station) =>
      haversineMeters(station, { lat: incident.lat, lng: incident.lng }) * 1.18
    );
  }

  try {
    const res = await axios.post(
      ORS_MATRIX_URL,
      {
        locations: [
          ...stations.map((station) => [station.lng, station.lat]),
          [incident.lng, incident.lat],
        ],
        sources: stations.map((_, index) => index),
        destinations: [stations.length],
        metrics: ["distance"],
      },
      {
        headers: {
          Authorization: process.env.ORS_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    return stations.map(
      (_, index) => res.data?.distances?.[index]?.[0] ?? null
    );
  } catch (error) {
    console.error("Falling back to haversine fire estimate", error?.response?.data || error?.message || error);
    return stations.map((station) =>
      haversineMeters(station, { lat: incident.lat, lng: incident.lng }) * 1.18
    );
  }
}

export async function POST(req) {
  try {
    const {
      incidentLat,
      incidentLng,
      scenario = "historical",
      includeRecommended = true,
      recommendedStations: recommendedStationsOverride,
    } = await req.json();

    if (!Number.isFinite(incidentLat) || !Number.isFinite(incidentLng)) {
      return Response.json(
        { error: "incidentLat and incidentLng are required numbers." },
        { status: 400 }
      );
    }

    const [stations, recommendedStations, metrics, summary] = await Promise.all([
      readFireStations(),
      readRecommendedFireStations(),
      readFireStationMetrics(),
      readSummary(),
    ]);
    const effectiveRecommendedStations =
      Array.isArray(recommendedStationsOverride) && recommendedStationsOverride.length
        ? recommendedStationsOverride
        : recommendedStations;

    const currentStations = stations.map((station) => ({
        stationId: station.stationId,
        stationName: station.stationName,
        lat: station.lat,
        lng: station.lng,
        stationKind: "current",
      }));
    const futureStations = includeRecommended
      ? effectiveRecommendedStations.map((station) => ({
            stationId: station.recommendedStationId,
            stationName:
              station.stationName || `Recommended ${station.recommendedStationId}`,
            lat: station.lat,
            lng: station.lng,
            stationKind: "recommended",
            inheritedSpeedKmph: station.inheritedSpeedKmph,
          }))
      : [];
    const candidateStations = [...currentStations, ...futureStations];

    const distances = await getRouteDistancesMeters(candidateStations, {
      lat: incidentLat,
      lng: incidentLng,
    });
    const scenarioMultiplier = getScenarioMultiplier(scenario, summary);
    const fallbackSpeedMps =
      metrics.reduce((sum, item) => sum + item.avgSpeedKmph, 0) / metrics.length / 3.6;

    const rankedStations = candidateStations
      .map((station, index) => {
        const routeDistanceMeters = distances[index];
        const historicalSpeedMps =
          getAverageSpeedMps(metrics, station.stationId) ||
          (station.inheritedSpeedKmph ? station.inheritedSpeedKmph / 3.6 : null) ||
          fallbackSpeedMps;
        const baseEstimate =
          typeof routeDistanceMeters === "number" && historicalSpeedMps
            ? routeDistanceMeters / historicalSpeedMps
            : null;

        return {
          stationId: station.stationId,
          stationName: station.stationName,
          stationKind: station.stationKind,
          routeDistanceMeters,
          avgDistanceKm: routeDistanceMeters ? routeDistanceMeters / 1000 : null,
          historicalAvgSpeedKmph: Number((historicalSpeedMps * 3.6).toFixed(2)),
          estimatedResponseSeconds: baseEstimate
            ? Number((baseEstimate * scenarioMultiplier).toFixed(1))
            : null,
        };
      })
      .filter((station) => typeof station.routeDistanceMeters === "number")
      .sort((left, right) => left.estimatedResponseSeconds - right.estimatedResponseSeconds);

    const currentRanked = rankedStations.filter((station) => station.stationKind === "current");
    const recommendedRanked = rankedStations.filter(
      (station) => station.stationKind === "recommended"
    );
    const currentBestStation = currentRanked[0] || null;
    const recommendedBestStation = recommendedRanked[0] || null;
    const bestStation =
      recommendedBestStation &&
      (!currentBestStation ||
        recommendedBestStation.estimatedResponseSeconds <
          currentBestStation.estimatedResponseSeconds)
        ? recommendedBestStation
        : currentBestStation;

    return Response.json({
      scenario,
      scenarioMultiplier,
      bestStation,
      currentBestStation,
      recommendedBestStation,
      improvementSeconds:
        currentBestStation && recommendedBestStation
          ? Number(
              (
                currentBestStation.estimatedResponseSeconds -
                recommendedBestStation.estimatedResponseSeconds
              ).toFixed(1)
            )
          : null,
      stations: rankedStations,
    });
  } catch (error) {
    console.error("Fire estimate route failed", error);
    return Response.json(
      { error: "Could not estimate fire response time." },
      { status: 500 }
    );
  }
}
