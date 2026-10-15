/**
 * Profiling engine. Every statistic is computed by SQL that DuckDB runs over the
 * whole file (no sampling), so numbers match what a warehouse query would return.
 *
 * The SQL builders are pure functions (exported for unit tests); `profileFile`
 * runs them against DuckDB-WASM.
 */
import type { AsyncDuckDB, AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { query, type Row } from "./db";
import type { ColumnProfile, DatasetProfile, HistogramBin, Kind, Pattern } from "./types";

export const TABLE = "dataset";
export const HISTOGRAM_BINS = 24;

/** Regexes for common semantic types (full-match on the trimmed value). */
export const PATTERNS: Record<Pattern, string> = {
  email: "^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$",
  phone: "^\\+?[0-9][0-9 ().-]{7,}[0-9]$",
  url: "^https?://[^ ]+$",
  uuid: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
  zip: "^[0-9]{5}(-[0-9]{4})?$",
  ip: "^([0-9]{1,3}\\.){3}[0-9]{1,3}$",
};

export function ident(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export function literal(s: string): string {
  return `'${s.replaceAll("'", "''")}'`;
}

export function kindOf(duckdbType: string): Kind {
  const t = duckdbType.toUpperCase();
  if (t === "BOOLEAN") return "boolean";
  if (/^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|FLOAT|REAL|DOUBLE|DECIMAL)/.test(t)) return "numeric";
  if (/^(DATE|TIME|TIMESTAMP)/.test(t)) return "temporal";
  return "text";
}

// ---------------------------------------------------------------- SQL builders
export function loadSql(fileName: string): string {
  // sample_size = -1: infer types from every row, so a late "N/A" can't break a numeric column silently
  return `CREATE OR REPLACE TABLE ${TABLE} AS
SELECT * FROM read_csv(${literal(fileName)}, auto_detect = true, header = true, sample_size = -1)`;
}

export function baseStatsSql(col: string, kind: Kind): string {
  const c = ident(col);
  const common = `count(*) AS rows, count(*) - count(${c}) AS nulls, count(DISTINCT ${c}) AS distinct_values`;
  if (kind === "numeric") {
    return `SELECT ${common},
  CAST(min(${c}) AS VARCHAR) AS min_value, CAST(max(${c}) AS VARCHAR) AS max_value,
  avg(${c}) AS mean, stddev_samp(${c}) AS stddev,
  quantile_cont(${c}, 0.25) AS q25, quantile_cont(${c}, 0.5) AS median, quantile_cont(${c}, 0.75) AS q75,
  count(*) FILTER (WHERE ${c} = 0) AS zeros, count(*) FILTER (WHERE ${c} < 0) AS negatives
FROM ${TABLE}`;
  }
  if (kind === "temporal") {
    return `SELECT ${common}, CAST(min(${c}) AS VARCHAR) AS min_value, CAST(max(${c}) AS VARCHAR) AS max_value FROM ${TABLE}`;
  }
  if (kind === "boolean") {
    return `SELECT ${common}, NULL AS min_value, NULL AS max_value FROM ${TABLE}`;
  }
  const patterns = Object.entries(PATTERNS)
    .map(([k, re]) => `count(*) FILTER (WHERE regexp_full_match(trim(${c}), ${literal(re)})) AS pattern_${k}`)
    .join(",\n  ");
  return `SELECT ${common},
  min(${c}) AS min_value, max(${c}) AS max_value,
  min(length(${c})) AS min_length, max(length(${c})) AS max_length,
  count(*) FILTER (WHERE ${c} <> trim(${c})) AS untrimmed,
  count(*) FILTER (WHERE trim(${c}) <> '' AND try_cast(trim(${c}) AS DOUBLE) IS NOT NULL) AS numeric_like,
  ${patterns}
FROM ${TABLE}`;
}

export function outlierSql(col: string, q25: number, q75: number): string {
  const iqr = q75 - q25;
  return `SELECT count(*) AS outliers FROM ${TABLE}
WHERE ${ident(col)} < ${q25 - 1.5 * iqr} OR ${ident(col)} > ${q75 + 1.5 * iqr}`;
}

export function topValuesSql(col: string, limit = 6): string {
  const c = ident(col);
  return `SELECT CAST(${c} AS VARCHAR) AS value, count(*) AS n FROM ${TABLE}
WHERE ${c} IS NOT NULL GROUP BY ${c} ORDER BY n DESC, value LIMIT ${limit}`;
}

/** Equal-width histogram; temporal columns are binned on epoch seconds. */
export function histogramSql(col: string, kind: Kind, bins = HISTOGRAM_BINS): string {
  const v = kind === "temporal" ? `epoch(${ident(col)})` : `CAST(${ident(col)} AS DOUBLE)`;
  return `WITH v AS (SELECT ${v} AS x FROM ${TABLE} WHERE ${ident(col)} IS NOT NULL),
b AS (SELECT min(x) AS lo, max(x) AS hi FROM v)
SELECT least(${bins - 1}, CAST(floor((x - b.lo) / nullif((b.hi - b.lo) / ${bins}, 0)) AS INTEGER)) AS bin,
       any_value(b.lo) AS lo, any_value(b.hi) AS hi, count(*) AS n
FROM v, b GROUP BY bin ORDER BY bin`;
}

export function duplicateRowsSql(): string {
  return `SELECT (SELECT count(*) FROM ${TABLE}) - (SELECT count(*) FROM (SELECT DISTINCT * FROM ${TABLE})) AS duplicates`;
}

// ---------------------------------------------------------------- runner
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export function buildHistogram(rows: Row[], bins = HISTOGRAM_BINS): HistogramBin[] {
  if (!rows.length) return [];
  const lo = Number(rows[0].lo);
  const hi = Number(rows[0].hi);
  const width = (hi - lo) / bins || 1;
  const counts = new Map(rows.map((r) => [r.bin === null ? 0 : Number(r.bin), Number(r.n)]));
  if (hi === lo) return [{ lo, hi, count: [...counts.values()].reduce((a, b) => a + b, 0) }];
  return Array.from({ length: bins }, (_, i) => ({ lo: lo + i * width, hi: lo + (i + 1) * width, count: counts.get(i) ?? 0 }));
}

async function profileColumn(conn: AsyncDuckDBConnection, name: string, duckdbType: string): Promise<ColumnProfile> {
  const kind = kindOf(duckdbType);
  const [s] = await query(conn, baseStatsSql(name, kind));
  const top = (await query(conn, topValuesSql(name))).map((r) => ({ value: String(r.value), count: Number(r.n) }));

  const p: ColumnProfile = {
    name, duckdbType, kind,
    rows: Number(s.rows), nulls: Number(s.nulls), distinct: Number(s.distinct_values),
    min: s.min_value == null ? null : String(s.min_value), max: s.max_value == null ? null : String(s.max_value),
    mean: num(s.mean), stddev: num(s.stddev), q25: num(s.q25), median: num(s.median), q75: num(s.q75),
    zeros: num(s.zeros), negatives: num(s.negatives), outliers: null,
    minLength: num(s.min_length), maxLength: num(s.max_length),
    untrimmed: num(s.untrimmed), numericLikeText: num(s.numeric_like),
    patterns: {}, top, histogram: [],
  };
  if (kind === "text") {
    for (const k of Object.keys(PATTERNS) as Pattern[]) {
      const n = Number(s[`pattern_${k}`] ?? 0);
      if (n > 0) p.patterns[k] = n;
    }
  }
  if (kind === "numeric" && p.q25 !== null && p.q75 !== null) {
    p.outliers = Number((await query(conn, outlierSql(name, p.q25, p.q75)))[0].outliers);
  }
  if ((kind === "numeric" || kind === "temporal") && p.rows > p.nulls) {
    p.histogram = buildHistogram(await query(conn, histogramSql(name, kind)));
  }
  return p;
}

/** Load a CSV into DuckDB-WASM and profile every column. */
export async function profileFile(
  db: AsyncDuckDB,
  fileName: string,
  data: Uint8Array,
  onProgress?: (done: number, total: number, column: string) => void,
): Promise<DatasetProfile> {
  const t0 = performance.now();
  const bytes = data.byteLength; // the buffer is transferred to the worker (and detached) below
  await db.registerFileBuffer(fileName, data);
  const conn = await db.connect();
  try {
    await conn.query(loadSql(fileName));
    const schema = await query(conn, `DESCRIBE ${TABLE}`);
    const [{ n }] = await query(conn, `SELECT count(*) AS n FROM ${TABLE}`);
    const columns: ColumnProfile[] = [];
    for (const [i, c] of schema.entries()) {
      onProgress?.(i, schema.length, String(c.column_name));
      columns.push(await profileColumn(conn, String(c.column_name), String(c.column_type)));
    }
    const [{ duplicates }] = await query(conn, duplicateRowsSql());
    return {
      fileName, rows: Number(n), columns, duplicateRows: Number(duplicates),
      elapsedMs: Math.round(performance.now() - t0), bytes,
    };
  } finally {
    await conn.close();
    await db.dropFile(fileName);
  }
}
