function toWeightedSamples(items, valueKey = "value", weightKey = "weight") {
  return items
    .map((item) => ({
      value: Number(item[valueKey]),
      weight: Number(item[weightKey]),
    }))
    .filter(
      (item) =>
        Number.isFinite(item.value) &&
        item.value >= 0 &&
        Number.isFinite(item.weight) &&
        item.weight > 0
    );
}

export function calculateWeightedMean(items, valueKey = "value", weightKey = "weight") {
  const samples = toWeightedSamples(items, valueKey, weightKey);

  if (!samples.length) {
    return null;
  }

  const totals = samples.reduce(
    (acc, sample) => {
      acc.weight += sample.weight;
      acc.weightedValue += sample.value * sample.weight;
      return acc;
    },
    { weight: 0, weightedValue: 0 }
  );

  return totals.weight === 0 ? null : totals.weightedValue / totals.weight;
}

export function calculateWeightedGini(items, valueKey = "value", weightKey = "weight") {
  const samples = toWeightedSamples(items, valueKey, weightKey).sort(
    (a, b) => a.value - b.value
  );

  if (!samples.length) {
    return null;
  }

  const totalWeight = samples.reduce((sum, sample) => sum + sample.weight, 0);
  const totalValue = samples.reduce(
    (sum, sample) => sum + sample.value * sample.weight,
    0
  );

  if (totalWeight === 0 || totalValue === 0) {
    return 0;
  }

  let cumulativeWeight = 0;
  let cumulativeShare = 0;
  let area = 0;

  samples.forEach((sample) => {
    const previousWeightShare = cumulativeWeight / totalWeight;
    const previousValueShare = cumulativeShare / totalValue;

    cumulativeWeight += sample.weight;
    cumulativeShare += sample.value * sample.weight;

    const nextWeightShare = cumulativeWeight / totalWeight;
    const nextValueShare = cumulativeShare / totalValue;

    area +=
      (nextWeightShare - previousWeightShare) *
      (previousValueShare + nextValueShare) /
      2;
  });

  return Math.max(0, Math.min(1, 1 - 2 * area));
}

export function calculateWeightedTheil(
  items,
  valueKey = "value",
  weightKey = "weight"
) {
  const samples = toWeightedSamples(items, valueKey, weightKey);

  if (!samples.length) {
    return null;
  }

  const mean = calculateWeightedMean(samples);

  if (!mean || mean <= 0) {
    return 0;
  }

  const totalWeight = samples.reduce((sum, sample) => sum + sample.weight, 0);
  const total = samples.reduce((sum, sample) => {
    if (sample.value === 0) {
      return sum;
    }

    const ratio = sample.value / mean;
    return sum + sample.weight * ratio * Math.log(ratio);
  }, 0);

  return totalWeight === 0 ? 0 : total / totalWeight;
}

export function buildLorenzCurve(items, valueKey = "value", weightKey = "weight") {
  const samples = toWeightedSamples(items, valueKey, weightKey).sort(
    (a, b) => a.value - b.value
  );

  if (!samples.length) {
    return [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  }

  const totalWeight = samples.reduce((sum, sample) => sum + sample.weight, 0);
  const totalValue = samples.reduce(
    (sum, sample) => sum + sample.value * sample.weight,
    0
  );

  if (totalWeight === 0 || totalValue === 0) {
    return [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  }

  let cumulativeWeight = 0;
  let cumulativeValue = 0;
  const points = [{ x: 0, y: 0 }];

  samples.forEach((sample) => {
    cumulativeWeight += sample.weight;
    cumulativeValue += sample.value * sample.weight;
    points.push({
      x: cumulativeWeight / totalWeight,
      y: cumulativeValue / totalValue,
    });
  });

  return points;
}

export function summarizeEquityGroups(items) {
  const groups = items.filter(
    (item) =>
      item &&
      Number.isFinite(item.averageMinutes) &&
      Number.isFinite(item.population) &&
      item.population > 0
  );

  if (!groups.length) {
    return { best: null, worst: null };
  }

  const sorted = [...groups].sort((a, b) => a.averageMinutes - b.averageMinutes);

  return {
    best: sorted[0],
    worst: sorted[sorted.length - 1],
  };
}
