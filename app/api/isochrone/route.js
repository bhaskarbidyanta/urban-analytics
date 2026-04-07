import axios from "axios";

export async function POST(req) {
  try {
    const { lat, lng } = await req.json();

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return Response.json(
        { error: "Latitude and longitude are required." },
        { status: 400 }
      );
    }

    if (!process.env.ORS_API_KEY) {
      return Response.json(
        { error: "ORS API key is not configured." },
        { status: 500 }
      );
    }

    const response = await axios.post(
      "https://api.openrouteservice.org/v2/isochrones/driving-car",
      {
        locations: [[lng, lat]],
        range: [300, 600, 900, 1200],
      },
      {
        headers: {
          Authorization: process.env.ORS_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    return Response.json(response.data);
  } catch (error) {
    console.error("Isochrone route failed", error.response?.data || error.message);

    return Response.json(
      {
        error:
          error.response?.data?.error?.message ||
          error.response?.data?.message ||
          "Failed to fetch isochrone data.",
      },
      { status: error.response?.status || 500 }
    );
  }
}
