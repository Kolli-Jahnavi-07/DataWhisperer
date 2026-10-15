import type { ColumnProfile, DatasetProfile } from "../../src/types";

export function col(over: Partial<ColumnProfile> = {}): ColumnProfile {
  return {
    name: "amount", duckdbType: "DOUBLE", kind: "numeric", rows: 1000, nulls: 0, distinct: 950,
    min: "1", max: "500", mean: 120, stddev: 40, q25: 90, median: 118, q75: 150,
    zeros: 0, negatives: 0, outliers: 0, minLength: null, maxLength: null,
    untrimmed: null, numericLikeText: null, patterns: {}, top: [], histogram: [],
    ...over,
  };
}

export function text(over: Partial<ColumnProfile> = {}): ColumnProfile {
  return col({
    name: "status", duckdbType: "VARCHAR", kind: "text", distinct: 3, min: null, max: null,
    mean: null, stddev: null, q25: null, median: null, q75: null, zeros: null, negatives: null, outliers: null,
    minLength: 6, maxLength: 8, untrimmed: 0, numericLikeText: 0,
    top: [{ value: "Approved", count: 600 }, { value: "Declined", count: 300 }, { value: "Pending", count: 100 }],
    ...over,
  });
}

export function dataset(columns: ColumnProfile[], over: Partial<DatasetProfile> = {}): DatasetProfile {
  return { fileName: "Loan Applications.csv", rows: 1000, columns, duplicateRows: 0, elapsedMs: 120, bytes: 50_000, ...over };
}
