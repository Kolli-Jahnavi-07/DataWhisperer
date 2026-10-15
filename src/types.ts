/** Shapes shared by the profiler, the rule engine, the exporters and the UI. */

export type Kind = "numeric" | "text" | "temporal" | "boolean";

export type Pattern = "email" | "phone" | "url" | "uuid" | "zip" | "ip";

export interface HistogramBin {
  lo: number;
  hi: number;
  count: number;
}

export interface TopValue {
  value: string;
  count: number;
}

export interface ColumnProfile {
  name: string;
  /** DuckDB type inferred from the file, e.g. BIGINT, DOUBLE, VARCHAR, DATE */
  duckdbType: string;
  kind: Kind;
  rows: number;
  nulls: number;
  distinct: number;
  /** min/max as display strings (works for numbers, dates and text) */
  min: string | null;
  max: string | null;
  mean: number | null;
  stddev: number | null;
  q25: number | null;
  median: number | null;
  q75: number | null;
  zeros: number | null;
  negatives: number | null;
  /** values outside 1.5 x IQR from the quartiles */
  outliers: number | null;
  minLength: number | null;
  maxLength: number | null;
  /** text values with leading or trailing spaces */
  untrimmed: number | null;
  /** text columns that look numeric or temporal but were read as text */
  numericLikeText: number | null;
  patterns: Partial<Record<Pattern, number>>;
  top: TopValue[];
  histogram: HistogramBin[];
}

export interface DatasetProfile {
  fileName: string;
  rows: number;
  columns: ColumnProfile[];
  duplicateRows: number;
  /** wall-clock time to load and profile, in milliseconds */
  elapsedMs: number;
  bytes: number;
}

export type Severity = "critical" | "warning" | "info";

export interface Finding {
  severity: Severity;
  column: string | null;
  rule: string;
  title: string;
  detail: string;
}
