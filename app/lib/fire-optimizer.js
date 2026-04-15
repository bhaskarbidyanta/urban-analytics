import { getScenarioMultiplier, haversineMeters } from "./fire";

function distanceSquared(left, right) {
  const latDelta = left.lat - right.lat;
  const lngDelta = left.lng - right.lng;
  return latDelta * latDelta + lngDelta * lngDelta;
}

function initializeCentroids(points, k) {
  const centroids = [points[0]];

  while (centroids.length < k) {
    let maxDistance = -1;
    let nextPoint = points[centroids.length % points.length];

    for (const point of points) {
      const nearestDistance = Math.min(
        ...centroids.map((centroid) => distanceSquared(point, centroid))
      );
      if (nearestDistance > maxDistance) {
        maxDistance = nearestDistance;
        nextPoint = point;
      }
    }

    centroids.push(nextPoint);
  }

  return centroids.map((centroid) => ({ ...centroid }));
}

export function runKmeans(points, k, maxIterations = 40) {
  if (!points.length) {
    return { centroids: [], assignments: [] };
  }

  const safeK = Math.max(1, Math.min(k, points.length));
  let centroids = initializeCentroids(points, safeK);
  let assignments = new Array(points.length).fill(0);

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const nextAssignments = points.map((point) => {
      let bestIndex = 0;
      let bestDistance = distanceSquared(point, centroids[0]);

      for (let index = 1; index < centroids.length; index += 1) {
        const currentDistance = distanceSquared(point, centroids[index]);
        if (currentDistance < bestDistance) {
          bestDistance = currentDistance;
          bestIndex = index;
        }
      }

      return bestIndex;
    });

    const nextCentroids = centroids.map((centroid, index) => {
      const members = points.filter((_, pointIndex) => nextAssignments[pointIndex] === index);
      if (!members.length) {
        return centroid;
      }

      const sums = members.reduce(
        (accumulator, point) => ({
          lat: accumulator.lat + point.lat,
          lng: accumulator.lng + point.lng,
        }),
        { lat: 0, lng: 0 }
      );

      return {
        lat: sums.lat / members.length,
        lng: sums.lng / members.length,
      };
    });

    const unchanged =
      iteration > 0 &&
      nextAssignments.every((value, index) => value === assignments[index]);

    assignments = nextAssignments;
    centroids = nextCentroids;

    if (unchanged) {
      break;
    }
  }

  return { centroids, assignments };
}

function findNearestCurrentStation(station, currentStations) {
  let bestStation = currentStations[0];
  let bestDistance = haversineMeters(station, currentStations[0]);

  for (const currentStation of currentStations.slice(1)) {
    const distance = haversineMeters(station, currentStation);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestStation = currentStation;
    }
  }

  return bestStation;
}

export function buildDynamicRecommendations({
  incidents,
  currentStations,
  stationMetrics,
  summary,
  k,
  scenario = "historical",
}) {
  const points = incidents.map((incident) => ({ lat: incident.lat, lng: incident.lng }));
  const { centroids, assignments } = runKmeans(points, k);
  const metricsByStation = Object.fromEntries(
    stationMetrics.map((metric) => [metric.stationId, metric])
  );
  const scenarioMultiplier = getScenarioMultiplier(scenario, summary);
  const fallbackSpeedKmph =
    stationMetrics.reduce((sum, metric) => sum + metric.avgSpeedKmph, 0) /
      Math.max(stationMetrics.length, 1) || 28;

  const recommendedStations = centroids.map((centroid, index) => {
    const nearestCurrent = findNearestCurrentStation(centroid, currentStations);
    const inheritedSpeedKmph =
      metricsByStation[nearestCurrent.stationId]?.avgSpeedKmph || fallbackSpeedKmph;
    return {
      recommendedStationId: `RFS-${String(index + 1).padStart(2, "0")}`,
      stationName: `Recommended RFS-${String(index + 1).padStart(2, "0")}`,
      lat: Number(centroid.lat.toFixed(6)),
      lng: Number(centroid.lng.toFixed(6)),
      inheritedStationId: nearestCurrent.stationId,
      inheritedSpeedKmph: Number(inheritedSpeedKmph.toFixed(2)),
    };
  });

  const recommendedMetrics = recommendedStations.map((station, index) => {
    const members = incidents.filter((_, incidentIndex) => assignments[incidentIndex] === index);
    const speedMps = station.inheritedSpeedKmph / 3.6;
    const distances = members.map(
      (incident) => haversineMeters(station, incident) * 1.2
    );
    const estimatedResponses = distances.map(
      (distance) => (distance / speedMps) * scenarioMultiplier
    );
    const localityCounts = Object.fromEntries(
      members.map((incident) => [incident.locality, 0])
    );

    members.forEach((incident) => {
      localityCounts[incident.locality] += 1;
    });

    const dominantLocality =
      Object.entries(localityCounts).sort((left, right) => right[1] - left[1])[0]?.[0] ||
      "-";

    return {
      ...station,
      clusterId: index,
      incidentCoverage: members.length,
      avgDistanceKm:
        members.length > 0
          ? Number((distances.reduce((sum, value) => sum + value, 0) / members.length / 1000).toFixed(2))
          : 0,
      estimatedResponseSeconds:
        members.length > 0
          ? Number((estimatedResponses.reduce((sum, value) => sum + value, 0) / members.length).toFixed(1))
          : 0,
      dominantLocality,
    };
  });

  const perIncident = incidents.map((incident, index) => {
    const recommended = recommendedStations[assignments[index]];
    const speedMps = recommended.inheritedSpeedKmph / 3.6;
    const routeDistanceMeters = haversineMeters(recommended, incident) * 1.2;
    const estimatedResponseSeconds = (routeDistanceMeters / speedMps) * scenarioMultiplier;
    const currentResponseSeconds =
      (incident.modeledCurrentResponseSeconds || incident.responseTimeSeconds) *
      scenarioMultiplier;

    return {
      incidentId: incident.incidentId,
      recommendedStationId: recommended.recommendedStationId,
      routeDistanceMeters,
      estimatedResponseSeconds,
      currentResponseSeconds,
      improvementSeconds: currentResponseSeconds - estimatedResponseSeconds,
    };
  });

  const currentAvgResponseSeconds =
    perIncident.reduce((sum, row) => sum + row.currentResponseSeconds, 0) /
    Math.max(perIncident.length, 1);
  const optimizedAvgResponseSeconds =
    perIncident.reduce((sum, row) => sum + row.estimatedResponseSeconds, 0) /
    Math.max(perIncident.length, 1);
  const currentAvgDistanceKm =
    incidents.reduce((sum, incident) => sum + incident.routeDistanceMeters, 0) /
    Math.max(incidents.length, 1) /
    1000;
  const optimizedAvgDistanceKm =
    perIncident.reduce((sum, row) => sum + row.routeDistanceMeters, 0) /
    Math.max(perIncident.length, 1) /
    1000;
  const responseDeltaSeconds = optimizedAvgResponseSeconds - currentAvgResponseSeconds;
  const improvedIncidentShare =
    (perIncident.filter((row) => row.improvementSeconds > 0).length / Math.max(perIncident.length, 1)) *
    100;

  return {
    recommendedStations: recommendedMetrics,
    comparison: {
      currentModeledAvgResponseSeconds: Number(currentAvgResponseSeconds.toFixed(1)),
      optimizedModeledAvgResponseSeconds: Number(optimizedAvgResponseSeconds.toFixed(1)),
      responseDeltaSeconds: Number(responseDeltaSeconds.toFixed(1)),
      responseDeltaPercent: Number(
        ((responseDeltaSeconds / currentAvgResponseSeconds) * 100).toFixed(1)
      ),
      currentAvgDistanceKm: Number(currentAvgDistanceKm.toFixed(2)),
      optimizedAvgDistanceKm: Number(optimizedAvgDistanceKm.toFixed(2)),
      distanceDeltaKm: Number((optimizedAvgDistanceKm - currentAvgDistanceKm).toFixed(2)),
      improvedIncidentShare: Number(improvedIncidentShare.toFixed(1)),
    },
    perIncident,
    scenarioMultiplier,
  };
}
