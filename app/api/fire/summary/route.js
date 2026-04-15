import { readFile } from "fs/promises";
import path from "path";
import {
  readFireIncidents,
  readFireStationMetrics,
  readFireStations,
  readRecommendedFireStations,
} from "@/app/lib/fire";

export async function GET() {
  try {
    const summaryPath = path.join(
      process.cwd(),
      "public",
      "data",
      "fire",
      "fire-summary.json"
    );
    const summary = JSON.parse(await readFile(summaryPath, "utf8"));
    const [stations, incidents, stationMetrics, recommendedStations] =
      await Promise.all([
        readFireStations(),
        readFireIncidents(),
        readFireStationMetrics(),
        readRecommendedFireStations(),
      ]);

    return Response.json({
      summary,
      stations,
      incidents,
      stationMetrics,
      recommendedStations,
    });
  } catch (error) {
    console.error("Failed to load fire summary", error);
    return Response.json(
      { error: "Could not load fire analytics data." },
      { status: 500 }
    );
  }
}
