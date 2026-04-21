"use client";

import { GoogleMap, Marker, Polygon, useJsApiLoader } from "@react-google-maps/api";
import axios from "axios";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeIncidents, normalizePopulationCells, normalizeStations, parseCsv } from "./lib/csv";
import {
  computeGetisOrdHotspots,
  formatHotspotLabel,
  getHotspotBoundary,
  getHotspotColor,
  getHotspotFillOpacity,
} from "./lib/hotspots";

const defaultCenter = { lat: 19.044983, lng: 72.864062 };
const typeColors = {
  crime: "#ff5b5b",
  hospital: "#45b7ff",
  fire: "#ff9d2e",
};
const typeOrder = ["crime", "hospital", "fire"];
const darkMapStyles = [
  { elementType: "geometry", stylers: [{ color: "#101625" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#101625" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#737a91" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1a2236" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#0c111d" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#080b15" }] },
];

function getGradientColor(t) {
  const start = [255, 165, 0];
  const end = [138, 43, 226];
  const rgb = start.map((value, index) => Math.round(value + t * (end[index] - value)));
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

function isInside(point, polygon) {
  const x = point.lat;
  const y = point.lng;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lat;
    const yi = polygon[i].lng;
    const xj = polygon[j].lat;
    const yj = polygon[j].lng;
    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

    if (intersect) {
      inside = !inside;
    }
  }

  return inside;
}

function buildFocusBars(typeCounts) {
  const angles = [-60, 0, 60];

  return typeOrder.map((type, index) => {
    const count = typeCounts[type] || 0;

    return {
      id: `${type}-${index}`,
      type,
      count,
      color: typeColors[type],
      angle: angles[index],
      height: 26 + Math.min(count, 10) * 10,
    };
  });
}

function formatMinutes(seconds) {
  if (typeof seconds !== "number") {
    return "-";
  }

  return `${(seconds / 60).toFixed(1)} min`;
}

function haversineMeters(from, to) {
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

function getMetersPerPixel(lat, zoom) {
  return (
    (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom)
  );
}

function getMatrixErrorMessage(error) {
  const status = error?.response?.status;

  if (status === 429) {
    return "OpenRouteService rate limit hit. Wait a bit and try the incident matrix again.";
  }

  return (
    error?.response?.data?.error ||
    error?.message ||
    "Matrix run failed."
  );
}

function getIsochroneErrorMessage(error) {
  const status = error?.response?.status;

  if (status === 429) {
    return "OpenRouteService rate limit hit. Wait a bit and try the isochrone again.";
  }

  return (
    error?.response?.data?.error ||
    error?.message ||
    "Isochrone generation failed."
  );
}

export default function MapPage() {
  const hotspotRingSize = 1;
  const { isLoaded, loadError } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "",
  });
  const router = useRouter();
  const stageRef = useRef(null);
  const mapRef = useRef(null);
  const [center, setCenter] = useState(defaultCenter);
  const [stations, setStations] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [populationCells, setPopulationCells] = useState([]);
  const [populationAccessByCell, setPopulationAccessByCell] = useState({});
  const [polygons, setPolygons] = useState([]);
  const [isochroneError, setIsochroneError] = useState("");
  const [matrixByIncident, setMatrixByIncident] = useState({});
  const [matrixHeader, setMatrixHeader] = useState(null);
  const [matrixError, setMatrixError] = useState("");
  const [matrixLoading, setMatrixLoading] = useState(false);
  const [showHeader, setShowHeader] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showIncidents, setShowIncidents] = useState(true);
  const [showStations, setShowStations] = useState(true);
  const [showIsochrones, setShowIsochrones] = useState(true);
  const [showHotspots, setShowHotspots] = useState(true);
  const [focusRadiusKm, setFocusRadiusKm] = useState(1.6);
  const [hoverPoint, setHoverPoint] = useState(null);
  const [hoverGeoPoint, setHoverGeoPoint] = useState(null);
  const [mapZoom, setMapZoom] = useState(12);
  const [problemType, setProblemType] = useState("all");
  const outerPolygon = polygons[polygons.length - 1]?.paths || [];

  useEffect(() => {
    const loadData = async () => {
      try {
        const [stationsRes, incidentsRes, populationRes, accessRes] = await Promise.all([
          fetch("/data/stations.csv"),
          fetch("/data/incidents.csv"),
          fetch("/data/population-h3.csv"),
          fetch("/data/population-h3-with-access.csv"),
        ]);

        if (!stationsRes.ok || !incidentsRes.ok || !populationRes.ok) {
          throw new Error("Could not load CSV data files.");
        }

        const [stationsText, incidentsText, populationText, accessText] = await Promise.all([
          stationsRes.text(),
          incidentsRes.text(),
          populationRes.text(),
          accessRes.ok ? accessRes.text() : Promise.resolve(""),
        ]);

        setStations(normalizeStations(parseCsv(stationsText)));
        setIncidents(normalizeIncidents(parseCsv(incidentsText)));
        setPopulationCells(normalizePopulationCells(parseCsv(populationText)));

        if (accessText) {
          const accessRows = parseCsv(accessText);
          setPopulationAccessByCell(
            Object.fromEntries(
              accessRows.map((row) => [
                row.incidentId,
                {
                  nearestStationId: row.nearestStationId || null,
                  minDuration: Number(row.minDurationSeconds),
                },
              ])
            )
          );
        }
      } catch (error) {
        console.error("Failed to load CSV data:", error);
      }
    };

    loadData();
  }, []);

  const filteredIncidents =
    problemType === "all"
      ? incidents
      : incidents.filter((incident) => incident.type === problemType);

  const fetchIsochrone = async (lat, lng) => {
    setIsochroneError("");

    try {
      const res = await axios.post("/api/isochrone", { lat, lng });
      const features = res.data.features || [];

      setPolygons(
        features.map((feature, index) => {
          const coords = feature.geometry.coordinates[0];
          const t = features.length > 1 ? index / (features.length - 1) : 0;

          return {
            paths: coords.map(([pointLng, pointLat]) => ({ lat: pointLat, lng: pointLng })),
            color: getGradientColor(t),
          };
        })
      );
    } catch (err) {
      setIsochroneError(getIsochroneErrorMessage(err));
      console.error("Isochrone error:", err?.response?.data || err?.message || err);
    }
  };

  const fetchIncidentMatrix = async () => {
    if (!stations.length || !incidents.length) {
      return;
    }

    setMatrixLoading(true);
    setMatrixError("");

    try {
      const res = await axios.post("/api/matrix", {
        stations,
        incidents,
        datasetName: "incidents",
        outputFileName: "incidents-with-matrix.csv",
      });

      const nextMatrix = Object.fromEntries(
        (res.data.results || []).map((item) => [item.incidentId, item])
      );
      const nextIncidents = res.data.incidents || [];
      const durations = nextIncidents
        .map((incident) => incident.minDuration)
        .filter((value) => typeof value === "number");
      const averageDuration =
        durations.length > 0
          ? durations.reduce((sum, value) => sum + value, 0) / durations.length
          : null;

      setMatrixByIncident(nextMatrix);
      setIncidents(nextIncidents);
      setMatrixHeader({
        totalIncidents: nextIncidents.length,
        averageMinutes:
          averageDuration == null ? null : (averageDuration / 60).toFixed(1),
        outputFile: res.data.outputFile || null,
      });

      router.push("/matrix-results");
    } catch (error) {
      setMatrixError(getMatrixErrorMessage(error));
      console.error("Incident matrix error:", error);
    } finally {
      setMatrixLoading(false);
    }
  };

  const handleMapClick = (e) => {
    const lat = e.latLng.lat();
    const lng = e.latLng.lng();
    setCenter({ lat, lng });
    fetchIsochrone(lat, lng);
  };

  const handleMapMouseMove = (event) => {
    const rect = stageRef.current?.getBoundingClientRect();
    const domEvent = event.domEvent;

    if (!rect || !domEvent || !event.latLng) {
      return;
    }

    setHoverPoint({
      x: domEvent.clientX - rect.left,
      y: domEvent.clientY - rect.top,
    });
    setHoverGeoPoint({
      lat: event.latLng.lat(),
      lng: event.latLng.lng(),
    });
  };

  const radiusMeters = focusRadiusKm * 1000;
  const metersPerPixel = getMetersPerPixel(
    hoverGeoPoint?.lat ?? center.lat,
    mapZoom
  );
  const hoverRadiusPixels = radiusMeters / metersPerPixel;
  const radiusKilometers = radiusMeters / 1000;

  const nearbyIncidents = hoverGeoPoint
    ? filteredIncidents.filter(
        (incident) => haversineMeters(hoverGeoPoint, incident) <= radiusMeters
      )
    : [];
  const nearbyTypeCounts = {
    crime: nearbyIncidents.filter((incident) => incident.type === "crime").length,
    hospital: nearbyIncidents.filter((incident) => incident.type === "hospital").length,
    fire: nearbyIncidents.filter((incident) => incident.type === "fire").length,
  };
  const focusBars = buildFocusBars(nearbyTypeCounts);
  const latestRows = filteredIncidents.slice(0, 6);
  const hotspotPolygons = useMemo(() => {
    const rows = populationCells
      .map((cell) => ({
        ...cell,
        minDuration: populationAccessByCell[cell.id]?.minDuration ?? null,
      }))
      .filter((cell) => typeof cell.minDuration === "number" && cell.minDuration > 0)
      .map((cell) => ({
        id: cell.id,
        regionName: cell.regionName,
        lat: cell.lat,
        lng: cell.lng,
        value: cell.minDuration / 60,
      }));

    return computeGetisOrdHotspots(rows, {
      ringSize: hotspotRingSize,
      valueKey: "value",
    }).map((row) => ({
      ...row,
      label: formatHotspotLabel(row.classification),
      paths: getHotspotBoundary(row.id),
      color: getHotspotColor(row.classification),
      fillOpacity: getHotspotFillOpacity(row.classification),
    }));
  }, [hotspotRingSize, populationAccessByCell, populationCells]);

  return (
      <div className={`ua-shell ua-shellSimple ua-shellMap ${showHeader ? "" : "ua-shellMapHeaderHidden"}`}>
        {showHeader ? (
        <header className="ua-topbar">
          <div className="ua-topbarBrand">
            <div className="ua-eyebrow">Urban Analytics</div>
            <h1>Incident Response Map</h1>
            <div className="ua-topbarNav">
              <Link className="ua-navLink ua-navLinkActive" href="/">
                Map
              </Link>
              <Link className="ua-navLink" href="/matrix-results">
                Incident Matrix
              </Link>
              <Link className="ua-navLink" href="/equity">
                Equity Analytics
              </Link>
              <Link className="ua-navLink" href="/hotspots">
                Hotspots
              </Link>
              <Link className="ua-navLink" href="/fire">
                Fire Analytics
              </Link>
              <Link className="ua-navLink" href="/fire-sla">
                SLA Dashboard
              </Link>
            </div>
          </div>
        </header>
        ) : null}

        <div className={`ua-mapLayout ${sidebarOpen ? "ua-mapLayoutSidebarOpen" : "ua-mapLayoutSidebarClosed"}`}>
          {sidebarOpen ? (
          <aside className="ua-sidebar">
            <div className="ua-sidebarScroll">
              <section className="ua-panel">
                <div className="ua-panelTitle">Controls</div>
                <div className="ua-field">
                  <label>Incident type</label>
                  <select
                    value={problemType}
                    onChange={(event) => setProblemType(event.target.value)}
                  >
                    <option value="all">All incident types</option>
                    <option value="crime">Crime</option>
                    <option value="hospital">Hospital</option>
                    <option value="fire">Fire</option>
                  </select>
                </div>

                <div className="ua-field">
                  <label>Focus radius</label>
                  <input
                    className="ua-range"
                    type="range"
                    min="2"
                    max="15"
                    step="1"
                    value={focusRadiusKm}
                    onChange={(event) => setFocusRadiusKm(Number(event.target.value))}
                  />
                  <div className="ua-muted">
                    {nearbyIncidents.length} reports within {radiusKilometers.toFixed(2)} km
                  </div>
                </div>

                <div className="ua-legendList">
                  {typeOrder.map((type) => (
                    <div key={type} className="ua-legendItem">
                      <span className="ua-dot" style={{ backgroundColor: typeColors[type] }} />
                      <span className="ua-legendLabel">{type}</span>
                      <strong>{nearbyTypeCounts[type]}</strong>
                    </div>
                  ))}
                </div>
              </section>

              <section className="ua-panel">
                <div className="ua-panelTitle">Locations</div>
                <label className="ua-layerOption">
                  <input
                    type="checkbox"
                    checked={showIncidents}
                    onChange={(event) => setShowIncidents(event.target.checked)}
                  />
                  <span>Show incident markers</span>
                </label>
                <label className="ua-layerOption">
                  <input
                    type="checkbox"
                    checked={showStations}
                    onChange={(event) => setShowStations(event.target.checked)}
                  />
                  <span>Show station markers</span>
                </label>
                <label className="ua-layerOption">
                  <input
                    type="checkbox"
                    checked={showIsochrones}
                    onChange={(event) => setShowIsochrones(event.target.checked)}
                  />
                  <span>Show isochrone rings</span>
                </label>
              </section>

              <section className="ua-panel">
                <div className="ua-panelTitle">Hotspot Layer</div>
                <label className="ua-layerOption">
                  <input
                    type="checkbox"
                    checked={showHotspots}
                    onChange={(event) => setShowHotspots(event.target.checked)}
                  />
                  <span>Show H3 hotspot overlay</span>
                </label>
                <div className="ua-legendList" style={{ marginTop: 12 }}>
                  <div className="ua-legendItem">
                    <span className="ua-dot" style={{ backgroundColor: "#ff3d3d" }} />
                    <span className="ua-legendLabel">hot spot</span>
                  </div>
                  <div className="ua-legendItem">
                    <span className="ua-dot" style={{ backgroundColor: "#1ea85a" }} />
                    <span className="ua-legendLabel">cold spot</span>
                  </div>
                  <div className="ua-legendItem">
                    <span className="ua-dot" style={{ backgroundColor: "#c9c5df" }} />
                    <span className="ua-legendLabel">not significant</span>
                  </div>
                </div>
              </section>

              <section className="ua-panel">
                <div className="ua-panelTitle">Incident Matrix</div>
                <div className="ua-summaryLine">
                  Processed: <strong>{matrixHeader?.totalIncidents ?? incidents.length}</strong>
                </div>
                <div className="ua-summaryLine">
                  Average time: <strong>{matrixHeader?.averageMinutes ?? "-"}</strong>
                </div>
                <div className="ua-summaryLine">
                  Saved file: <strong>{matrixHeader?.outputFile || "-"}</strong>
                </div>
                <div className="ua-summaryLine">
                  Results page: <Link className="ua-navLink" href="/matrix-results">Open</Link>
                </div>
              </section>

              <section className="ua-panel">
                <div className="ua-panelTitle">Analytics</div>
                <div className="ua-muted">
                  Spatial equity metrics and hotspot analysis are available on dedicated pages.
                </div>
                <div className="ua-overlayLinks">
                  <Link className="ua-navLink ua-navLinkActive" href="/equity">
                    Open Equity Analytics
                  </Link>
                  <Link className="ua-navLink" href="/hotspots">
                    Open Hotspot Analysis
                  </Link>
                  <Link className="ua-navLink" href="/fire">
                    Open Fire Analytics
                  </Link>
                </div>
              </section>

              {isochroneError ? (
                <section className="ua-panel">
                  <div className="ua-panelTitle">Isochrone Status</div>
                  <div className="ua-emptyState">{isochroneError}</div>
                </section>
              ) : null}

              {matrixError ? (
                <section className="ua-panel">
                  <div className="ua-panelTitle">Matrix Status</div>
                  <div className="ua-emptyState">{matrixError}</div>
                </section>
              ) : null}
            </div>
          </aside>
          ) : null}

          <main
            ref={stageRef}
            className="ua-mapStage ua-mapStagePrimary"
            onMouseLeave={() => {
              setHoverPoint(null);
              setHoverGeoPoint(null);
            }}
          >
            <div className="ua-mapCanvas">
              {loadError ? (
                <div className="ua-mapStatus">
                  Could not load Google Maps. Check `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.
                </div>
              ) : !isLoaded ? (
                <div className="ua-mapStatus">Loading map...</div>
              ) : (
                <GoogleMap
                  mapContainerStyle={{ width: "100%", height: "100%" }}
                  center={center}
                  zoom={12}
                  onLoad={(map) => {
                    mapRef.current = map;
                    setMapZoom(map.getZoom() || 12);
                  }}
                  onClick={handleMapClick}
                  onMouseMove={handleMapMouseMove}
                  onZoomChanged={() => {
                    if (mapRef.current) {
                      setMapZoom(mapRef.current.getZoom() || 12);
                    }
                  }}
                  options={{
                    disableDefaultUI: false,
                    streetViewControl: false,
                    mapTypeControl: false,
                    fullscreenControl: false,
                    styles: darkMapStyles,
                    gestureHandling: "greedy",
                  }}
                >
                  <Marker position={center} />

                  {showIncidents &&
                    filteredIncidents.map((incident) => {
                      const covered =
                        outerPolygon.length > 0
                          ? isInside(incident, outerPolygon)
                          : false;
                      const matrixResult = matrixByIncident[incident.id];
                      const minDuration =
                        typeof incident.minDuration === "number"
                          ? incident.minDuration
                          : matrixResult?.minDuration;
                      const nearestStationId =
                        incident.nearestStationId ?? matrixResult?.nearestStationId;

                      return (
                        <Marker
                          key={incident.id}
                          position={{ lat: incident.lat, lng: incident.lng }}
                          icon={
                            covered
                              ? "http://maps.google.com/mapfiles/ms/icons/green-dot.png"
                              : `http://maps.google.com/mapfiles/ms/icons/${
                                  incident.type === "crime"
                                    ? "red"
                                    : incident.type === "hospital"
                                      ? "blue"
                                      : "orange"
                                }-dot.png`
                          }
                          opacity={0.84}
                          title={
                            nearestStationId && typeof minDuration === "number"
                              ? `Incident ${incident.id}: station ${nearestStationId}, ${Math.round(minDuration)} sec`
                              : `Incident ${incident.id}`
                          }
                        />
                      );
                    })}

                  {showStations &&
                    stations.map((station) => (
                      <Marker
                        key={station.id}
                        position={{ lat: station.lat, lng: station.lng }}
                        icon="http://maps.google.com/mapfiles/ms/icons/yellow-dot.png"
                        label={{
                          text: `S${station.id}`,
                          color: "#111111",
                          fontWeight: "700",
                        }}
                        zIndex={1000}
                      />
                    ))}

                  {showIsochrones &&
                    polygons.map((poly, index) => (
                      <Polygon
                        key={index}
                        paths={poly.paths}
                        options={{
                          fillColor: poly.color,
                          fillOpacity: 0.16,
                          strokeColor: poly.color,
                          strokeWeight: 2,
                          clickable: false,
                        }}
                      />
                    ))}

                  {showHotspots &&
                    hotspotPolygons.map((poly) => (
                      <Polygon
                        key={poly.id}
                        paths={poly.paths}
                        options={{
                          fillColor: poly.color,
                          fillOpacity: poly.fillOpacity,
                          strokeColor: poly.color,
                          strokeOpacity: 0.85,
                          strokeWeight: 1.5,
                          clickable: false,
                          zIndex: 2,
                        }}
                      />
                    ))}
                </GoogleMap>
              )}
            </div>

            <div className="ua-floatingToolbar">
              <button
                className="ua-floatChip"
                onClick={() => fetchIsochrone(center.lat, center.lng)}
              >
                Generate Isochrone
              </button>
              <button
                className={`ua-floatChip ${matrixLoading ? "ua-floatChipActive" : ""}`}
                onClick={fetchIncidentMatrix}
                disabled={matrixLoading}
              >
                {matrixLoading ? "Running Incident Matrix..." : "Run Incident Matrix"}
              </button>
              <button
                className="ua-floatChip"
                onClick={() => setSidebarOpen((current) => !current)}
              >
                {sidebarOpen ? "Hide Sidebar" : "Show Sidebar"}
              </button>
              <button
                className="ua-floatChip"
                onClick={() => setShowHeader((current) => !current)}
              >
                {showHeader ? "Hide Header" : "Show Header"}
              </button>
            </div>

            <div className="ua-mapCard">
              <div className="ua-stageKicker">Live Map</div>
              <div className="ua-stageTitle">Click anywhere to generate an isochrone</div>
              <div className="ua-stageMeta">
                Center {center.lat.toFixed(4)}, {center.lng.toFixed(4)} | Focus{" "}
                {hoverGeoPoint ? `${radiusKilometers.toFixed(2)} km` : "-"}
              </div>
            </div>

            {hoverPoint && (
              <div
                className="ua-focusRing"
                style={{
                  left: `${hoverPoint.x}px`,
                  top: `${hoverPoint.y}px`,
                  width: `${hoverRadiusPixels * 2}px`,
                  height: `${hoverRadiusPixels * 2}px`,
                }}
              >
                <div className="ua-focusColumns">
                  {focusBars.map((bar) => (
                    <div
                      key={bar.id}
                      className="ua-focusColumnWrap"
                      style={{
                        transform: `translate(-50%, -50%) rotate(${bar.angle}deg)`,
                      }}
                      title={`${bar.type}: ${bar.count}`}
                    >
                      <div className="ua-focusColumn">
                        <div className="ua-focusValue">{bar.count}</div>
                        <div
                          className="ua-focusColumnBar"
                          style={{
                            height: `${bar.height}px`,
                            background: bar.color,
                          }}
                        />
                        <div className="ua-focusType">{bar.type}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="ua-mapFooter">
              {latestRows.map((incident) => (
                <div key={incident.id} className="ua-chip">
                  <span
                    className="ua-dot"
                    style={{ backgroundColor: typeColors[incident.type] || "#ffffff" }}
                  />
                  #{incident.id} {incident.type}
                  <strong>{formatMinutes(incident.minDuration)}</strong>
                </div>
              ))}
            </div>
          </main>
        </div>
      </div>
  );
}
