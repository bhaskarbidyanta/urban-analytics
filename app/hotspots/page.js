"use client";

import axios from "axios";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  computeGetisOrdHotspots,
  formatHotspotLabel,
  summarizeHotspots,
} from "../lib/hotspots";
import {
  normalizePopulationCells,
  normalizeStations,
  parseCsv,
} from "../lib/csv";

function getMatrixErrorMessage(error) {
  const status = error?.response?.status;

  if (status === 429) {
    return "OpenRouteService rate limit hit. Wait a bit and try the hotspot matrix again.";
  }

  return (
    error?.response?.data?.error ||
    error?.message ||
    "Hotspot matrix run failed."
  );
}

function formatMetric(value, digits = 2, suffix = "") {
  return typeof value === "number" && !Number.isNaN(value)
    ? `${value.toFixed(digits)}${suffix}`
    : "-";
}

function getHotspotInterpretation(summary, strongestHotspot) {
  if (!summary.significant) {
    return "No statistically significant hot or cold spots are detected in the current H3 response-time surface.";
  }

  if (strongestHotspot) {
    return `${strongestHotspot.regionName} stands out as the strongest high-response-time cluster in this first-pass Gi* analysis.`;
  }

  return "The current H3 response-time surface contains statistically significant hot and cold spot structure.";
}

export default function HotspotsPage() {
  const ringSize = 1;
  const [stations, setStations] = useState([]);
  const [populationCells, setPopulationCells] = useState([]);
  const [accessByCell, setAccessByCell] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fileLoaded, setFileLoaded] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [stationsRes, populationRes, accessRes] = await Promise.all([
          fetch("/data/stations.csv"),
          fetch("/data/population-h3.csv"),
          fetch("/data/population-h3-with-access.csv"),
        ]);

        if (!stationsRes.ok || !populationRes.ok) {
          throw new Error("Could not load CSV data files.");
        }

        const [stationsText, populationText, accessText] = await Promise.all([
          stationsRes.text(),
          populationRes.text(),
          accessRes.ok ? accessRes.text() : Promise.resolve(""),
        ]);

        setStations(normalizeStations(parseCsv(stationsText)));
        setPopulationCells(normalizePopulationCells(parseCsv(populationText)));

        if (accessText) {
          const accessRows = parseCsv(accessText);
          const nextAccess = Object.fromEntries(
            accessRows.map((row) => [
              row.incidentId,
              {
                nearestStationId: row.nearestStationId || null,
                nearestStationType: row.nearestStationType || null,
                minDuration: Number(row.minDurationSeconds),
              },
            ])
          );
          setAccessByCell(nextAccess);
          setFileLoaded(true);
        }
      } catch (loadError) {
        console.error("Failed to load hotspot data:", loadError);
        setError("Could not load hotspot source data.");
      }
    };

    loadData();
  }, []);

  const runHotspotMatrix = async () => {
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

      const nextAccess = Object.fromEntries(
        (res.data.results || []).map((item) => [
          item.incidentId,
          {
            nearestStationId: item.nearestStationId ?? null,
            nearestStationType: item.nearestStationType ?? null,
            minDuration: item.minDuration ?? null,
          },
        ])
      );

      setAccessByCell(nextAccess);
      setFileLoaded(true);
    } catch (runError) {
      setError(getMatrixErrorMessage(runError));
      console.error("Hotspot matrix error:", runError);
    } finally {
      setLoading(false);
    }
  };

  const hotspotRows = useMemo(() => {
    const joined = populationCells
      .map((cell) => ({
        ...cell,
        nearestStationId: accessByCell[cell.id]?.nearestStationId ?? null,
        minDuration: accessByCell[cell.id]?.minDuration ?? null,
      }))
      .filter((cell) => typeof cell.minDuration === "number" && cell.minDuration > 0)
      .map((cell) => ({
        id: cell.id,
        regionName: cell.regionName,
        densityBand: cell.densityBand,
        population: cell.population,
        lat: cell.lat,
        lng: cell.lng,
        nearestStationId: cell.nearestStationId,
        value: cell.minDuration / 60,
      }));

    return computeGetisOrdHotspots(joined, { ringSize, valueKey: "value" })
      .map((row) => ({
        ...row,
        label: formatHotspotLabel(row.classification),
      }))
      .sort((a, b) => b.zScore - a.zScore);
  }, [accessByCell, populationCells, ringSize]);

  const hotspotSummary = summarizeHotspots(hotspotRows);
  const strongestHotspot = hotspotRows.find((row) =>
    row.classification.startsWith("hotspot")
  );
  const strongestColdspot = [...hotspotRows]
    .reverse()
    .find((row) => row.classification.startsWith("coldspot"));
  const significantRows = hotspotRows.filter(
    (row) => row.classification !== "not_significant"
  );
  const hotspotBands = [
    ["Hot spot (99%)", hotspotRows.filter((row) => row.classification === "hotspot_99")],
    ["Hot spot (95%)", hotspotRows.filter((row) => row.classification === "hotspot_95")],
    ["Hot spot (90%)", hotspotRows.filter((row) => row.classification === "hotspot_90")],
    ["Cold spot (90-99%)", hotspotRows.filter((row) => row.classification.startsWith("coldspot"))],
  ].filter(([, rows]) => rows.length > 0);

  return (
    <div className="ua-shellSimple ua-resultsPage">
      <header className="ua-topbar">
        <div className="ua-topbarBrand">
          <div className="ua-eyebrow">Urban Analytics</div>
          <h1>Hotspot Analysis</h1>
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
            <Link className="ua-navLink ua-navLinkActive" href="/hotspots">
              Hotspots
            </Link>
            <Link className="ua-navLink" href="/fire">
              Fire Analytics
            </Link>
          </div>
        </div>

        <div className="ua-topbarActions">
          <button className="ua-button" onClick={runHotspotMatrix} disabled={loading}>
            {loading ? "Running Hotspot Matrix..." : "Refresh Hotspot Input"}
          </button>
        </div>
      </header>

      {error ? (
        <section className="ua-panel">
          <div className="ua-panelTitle">Matrix Status</div>
          <div className="ua-emptyState">{error}</div>
        </section>
      ) : null}

      <section className="ua-hotspotSection">
        <div className="ua-hotspotHeader">
          <div className="ua-hotspotStep">10</div>
          <div>
            <div className="ua-eyebrow ua-eyebrowHotspot">Hotspot Detection</div>
            <h2>Hotspot Analysis · Getis-Ord Gi*</h2>
          </div>
        </div>

        <div className="ua-hotspotPurpose">
          <div className="ua-cardKicker ua-cardKickerHotspot">Purpose</div>
          <p>
            Identify statistically significant spatial clusters of high or low response
            times across the population-weighted H3 zones.
          </p>
        </div>

        <div className="ua-hotspotGrid">
          <article className="ua-hotspotCard">
            <div className="ua-cardKicker ua-cardKickerHotspot">What It Does</div>
            <ul className="ua-bulletList">
              <li>Produces a Gi* z-score and p-value for each H3 zone.</li>
              <li>Flags high-response-time clusters as hot spots and low-response-time clusters as cold spots.</li>
              <li>Moves beyond visual inspection to a neighborhood-based significance test.</li>
            </ul>
          </article>

          <article className="ua-hotspotCard">
            <div className="ua-cardKicker ua-cardKickerHotspot">Theory</div>
            <ul className="ua-bulletList">
              <li>Each zone is compared with its true H3 ring-{ringSize} neighbors using a local Gi* statistic.</li>
              <li>Positive z-scores indicate unusually high local response-time clusters.</li>
              <li>Negative z-scores indicate unusually low local response-time clusters.</li>
            </ul>
          </article>

          <article className="ua-hotspotCard ua-hotspotFormula">
            <div className="ua-cardKicker ua-cardKickerHotspot">Key Formula</div>
            <div className="ua-formulaBox">
              <div>Gi* compares the local weighted sum around one zone against the global mean.</div>
              <div>This version uses true H3 ring neighbors instead of distance-based approximations.</div>
            </div>
            <p className="ua-formulaNote">
              Response time is the hotspot variable, so positive Gi* means locally elevated delays.
            </p>
          </article>
        </div>

        <div className="ua-kpiRow">
          <div className="ua-kpiCard ua-kpiCardHotspot">
            <span>Significant Hot Spots</span>
            <strong>{hotspotSummary.hotspots}</strong>
          </div>
          <div className="ua-kpiCard ua-kpiCardHotspot">
            <span>Significant Cold Spots</span>
            <strong>{hotspotSummary.coldspots}</strong>
          </div>
          <div className="ua-kpiCard ua-kpiCardHotspot">
            <span>Strongest Hot Spot</span>
            <strong>{strongestHotspot?.regionName || "-"}</strong>
          </div>
          <div className="ua-kpiCard ua-kpiCardHotspot">
            <span>Input File</span>
            <strong>{fileLoaded ? "population-h3-with-access.csv" : "-"}</strong>
          </div>
        </div>

        <div className="ua-equityInsights">
          <article className="ua-insightCard">
            <div className="ua-cardKicker ua-cardKickerHotspot">Applied In This Prototype</div>
            <p>{getHotspotInterpretation(hotspotSummary, strongestHotspot)}</p>
            <div className="ua-summaryStack">
              <div className="ua-summaryLine">
                Significant clusters:
                <strong>{hotspotSummary.significant}</strong>
              </div>
              <div className="ua-summaryLine">
                Neighborhood rule:
                <strong>H3 ring-{ringSize}</strong>
              </div>
              <div className="ua-summaryLine">
                Strongest hot spot Gi* z-score:
                <strong>{formatMetric(strongestHotspot?.giStar)}</strong>
              </div>
              <div className="ua-summaryLine">
                Strongest cold spot:
                <strong>{strongestColdspot?.regionName || "-"}</strong>
              </div>
              <div className="ua-summaryLine">
                Strongest cold spot Gi* z-score:
                <strong>{formatMetric(strongestColdspot?.giStar)}</strong>
              </div>
            </div>
          </article>

          <article className="ua-insightCard">
            <div className="ua-cardKicker ua-cardKickerHotspot">Hotspot Bands</div>
            <div className="ua-table">
              {hotspotBands.map(([label, rows]) => (
                <div key={label} className="ua-tableRow">
                  <span>{label}</span>
                  <span>{rows.length} zones</span>
                  <strong>
                    {rows[0] ? rows[0].regionName : "-"}
                  </strong>
                </div>
              ))}
            </div>
          </article>
        </div>

        <article className="ua-insightCard ua-insightCardWide">
          <div className="ua-cardKicker ua-cardKickerHotspot">Hotspot Regions</div>
          {significantRows.length > 0 ? (
            <div className="ua-table ua-tableCompactHead">
              <div className="ua-tableHead ua-tableHeadHotspot">
                <span>Region</span>
                <span>Class</span>
                <span>Gi* z-score</span>
              </div>
              {significantRows.map((row) => (
                <div key={row.id} className="ua-tableRow">
                  <span>{row.regionName}</span>
                  <span>{row.label}</span>
                  <strong>{formatMetric(row.giStar)}</strong>
                </div>
              ))}
            </div>
          ) : (
            <div className="ua-emptyState">
              Refresh the hotspot input to compute Gi* scores for the H3 zones.
            </div>
          )}
        </article>

        <div className="ua-equityTables">
          <article className="ua-insightCard">
            <div className="ua-cardKicker ua-cardKickerHotspot">All Regions</div>
            <div className="ua-table ua-tableCompactHead">
              <div className="ua-tableHead ua-tableHeadHotspot">
                <span>Region</span>
                <span>Response time</span>
                <span>Gi* z-score</span>
              </div>
              {hotspotRows.map((row) => (
                <div key={row.id} className="ua-tableRow">
                  <span>{row.regionName}</span>
                  <span>{formatMetric(row.value, 1, " min")}</span>
                  <strong>{formatMetric(row.giStar)}</strong>
                </div>
              ))}
            </div>
          </article>

          <article className="ua-insightCard">
            <div className="ua-cardKicker ua-cardKickerHotspot">Neighbor Context</div>
            <div className="ua-table ua-tableCompactHead">
              <div className="ua-tableHead ua-tableHeadHotspot">
                <span>Region</span>
                <span>H3 neighbors</span>
                <span>p-value</span>
              </div>
              {hotspotRows.slice(0, 8).map((row) => (
                <div key={row.id} className="ua-tableRow">
                  <span>{row.regionName}</span>
                  <span>{row.neighbors.length} neighbors</span>
                  <strong>{formatMetric(row.pValue, 3)}</strong>
                </div>
              ))}
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}
