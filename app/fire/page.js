"use client";

import { GoogleMap, Marker, Polyline, useJsApiLoader } from "@react-google-maps/api";
import axios from "axios";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const defaultCenter = { lat: 18.585, lng: 73.86 };
const scenarioOptions = [
  { id: "historical", label: "Historical" },
  { id: "night", label: "Night" },
  { id: "peak", label: "Peak Hours" },
];

function formatSeconds(seconds) {
  return typeof seconds === "number" ? `${Math.round(seconds)} sec` : "-";
}

function formatKilometers(value) {
  return typeof value === "number" ? `${value.toFixed(2)} km` : "-";
}

function formatSignedSeconds(value) {
  if (typeof value !== "number") {
    return "-";
  }

  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded} sec`;
}

function formatSignedPercent(value) {
  if (typeof value !== "number") {
    return "-";
  }

  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function getTrendClass(value, reverse = false) {
  if (typeof value !== "number" || value === 0) {
    return "";
  }

  const good = reverse ? value > 0 : value < 0;
  return good ? "ua-trendPositive" : "ua-trendNegative";
}

function buildStationMetricsMap(metrics) {
  return Object.fromEntries(metrics.map((item) => [item.stationId, item]));
}

function buildSummaryKpis(comparison) {
  if (!comparison) {
    return [];
  }

  return [
    {
      label: "Current Avg Time",
      value: formatSeconds(comparison.currentModeledAvgResponseSeconds),
      tone: "",
    },
    {
      label: "Optimized Avg Time",
      value: formatSeconds(comparison.optimizedModeledAvgResponseSeconds),
      tone: getTrendClass(comparison.responseDeltaSeconds),
    },
    {
      label: "Time Delta",
      value: formatSignedSeconds(comparison.responseDeltaSeconds),
      tone: getTrendClass(comparison.responseDeltaSeconds),
    },
    {
      label: "Delta Percent",
      value: formatSignedPercent(comparison.responseDeltaPercent),
      tone: getTrendClass(comparison.responseDeltaPercent),
    },
    {
      label: "Current Avg Distance",
      value: formatKilometers(comparison.currentAvgDistanceKm),
      tone: "",
    },
    {
      label: "Optimized Avg Distance",
      value: formatKilometers(comparison.optimizedAvgDistanceKm),
      tone: getTrendClass(comparison.distanceDeltaKm),
    },
  ];
}

export default function FirePage() {
  const { isLoaded, loadError } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "",
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dataset, setDataset] = useState({
    summary: null,
    incidents: [],
    stations: [],
    stationMetrics: [],
    recommendedStations: [],
  });
  const [selectedIncidentId, setSelectedIncidentId] = useState(null);
  const [selectedLocality, setSelectedLocality] = useState("all");
  const [scenario, setScenario] = useState("historical");
  const [showCurrentStations, setShowCurrentStations] = useState(true);
  const [showRecommendedStations, setShowRecommendedStations] = useState(true);
  const [kValue, setKValue] = useState(5);
  const [optimizationLoading, setOptimizationLoading] = useState(false);
  const [optimizationError, setOptimizationError] = useState("");
  const [optimizationResult, setOptimizationResult] = useState(null);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [estimateError, setEstimateError] = useState("");
  const [estimateResult, setEstimateResult] = useState(null);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError("");

      try {
        const res = await fetch("/api/fire/summary");
        if (!res.ok) {
          throw new Error("Could not load fire analytics.");
        }

        const nextDataset = await res.json();
        setDataset(nextDataset);
        setSelectedIncidentId(nextDataset.incidents[0]?.incidentId ?? null);
      } catch (loadError) {
        console.error(loadError);
        setError(loadError.message || "Could not load fire analytics.");
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const metricsByStation = useMemo(
    () => buildStationMetricsMap(dataset.stationMetrics),
    [dataset.stationMetrics]
  );
  const activeComparison = optimizationResult?.comparison || dataset.summary?.comparison || null;
  const summaryKpis = useMemo(
    () => buildSummaryKpis(activeComparison),
    [activeComparison]
  );

  const localityOptions = useMemo(() => {
    return [
      "all",
      ...Array.from(new Set(dataset.incidents.map((incident) => incident.locality))).sort(),
    ];
  }, [dataset.incidents]);

  const filteredIncidents = useMemo(() => {
    if (selectedLocality === "all") {
      return dataset.incidents;
    }

    return dataset.incidents.filter((incident) => incident.locality === selectedLocality);
  }, [dataset.incidents, selectedLocality]);

  const displayedIncidents = useMemo(() => filteredIncidents.slice(0, 300), [filteredIncidents]);
  const selectedIncident =
    dataset.incidents.find((incident) => incident.incidentId === selectedIncidentId) || null;
  const activeRecommendedStations =
    optimizationResult?.recommendedStations || dataset.recommendedStations;

  useEffect(() => {
    if (!filteredIncidents.length) {
      setSelectedIncidentId(null);
      return;
    }

    if (!filteredIncidents.some((incident) => incident.incidentId === selectedIncidentId)) {
      setSelectedIncidentId(filteredIncidents[0].incidentId);
    }
  }, [filteredIncidents, selectedIncidentId]);

  useEffect(() => {
    const runOptimization = async () => {
      if (!dataset.incidents.length) {
        return;
      }

      setOptimizationLoading(true);
      setOptimizationError("");

      try {
        const res = await axios.post("/api/fire/recommend", {
          k: kValue,
          scenario,
        });
        setOptimizationResult(res.data);
      } catch (requestError) {
        console.error(requestError);
        setOptimizationError(
          requestError?.response?.data?.error ||
            requestError?.message ||
            "Could not optimize station locations."
        );
      } finally {
        setOptimizationLoading(false);
      }
    };

    runOptimization();
  }, [dataset.incidents.length, kValue, scenario]);

  useEffect(() => {
    const runEstimate = async () => {
      if (!selectedIncident) {
        return;
      }

      setEstimateLoading(true);
      setEstimateError("");

      try {
        const res = await axios.post("/api/fire/estimate", {
          incidentLat: selectedIncident.lat,
          incidentLng: selectedIncident.lng,
          scenario,
          includeRecommended: showRecommendedStations,
          recommendedStations: activeRecommendedStations,
        });
        setEstimateResult(res.data);
      } catch (requestError) {
        console.error(requestError);
        setEstimateError(
          requestError?.response?.data?.error ||
            requestError?.message ||
            "Could not estimate response time."
        );
      } finally {
        setEstimateLoading(false);
      }
    };

    runEstimate();
  }, [activeRecommendedStations, scenario, selectedIncident, showRecommendedStations]);

  const routePath = useMemo(() => {
    const bestStation = estimateResult?.bestStation;
    if (!bestStation || !selectedIncident) {
      return [];
    }

    const stationSource =
      dataset.stations.find((station) => station.stationId === bestStation.stationId) ||
      activeRecommendedStations.find(
        (station) => station.recommendedStationId === bestStation.stationId
      );

    if (!stationSource) {
      return [];
    }

    return [
      { lat: stationSource.lat, lng: stationSource.lng },
      { lat: selectedIncident.lat, lng: selectedIncident.lng },
    ];
  }, [activeRecommendedStations, dataset.stations, estimateResult, selectedIncident]);

  const incidentImprovement = estimateResult?.improvementSeconds ?? null;
  const incidentImprovementPercent =
    estimateResult?.currentBestStation && estimateResult?.recommendedBestStation
      ? ((estimateResult.improvementSeconds / estimateResult.currentBestStation.estimatedResponseSeconds) * 100)
      : null;

  return (
    <div className="ua-shellSimple ua-resultsPage">
      <header className="ua-topbar">
        <div className="ua-topbarBrand">
          <div className="ua-eyebrow">Urban Analytics</div>
          <h1>Fire Analytics</h1>
          <div className="ua-topbarNav">
            <Link className="ua-navLink" href="/">
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
            <Link className="ua-navLink ua-navLinkActive" href="/fire">
              Fire Analytics
            </Link>
          </div>
        </div>
      </header>

      {error ? (
        <section className="ua-panel">
          <div className="ua-emptyState">{error}</div>
        </section>
      ) : null}

      <section className="ua-kpiRow">
        {summaryKpis.map((kpi) => (
          <div key={kpi.label} className="ua-kpiCard ua-kpiCardHotspot">
            <span>{kpi.label}</span>
            <strong className={kpi.tone}>{kpi.value}</strong>
          </div>
        ))}
      </section>

      <section className="ua-fireGrid">
        <article className="ua-panel ua-fireMapPanel">
          <div className="ua-fireMapHeader">
            <div>
              <div className="ua-cardKicker ua-cardKickerHotspot">Operational Map</div>
              <div className="ua-stageTitle">Current vs recommended station plotting on Google Maps</div>
              <div className="ua-stageMeta">
                Pune and Pimpri-Chinchwad incidents with live KMeans station optimization.
              </div>
            </div>
            <div className="ua-fireControls">
              <label className="ua-layerOption">
                <span>Stations (k)</span>
                <select value={kValue} onChange={(event) => setKValue(Number(event.target.value))}>
                  {[3, 4, 5, 6, 7, 8, 9, 10].map((value) => (
                    <option key={value} value={value}>
                      {value} stations
                    </option>
                  ))}
                </select>
              </label>
              <label className="ua-layerOption">
                <span>Scenario</span>
                <select value={scenario} onChange={(event) => setScenario(event.target.value)}>
                  {scenarioOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ua-layerOption">
                <span>Locality</span>
                <select
                  value={selectedLocality}
                  onChange={(event) => setSelectedLocality(event.target.value)}
                >
                  {localityOptions.map((option) => (
                    <option key={option} value={option}>
                      {option === "all" ? "All localities" : option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ua-layerOption">
                <input
                  type="checkbox"
                  checked={showCurrentStations}
                  onChange={(event) => setShowCurrentStations(event.target.checked)}
                />
                <span>Current stations</span>
              </label>
              <label className="ua-layerOption">
                <input
                  type="checkbox"
                  checked={showRecommendedStations}
                  onChange={(event) => setShowRecommendedStations(event.target.checked)}
                />
                <span>Recommended stations</span>
              </label>
            </div>
          </div>

          <div className="ua-fireMapShell">
            {loadError ? (
              <div className="ua-mapStatus">
                Could not load Google Maps. Check `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.
              </div>
            ) : !isLoaded || loading ? (
              <div className="ua-mapStatus">Loading fire map...</div>
            ) : (
              <GoogleMap
                mapContainerStyle={{ width: "100%", height: "100%" }}
                center={selectedIncident ? { lat: selectedIncident.lat, lng: selectedIncident.lng } : defaultCenter}
                zoom={11}
                options={{
                  streetViewControl: false,
                  mapTypeControl: false,
                  fullscreenControl: false,
                  gestureHandling: "greedy",
                }}
              >
                {displayedIncidents.map((incident) => (
                  <Marker
                    key={incident.incidentId}
                    position={{ lat: incident.lat, lng: incident.lng }}
                    icon={{
                      path: window.google.maps.SymbolPath.CIRCLE,
                      scale: incident.incidentId === selectedIncidentId ? 8 : 4.8,
                      fillColor:
                        incident.incidentId === selectedIncidentId ? "#ff3b30" : "#ff8447",
                      fillOpacity: 0.92,
                      strokeColor: "#fff4ec",
                      strokeWeight: 1,
                    }}
                    onClick={() => setSelectedIncidentId(incident.incidentId)}
                    title={`${incident.incidentId} - ${incident.callType}`}
                  />
                ))}

                {showCurrentStations &&
                  dataset.stations.map((station) => (
                    <Marker
                      key={station.stationId}
                      position={{ lat: station.lat, lng: station.lng }}
                      icon="http://maps.google.com/mapfiles/ms/icons/red-dot.png"
                      label={{
                        text: station.stationId.replace("FS-", ""),
                        color: "#23160d",
                        fontWeight: "700",
                      }}
                      title={`${station.stationName} - ${metricsByStation[station.stationId]?.avgSpeedKmph?.toFixed(1) || "-"} km/h`}
                    />
                  ))}

                {showRecommendedStations &&
                  activeRecommendedStations.map((station) => (
                    <Marker
                      key={station.recommendedStationId}
                      position={{ lat: station.lat, lng: station.lng }}
                      icon="http://maps.google.com/mapfiles/ms/icons/green-dot.png"
                      label={{
                        text: station.recommendedStationId.replace("RFS-", "R"),
                        color: "#17311f",
                        fontWeight: "700",
                      }}
                      title={`${station.recommendedStationId} - ${station.estimatedResponseSeconds} sec avg`}
                    />
                  ))}

                {routePath.length > 1 ? (
                  <Polyline
                    path={routePath}
                    options={{
                      strokeColor: "#4fd1ff",
                      strokeOpacity: 0.88,
                      strokeWeight: 3,
                    }}
                  />
                ) : null}
              </GoogleMap>
            )}
          </div>

          <div className="ua-fireLegend">
            <div className="ua-fireLegendItem">
              <span className="ua-fireLegendSwatch ua-fireLegendSwatchIncident" />
              <span>CAD incidents</span>
            </div>
            <div className="ua-fireLegendItem">
              <span className="ua-fireLegendSwatch ua-fireLegendSwatchCurrent" />
              <span>Current stations</span>
            </div>
            <div className="ua-fireLegendItem">
              <span className="ua-fireLegendSwatch ua-fireLegendSwatchRecommended" />
              <span>Recommended stations</span>
            </div>
            <div className="ua-fireLegendItem">
              <span className="ua-fireLegendLine" />
              <span>Fastest route estimate</span>
            </div>
          </div>

          <div className="ua-fireMapFooter">
            Showing {displayedIncidents.length} of {filteredIncidents.length} filtered incidents in Pune-PCMC.
          </div>
        </article>

        <aside className="ua-fireSidebar">
          <section className="ua-panel">
            <div className="ua-panelTitle">Selected Incident</div>
            {selectedIncident ? (
              <div className="ua-summaryStack">
                <div className="ua-summaryLine"><span>ID</span><strong>{selectedIncident.incidentId}</strong></div>
                <div className="ua-summaryLine"><span>Call Type</span><strong>{selectedIncident.callType}</strong></div>
                <div className="ua-summaryLine"><span>Locality</span><strong>{selectedIncident.locality}</strong></div>
                <div className="ua-summaryLine"><span>Historical Station</span><strong>{selectedIncident.stationId}</strong></div>
                <div className="ua-summaryLine"><span>Historical Response</span><strong>{formatSeconds(selectedIncident.responseTimeSeconds)}</strong></div>
                <div className="ua-summaryLine"><span>ORS Distance</span><strong>{formatKilometers(selectedIncident.routeDistanceMeters / 1000)}</strong></div>
              </div>
            ) : (
              <div className="ua-emptyState">Select an incident marker to see values.</div>
            )}
          </section>

          <section className="ua-panel">
            <div className="ua-panelTitle">Plotted Location Result</div>
            {optimizationError ? <div className="ua-emptyState">{optimizationError}</div> : null}
            {estimateError ? <div className="ua-emptyState">{estimateError}</div> : null}
            {estimateLoading || optimizationLoading ? (
              <div className="ua-emptyState">Running KMeans and calculating current vs recommended outcome...</div>
            ) : (
              <div className="ua-summaryStack">
                <div className="ua-summaryLine">
                  <span>Current Best</span>
                  <strong>{formatSeconds(estimateResult?.currentBestStation?.estimatedResponseSeconds)}</strong>
                </div>
                <div className="ua-summaryLine">
                  <span>Recommended Best</span>
                  <strong className={getTrendClass(incidentImprovement, true)}>{formatSeconds(estimateResult?.recommendedBestStation?.estimatedResponseSeconds)}</strong>
                </div>
                <div className="ua-summaryLine">
                  <span>Incident Delta</span>
                  <strong className={getTrendClass(incidentImprovement, true)}>{formatSignedSeconds(-incidentImprovement)}</strong>
                </div>
                <div className="ua-summaryLine">
                  <span>Incident Delta %</span>
                  <strong className={getTrendClass(incidentImprovementPercent, true)}>{formatSignedPercent(-incidentImprovementPercent)}</strong>
                </div>
                <div className="ua-summaryLine">
                  <span>Chosen Station</span>
                  <strong>{estimateResult?.bestStation?.stationName || "-"}</strong>
                </div>
              </div>
            )}
          </section>

          <section className="ua-panel">
            <div className="ua-panelTitle">Map KPIs</div>
            <div className="ua-fireMiniStats">
              <div className="ua-fireMiniStat">
                <span>Chosen k</span>
                <strong>{kValue}</strong>
              </div>
              <div className="ua-fireMiniStat">
                <span>Improved incidents</span>
                <strong className="ua-trendPositive">
                  {activeComparison?.improvedIncidentShare ?? "-"}%
                </strong>
              </div>
              <div className="ua-fireMiniStat">
                <span>Current avg</span>
                <strong>{formatSeconds(activeComparison?.currentModeledAvgResponseSeconds)}</strong>
              </div>
              <div className="ua-fireMiniStat">
                <span>Optimized avg</span>
                <strong className={getTrendClass(activeComparison?.responseDeltaSeconds)}>
                  {formatSeconds(activeComparison?.optimizedModeledAvgResponseSeconds)}
                </strong>
              </div>
              <div className="ua-fireMiniStat">
                <span>Network delta</span>
                <strong className={getTrendClass(activeComparison?.responseDeltaSeconds)}>
                  {formatSignedSeconds(activeComparison?.responseDeltaSeconds)}
                </strong>
              </div>
            </div>
          </section>
        </aside>
      </section>

      <section className="ua-fireChartsGrid">
        <article className="ua-panel">
          <div className="ua-panelTitle">KMeans Elbow Curve</div>
          {dataset.summary?.graphs?.elbow ? (
            <Image
              className="ua-fireChart"
              src={dataset.summary.graphs.elbow}
              alt="KMeans elbow curve for fire incidents"
              width={800}
              height={500}
            />
          ) : (
            <div className="ua-emptyState">Chart unavailable.</div>
          )}
        </article>
        <article className="ua-panel">
          <div className="ua-panelTitle">Cluster Plot with Current and Recommended Stations</div>
          {dataset.summary?.graphs?.clusters ? (
            <Image
              className="ua-fireChart"
              src={dataset.summary.graphs.clusters}
              alt="KMeans cluster plot with current and recommended station locations"
              width={800}
              height={600}
            />
          ) : (
            <div className="ua-emptyState">Chart unavailable.</div>
          )}
        </article>
        <article className="ua-panel">
          <div className="ua-panelTitle">Average Response by Hour</div>
          {dataset.summary?.graphs?.responseByHour ? (
            <Image
              className="ua-fireChart"
              src={dataset.summary.graphs.responseByHour}
              alt="Average response time by hour"
              width={800}
              height={500}
            />
          ) : (
            <div className="ua-emptyState">Chart unavailable.</div>
          )}
        </article>
      </section>
    </div>
  );
}
