import Link from "next/link";
import { readFile } from "fs/promises";
import path from "path";
import { parseCsv } from "../lib/csv";

async function getMatrixRows() {
  try {
    const filePath = path.join(
      process.cwd(),
      "public",
      "data",
      "incidents-with-matrix.csv"
    );
    const csvText = await readFile(filePath, "utf8");
    return parseCsv(csvText);
  } catch {
    return [];
  }
}

function summarize(rows) {
  const validRows = rows.filter((row) => row.minDurationMinutes);
  const minuteValues = validRows.map((row) => Number(row.minDurationMinutes));

  if (!minuteValues.length) {
    return {
      total: rows.length,
      average: "-",
      fastest: "-",
      slowest: "-",
    };
  }

  const average =
    minuteValues.reduce((sum, value) => sum + value, 0) / minuteValues.length;

  return {
    total: rows.length,
    average: `${average.toFixed(1)} min`,
    fastest: `${Math.min(...minuteValues).toFixed(1)} min`,
    slowest: `${Math.max(...minuteValues).toFixed(1)} min`,
  };
}

export default async function MatrixResultsPage() {
  const rows = await getMatrixRows();
  const summary = summarize(rows);

  return (
    <div className="ua-shellSimple ua-resultsPage">
      <header className="ua-topbar">
        <div className="ua-topbarBrand">
          <div className="ua-eyebrow">Urban Analytics</div>
          <h1>All Matrix Calculations</h1>
          <div className="ua-topbarNav">
            <Link className="ua-navLink" href="/">
              Map
            </Link>
            <Link className="ua-navLink ua-navLinkActive" href="/matrix-results">
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
          </div>
        </div>
      </header>

      <section className="ua-resultsSummary">
        <div className="ua-panel">
          <div className="ua-panelTitle">Summary</div>
          <div className="ua-summaryLine">
            <span>Total incidents</span>
            <strong>{summary.total}</strong>
          </div>
          <div className="ua-summaryLine">
            <span>Average travel time</span>
            <strong>{summary.average}</strong>
          </div>
          <div className="ua-summaryLine">
            <span>Fastest travel time</span>
            <strong>{summary.fastest}</strong>
          </div>
          <div className="ua-summaryLine">
            <span>Slowest travel time</span>
            <strong>{summary.slowest}</strong>
          </div>
        </div>
      </section>

      <section className="ua-panel ua-resultsTablePage">
        <div className="ua-panelTitle">Matrix Calculation Table</div>
        {rows.length > 0 ? (
          <div className="ua-resultsScroll">
            <table className="ua-fullTable">
              <thead>
                <tr>
                  <th>Incident</th>
                  <th>Type</th>
                  <th>Latitude</th>
                  <th>Longitude</th>
                  <th>Nearest Station</th>
                  <th>Station Type</th>
                  <th>Seconds</th>
                  <th>Minutes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.incidentId}>
                    <td>{row.incidentId}</td>
                    <td>{row.type}</td>
                    <td>{row.lat}</td>
                    <td>{row.lng}</td>
                    <td>{row.nearestStationId}</td>
                    <td>{row.nearestStationType}</td>
                    <td>{row.minDurationSeconds}</td>
                    <td>{row.minDurationMinutes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="ua-emptyState">
            Run the matrix from the map page to generate the calculations file.
          </div>
        )}
      </section>
    </div>
  );
}
