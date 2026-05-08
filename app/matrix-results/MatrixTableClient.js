"use client";

import { useMemo, useState } from "react";

const ROW_HEIGHT = 36;
const VIEWPORT_HEIGHT = 620;
const OVERSCAN = 12;

function getMinuteTone(minutes) {
  if (minutes <= 5) {
    return "bg-emerald-500/15 text-emerald-200";
  }

  if (minutes >= 10) {
    return "bg-red-500/15 text-red-200";
  }

  return "bg-amber-500/15 text-amber-200";
}

export default function MatrixTableClient({ rows }) {
  const [scrollTop, setScrollTop] = useState(0);

  const totalHeight = rows.length * ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT) + OVERSCAN * 2;
  const endIndex = Math.min(rows.length, startIndex + visibleCount);

  const visibleRows = useMemo(
    () => rows.slice(startIndex, endIndex),
    [endIndex, rows, startIndex]
  );

  return (
    <div className="rounded-2xl border border-white/8 bg-[#0b101d]">
      <div className="grid grid-cols-[1.1fr_0.7fr_0.9fr_0.9fr_0.9fr_0.9fr_0.8fr_0.8fr] gap-3 border-b border-white/8 bg-[#10172a] px-3 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400 sticky top-0 z-10">
        <span>Incident</span>
        <span>Type</span>
        <span>Latitude</span>
        <span>Longitude</span>
        <span>Nearest Station</span>
        <span>Station Type</span>
        <span>Seconds</span>
        <span>Minutes</span>
      </div>

      <div
        className="overflow-auto"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        style={{ height: VIEWPORT_HEIGHT }}
      >
        <div style={{ height: totalHeight, position: "relative" }}>
          <div
            style={{
              position: "absolute",
              top: startIndex * ROW_HEIGHT,
              left: 0,
              right: 0,
            }}
          >
            {visibleRows.map((row) => {
              const minutes = Number(row.minDurationMinutes);
              const seconds = Number(row.minDurationSeconds);

              return (
                <div
                  className="grid grid-cols-[1.1fr_0.7fr_0.9fr_0.9fr_0.9fr_0.9fr_0.8fr_0.8fr] gap-3 border-b border-white/6 px-3 py-2 text-[12px] text-slate-200"
                  key={row.incidentId}
                  style={{ height: ROW_HEIGHT }}
                >
                  <span className="truncate">{row.incidentId}</span>
                  <span className="truncate capitalize">{row.type}</span>
                  <span className="font-mono text-[11px] text-slate-300">{row.lat}</span>
                  <span className="font-mono text-[11px] text-slate-300">{row.lng}</span>
                  <span className="truncate">{row.nearestStationId}</span>
                  <span className="truncate">{row.nearestStationType}</span>
                  <span
                    className={`rounded-md px-2 py-1 text-right font-semibold ${getMinuteTone(
                      seconds / 60
                    )}`}
                  >
                    {row.minDurationSeconds}
                  </span>
                  <span
                    className={`rounded-md px-2 py-1 text-right font-semibold ${getMinuteTone(
                      minutes
                    )}`}
                  >
                    {row.minDurationMinutes}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
