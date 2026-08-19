import get from "lodash/get.js";

export type Aggregation =
  | "average"
  | "latest"
  | "sum"
  | "median"
  | `p${number}`;

// array of numbers => single datapoint
export function doAggregation(
  data: Array<number>,
  aggregation: string,
  path = "",
) {
  if (data.length === 1) aggregation = "latest";
  // An empty path makes lodash fall through to the datapoint itself, which
  // is how primitive readings share this code with object readings.
  const values: Array<number> = data.map((datapoint) =>
    get(datapoint, path, datapoint),
  );

  if (aggregation === "latest") {
    return values[values.length - 1];
  } else if (aggregation === "average") {
    return values.reduce((sum, next) => sum + next, 0) / values.length;
  } else if (aggregation === "sum") {
    return values.reduce((sum, next) => sum + next, 0);
  }

  // "median" is p50; "pX" accepts any percentile, integer or fractional.
  const percentile =
    aggregation === "median"
      ? 50
      : Number(/^p([\d.]+)$/.exec(aggregation)?.[1]);

  if (Number.isNaN(percentile) || percentile < 0 || percentile > 100)
    throw new Error(
      `Unsupported aggregation "${aggregation}" for ${data.length} datapoints: ${JSON.stringify(data)}.`,
    );

  // Linear interpolation between closest ranks, matching numpy's default
  // and InfluxDB's PERCENTILE, so aggregated values compare across stores.
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (percentile / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);

  return low === high
    ? sorted[low]
    : sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}
