/**
 * Turn a profile into artifacts a data engineer can use right away:
 *   - a dbt schema.yml with tests inferred from the data
 *   - CREATE TABLE DDL for Snowflake or Postgres
 *   - the full profile as JSON
 * Pure functions; unit-tested.
 */
import type { ColumnProfile, DatasetProfile } from "./types";

export function modelName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[a-z_]/.test(base) ? base || "dataset" : `t_${base}`;
}

export function columnName(name: string): string {
  const s = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[a-z_]/.test(s) ? s || "col" : `c_${s}`;
}

const yamlStr = (s: string) => (/^[A-Za-z0-9 _.-]+$/.test(s) && !/^(true|false|null|yes|no|on|off)$/i.test(s) && isNaN(Number(s)) ? s : JSON.stringify(s));

/** Tests the data already passes, so they guard against regressions rather than fail on day one. */
export function dbtTests(c: ColumnProfile): string[] {
  const tests: string[] = [];
  const nonNull = c.rows - c.nulls;
  if (c.nulls === 0 && c.rows > 0) tests.push("not_null");
  if (nonNull > 1 && c.distinct === nonNull) tests.push("unique");
  if ((c.kind === "text" || c.kind === "boolean") && c.distinct > 1 && c.distinct <= 10 && c.top.length === c.distinct) {
    const values = c.top.map((t) => yamlStr(t.value)).join(", ");
    tests.push(`accepted_values:\n              arguments:\n                values: [${values}]`);
  }
  if (c.kind === "numeric" && c.min !== null && c.max !== null && Number(c.min) >= 0) {
    tests.push(`dbt_utils.accepted_range:\n              arguments:\n                min_value: 0`);
  }
  return tests;
}

export function toDbtYaml(d: DatasetProfile): string {
  const lines = [
    "version: 2",
    "",
    "models:",
    `  - name: ${modelName(d.fileName)}`,
    `    description: "Profiled by DataWhisperer: ${d.rows.toLocaleString("en-US")} rows, ${d.columns.length} columns."`,
    "    columns:",
  ];
  for (const c of d.columns) {
    lines.push(`      - name: ${columnName(c.name)}`);
    lines.push(`        description: "${c.kind}, ${c.distinct.toLocaleString("en-US")} distinct values${c.nulls ? `, ${c.nulls.toLocaleString("en-US")} missing` : ""}"`);
    const tests = dbtTests(c);
    if (tests.length) {
      lines.push("        data_tests:");
      for (const t of tests) lines.push(`          - ${t}`);
    }
  }
  return lines.join("\n") + "\n";
}

export type Dialect = "snowflake" | "postgres";

export function sqlType(c: ColumnProfile, dialect: Dialect): string {
  const t = c.duckdbType.toUpperCase();
  const textLen = Math.max(16, Math.ceil(((c.maxLength ?? 64) * 1.5) / 16) * 16);
  if (t === "BOOLEAN") return "BOOLEAN";
  if (/^(TINYINT|SMALLINT|INTEGER|UTINYINT|USMALLINT)$/.test(t)) return dialect === "snowflake" ? "NUMBER(38,0)" : "INTEGER";
  if (/^(BIGINT|HUGEINT|UINTEGER|UBIGINT)$/.test(t)) return dialect === "snowflake" ? "NUMBER(38,0)" : "BIGINT";
  if (t.startsWith("DECIMAL")) return t.replace("DECIMAL", dialect === "snowflake" ? "NUMBER" : "NUMERIC");
  if (/^(FLOAT|REAL|DOUBLE)$/.test(t)) return dialect === "snowflake" ? "FLOAT" : "DOUBLE PRECISION";
  if (t === "DATE") return "DATE";
  if (t.startsWith("TIMESTAMP WITH TIME ZONE")) return dialect === "snowflake" ? "TIMESTAMP_TZ" : "TIMESTAMPTZ";
  if (t.startsWith("TIMESTAMP")) return dialect === "snowflake" ? "TIMESTAMP_NTZ" : "TIMESTAMP";
  if (t.startsWith("TIME")) return "TIME";
  return dialect === "snowflake" ? `VARCHAR(${textLen})` : `VARCHAR(${textLen})`;
}

export function toDdl(d: DatasetProfile, dialect: Dialect): string {
  const width = Math.max(...d.columns.map((c) => columnName(c.name).length));
  const cols = d.columns.map((c) => {
    const nn = c.nulls === 0 ? " NOT NULL" : "";
    return `    ${columnName(c.name).padEnd(width)}  ${sqlType(c, dialect)}${nn}`;
  });
  const key = d.columns.find((c) => c.nulls === 0 && c.distinct === c.rows && c.rows > 1);
  if (key) cols.push(`    PRIMARY KEY (${columnName(key.name)})`);
  return `CREATE TABLE ${modelName(d.fileName)} (\n${cols.join(",\n")}\n);\n`;
}

export function toJson(d: DatasetProfile): string {
  return JSON.stringify(d, null, 2);
}
