import axios from "axios";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { stringifyCsv } from "@/app/lib/csv";

const ORS_URL = "https://api.openrouteservice.org/v2/matrix/driving-car";

function chunkArray(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

export async function POST(req) {
  try {
    const {
      stations,
      incidents,
      datasetName = "incidents",
      outputFileName,
    } = await req.json();

    if (!process.env.ORS_API_KEY) {
      return Response.json(
        { error: "ORS API key is not configured." },
        { status: 500 }
      );
    }

    if (!Array.isArray(stations) || !Array.isArray(incidents)) {
      return Response.json(
        { error: "Stations and incidents must be arrays." },
        { status: 400 }
      );
    }

    const chunks = chunkArray(incidents, 50); // ORS allows max 50 destinations per request

    const finalResults = [];

    for (const chunk of chunks) {
      const locations = [
        ...stations.map((station) => [station.lng, station.lat]),
        ...chunk.map((incident) => [incident.lng, incident.lat]),
      ];

      const sources = stations.map((_, i) => i);
      const destinations = chunk.map((_, i) => stations.length + i);

      const res = await axios.post(
        ORS_URL,
        {
          locations,
          sources,
          destinations,
          metrics: ["duration"],
        },
        {
          headers: {
            Authorization: process.env.ORS_API_KEY,
            "Content-Type": "application/json",
          },
        }
      );

      const durations = res.data.durations || [];

      chunk.forEach((incident, incidentIndex) => {
        const durationsFromStations = stations.map(
          (_, stationIndex) => durations[stationIndex]?.[incidentIndex] ?? null
        );

        let nearestStationId = null;
        let nearestStationType = null;
        let minDuration = null;

        durationsFromStations.forEach((duration, stationIndex) => {
          if (
            typeof duration === "number" &&
            (minDuration === null || duration < minDuration)
          ) {
            minDuration = duration;
            nearestStationId = stations[stationIndex]?.id ?? null;
            nearestStationType = stations[stationIndex]?.stationType ?? null;
          }
        });

        finalResults.push({
          incidentId: incident.id,
          incidentType: incident.type ?? datasetName,
          lat: incident.lat,
          lng: incident.lng,
          durations: durationsFromStations,
          nearestStationId,
          nearestStationType,
          minDuration,
        });
      });
    }

    const incidentsWithMatrix = finalResults.map((result) => ({
      id: result.incidentId,
      type: result.incidentType,
      lat: result.lat,
      lng: result.lng,
      nearestStationId: result.nearestStationId,
      nearestStationType: result.nearestStationType,
      minDuration: result.minDuration,
      durations: result.durations,
    }));

    const csvRows = incidentsWithMatrix.map((incident) => ({
      incidentId: incident.id,
      type: incident.type,
      lat: incident.lat,
      lng: incident.lng,
      nearestStationId: incident.nearestStationId ?? "",
      nearestStationType: incident.nearestStationType ?? "",
      minDurationSeconds:
        typeof incident.minDuration === "number"
          ? Math.round(incident.minDuration)
          : "",
      minDurationMinutes:
        typeof incident.minDuration === "number"
          ? (incident.minDuration / 60).toFixed(1)
          : "",
    }));

    const outputDir = path.join(process.cwd(), "public", "data");
    const safeFileName =
      outputFileName ||
      `${datasetName.replace(/[^a-z0-9-_]/gi, "-").toLowerCase()}-with-matrix.csv`;
    const outputPath = path.join(outputDir, safeFileName);
    await mkdir(outputDir, { recursive: true });
    await writeFile(outputPath, stringifyCsv(csvRows), "utf8");

    return Response.json({
      results: finalResults,
      incidents: incidentsWithMatrix,
      outputFile: `/data/${safeFileName}`,
    });
  } catch (error) {
    console.error(error.response?.data || error.message);

    return Response.json(
      { error: "Matrix API failed" },
      { status: error.response?.status || 500 }
    );
  }
}
