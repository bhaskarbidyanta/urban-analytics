import { readFireSlaAnalysis } from "@/app/lib/fire-sla";

export async function GET() {
  try {
    const payload = await readFireSlaAnalysis();
    return Response.json(payload);
  } catch (error) {
    console.error("Failed to load fire SLA analysis", error);
    return Response.json(
      {
        error:
          "Could not load fire SLA analysis. Run python/fire_analytics/generate_fire_sla_assets.py first.",
      },
      { status: 500 }
    );
  }
}
