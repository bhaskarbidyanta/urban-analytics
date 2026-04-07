"use client";

import { GoogleMap, LoadScript, Marker, Polygon } from "@react-google-maps/api";
import axios from "axios";
import { useState } from "react";

const defaultCenter = { lat: 19.044983, lng: 72.864062 };

// 🎨 Gradient function (orange → violet)
function getGradientColor(t) {
  const start = [255, 165, 0];   // orange
  const end = [138, 43, 226];    // violet

  const r = Math.round(start[0] + t * (end[0] - start[0]));
  const g = Math.round(start[1] + t * (end[1] - start[1]));
  const b = Math.round(start[2] + t * (end[2] - start[2]));

  return `rgb(${r},${g},${b})`;
}

export default function MapPage() {
  const [center, setCenter] = useState(defaultCenter);
  const [polygons, setPolygons] = useState([]);

  // 🔥 Fetch isochrone
  const fetchIsochrone = async (lat, lng) => {
    try {
      const res = await axios.post("/api/isochrone", { lat, lng });

      const features = res.data.features;

      const formatted = features.map((feature, index) => {
        const coords = feature.geometry.coordinates[0];

        const t = index / (features.length - 1); // gradient factor

        return {
          paths: coords.map(([lng, lat]) => ({ lat, lng })),
          color: getGradientColor(t),
        };
      });

      setPolygons(formatted);
    } catch (err) {
      console.error("Isochrone error:", err);
    }
  };

  // 🖱️ Map click
  const handleMapClick = (e) => {
    const lat = e.latLng.lat();
    const lng = e.latLng.lng();

    setCenter({ lat, lng });
    fetchIsochrone(lat, lng);
  };

  return (
    <LoadScript googleMapsApiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}>
      <div style={{ position: "relative" }}>

        {/* ✅ BUTTON (FIXED) */}
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            fetchIsochrone(center.lat, center.lng);
          }}
          style={{
            position: "absolute",
            top: "10px",
            left: "10px",
            zIndex: 9999,
            padding: "10px",
            background: "white",
            border: "1px solid black",
            cursor: "pointer",
          }}
        >
          Generate Isochrone
        </button>

        <GoogleMap
          mapContainerStyle={{ height: "100vh", width: "100%" }}
          center={center}
          zoom={12}
          onClick={handleMapClick}
        >
          <Marker position={center} />

          {/* ✅ POLYGONS */}
          {polygons.map((poly, index) => (
            <Polygon
              key={index}
              paths={poly.paths}
              options={{
                fillColor: poly.color,
                fillOpacity: 0.15,
                strokeColor: poly.color,
                strokeWeight: 2,
                clickable: false, // 🔥 IMPORTANT FIX
              }}
            />
          ))}
        </GoogleMap>
      </div>
    </LoadScript>
  );
}