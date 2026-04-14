"use client";

import axios from "axios";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  buildLorenzCurve,
  calculateWeightedGini,
  calculateWeightedMean,
  calculateWeightedTheil,
  summarizeEquityGroups,
} from "../lib/equity";
import {
  normalizePopulationCells,
  normalizeStations,
  parseCsv,
} from "../lib/csv";

function getMatrixErrorMessage(error) {
  const status = error?.response?.status;

  if (status === 429) {
    return "OpenRouteService rate limit hit. Wait a bit and try the equity matrix again.";
  }

  return (
    error?.response?.data?.error ||
    error?.message ||
    "Equity matrix run failed."
  );
}

function buildGroupSummaries(cells, key) {
  const groups = new Map();

  cells.forEach((cell) => {
    if (typeof cell.minDuration !== "number") {
      return;
    }

    const id = String(cell[key] ?? "unknown");
    const current =
      groups.get(id) || { id, population: 0, weightedDuration: 0, zones: 0 };

    current.population += cell.population;
    current.weightedDuration += cell.population * cell.minDuration;
    current.zones += 1;
    groups.set(id, current);
  });

  return [...groups.values()]
    .map((group) => ({
      ...group,
      averageMinutes:
        group.population > 0 ? group.weightedDuration / group.population / 60 : null,
    }))
    .sort((a, b) => (b.population || 0) - (a.population || 0));
}

function buildStationSummaries(cells, stations) {
  const grouped = buildGroupSummaries(cells, "nearestStationId");
  const groupedMap = new Map(grouped.map((group) => [String(group.id), group]));

  return stations.map((station) => {
    const key = String(station.id);
    const match = groupedMap.get(key);

    return {
      id: key,
      stationType: station.stationType || station.type || "",
      population: match?.population ?? 0,
      weightedDuration: match?.weightedDuration ?? 0,
      zones: match?.zones ?? 0,
      averageMinutes: match?.averageMinutes ?? null,
    };
  });
}

function formatMetric(value, digits = 2, suffix = "") {
  return typeof value === "number" && !Number.isNaN(value)
    ? `${value.toFixed(digits)}${suffix}`
    : "-";
}

function getEquityInterpretation(gini) {
  if (typeof gini !== "number") {
    return "Run the equity matrix to compute weighted inequality across the synthetic H3 zones.";
  }

  if (gini < 0.2) {
    return "Access is fairly even across the weighted population surface.";
  }

  if (gini < 0.35) {
    return "Access is moderately unequal across zones.";
  }

  return "Access is strongly unequal across zones and station catchments.";
}

function LorenzChart({ points }) {
  const width = 320;
  const height = 220;
  const pad = 26;
  const path = points
    .map((point, index) => {
      const x = pad + point.x * (width - pad * 2);
      const y = height - pad - point.y * (height - pad * 2);
      return `${index ? "L" : "M"} ${x} ${y}`;
    })
    .join(" ");

  return (
    <svg className="ua-lorenzChart" viewBox={`0 0 ${width} ${height}`}>
      <line
        x1={pad}
        y1={height - pad}
        x2={width - pad}
        y2={pad}
        className="ua-lorenzEquality"
      />
      <rect
        x={pad}
        y={pad}
        width={width - pad * 2}
        height={height - pad * 2}
        className="ua-lorenzFrame"
      />
      <path d={path} className="ua-lorenzPath" />
    </svg>
  );
}

export default function EquityPage() {
  const [stations, setStations] = useState([]);
  const [populationCells, setPopulationCells] = useState([]);
  const [populationAccessByCell, setPopulationAccessByCell] = useState({});
  const [populationHeader, setPopulationHeader] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const loadData = async () => {
      try {
        const [stationsRes, populationRes] = await Promise.all([
          fetch("/data/stations.csv"),
          fetch("/data/population-h3.csv"),
        ]);

        if (!stationsRes.ok || !populationRes.ok) {
          throw new Error("Could not load CSV data files.");
        }

        const [stationsText, populationText] = await Promise.all([
          stationsRes.text(),
          populationRes.text(),
        ]);

        setStations(normalizeStations(parseCsv(stationsText)));
        setPopulationCells(normalizePopulationCells(parseCsv(populationText)));
      } catch (loadError) {
        console.error("Failed to load equity data:", loadError);
        setError("Could not load population or station data.");
      }
    };

    loadData();
  }, []);

  const runEquityMatrix = async () => {
    if (!stations.length || !populationCells.length) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await axios.post("/api/matrix", {
        stations,
        incidents: populationCells.map((cell) => ({
          id: cell.id,
          type: "population",
          lat: cell.lat,
          lng: cell.lng,
        })),
        datasetName: "population-h3",
        outputFileName: "population-h3-with-access.csv",
      });

      const nextMatrix = Object.fromEntries(
        (res.data.results || []).map((item) => [item.incidentId, item])
      );
      const durations = (res.data.results || [])
        .map((item) => item.minDuration)
        .filter((value) => typeof value === "number");
      const averageDuration =
        durations.length > 0
          ? durations.reduce((sum, value) => sum + value, 0) / durations.length
          : null;

      setPopulationAccessByCell(nextMatrix);
      setPopulationHeader({
        totalCells: populationCells.length,
        averageMinutes:
          averageDuration == null ? null : (averageDuration / 60).toFixed(1),
        outputFile: res.data.outputFile || null,
      });
    } catch (runError) {
      setError(getMatrixErrorMessage(runError));
      console.error("Equity matrix error:", runError);
    } finally {
      setLoading(false);
    }
  };

  const populationRowsWithAccess = populationCells
    .map((cell) => ({
      ...cell,
      nearestStationId: populationAccessByCell[cell.id]?.nearestStationId ?? null,
      minDuration: populationAccessByCell[cell.id]?.minDuration ?? null,
    }))
    .filter((cell) => typeof cell.minDuration === "number" && cell.population > 0);

  const weightedSamples = populationRowsWithAccess.map((cell) => ({
    value: cell.minDuration / 60,
    weight: cell.population,
  }));
  const weightedGini = calculateWeightedGini(weightedSamples);
  const weightedTheil = calculateWeightedTheil(weightedSamples);
  const weightedMeanMinutes = calculateWeightedMean(weightedSamples);
  const lorenzPoints = buildLorenzCurve(weightedSamples);
  const stationSummaries = buildStationSummaries(populationRowsWithAccess, stations);
  const densitySummaries = buildGroupSummaries(
    populationRowsWithAccess,
    "densityBand"
  );
  const regionSummaries = [...populationRowsWithAccess]
    .map((cell) => ({
      regionName: cell.regionName,
      population: cell.population,
      minutes: cell.minDuration / 60,
    }))
    .sort((a, b) => b.minutes - a.minutes);
  const { best: bestGroup, worst: worstGroup } = summarizeEquityGroups(stationSummaries);
  const servedPopulation = populationRowsWithAccess.reduce(
    (sum, cell) => sum + cell.population,
    0
  );
  const topPopulationGapMinutes =
    bestGroup && worstGroup
      ? Math.max(0, worstGroup.averageMinutes - bestGroup.averageMinutes)
      : null;

  return (
    <div className="ua-shellSimple ua-resultsPage">
      <header className="ua-topbar">
        <div className="ua-topbarBrand">
          <div className="ua-eyebrow">Urban Analytics</div>
          <h1>Spatial Equity Metrics</h1>
          <div className="ua-topbarNav">
            <Link className="ua-navLink" href="/">
              Map
            </Link>
            <Link className="ua-navLink" href="/matrix-results">
              Incident Matrix
            </Link>
            <Link className="ua-navLink ua-navLinkActive" href="/equity">
              Equity Analytics
            </Link>
            <Link className="ua-navLink" href="/hotspots">
              Hotspots
            </Link>
          </div>
        </div>

        <div className="ua-topbarActions">
          <button className="ua-button" onClick={runEquityMatrix} disabled={loading}>
            {loading ? "Running Equity Matrix..." : "Run Equity Matrix"}
          </button>
        </div>
      </header>

      {error ? (
        <section className="ua-panel">
          <div className="ua-panelTitle">Matrix Status</div>
          <div className="ua-emptyState">{error}</div>
        </section>
      ) : null}

      <section className="ua-equitySection">
        <div className="ua-equityHeader">
          <div className="ua-equityStep">09</div>
          <div>
            <div className="ua-eyebrow">Equity Analytics</div>
            <h2>Spatial Equity Metrics · Gini & Theil Index</h2>
          </div>
        </div>

        <div className="ua-purposeCard">
          <div className="ua-cardKicker">Purpose</div>
          <p>
            Quantify how unequally distributed emergency access is across the
            population using weighted H3 zones around Mumbai.
          </p>
        </div>

        <div className="ua-equityGrid">
          <article className="ua-equityCard">
            <div className="ua-cardKicker">What It Does</div>
            <ul className="ua-bulletList">
              <li>Computes weighted Gini where 0 is equal access and 1 is concentrated disadvantage.</li>
              <li>Computes weighted Theil to capture entropy-style inequality in access times.</li>
              <li>Uses synthetic population in H3 cells so dense inner-city zones count more than fringe areas.</li>
            </ul>
          </article>

          <article className="ua-equityCard">
            <div className="ua-cardKicker">Theory</div>
            <ul className="ua-bulletList">
              <li>Lorenz curve compares cumulative population against cumulative response-time burden.</li>
              <li>Theil grows as zone response times drift away from the weighted mean.</li>
              <li>Station grouping shows which catchments carry the highest weighted delay.</li>
            </ul>
          </article>

          <article className="ua-equityCard ua-equityCardFormula">
            <div className="ua-cardKicker">Key Formula</div>
            <div className="ua-formulaBox">
              <div>Weighted Gini = 1 - 2 x area under Lorenz curve</div>
              <div>Weighted Theil = sum of w_i x (y_i / y_bar) x ln(y_i / y_bar) divided by sum of w_i</div>
            </div>
            <p className="ua-formulaNote">
              y_i is nearest-station response time for one H3 cell and w_i is the
              synthetic population of that cell.
            </p>
          </article>
        </div>

        <div className="ua-kpiRow">
          <div className="ua-kpiCard">
            <span>Weighted Gini</span>
            <strong>{formatMetric(weightedGini)}</strong>
          </div>
          <div className="ua-kpiCard">
            <span>Weighted Theil</span>
            <strong>{formatMetric(weightedTheil)}</strong>
          </div>
          <div className="ua-kpiCard">
            <span>Mean Response</span>
            <strong>{formatMetric(weightedMeanMinutes, 1, " min")}</strong>
          </div>
          <div className="ua-kpiCard">
            <span>Served Population</span>
            <strong>{servedPopulation.toLocaleString()}</strong>
          </div>
        </div>

        <div className="ua-equityInsights">
          <article className="ua-insightCard">
            <div className="ua-cardKicker">Lorenz Curve</div>
            <LorenzChart points={lorenzPoints} />
          </article>

          <article className="ua-insightCard">
            <div className="ua-cardKicker">Applied In This Prototype</div>
            <p>{getEquityInterpretation(weightedGini)}</p>
            <div className="ua-summaryStack">
              <div className="ua-summaryLine">
                Population zones with access:
                <strong>{populationRowsWithAccess.length}</strong>
              </div>
              <div className="ua-summaryLine">
                Average route time:
                <strong>{populationHeader?.averageMinutes ?? "-"}</strong>
              </div>
              <div className="ua-summaryLine">
                Best catchment:
                <strong>{bestGroup ? `S${bestGroup.id}` : "-"}</strong>
              </div>
              <div className="ua-summaryLine">
                Worst catchment:
                <strong>{worstGroup ? `S${worstGroup.id}` : "-"}</strong>
              </div>
              <div className="ua-summaryLine">
                Catchment gap:
                <strong>
                  {topPopulationGapMinutes == null
                    ? "-"
                    : `${topPopulationGapMinutes.toFixed(1)} min`}
                </strong>
              </div>
              <div className="ua-summaryLine">
                Output file:
                <strong>{populationHeader?.outputFile || "-"}</strong>
              </div>
            </div>
          </article>
        </div>

        <article className="ua-insightCard ua-insightCardWide">
          <div className="ua-cardKicker">Region Response Times</div>
          {regionSummaries.length > 0 ? (
            <div className="ua-table">
              {regionSummaries.map((region) => (
                <div key={region.regionName} className="ua-tableRow">
                  <span>{region.regionName}</span>
                  <span>{region.population.toLocaleString()} people</span>
                  <strong>{formatMetric(region.minutes, 1, " min")}</strong>
                </div>
              ))}
            </div>
          ) : (
            <div className="ua-emptyState">
              Run the equity matrix to see average response time by region.
            </div>
          )}
        </article>

        <div className="ua-equityTables">
          <article className="ua-insightCard">
            <div className="ua-cardKicker">Station Catchments</div>
            <div className="ua-table">
                {stationSummaries.map((group) => (
                  <div key={group.id} className="ua-tableRow">
                    <span>
                      Station {group.id}
                      {group.stationType ? ` (${group.stationType})` : ""}
                    </span>
                    <span>{group.population.toLocaleString()} people</span>
                    <strong>{formatMetric(group.averageMinutes, 1, " min")}</strong>
                  </div>
                ))}
              </div>
            </article>

          <article className="ua-insightCard">
            <div className="ua-cardKicker">Density Bands</div>
            <div className="ua-table">
              {densitySummaries.map((group) => (
                <div key={group.id} className="ua-tableRow">
                  <span>{group.id.replaceAll("_", " ")}</span>
                  <span>{group.population.toLocaleString()} people</span>
                  <strong>{formatMetric(group.averageMinutes, 1, " min")}</strong>
                </div>
              ))}
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}
