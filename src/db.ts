/**
 * DuckDB-WASM setup. The database runs in a Web Worker inside the visitor's
 * browser, so a CSV is never uploaded anywhere: it is read straight from the
 * file input into DuckDB's in-memory file system.
 */
import * as duckdb from "@duckdb/duckdb-wasm";
import mvpWasm from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import mvpWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import ehWasm from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import ehWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";

const BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
  eh: { mainModule: ehWasm, mainWorker: ehWorker },
};

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;

export function getDb(): Promise<duckdb.AsyncDuckDB> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const bundle = await duckdb.selectBundle(BUNDLES); // picks the fastest build the browser supports
      const worker = new Worker(bundle.mainWorker!);
      const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      return db;
    })();
  }
  return dbPromise;
}

export type Row = Record<string, unknown>;

/** Run a query and return plain JS rows (BigInt -> number, Arrow dates -> ISO strings). */
export async function query(conn: duckdb.AsyncDuckDBConnection, sql: string): Promise<Row[]> {
  const result = await conn.query(sql);
  return result.toArray().map((r) => {
    const o: Row = {};
    for (const [k, v] of Object.entries(r.toJSON())) o[k] = normalize(v);
    return o;
  });
}

function normalize(v: unknown): unknown {
  if (typeof v === "bigint") return Number(v);
  if (v instanceof Date) return v.toISOString();
  return v;
}
