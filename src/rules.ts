/**
 * Data quality rules. Each rule looks at a column (or dataset) profile and
 * returns zero or more findings. Pure functions, so they are unit-tested
 * without a browser.
 */
import type { ColumnProfile, DatasetProfile, Finding, Pattern } from "./types";

const pct = (n: number, d: number) => (d ? (100 * n) / d : 0);
const fmtPct = (x: number) => (x < 1 && x > 0 ? "<1%" : `${Math.round(x)}%`);

export const THRESHOLDS = {
  mostlyMissing: 50, // % null -> critical
  someMissing: 5, // % null -> warning
  idLike: 0.999, // distinct / non-null ratio for a candidate key
  lowCardinality: 12, // distinct values for "categorical"
  outliers: 1, // % of rows outside 1.5 x IQR
  numericText: 95, // % of text values that parse as numbers
};

const PII: Pattern[] = ["email", "phone", "ip"];

export function columnFindings(c: ColumnProfile): Finding[] {
  const out: Finding[] = [];
  const nonNull = c.rows - c.nulls;
  const add = (severity: Finding["severity"], rule: string, title: string, detail: string) =>
    out.push({ severity, column: c.name, rule, title, detail });

  const missing = pct(c.nulls, c.rows);
  if (nonNull === 0) {
    add("critical", "empty_column", "Column is empty", "Every value is missing. Drop it or fix the source.");
    return out;
  }
  if (missing >= THRESHOLDS.mostlyMissing) {
    add("critical", "mostly_missing", `${fmtPct(missing)} missing`, `${c.nulls.toLocaleString()} of ${c.rows.toLocaleString()} values are empty.`);
  } else if (missing >= THRESHOLDS.someMissing) {
    add("warning", "some_missing", `${fmtPct(missing)} missing`, `${c.nulls.toLocaleString()} empty values. Decide whether to fill, flag or exclude them.`);
  }

  if (c.distinct === 1) {
    add("warning", "constant", "Same value in every row", `Only "${c.top[0]?.value ?? ""}" appears. It carries no information.`);
  }

  if (c.distinct === nonNull && nonNull > 1 && c.nulls === 0) {
    add("info", "unique_key", "Candidate primary key", "Every value is unique and none are missing.");
  } else if (nonNull > 20 && c.distinct / nonNull >= THRESHOLDS.idLike && c.distinct !== nonNull) {
    add("warning", "near_unique", "Almost unique: possible duplicate keys",
      `${(nonNull - c.distinct).toLocaleString()} repeated values in a column that is otherwise unique.`);
  }

  if (c.kind === "numeric" && c.outliers !== null && pct(c.outliers, nonNull) >= THRESHOLDS.outliers) {
    add("warning", "outliers", `${c.outliers.toLocaleString()} outliers`,
      `${fmtPct(pct(c.outliers, nonNull))} of values fall outside 1.5 x IQR (${fmt(c.q25)} to ${fmt(c.q75)}).`);
  }
  if (c.kind === "numeric" && c.negatives && c.negatives > 0 && c.negatives / nonNull < 0.02) {
    add("warning", "rare_negatives", `${c.negatives.toLocaleString()} negative values`,
      "A small share of negatives in a mostly positive column is often a sign or entry error.");
  }

  if (c.kind === "text") {
    if (c.untrimmed && c.untrimmed > 0) {
      add("warning", "untrimmed", `${c.untrimmed.toLocaleString()} values with extra spaces`,
        "Leading or trailing spaces make equal values look different in joins and group-bys.");
    }
    if (c.numericLikeText && pct(c.numericLikeText, nonNull) >= THRESHOLDS.numericText && c.numericLikeText < nonNull) {
      add("warning", "numbers_as_text", "Numbers stored as text",
        `${fmtPct(pct(c.numericLikeText, nonNull))} of values are numbers, but a few are not, so the column was read as text.`);
    }
    for (const p of PII) {
      const n = c.patterns[p];
      if (n && pct(n, nonNull) >= 50) {
        add("info", "pii", `Looks like ${p === "ip" ? "IP addresses" : p + "s"}: personal data`,
          `${fmtPct(pct(n, nonNull))} of values match a ${p} pattern. Mask or restrict it before sharing.`);
      }
    }
    if (c.distinct > 1 && c.distinct <= THRESHOLDS.lowCardinality) {
      const lowered = new Set(c.top.map((t) => t.value.trim().toLowerCase()));
      if (lowered.size < c.top.length) {
        add("warning", "inconsistent_labels", "Same category written differently",
          `Values differ only by case or spacing: ${c.top.map((t) => `"${t.value}"`).join(", ")}.`);
      }
    }
  }
  return out;
}

export function datasetFindings(d: DatasetProfile): Finding[] {
  const out: Finding[] = [];
  if (d.duplicateRows > 0) {
    out.push({
      severity: d.duplicateRows / d.rows > 0.01 ? "critical" : "warning",
      column: null, rule: "duplicate_rows", title: `${d.duplicateRows.toLocaleString()} duplicate rows`,
      detail: "Fully identical rows usually mean a file was loaded twice or an extract was re-sent.",
    });
  }
  if (!d.columns.some((c) => c.distinct === c.rows && c.nulls === 0)) {
    out.push({
      severity: "info", column: null, rule: "no_key", title: "No single-column key",
      detail: "No column is unique and complete. Rows may need a composite key.",
    });
  }
  return out;
}

export function allFindings(d: DatasetProfile): Finding[] {
  const order = { critical: 0, warning: 1, info: 2 };
  return [...datasetFindings(d), ...d.columns.flatMap(columnFindings)].sort((a, b) => order[a.severity] - order[b.severity]);
}

/** 0-100 health score: starts at 100, loses points per finding, weighted by severity. */
export function healthScore(findings: Finding[]): number {
  const cost = { critical: 15, warning: 5, info: 0 };
  return Math.max(0, 100 - findings.reduce((s, f) => s + cost[f.severity], 0));
}

function fmt(x: number | null): string {
  if (x === null) return "-";
  return Math.abs(x) >= 1000 ? Math.round(x).toLocaleString() : String(Math.round(x * 100) / 100);
}
