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

const layerDefinitions = [
  {
    key: "existing",
    label: "Existing Stations",
    legendLabel: "Grey dots",
    note: "Historical station footprint",
    swatchClass: "bg-slate-400",
  },
  {
    key: "optimized",
    label: "Optimized Stations",
    legendLabel: "Emerald arrows",
    note: "Optimized 3-station solution",
    swatchClass: "bg-emerald-400",
  },
  {
    key: "hotspots",
    label: "KDE Hotspots",
    legendLabel: "Amber circles",
    note: "Incident demand hotspots",
    swatchClass: "bg-amber-400",
  },
  {
    key: "radii",
    label: "8-Minute Reach",
    legendLabel: "Emerald rings",
    note: "Estimated service radius",
    swatchClass: "bg-emerald-300",
  },
  {
    key: "incidents",
    label: "Incident Sample",
    legendLabel: "Amber and red dots",
    note: "Covered or breached incidents",
    swatchClass: "bg-gradient-to-r from-amber-400 to-red-500",
  },
  {
    key: "overflow",
    label: "Overflow Route",
    legendLabel: "Green or red line",
    note: "Backup dispatch outcome",
    swatchClass: "bg-gradient-to-r from-emerald-400 to-red-500",
  },
];

function toPercent(value) {
  return typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "-";
}

function toMinutes(value) {
  return typeof value === "number" ? `${value.toFixed(2)} min` : "-";
}

function getRateTone(value, goodThreshold = 0.75, warnThreshold = 0.5) {
  if (typeof value !== "number") {
    return "slate";
  }

  if (value >= goodThreshold) {
    return "emerald";
  }

  if (value >= warnThreshold) {
    return "amber";
  }

  return "red";
}

function getReverseTone(value, goodThreshold, warnThreshold) {
  if (typeof value !== "number") {
    return "slate";
  }

  if (value <= goodThreshold) {
    return "emerald";
  }

  if (value <= warnThreshold) {
    return "amber";
  }

  return "red";
}

function getBarTone(value) {
  if (value < 0.7) {
    return "bg-emerald-500";
  }

  if (value <= 0.85) {
    return "bg-amber-400";
  }

  return "bg-red-500";
}

function buildKpis(summary) {
  if (!summary) {
    return [];
  }

  return [
    {
      label: "Total Incidents",
      value: String(summary.totalIncidents ?? "-"),
      tone: "slate",
      tooltip: "Historical CAD incidents included in this model run.",
    },
    {
      label: "Historical SLA",
      value: toPercent(summary.historicalSlaRate),
      tone: "slate",
      tooltip: "Observed 8-minute SLA compliance from historical dispatch outcomes.",
    },
    {
      label: "Optimized SLA",
      value: toPercent(summary.optimizedPrimarySlaRate),
      tone: getRateTone(summary.optimizedPrimarySlaRate),
      tooltip: "Primary coverage rate after placing the optimized 3-station network.",
    },
    {
      label: "Expected Coverage",
      value: toPercent(summary.expectedCoverageRate),
      tone: getRateTone(summary.expectedCoverageRate, 0.6, 0.4),
      tooltip: "Availability-aware expected coverage using the MEXCLP-style backup logic.",
    },
    {
      label: "DES Overflow Rate",
      value: toPercent(summary.desOverflowRate),
      tone: getReverseTone(summary.desOverflowRate, 0.03, 0.08),
      tooltip: "Share of simulated incidents that had to spill over because the nearest unit was unavailable.",
    },
    {
      label: "Overflow SLA Delta",
      value: toMinutes(summary.overflowScenarioSlaDeltaMinutes),
      tone: getReverseTone(summary.overflowScenarioSlaDeltaMinutes, 2.5, 5),
      tooltip: "Extra travel time created when the fallback station responds instead of the nearest station.",
    },
  ];
}

function buildCoverageRadiusMeters(speedKmPerMin, slaMinutes) {
  if (typeof speedKmPerMin !== "number") {
    return 0;
  }

  return speedKmPerMin * slaMinutes * 1000;
}

function Tooltip({ text }) {
  return (
    <span className="group relative inline-flex">
      <button
        aria-label={text}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-700 bg-slate-900/70 text-[11px] font-semibold text-slate-300"
        type="button"
      >
        i
      </button>
      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden w-56 -translate-x-1/2 rounded-xl border border-slate-700 bg-slate-950/95 px-3 py-2 text-[12px] leading-5 text-slate-200 shadow-2xl group-hover:block group-focus-within:block">
        {text}
      </span>
    </span>
  );
}

function ProgressBar({ value }) {
  const safeValue = typeof value === "number" ? Math.max(0, Math.min(1, value)) : 0;

  return (
    <div className="flex items-center gap-3">
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full rounded-full transition-all ${getBarTone(safeValue)}`}
          style={{ width: `${safeValue * 100}%` }}
        />
      </div>
      <span className="min-w-14 text-right text-[14px] font-medium text-slate-200">
        {toPercent(safeValue)}
      </span>
    </div>
  );
}

function MetricCard({ label, value, tone, tooltip }) {
  const toneClasses = {
    slate: "border-slate-800 bg-slate-950/80",
    emerald: "border-emerald-900/60 bg-emerald-950/45",
    amber: "border-amber-900/60 bg-amber-950/35",
    red: "border-red-900/60 bg-red-950/35",
  };

  return (
    <article
      className={`flex h-full max-h-20 w-full max-w-[180px] min-w-[160px] flex-col justify-between rounded-2xl border px-3 py-2 shadow-lg ${toneClasses[tone] || toneClasses.slate}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="line-clamp-2 text-[14px] font-medium leading-4 text-slate-300">{label}</span>
        <Tooltip text={tooltip} />
      </div>
      <strong className="text-[24px] font-bold leading-none tracking-tight text-white">{value}</strong>
    </article>
  );
}

function LayerToggle({ active, label, onClick }) {
  return (
    <button
      aria-pressed={active}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-[14px] font-medium transition ${
        active
          ? "border-emerald-400/50 bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-950/30"
          : "border-slate-700 bg-slate-950/70 text-slate-300 hover:border-slate-500"
      }`}
      onClick={onClick}
      type="button"
    >
      <span
        className={`h-2.5 w-2.5 rounded-full ${
          active ? "bg-slate-950" : "bg-slate-500"
        }`}
      />
      {label}
    </button>
  );
}

function StationSummaryCard({ title, rows, kind }) {
  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-950/80 p-3 shadow-xl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[16px] font-semibold text-white">{title}</h3>
        <span className="text-sm text-slate-400">{rows.length} rows</span>
      </div>
      <div className="space-y-2">
        {rows.map((row) => (
          <div
            className="rounded-2xl border border-slate-800/80 bg-slate-900/80 px-3 py-2"
            key={kind === "zone" ? row.zone : row.stationId}
          >
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-white">
                  {kind === "zone" ? row.zone : row.stationId}
                </div>
                <div className="text-sm text-slate-400">
                  {kind === "zone"
                    ? `${row.incidentCount} incidents`
                    : `${row.responses} responses, ${row.overflowResponses} overflow`}
                </div>
              </div>
            </div>
            <ProgressBar value={kind === "zone" ? row.busyProbability : row.utilization} />
          </div>
        ))}
      </div>
    </article>
  );
}

export default function FireSlaPage() {
  const { isLoaded, loadError } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "",
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dataset, setDataset] = useState(null);
  const [selectedAlgorithm, setSelectedAlgorithm] = useState("");
  const [incidentOverlayOpen, setIncidentOverlayOpen] = useState(true);
  const [layers, setLayers] = useState({
    existing: true,
    optimized: true,
    hotspots: true,
    incidents: true,
    radii: true,
    overflow: true,
  });

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
        setSelectedAlgorithm(payload.algorithms?.[0]?.shortName || "");
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
  const mapIncidents = useMemo(() => dataset?.incidents?.slice(0, 180) || [], [dataset]);
  const selectedAlgorithmDetails = useMemo(
    () =>
      dataset?.algorithms?.find((algorithm) => algorithm.shortName === selectedAlgorithm) ||
      dataset?.algorithms?.[0] ||
      null,
    [dataset, selectedAlgorithm]
  );
  const overflowPath = useMemo(() => {
    if (!dataset?.overflowScenario || !dataset?.optimizedStations?.length) {
      return [];
    }

    const fallbackStation = dataset.optimizedStations.find(
      (station) => station.stationId === dataset.overflowScenario.fallbackStationId
    );

    if (!fallbackStation) {
      return [];
    }

    return [
      {
        lat: dataset.overflowScenario.incidentB.lat,
        lng: dataset.overflowScenario.incidentB.lng,
      },
      { lat: fallbackStation.lat, lng: fallbackStation.lng },
    ];
  }, [dataset]);
  const improvementPercent = useMemo(() => {
    if (!dataset?.summary) {
      return null;
    }

    return (dataset.summary.optimizedPrimarySlaRate || 0) - (dataset.summary.historicalSlaRate || 0);
  }, [dataset]);
  const attentionStations = useMemo(() => {
    if (!dataset?.optimizedStations) {
      return [];
    }

    return dataset.optimizedStations
      .map((station) => ({
        ...station,
        overflowRiskPercent: (1 - (station.expectedCoverageRate || 0)) * 100,
      }))
      .filter((station) => station.overflowRiskPercent > 5)
      .sort((left, right) => right.overflowRiskPercent - left.overflowRiskPercent);
  }, [dataset]);

  const toggleLayer = (key) => {
    setLayers((current) => ({ ...current, [key]: !current[key] }));
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 px-4 py-4 text-white">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4">
        <header className="flex flex-col gap-3 rounded-3xl border border-slate-800 bg-slate-950/80 px-4 py-3 shadow-2xl lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-4xl">
            <span className="text-[14px] uppercase tracking-[0.18em] text-emerald-300">
              Fire Coverage Modeling
            </span>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">
              8-Minute Fire SLA and Overflow Dashboard
            </h1>
            <p className="mt-1 max-w-3xl text-[14px] leading-5 text-slate-300">
              A map-first emergency coverage dashboard for optimized station placement, backup
              dispatch behavior, and SLA breach visibility.
            </p>
          </div>
          <nav className="flex flex-wrap gap-2">
            <Link
              className="rounded-full border border-slate-700 bg-slate-950/70 px-4 py-2 text-[14px] text-slate-300 transition hover:border-slate-500"
              href="/"
            >
              City Map
            </Link>
            <Link
              className="rounded-full border border-slate-700 bg-slate-950/70 px-4 py-2 text-[14px] text-slate-300 transition hover:border-slate-500"
              href="/fire"
            >
              Fire Explorer
            </Link>
            <Link
              className="rounded-full border border-emerald-400/40 bg-emerald-500/15 px-4 py-2 text-[14px] font-medium text-emerald-200"
              href="/fire-sla"
            >
              SLA Dashboard
            </Link>
          </nav>
        </header>

        {loading ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-950/80 px-5 py-4 text-[14px] text-slate-300">
            Loading fire SLA analysis...
          </div>
        ) : null}

        {error ? (
          <div className="rounded-2xl border border-red-900/50 bg-red-950/30 px-5 py-4 text-[14px] text-red-200">
            {error}
          </div>
        ) : null}

        {dataset ? (
          <>
            {attentionStations.length > 0 ? (
              <section className="rounded-2xl border border-red-900/50 bg-red-950/30 px-4 py-4 shadow-xl">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[14px] font-semibold uppercase tracking-[0.14em] text-red-200">
                      Attention Required
                    </div>
                    <div className="mt-1 text-[14px] text-red-100">
                      Stations with modeled overflow risk greater than 5%.
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {attentionStations.map((station) => (
                    <div
                      className="rounded-full border border-red-800/60 bg-red-950/60 px-3 py-2 text-[14px] text-red-100"
                      key={station.stationId}
                    >
                      <strong>{station.stationId}</strong> {station.overflowRiskPercent.toFixed(1)}% risk
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="overflow-x-auto">
              <div className="flex min-w-max flex-nowrap gap-2 pb-1">
              {kpis.map((kpi) => (
                <MetricCard
                  key={kpi.label}
                  label={kpi.label}
                  tone={kpi.tone}
                  tooltip={kpi.tooltip}
                  value={kpi.value}
                />
              ))}
              <article className="flex h-full max-h-20 w-full max-w-[180px] min-w-[160px] flex-col justify-between rounded-2xl border border-emerald-900/60 bg-emerald-950/45 px-3 py-2 shadow-lg">
                <div className="flex items-start justify-between gap-2">
                  <span className="line-clamp-2 text-[14px] font-medium leading-4 text-emerald-100">
                    Improvement Signal
                  </span>
                  <Tooltip text="Difference between optimized primary SLA coverage and historical SLA coverage." />
                </div>
                <div className="text-[24px] font-bold leading-none tracking-tight text-white">
                  {toPercent(improvementPercent)}
                </div>
              </article>
              <article className="flex h-full max-h-20 w-full max-w-[180px] min-w-[160px] flex-col justify-between rounded-2xl border border-red-900/60 bg-red-950/35 px-3 py-2 shadow-lg">
                <div className="flex items-start justify-between gap-2">
                  <span className="line-clamp-2 text-[14px] font-medium leading-4 text-red-100">
                    Overflow Risk
                  </span>
                  <Tooltip text="Extra travel time once the nearest station is fully occupied and the fallback station responds." />
                </div>
                <div className="text-[24px] font-bold leading-none tracking-tight text-white">
                  {toMinutes(dataset.summary.overflowScenarioSlaDeltaMinutes)}
                </div>
              </article>
              </div>
            </section>

            <section className="grid items-start gap-4 xl:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
              <aside className="flex flex-col gap-4 xl:sticky xl:top-4">
                <article className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow-xl">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="text-[16px] font-semibold text-white">Algorithms</h2>
                    <Tooltip text="Select an algorithm to view only its explanation instead of showing every method at once." />
                  </div>
                  <div className="space-y-3">
                    <label className="block text-[14px] text-slate-300" htmlFor="algorithm-select">
                      Selected method
                    </label>
                    <select
                      className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-3 py-3 text-[14px] text-white outline-none"
                      id="algorithm-select"
                      onChange={(event) => setSelectedAlgorithm(event.target.value)}
                      value={selectedAlgorithm}
                    >
                      {dataset.algorithms.map((algorithm) => (
                        <option key={algorithm.shortName} value={algorithm.shortName}>
                          {algorithm.shortName} - {algorithm.longName}
                        </option>
                      ))}
                    </select>
                    {selectedAlgorithmDetails ? (
                      <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
                        <div className="text-[14px] font-semibold text-white">
                          {selectedAlgorithmDetails.shortName}
                        </div>
                        <div className="mt-1 text-[14px] text-slate-400">
                          {selectedAlgorithmDetails.longName}
                        </div>
                        <p className="mt-3 text-[14px] leading-6 text-slate-200">
                          {selectedAlgorithmDetails.usedFor}
                        </p>
                        <p className="mt-2 text-[14px] leading-6 text-slate-400">
                          {selectedAlgorithmDetails.whyChosen}
                        </p>
                      </div>
                    ) : null}
                  </div>
                </article>

                <article className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow-xl">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="text-[16px] font-semibold text-white">Visible Layers</h2>
                    <Tooltip text="Use solid buttons for active layers and outline buttons for hidden layers." />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {layerDefinitions.map((layer) => (
                      <LayerToggle
                        active={layers[layer.key]}
                        key={layer.key}
                        label={layer.label}
                        onClick={() => toggleLayer(layer.key)}
                      />
                    ))}
                  </div>
                </article>

                <article className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow-xl">
                  <h2 className="mb-3 text-[16px] font-semibold text-white">Simulation Summary</h2>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3 text-[14px] text-slate-300">
                      <span>Incidents simulated</span>
                      <strong className="text-white">{dataset.desSimulation.incidentsSimulated}</strong>
                    </div>
                    <div className="flex items-center justify-between gap-3 text-[14px] text-slate-300">
                      <span>DES SLA met</span>
                      <strong className="text-white">{toPercent(dataset.desSimulation.slaMetRate)}</strong>
                    </div>
                    <div className="flex items-center justify-between gap-3 text-[14px] text-slate-300">
                      <span>Average response</span>
                      <strong className="text-white">
                        {toMinutes(dataset.desSimulation.averageResponseMinutes)}
                      </strong>
                    </div>
                    <div className="flex items-center justify-between gap-3 text-[14px] text-slate-300">
                      <span>Overflow rate</span>
                      <strong className="text-white">
                        {toPercent(dataset.desSimulation.overflowIncidentRate)}
                      </strong>
                    </div>
                  </div>
                </article>
              </aside>

              <div className="flex flex-col gap-4">
                <article className="rounded-3xl border border-slate-800 bg-slate-950/80 p-4 shadow-2xl">
                  <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <h2 className="text-[18px] font-semibold text-white">Coverage Map</h2>
                      <p className="mt-1 text-[14px] leading-6 text-slate-400">
                        Existing stations are neutral grey, optimized placements are emerald, and
                        red is reserved only for breaches or high-risk outcomes.
                      </p>
                    </div>
                  </div>

                  <div className="relative h-[62vh] min-h-[560px] overflow-hidden rounded-3xl border border-slate-800 bg-slate-950">
                    {!isLoaded || loadError ? (
                      <div className="grid h-full place-items-center px-6 text-center text-[14px] text-slate-300">
                        {loadError
                          ? "Google Maps could not load. KPI and algorithm results are still available."
                          : "Loading map..."}
                      </div>
                    ) : (
                      <>
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
                          {Boolean(layers.hotspots)
                            ? dataset.hotspots.map((hotspot) => (
                                <Circle
                                  center={{ lat: hotspot.lat, lng: hotspot.lng }}
                                  key={hotspot.id}
                                  options={{
                                    fillColor: "#f59e0b",
                                    fillOpacity: 0.12 + hotspot.intensity * 0.18,
                                    strokeColor: "#fbbf24",
                                    strokeOpacity: 0.38,
                                    strokeWeight: 1,
                                  }}
                                  radius={650 + hotspot.intensity * 700}
                                />
                              ))
                            : null}

                          {Boolean(layers.radii)
                            ? dataset.optimizedStations.map((station) => (
                                <Circle
                                  center={{ lat: station.lat, lng: station.lng }}
                                  key={`radius-${station.stationId}`}
                                  options={{
                                    fillColor: "#34d399",
                                    fillOpacity: 0.08,
                                    strokeColor: "#34d399",
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

                          {Boolean(layers.incidents)
                            ? mapIncidents.map((incident) => (
                                <Circle
                                  center={{ lat: incident.lat, lng: incident.lng }}
                                  key={incident.incidentId}
                                  options={{
                                    fillColor: incident.optimizedSlaMet ? "#f59e0b" : "#ef4444",
                                    fillOpacity: 0.72,
                                    strokeColor: "#ffffff",
                                    strokeOpacity: 0.15,
                                    strokeWeight: 1,
                                  }}
                                  radius={48}
                                />
                              ))
                            : null}

                          {Boolean(layers.existing)
                            ? dataset.existingStations.map((station) => (
                                <Marker
                                  key={station.stationId}
                                  position={{ lat: station.lat, lng: station.lng }}
                                  title={`${station.stationId} | Existing station`}
                                  icon={{
                                    path: window.google.maps.SymbolPath.CIRCLE,
                                    fillColor: "#94a3b8",
                                    fillOpacity: 0.96,
                                    strokeColor: "#0f172a",
                                    strokeWeight: 1.5,
                                    scale: 6,
                                  }}
                                />
                              ))
                            : null}

                          {Boolean(layers.optimized)
                            ? dataset.optimizedStations.map((station) => (
                                <Marker
                                  key={station.stationId}
                                  position={{ lat: station.lat, lng: station.lng }}
                                  title={`${station.stationId} | ${station.stationName}`}
                                  icon={{
                                    path: window.google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                                    fillColor: "#34d399",
                                    fillOpacity: 1,
                                    strokeColor: "#ecfdf5",
                                    strokeWeight: 1.1,
                                    scale: 6,
                                  }}
                                />
                              ))
                            : null}

                          {Boolean(layers.overflow) ? (
                            <>
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
                                    ? "#34d399"
                                    : "#ef4444",
                                  strokeOpacity: 0.96,
                                  strokeWeight: 3.2,
                                }}
                                path={overflowPath}
                              />
                            </>
                          ) : null}
                        </GoogleMap>

                        <div className="absolute left-3 top-3 z-10 w-[320px] max-w-[calc(100%-24px)] rounded-2xl border border-slate-800 bg-slate-950/92 shadow-2xl backdrop-blur">
                          <button
                            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                            onClick={() => setIncidentOverlayOpen((value) => !value)}
                            type="button"
                          >
                            <div>
                              <div className="text-[14px] font-semibold text-white">Incident Details</div>
                              <div className="text-[14px] text-slate-400">
                                Overflow pair and backup dispatch outcome
                              </div>
                            </div>
                            <span className="text-[14px] text-slate-300">
                              {incidentOverlayOpen ? "Hide" : "Show"}
                            </span>
                          </button>

                          {incidentOverlayOpen ? (
                            <div className="space-y-3 border-t border-slate-800 px-4 py-4 text-[14px]">
                              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3">
                                <div className="font-medium text-white">
                                  {dataset.overflowScenario.incidentA.incidentId}
                                </div>
                                <div className="mt-1 text-slate-400">
                                  Primary fire drawing two units from {dataset.overflowScenario.primaryStationId}
                                </div>
                              </div>
                              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3">
                                <div className="font-medium text-white">
                                  {dataset.overflowScenario.incidentB.incidentId}
                                </div>
                                <div className="mt-1 text-slate-400">
                                  Overflow incident handled by {dataset.overflowScenario.fallbackStationId}
                                </div>
                              </div>
                              <div className="grid gap-2">
                                <div className="flex items-center justify-between gap-3 text-slate-300">
                                  <span>Primary ETA</span>
                                  <strong className="text-white">
                                    {toMinutes(dataset.overflowScenario.incidentB.primaryStationWouldTakeMinutes)}
                                  </strong>
                                </div>
                                <div className="flex items-center justify-between gap-3 text-slate-300">
                                  <span>Fallback ETA</span>
                                  <strong className="text-white">
                                    {toMinutes(dataset.overflowScenario.incidentB.fallbackStationEtaMinutes)}
                                  </strong>
                                </div>
                                <div className="flex items-center justify-between gap-3 text-slate-300">
                                  <span>SLA outcome</span>
                                  <strong
                                    className={
                                      dataset.overflowScenario.incidentB.slaMetByFallback
                                        ? "text-emerald-300"
                                        : "text-red-300"
                                    }
                                  >
                                    {dataset.overflowScenario.incidentB.slaMetByFallback
                                      ? "Met"
                                      : "Breached"}
                                  </strong>
                                </div>
                              </div>
                            </div>
                          ) : null}
                        </div>

                        <div className="absolute bottom-3 right-3 z-10 w-[320px] max-w-[calc(100%-24px)] rounded-2xl border border-slate-800 bg-slate-950/92 p-4 shadow-2xl backdrop-blur">
                          <div className="mb-3 text-[14px] font-semibold text-white">Interactive Legend</div>
                          <div className="space-y-2">
                            {layerDefinitions.map((layer) => (
                              <button
                                className={`flex w-full items-center justify-between gap-3 rounded-2xl border px-3 py-2 text-left transition ${
                                  layers[layer.key]
                                    ? "border-emerald-400/40 bg-emerald-500/12"
                                    : "border-slate-800 bg-slate-900/70"
                                }`}
                                key={layer.key}
                                onClick={() => toggleLayer(layer.key)}
                                type="button"
                              >
                                <div className="flex min-w-0 items-center gap-3">
                                  <span className={`h-3.5 w-3.5 rounded-full ${layer.swatchClass}`} />
                                  <div className="min-w-0">
                                    <div className="truncate text-[14px] font-medium text-white">
                                      {layer.legendLabel}
                                    </div>
                                    <div className="truncate text-[14px] text-slate-400">
                                      {layer.note}
                                    </div>
                                  </div>
                                </div>
                                <span className="text-[14px] text-slate-300">
                                  {layers[layer.key] ? "Active" : "Off"}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </article>

                <section className="grid gap-4 xl:grid-cols-3">
                  <article className="rounded-2xl border border-slate-800 bg-slate-950/80 p-3 shadow-xl xl:col-span-1">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <h3 className="text-[16px] font-semibold text-white">Optimized Stations</h3>
                      <Tooltip text="Coverage quality of the optimized 3-station layout." />
                    </div>
                    <div className="space-y-2">
                      {dataset.optimizedStations.map((station) => (
                        <div
                          className="rounded-2xl border border-slate-800 bg-slate-900/80 px-3 py-2"
                          key={station.stationId}
                        >
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-medium text-white">{station.stationId}</div>
                              <div className="text-sm text-slate-400">
                                {station.coveredIncidents} incidents
                              </div>
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <div className="text-sm text-slate-400">Primary SLA</div>
                            <ProgressBar value={station.slaCoverageRate} />
                            <div className="text-sm text-slate-400">Expected Coverage</div>
                            <ProgressBar value={station.expectedCoverageRate} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>

                  <div className="xl:col-span-2 grid gap-4 xl:grid-cols-2">
                    <StationSummaryCard
                      kind="zone"
                      rows={dataset.zoneBusyProbabilities.slice(0, 8)}
                      title="Zone Busy Probabilities"
                    />
                    <StationSummaryCard
                      kind="station"
                      rows={dataset.desSimulation.stationUtilization}
                      title="Station Utilization"
                    />
                  </div>
                </section>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
