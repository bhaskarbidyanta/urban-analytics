import { cellToBoundary, gridDisk } from "h3-js";

function buildH3RingWeights(rows, ringSize = 1) {
  const rowIds = new Set(rows.map((row) => row.id));

  return rows.map((row) => {
    const neighbors = [...gridDisk(row.id, ringSize)]
      .filter((neighborId) => rowIds.has(neighborId))
      .map((neighborId) => ({
        id: neighborId,
        weight: 1,
      }));

    return neighbors.length > 0
      ? neighbors
      : [{ id: row.id, weight: 1 }];
  });
}

function calculateNormalCdf(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const coefficients = [
    0.254829592,
    -0.284496736,
    1.421413741,
    -1.453152027,
    1.061405429,
  ];
  const erf =
    1 -
    (((((coefficients[4] * t + coefficients[3]) * t + coefficients[2]) * t +
      coefficients[1]) *
      t +
      coefficients[0]) *
      t *
      Math.exp(-x * x));

  return 0.5 * (1 + sign * erf);
}

export function classifyHotspot(zScore) {
  if (!Number.isFinite(zScore)) {
    return "not_significant";
  }

  if (zScore >= 2.58) {
    return "hotspot_99";
  }

  if (zScore >= 1.96) {
    return "hotspot_95";
  }

  if (zScore >= 1.65) {
    return "hotspot_90";
  }

  if (zScore <= -2.58) {
    return "coldspot_99";
  }

  if (zScore <= -1.96) {
    return "coldspot_95";
  }

  if (zScore <= -1.65) {
    return "coldspot_90";
  }

  return "not_significant";
}

export function formatHotspotLabel(classification) {
  switch (classification) {
    case "hotspot_99":
      return "Hot spot (99%)";
    case "hotspot_95":
      return "Hot spot (95%)";
    case "hotspot_90":
      return "Hot spot (90%)";
    case "coldspot_99":
      return "Cold spot (99%)";
    case "coldspot_95":
      return "Cold spot (95%)";
    case "coldspot_90":
      return "Cold spot (90%)";
    default:
      return "Not significant";
  }
}

export function getHotspotColor(classification) {
  switch (classification) {
    case "hotspot_99":
      return "#ff3d3d";
    case "hotspot_95":
      return "#ff6767";
    case "hotspot_90":
      return "#ff9c9c";
    case "coldspot_99":
      return "#1ea85a";
    case "coldspot_95":
      return "#44c976";
    case "coldspot_90":
      return "#7de09f";
    default:
      return "#c9c5df";
  }
}

export function getHotspotFillOpacity(classification) {
  return classification === "not_significant" ? 0.14 : 0.3;
}

export function getHotspotBoundary(h3Index) {
  return cellToBoundary(h3Index).map(([lat, lng]) => ({ lat, lng }));
}

export function computeGetisOrdHotspots(rows, options = {}) {
  const ringSize = options.ringSize ?? 1;
  const valueKey = options.valueKey ?? "value";
  const samples = rows
    .map((row) => ({
      ...row,
      value: Number(row[valueKey]),
    }))
    .filter((row) => Number.isFinite(row.value));

  const n = samples.length;

  if (n < 3) {
    return [];
  }

  const mean = samples.reduce((sum, row) => sum + row.value, 0) / n;
  const variance =
    samples.reduce((sum, row) => sum + (row.value - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) {
    return samples.map((row) => ({
      ...row,
      neighbors: [row.id],
      giStar: 0,
      zScore: 0,
      pValue: 1,
      classification: "not_significant",
    }));
  }

  const weightSets = buildH3RingWeights(samples, ringSize);
  const byId = new Map(samples.map((row) => [row.id, row]));

  return samples.map((row, index) => {
    const weights = weightSets[index];
    const sumWij = weights.reduce((sum, item) => sum + item.weight, 0);
    const sumWijSquared = weights.reduce(
      (sum, item) => sum + item.weight * item.weight,
      0
    );
    const localSum = weights.reduce((sum, item) => {
      const neighbor = byId.get(item.id);
      return sum + item.weight * (neighbor?.value ?? 0);
    }, 0);
    const denominator =
      stdDev *
      Math.sqrt(
        Math.max(
          0,
          (n * sumWijSquared - sumWij * sumWij) / Math.max(1, n - 1)
        )
      );
    const zScore =
      denominator === 0 ? 0 : (localSum - mean * sumWij) / denominator;
    const pValue = 2 * (1 - calculateNormalCdf(Math.abs(zScore)));
    const classification = classifyHotspot(zScore);

    return {
      ...row,
      neighbors: weights.map((item) => item.id),
      giStar: zScore,
      zScore,
      pValue,
      classification,
    };
  });
}

export function summarizeHotspots(rows) {
  const counts = {
    hotspots: 0,
    coldspots: 0,
    significant: 0,
    notSignificant: 0,
  };

  rows.forEach((row) => {
    if (row.classification.startsWith("hotspot")) {
      counts.hotspots += 1;
      counts.significant += 1;
    } else if (row.classification.startsWith("coldspot")) {
      counts.coldspots += 1;
      counts.significant += 1;
    } else {
      counts.notSignificant += 1;
    }
  });

  return counts;
}
