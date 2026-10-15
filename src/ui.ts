/** Rendering. All CSV-derived text goes through `esc` before it touches innerHTML. */
import { columnName, modelName, toDbtYaml, toDdl, toJson } from "./exporters";
import { allFindings, columnFindings, healthScore } from "./rules";
import type { ColumnProfile, DatasetProfile, Finding, HistogramBin, TopValue } from "./types";

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

const n = (x: number) => x.toLocaleString("en-US");
const pct = (a: number, b: number) => (b ? (100 * a) / b : 0);

export function compact(x: number | null): string {
  if (x === null || Number.isNaN(x)) return "-";
  const a = Math.abs(x);
  if (a >= 1e9) return (x / 1e9).toFixed(1) + "B";
  if (a >= 1e6) return (x / 1e6).toFixed(1) + "M";
  if (a >= 1e4) return (x / 1e3).toFixed(1) + "k";
  if (Number.isInteger(x)) return n(x);
  return a >= 100 ? n(Math.round(x)) : String(Math.round(x * 1000) / 1000);
}

/** Percentages: one decimal below 10%, whole numbers above, never "0%" for a non-zero share. */
export function fmtPct(x: number): string {
  if (x > 0 && x < 0.1) return "<0.1%";
  if (x < 99.95 && x > 99) return x.toFixed(1) + "%";
  return (x < 10 ? x.toFixed(1).replace(/\.0$/, "") : String(Math.round(x))) + "%";
}

function bytes(b: number): string {
  if (b >= 1e6) return (b / 1e6).toFixed(1) + " MB";
  return Math.max(1, Math.round(b / 1e3)) + " KB";
}

const SEV_ICON: Record<Finding["severity"], string> = {
  critical: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 15 14H1L8 1.5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 6v3.5M8 11.6v.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  warning: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 4.8v4M8 10.9v.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  info: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 7.2v4M8 4.7v.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
};
const SEV_LABEL = { critical: "Critical", warning: "Warning", info: "Note" };

// ---------------------------------------------------------------- small charts
export function histogramSvg(bins: HistogramBin[], w = 160, h = 34): string {
  if (!bins.length) return "";
  const max = Math.max(...bins.map((b) => b.count)) || 1;
  const bw = w / bins.length;
  const bars = bins
    .map((b, i) => {
      const bh = b.count ? Math.max(1.5, (b.count / max) * (h - 2)) : 0;
      return `<rect x="${(i * bw + 0.5).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${Math.max(1, bw - 1.5).toFixed(1)}" height="${bh.toFixed(1)}" rx="1"><title>${compact(b.lo)} to ${compact(b.hi)}: ${n(b.count)}</title></rect>`;
    })
    .join("");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Distribution">${bars}</svg>`;
}

function topBars(top: TopValue[], total: number, limit = 3): string {
  return `<ol class="tops">${top
    .slice(0, limit)
    .map((t) => `<li><span class="tv" title="${esc(t.value)}">${esc(t.value) || "<em>(empty)</em>"}</span><span class="tb"><i style="width:${pct(t.count, total).toFixed(1)}%"></i></span><span class="tc">${fmtPct(pct(t.count, total))}</span></li>`)
    .join("")}</ol>`;
}

// ---------------------------------------------------------------- sections
function summary(d: DatasetProfile, findings: Finding[]): string {
  const cells = d.rows * d.columns.length;
  const missing = d.columns.reduce((s, c) => s + c.nulls, 0);
  const score = healthScore(findings);
  const grade = score >= 85 ? "good" : score >= 60 ? "fair" : "poor";
  const counts = (s: Finding["severity"]) => findings.filter((f) => f.severity === s).length;
  return `
  <div class="summary">
    <div class="file">
      <h2>${esc(d.fileName)}</h2>
      <p>${bytes(d.bytes)} · profiled in ${(d.elapsedMs / 1000).toFixed(1)} s</p>
      <button type="button" class="link" id="reset">Profile another file</button>
    </div>
    <div class="score ${grade}" title="Starts at 100; each critical finding costs 15 points, each warning 5">
      <span class="score-num">${score}</span><span class="score-label">Health score</span>
    </div>
    <dl class="stats">
      <div><dt>Rows</dt><dd>${n(d.rows)}</dd></div>
      <div><dt>Columns</dt><dd>${d.columns.length}</dd></div>
      <div><dt>Missing cells</dt><dd>${fmtPct(pct(missing, cells))}</dd></div>
      <div><dt>Duplicate rows</dt><dd>${n(d.duplicateRows)}</dd></div>
      <div><dt>Critical / warnings</dt><dd>${counts("critical")} / ${counts("warning")}</dd></div>
    </dl>
  </div>`;
}

function findingsList(findings: Finding[]): string {
  if (!findings.length) return `<p class="empty">No issues found. This file looks clean.</p>`;
  return `<ul class="findings">${findings
    .map(
      (f) => `<li class="f ${f.severity}">
        <span class="sev">${SEV_ICON[f.severity]}<span>${SEV_LABEL[f.severity]}</span></span>
        <div><strong>${f.column ? `<button type="button" class="col-link" data-col="${esc(f.column)}">${esc(f.column)}</button>: ` : ""}${esc(f.title)}</strong>
        <p>${esc(f.detail)}</p></div>
      </li>`,
    )
    .join("")}</ul>`;
}

function columnRow(c: ColumnProfile, i: number): string {
  const nonNull = c.rows - c.nulls;
  const complete = pct(nonNull, c.rows);
  const flags = columnFindings(c).filter((f) => f.severity !== "info");
  const shape =
    c.histogram.length > 1
      ? histogramSvg(c.histogram)
      : topBars(c.top, nonNull, 2);
  return `
  <li class="col" id="col-${i}" data-name="${esc(c.name)}">
    <button type="button" class="col-head" aria-expanded="false" aria-controls="col-body-${i}">
      <span class="cname"><strong>${esc(c.name)}</strong><code>${esc(c.duckdbType)}</code></span>
      <span class="complete" title="${fmtPct(complete)} complete">
        <span class="bar"><i style="width:${complete.toFixed(1)}%"></i></span><span class="num">${fmtPct(complete)}</span>
      </span>
      <span class="num distinct">${compact(c.distinct)}<small> distinct</small></span>
      <span class="shape">${shape}</span>
      <span class="flags">${flags.length ? `<span class="badge ${flags.some((f) => f.severity === "critical") ? "critical" : "warning"}">${flags.length} issue${flags.length > 1 ? "s" : ""}</span>` : `<span class="badge ok">OK</span>`}</span>
    </button>
    <div class="col-body" id="col-body-${i}" hidden>${columnDetail(c)}</div>
  </li>`;
}

function columnDetail(c: ColumnProfile): string {
  const nonNull = c.rows - c.nulls;
  const rows: [string, string][] = [
    ["Non-missing", `${n(nonNull)} of ${n(c.rows)}`],
    ["Distinct", n(c.distinct)],
  ];
  if (c.kind === "numeric") {
    rows.push(["Min / max", `${compact(Number(c.min))} / ${compact(Number(c.max))}`], ["Mean ± std dev", `${compact(c.mean)} ± ${compact(c.stddev)}`],
      ["Quartiles", `${compact(c.q25)} · ${compact(c.median)} · ${compact(c.q75)}`], ["Zeros / negatives", `${n(c.zeros ?? 0)} / ${n(c.negatives ?? 0)}`],
      ["Outliers (1.5 × IQR)", n(c.outliers ?? 0)]);
  } else if (c.kind === "temporal") {
    rows.push(["Earliest", esc(c.min)], ["Latest", esc(c.max)]);
  } else if (c.kind === "text") {
    rows.push(["Length", `${c.minLength ?? "-"} to ${c.maxLength ?? "-"} characters`]);
    const pats = Object.entries(c.patterns).map(([k, v]) => `${k} ${fmtPct(pct(v!, nonNull))}`).join(", ");
    if (pats) rows.push(["Patterns", esc(pats)]);
  }
  const findings = columnFindings(c);
  return `
    <div class="detail">
      <dl>${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
      <div><h4>Most common values</h4>${topBars(c.top, nonNull, 6)}</div>
      ${findings.length ? `<div><h4>Findings</h4><ul class="mini">${findings.map((f) => `<li class="${f.severity}">${SEV_ICON[f.severity]} ${esc(f.title)}</li>`).join("")}</ul></div>` : ""}
    </div>`;
}

const EXPORTS = [
  { id: "dbt", label: "dbt schema.yml", file: (d: DatasetProfile) => `${modelName(d.fileName)}.yml`, make: toDbtYaml },
  { id: "snowflake", label: "Snowflake DDL", file: (d: DatasetProfile) => `${modelName(d.fileName)}_snowflake.sql`, make: (d: DatasetProfile) => toDdl(d, "snowflake") },
  { id: "postgres", label: "Postgres DDL", file: (d: DatasetProfile) => `${modelName(d.fileName)}_postgres.sql`, make: (d: DatasetProfile) => toDdl(d, "postgres") },
  { id: "json", label: "Profile JSON", file: (d: DatasetProfile) => `${modelName(d.fileName)}_profile.json`, make: toJson },
];

function exportsPanel(): string {
  return `
  <div class="tabs" role="tablist" aria-label="Export format">
    ${EXPORTS.map((e, i) => `<button type="button" role="tab" class="tab" id="tab-${e.id}" aria-selected="${i === 0}" data-export="${e.id}">${e.label}</button>`).join("")}
  </div>
  <div class="code-wrap">
    <div class="code-actions">
      <button type="button" class="btn" id="copy">Copy</button>
      <button type="button" class="btn" id="download">Download</button>
    </div>
    <pre class="code" id="code" tabindex="0" aria-live="polite"></pre>
  </div>
  <p class="hint">Tests are inferred from what the data already satisfies, so they pass today and catch regressions tomorrow. <code>accepted_range</code> needs the dbt_utils package.</p>`;
}

export function renderReport(root: HTMLElement, d: DatasetProfile, onReset: () => void): void {
  const findings = allFindings(d);
  root.innerHTML = `
    ${summary(d, findings)}
    <div class="grid">
      <section class="panel" aria-labelledby="h-findings"><h3 id="h-findings">What needs attention</h3>${findingsList(findings)}</section>
      <section class="panel" aria-labelledby="h-export"><h3 id="h-export">Take it to your warehouse</h3>${exportsPanel()}</section>
    </div>
    <section class="panel cols" aria-labelledby="h-cols">
      <div class="cols-head"><h3 id="h-cols">Columns</h3>
        <input type="search" id="filter" placeholder="Filter columns" aria-label="Filter columns" /></div>
      <div class="col-legend" aria-hidden="true"><span>Column · type</span><span>Complete</span><span>Distinct</span><span>Distribution / top values</span><span></span></div>
      <ul class="col-list">${d.columns.map(columnRow).join("")}</ul>
    </section>`;

  root.querySelector("#reset")!.addEventListener("click", onReset);

  root.querySelectorAll<HTMLButtonElement>(".col-head").forEach((b) =>
    b.addEventListener("click", () => {
      const body = document.getElementById(b.getAttribute("aria-controls")!)!;
      const open = b.getAttribute("aria-expanded") === "true";
      b.setAttribute("aria-expanded", String(!open));
      body.hidden = open;
    }),
  );

  root.querySelectorAll<HTMLButtonElement>(".col-link").forEach((b) =>
    b.addEventListener("click", () => {
      const li = [...root.querySelectorAll<HTMLLIElement>(".col")].find((x) => x.dataset.name === b.dataset.col);
      if (!li) return;
      const head = li.querySelector<HTMLButtonElement>(".col-head")!;
      if (head.getAttribute("aria-expanded") !== "true") head.click();
      li.scrollIntoView({ behavior: "smooth", block: "center" });
      head.focus({ preventScroll: true });
    }),
  );

  const filter = root.querySelector<HTMLInputElement>("#filter")!;
  filter.addEventListener("input", () => {
    const q = filter.value.trim().toLowerCase();
    root.querySelectorAll<HTMLLIElement>(".col").forEach((li) => (li.hidden = !!q && !li.dataset.name!.toLowerCase().includes(q)));
  });

  const code = root.querySelector<HTMLPreElement>("#code")!;
  let current = EXPORTS[0];
  const show = (id: string) => {
    current = EXPORTS.find((e) => e.id === id)!;
    root.querySelectorAll<HTMLButtonElement>(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.export === id)));
    code.textContent = current.make(d);
  };
  root.querySelectorAll<HTMLButtonElement>(".tab").forEach((t) => t.addEventListener("click", () => show(t.dataset.export!)));
  show("dbt");

  const copy = root.querySelector<HTMLButtonElement>("#copy")!;
  copy.addEventListener("click", async () => {
    await navigator.clipboard.writeText(code.textContent ?? "");
    copy.textContent = "Copied";
    setTimeout(() => (copy.textContent = "Copy"), 1500);
  });
  root.querySelector("#download")!.addEventListener("click", () => {
    const blob = new Blob([code.textContent ?? ""], { type: "text/plain" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: current.file(d) });
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

export { columnName };
