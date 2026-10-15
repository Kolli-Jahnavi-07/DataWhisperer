import { getDb } from "./db";
import { profileFile } from "./profile";
import { renderReport } from "./ui";

const start = document.getElementById("start")!;
const report = document.getElementById("report")!;
const status = document.getElementById("status")!;
const input = document.getElementById("file") as HTMLInputElement;
const drop = document.getElementById("drop")!;

// Start loading DuckDB right away so the first profile is fast.
const dbReady = getDb();

const MAX_BYTES = 500 * 1024 * 1024;

async function run(name: string, data: Uint8Array): Promise<void> {
  if (data.byteLength > MAX_BYTES) {
    status.textContent = "That file is over 500 MB. Split it or sample it first.";
    return;
  }
  if (data.byteLength === 0) {
    status.textContent = `${name} is empty.`;
    return;
  }
  status.textContent = "Starting DuckDB…";
  start.classList.add("busy");
  try {
    const db = await dbReady;
    const profile = await profileFile(db, name, data, (i, total, col) => {
      status.textContent = `Profiling column ${i + 1} of ${total}: ${col}`;
    });
    if (profile.rows === 0) {
      status.textContent = `${name} has a header but no data rows.`;
      return;
    }
    renderReport(report, profile, reset);
    start.hidden = true;
    report.hidden = false;
    status.textContent = "";
    window.scrollTo({ top: 0 });
  } catch (err) {
    console.error(err);
    status.textContent = `Couldn't read ${name}: ${(err as Error).message.split("\n")[0]}. Check that it's a CSV with a header row.`;
  } finally {
    start.classList.remove("busy");
  }
}

function reset(): void {
  report.hidden = true;
  report.innerHTML = "";
  start.hidden = false;
  input.value = "";
  status.textContent = "";
}

async function fromFile(file: File): Promise<void> {
  await run(file.name, new Uint8Array(await file.arrayBuffer()));
}

input.addEventListener("change", () => {
  if (input.files?.[0]) void fromFile(input.files[0]);
});

for (const ev of ["dragenter", "dragover"]) {
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.add("over");
  });
}
for (const ev of ["dragleave", "drop"]) {
  drop.addEventListener(ev, () => drop.classList.remove("over"));
}
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  const f = (e as DragEvent).dataTransfer?.files?.[0];
  if (f) void fromFile(f);
});

document.querySelectorAll<HTMLButtonElement>("[data-sample]").forEach((b) =>
  b.addEventListener("click", async () => {
    const name = b.dataset.sample!;
    status.textContent = `Loading ${name}…`;
    const res = await fetch(`${import.meta.env.BASE_URL}samples/${name}`);
    await run(name, new Uint8Array(await res.arrayBuffer()));
  }),
);
