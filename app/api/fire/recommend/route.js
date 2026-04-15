import { buildDynamicRecommendations } from "@/app/lib/fire-optimizer";
import {
  readFireIncidents,
  readFireStationMetrics,
  readFireStations,
} from "@/app/lib/fire";
import { readFile } from "fs/promises";
import path from "path";

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

export async function POST(req) {
  try {
    const { k = 5, scenario = "historical" } = await req.json();
    const [incidents, currentStations, stationMetrics, summary] = await Promise.all([
      readFireIncidents(),
      readFireStations(),
      readFireStationMetrics(),
      readSummary(),
    ]);

    const result = buildDynamicRecommendations({
      incidents,
      currentStations,
      stationMetrics,
      summary,
      k: Number(k),
      scenario,
    });

    return Response.json({
      k: Number(k),
      scenario,
      ...result,
    });
  } catch (error) {
    console.error("Dynamic fire recommendation failed", error);
    return Response.json(
      { error: "Could not compute fire station recommendations." },
      { status: 500 }
    );
  }
}
