import { describe, expect, it } from "vitest";
import { columnName, dbtTests, modelName, sqlType, toDbtYaml, toDdl } from "../../src/exporters";
import { fmtPct } from "../../src/ui";
import { col, dataset, text } from "./fixtures";

describe("naming", () => {
  it("normalises file and column names to warehouse identifiers", () => {
    expect(modelName("Loan Applications (2026).csv")).toBe("loan_applications_2026");
    expect(modelName("2026_orders.csv")).toBe("t_2026_orders");
    expect(columnName(" Annual Income $ ")).toBe("annual_income");
    expect(columnName("1st payment")).toBe("c_1st_payment");
  });
});

describe("dbt tests", () => {
  it("only proposes tests the data already passes", () => {
    expect(dbtTests(col({ distinct: 1000 }))).toEqual(["not_null", "unique", expect.stringContaining("accepted_range")]);
    expect(dbtTests(col({ nulls: 5, min: "-3" }))).toEqual([]);
  });

  it("emits accepted_values for low-cardinality text, quoting YAML-unsafe values", () => {
    const t = dbtTests(text({ distinct: 2, top: [{ value: "yes", count: 600 }, { value: "No answer", count: 400 }] }));
    expect(t.find((x) => x.startsWith("accepted_values"))).toContain('values: ["yes", No answer]');
  });

  it("writes valid nesting for test arguments", () => {
    const yaml = toDbtYaml(dataset([text()]));
    expect(yaml).toContain("          - accepted_values:\n              arguments:\n                values: [Approved, Declined, Pending]");
    expect(yaml.startsWith("version: 2\n\nmodels:\n  - name: loan_applications\n")).toBe(true);
  });
});

describe("DDL", () => {
  it("maps DuckDB types per dialect", () => {
    expect(sqlType(col({ duckdbType: "BIGINT" }), "snowflake")).toBe("NUMBER(38,0)");
    expect(sqlType(col({ duckdbType: "BIGINT" }), "postgres")).toBe("BIGINT");
    expect(sqlType(col({ duckdbType: "DOUBLE" }), "postgres")).toBe("DOUBLE PRECISION");
    expect(sqlType(col({ duckdbType: "TIMESTAMP" }), "snowflake")).toBe("TIMESTAMP_NTZ");
    expect(sqlType(text({ maxLength: 40 }), "postgres")).toBe("VARCHAR(64)");
  });

  it("adds NOT NULL and a primary key on the first unique complete column", () => {
    const ddl = toDdl(dataset([col({ name: "order_id", duckdbType: "BIGINT", distinct: 1000 }), text({ nulls: 4 })]), "postgres");
    expect(ddl).toContain("order_id  BIGINT NOT NULL");
    expect(ddl).toMatch(/status\s+VARCHAR\(16\),/);
    expect(ddl).toContain("PRIMARY KEY (order_id)");
  });
});

describe("formatting", () => {
  it("formats percentages for humans", () => {
    expect(fmtPct(0)).toBe("0%");
    expect(fmtPct(0.04)).toBe("<0.1%");
    expect(fmtPct(7.017)).toBe("7%");
    expect(fmtPct(8.57)).toBe("8.6%");
    expect(fmtPct(59.94)).toBe("60%");
    expect(fmtPct(99.2)).toBe("99.2%");
    expect(fmtPct(100)).toBe("100%");
  });
});
