"use client";

import {
  Circle,
  GoogleMap,
  Marker,
  Polyline,
  useJsApiLoader,
} from "@react-google-maps/api";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const defaultCenter = { lat: 18.545, lng: 73.86 };
const darkMapStyles = [
  { elementType: "geometry", stylers: [{ color: "#111827" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#111827" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#7c89a8" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1d2940" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#0b1220" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#09121f" }] },
];

function toPercent(value) {
  return typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "-";
}

function toMinutes(value) {
  return typeof value === "number" ? `${value.toFixed(2)} min` : "-";
}

function getRateTone(value, goodThreshold = 0.75, warnThreshold = 0.5) {
  if (typeof value !== "number") {
    return "neutral";
  }

  if (value >= goodThreshold) {
    return "good";
  }

  if (value >= warnThreshold) {
    return "warn";
  }

  return "bad";
}

function getReverseTone(value, goodThreshold, warnThreshold) {
  if (typeof value !== "number") {
    return "neutral";
  }

  if (value <= goodThreshold) {
    return "good";
  }

  if (value <= warnThreshold) {
    return "warn";
  }

  return "bad";
}

function buildKpis(summary) {
  if (!summary) {
    return [];
  }

  return [
    {
      label: "Total Incidents",
      value: String(summary.totalIncidents ?? "-"),
      tone: "neutral",
      note: "Historical CAD records modeled",
    },
    {
      label: "Historical SLA",
      value: toPercent(summary.historicalSlaRate),
      tone: getRateTone(summary.historicalSlaRate),
      note: "Observed 8-minute compliance",
    },
    {
      label: "Optimized SLA",
      value: toPercent(summary.optimizedPrimarySlaRate),
      tone: getRateTone(summary.optimizedPrimarySlaRate),
      note: "Primary station assignment after optimization",
    },
    {
      label: "Expected Coverage",
      value: toPercent(summary.expectedCoverageRate),
      tone: getRateTone(summary.expectedCoverageRate, 0.6, 0.4),
      note: "Availability-aware MEXCLP style estimate",
    },
    {
      label: "DES Overflow Rate",
      value: toPercent(summary.desOverflowRate),
      tone: getReverseTone(summary.desOverflowRate, 0.03, 0.08),
      note: "Concurrent incidents needing spillover",
    },
    {
      label: "Overflow SLA Delta",
      value: toMinutes(summary.overflowScenarioSlaDeltaMinutes),
      tone: getReverseTone(summary.overflowScenarioSlaDeltaMinutes, 2.5, 5),
      note: "Added delay from fallback dispatch",
    },
  ];
}

function buildCoverageRadiusMeters(speedKmPerMin, slaMinutes) {
  if (typeof speedKmPerMin !== "number") {
    return 0;
  }

  return speedKmPerMin * slaMinutes * 1000;
}

export default function FireSlaPage() {
  const { isLoaded, loadError } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "",
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dataset, setDataset] = useState(null);
  const [showExisting, setShowExisting] = useState(true);
  const [showOptimized, setShowOptimized] = useState(true);
  const [showHotspots, setShowHotspots] = useState(true);
  const [showIncidents, setShowIncidents] = useState(true);
  const [showRadii, setShowRadii] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/fire/sla");
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || "Could not load fire SLA analysis.");
        }
        const payload = await response.json();
        setDataset(payload);
      } catch (loadError) {
        console.error(loadError);
        setError(loadError.message || "Could not load fire SLA analysis.");
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const kpis = useMemo(() => buildKpis(dataset?.summary), [dataset]);
  const mapIncidents = useMemo(() => dataset?.incidents?.slice(0, 260) || [], [dataset]);
  const overflowPath = useMemo(() => {
    if (!dataset?.overflowScenario || !dataset?.optimizedStations?.length) {
      return [];
    }

    const overflow = dataset.overflowScenario;
    const fallbackStation = dataset.optimizedStations.find(
      (station) => station.stationId === overflow.fallbackStationId
    );

    if (!fallbackStation) {
      return [];
    }

    return [
      { lat: overflow.incidentB.lat, lng: overflow.incidentB.lng },
      { lat: fallbackStation.lat, lng: fallbackStation.lng },
    ];
  }, [dataset]);

  return (
    <main className="ua-shellSimple ua-slaShell">
      <div className="ua-topbar ua-slaTopbar">
            <div className="ua-topbarBrand">
              <span className="ua-eyebrow">Fire Coverage Modeling</span>
              <h1>8-Minute Fire SLA and Overflow Dashboard</h1>
              <p className="ua-muted">
                Python-generated optimization and React-based operations view for 3-station
                placement, busy-unit overflow, and SLA impact.
              </p>
            </div>
        <div className="ua-topbarNav">
          <Link className="ua-navLink" href="/">
            City Map
          </Link>
          <Link className="ua-navLink" href="/fire">
            Fire Explorer
          </Link>
          <Link className="ua-navLink ua-navLinkActive" href="/fire-sla">
            SLA Dashboard
          </Link>
        </div>
      </div>

      {loading ? <div className="ua-panel">Loading fire SLA analysis...</div> : null}
      {error ? <div className="ua-panel">{error}</div> : null}

      {dataset ? (
        <>
          <section className="ua-slaGrid">
            {kpis.map((kpi) => (
              <article className={`ua-panel ua-slaKpi ua-slaKpi-${kpi.tone}`} key={kpi.label}>
                <span className="ua-eyebrow">{kpi.label}</span>
                <strong>{kpi.value}</strong>
                <span className="ua-slaKpiNote">{kpi.note}</span>
              </article>
            ))}
          </section>

          <section className="ua-slaSignalRow">
            <article className="ua-panel ua-slaSignalCard ua-slaSignalCard-good">
              <span className="ua-slaSignalLabel">Improvement Signal</span>
              <strong>
                {toPercent(
                  (dataset.summary.optimizedPrimarySlaRate || 0) -
                    (dataset.summary.historicalSlaRate || 0)
                )}
              </strong>
              <p>Net gain in SLA compliance after the 3-station optimization.</p>
            </article>
            <article className="ua-panel ua-slaSignalCard ua-slaSignalCard-bad">
              <span className="ua-slaSignalLabel">Overflow Risk</span>
              <strong>{toMinutes(dataset.summary.overflowScenarioSlaDeltaMinutes)}</strong>
              <p>Extra travel time once the nearest station is full and backup dispatch takes over.</p>
            </article>
          </section>

          <section className="ua-slaMainGrid">
            <div className="ua-slaSidebar">
              <article className="ua-panel">
                <div className="ua-panelTitle">Algorithms Used</div>
                <div className="ua-slaCardStack">
                  {dataset.algorithms.map((algorithm) => (
                    <div className="ua-slaAlgoCard" key={algorithm.shortName}>
                      <div className="ua-slaAlgoHeader">
                        <strong>{algorithm.shortName}</strong>
                        <span>{algorithm.longName}</span>
                      </div>
                      <p>{algorithm.usedFor}</p>
                      <p className="ua-muted">{algorithm.whyChosen}</p>
                    </div>
                  ))}
                </div>
              </article>

              <article className="ua-panel">
                <div className="ua-panelTitle">Layers</div>
                <label className="ua-layerOption">
                  <input
                    checked={showExisting}
                    onChange={() => setShowExisting((value) => !value)}
                    type="checkbox"
                  />
                  Existing stations
                </label>
                <label className="ua-layerOption">
                  <input
                    checked={showOptimized}
                    onChange={() => setShowOptimized((value) => !value)}
                    type="checkbox"
                  />
                  Optimized stations
                </label>
                <label className="ua-layerOption">
                  <input
                    checked={showHotspots}
                    onChange={() => setShowHotspots((value) => !value)}
                    type="checkbox"
                  />
                  KDE hotspots
                </label>
                <label className="ua-layerOption">
                  <input
                    checked={showIncidents}
                    onChange={() => setShowIncidents((value) => !value)}
                    type="checkbox"
                  />
                  Incident sample
                </label>
                <label className="ua-layerOption">
                  <input
                    checked={showRadii}
                    onChange={() => setShowRadii((value) => !value)}
                    type="checkbox"
                  />
                  8-minute radii
                </label>
              </article>

              <article
                className={`ua-panel ${
                  dataset.overflowScenario.incidentB.slaMetByFallback
                    ? "ua-slaStateGood"
                    : "ua-slaStateBad"
                }`}
              >
                <div className="ua-panelTitle">Overflow Scenario</div>
                <div className="ua-slaScenario">
                  <p>{dataset.overflowScenario.narrative}</p>
                  <div className="ua-summaryLine">
                    <span>Incident A</span>
                    <strong>{dataset.overflowScenario.incidentA.incidentId}</strong>
                  </div>
                  <div className="ua-summaryLine">
                    <span>Primary station</span>
                    <strong>{dataset.overflowScenario.primaryStationId}</strong>
                  </div>
                  <div className="ua-summaryLine">
                    <span>Fallback station</span>
                    <strong>{dataset.overflowScenario.fallbackStationId}</strong>
                  </div>
                  <div className="ua-summaryLine">
                    <span>Fallback ETA</span>
                    <strong>{toMinutes(dataset.overflowScenario.incidentB.fallbackStationEtaMinutes)}</strong>
                  </div>
                  <div className="ua-summaryLine">
                    <span>SLA met after overflow</span>
                    <strong>
                      {dataset.overflowScenario.incidentB.slaMetByFallback ? "Yes" : "No"}
                    </strong>
                  </div>
                </div>
              </article>

              <article className="ua-panel ua-slaStateWarn">
                <div className="ua-panelTitle">DES Simulation</div>
                <div className="ua-summaryLine">
                  <span>Incidents simulated</span>
                  <strong>{dataset.desSimulation.incidentsSimulated}</strong>
                </div>
                <div className="ua-summaryLine">
                  <span>DES SLA met</span>
                  <strong>{toPercent(dataset.desSimulation.slaMetRate)}</strong>
                </div>
                <div className="ua-summaryLine">
                  <span>Average response</span>
                  <strong>{toMinutes(dataset.desSimulation.averageResponseMinutes)}</strong>
                </div>
                <div className="ua-summaryLine">
                  <span>Overflow rate</span>
                  <strong>{toPercent(dataset.desSimulation.overflowIncidentRate)}</strong>
                </div>
              </article>
            </div>

            <article className="ua-panel ua-slaMapPanel">
              <div className="ua-panelTitle">Coverage Map</div>
              <div className="ua-slaMapWrap">
                {!isLoaded || loadError ? (
                  <div className="ua-mapStatus">
                    {loadError
                      ? "Google Maps could not load. KPI and algorithm results are still available."
                      : "Loading map..."}
                  </div>
                ) : (
                  <GoogleMap
                    center={defaultCenter}
                    mapContainerStyle={{ width: "100%", height: "100%" }}
                    options={{
                      disableDefaultUI: true,
                      zoomControl: true,
                      styles: darkMapStyles,
                    }}
                    zoom={11}
                  >
                    {showHotspots
                      ? dataset.hotspots.map((hotspot) => (
                          <Circle
                            center={{ lat: hotspot.lat, lng: hotspot.lng }}
                            key={hotspot.id}
                            options={{
                              fillColor: "#ff9d2e",
                              fillOpacity: 0.12 + hotspot.intensity * 0.18,
                              strokeColor: "#ffb347",
                              strokeOpacity: 0.4,
                              strokeWeight: 1,
                            }}
                            radius={650 + hotspot.intensity * 700}
                          />
                        ))
                      : null}

                    {showRadii
                      ? dataset.optimizedStations.map((station) => (
                          <Circle
                            center={{ lat: station.lat, lng: station.lng }}
                            key={`radius-${station.stationId}`}
                            options={{
                              fillColor: "#45b7ff",
                              fillOpacity: 0.08,
                              strokeColor: "#45b7ff",
                              strokeOpacity: 0.4,
                              strokeWeight: 1.2,
                            }}
                            radius={buildCoverageRadiusMeters(
                              station.speedKmPerMin,
                              dataset.assumptions.slaMinutes
                            )}
                          />
                        ))
                      : null}

                    {showIncidents
                      ? mapIncidents.map((incident) => (
                          <Circle
                            center={{ lat: incident.lat, lng: incident.lng }}
                            key={incident.incidentId}
                            options={{
                              fillColor: incident.optimizedSlaMet ? "#ff9350" : "#ff5b5b",
                              fillOpacity: 0.7,
                              strokeColor: "#ffffff",
                              strokeOpacity: 0.15,
                              strokeWeight: 1,
                            }}
                            radius={55}
                          />
                        ))
                      : null}

                    {showExisting
                      ? dataset.existingStations.map((station) => (
                          <Marker
                            key={station.stationId}
                            position={{ lat: station.lat, lng: station.lng }}
                            title={`${station.stationId} | Existing station`}
                            icon={{
                              path: window.google.maps.SymbolPath.CIRCLE,
                              fillColor: "#93a5c7",
                              fillOpacity: 0.95,
                              strokeColor: "#0f1727",
                              strokeWeight: 1.5,
                              scale: 6,
                            }}
                          />
                        ))
                      : null}

                    {showOptimized
                      ? dataset.optimizedStations.map((station) => (
                          <Marker
                            key={station.stationId}
                            position={{ lat: station.lat, lng: station.lng }}
                            title={`${station.stationId} | ${station.stationName}`}
                            icon={{
                              path: window.google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                              fillColor: "#45b7ff",
                              fillOpacity: 1,
                              strokeColor: "#ffffff",
                              strokeWeight: 1.2,
                              scale: 6,
                            }}
                          />
                        ))
                      : null}

                    <Marker
                      position={{
                        lat: dataset.overflowScenario.incidentA.lat,
                        lng: dataset.overflowScenario.incidentA.lng,
                      }}
                      title="Incident A"
                    />
                    <Marker
                      position={{
                        lat: dataset.overflowScenario.incidentB.lat,
                        lng: dataset.overflowScenario.incidentB.lng,
                      }}
                      title="Incident B"
                    />
                    <Polyline
                      options={{
                        strokeColor: dataset.overflowScenario.incidentB.slaMetByFallback
                          ? "#5ef2a4"
                          : "#ff5b5b",
                        strokeOpacity: 0.95,
                        strokeWeight: 3,
                      }}
                      path={overflowPath}
                    />
                  </GoogleMap>
                )}
              </div>
            </article>
          </section>

          <section className="ua-slaLowerGrid">
            <article className="ua-panel ua-slaStateGood">
              <div className="ua-panelTitle">Optimized Stations</div>
              <div className="ua-slaTable">
                <div className="ua-slaTableHeader">
                  <span>Station</span>
                  <span>Incidents</span>
                  <span>SLA</span>
                  <span>Expected</span>
                </div>
                {dataset.optimizedStations.map((station) => (
                  <div className="ua-slaTableRow" key={station.stationId}>
                    <span>{station.stationId}</span>
                    <span>{station.coveredIncidents}</span>
                    <span>{toPercent(station.slaCoverageRate)}</span>
                    <span>{toPercent(station.expectedCoverageRate)}</span>
                  </div>
                ))}
              </div>
            </article>

            <article className="ua-panel ua-slaStateWarn">
              <div className="ua-panelTitle">Zone Busy Probabilities</div>
              <div className="ua-slaCardStack">
                {dataset.zoneBusyProbabilities.slice(0, 8).map((zone) => (
                  <div className="ua-summaryLine" key={zone.zone}>
                    <span>{zone.zone}</span>
                    <strong>{toPercent(zone.busyProbability)}</strong>
                  </div>
                ))}
              </div>
            </article>

            <article className="ua-panel ua-slaStateBad">
              <div className="ua-panelTitle">Station Utilization</div>
              <div className="ua-slaCardStack">
                {dataset.desSimulation.stationUtilization.map((station) => (
                  <div className="ua-summaryLine" key={station.stationId}>
                    <span>{station.stationId}</span>
                    <strong>{toPercent(station.utilization)}</strong>
                  </div>
                ))}
              </div>
            </article>
          </section>
        </>
      ) : null}
    </main>
  );
}
