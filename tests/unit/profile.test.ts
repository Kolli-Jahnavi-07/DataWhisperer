import { describe, expect, it } from "vitest";
import { baseStatsSql, buildHistogram, ident, kindOf, literal, loadSql, topValuesSql } from "../../src/profile";

describe("SQL builders", () => {
  it("quotes identifiers and literals safely", () => {
    expect(ident('weird "col"')).toBe('"weird ""col"""');
    expect(literal("o'brien.csv")).toBe("'o''brien.csv'");
    expect(topValuesSql('a"; DROP TABLE x; --')).toContain('"a""; DROP TABLE x; --"');
  });

  it("maps DuckDB types to profile kinds", () => {
    expect(kindOf("BIGINT")).toBe("numeric");
    expect(kindOf("DECIMAL(18,2)")).toBe("numeric");
    expect(kindOf("TIMESTAMP WITH TIME ZONE")).toBe("temporal");
    expect(kindOf("BOOLEAN")).toBe("boolean");
    expect(kindOf("VARCHAR")).toBe("text");
  });

  it("infers types from every row, not a sample", () => {
    expect(loadSql("f.csv")).toContain("sample_size = -1");
  });

  it("computes quartiles only for numeric columns", () => {
    expect(baseStatsSql("x", "numeric")).toContain("quantile_cont");
    expect(baseStatsSql("x", "text")).not.toContain("quantile_cont");
  });
});

describe("buildHistogram", () => {
  it("fills empty bins with zero so the chart keeps its shape", () => {
    const h = buildHistogram([{ lo: 0, hi: 10, bin: 0, n: 3 }, { lo: 0, hi: 10, bin: 4, n: 7 }], 5);
    expect(h.map((b) => b.count)).toEqual([3, 0, 0, 0, 7]);
    expect(h[1]).toMatchObject({ lo: 2, hi: 4 });
  });

  it("collapses a constant column into one bin", () => {
    expect(buildHistogram([{ lo: 5, hi: 5, bin: null, n: 12 }], 5)).toEqual([{ lo: 5, hi: 5, count: 12 }]);
  });

  it("returns nothing for an all-null column", () => {
    expect(buildHistogram([])).toEqual([]);
  });
});
