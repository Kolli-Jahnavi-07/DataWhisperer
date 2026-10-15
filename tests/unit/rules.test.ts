import { describe, expect, it } from "vitest";
import { allFindings, columnFindings, datasetFindings, healthScore } from "../../src/rules";
import { col, dataset, text } from "./fixtures";

const rules = (c: Parameters<typeof columnFindings>[0]) => columnFindings(c).map((f) => f.rule);

describe("column rules", () => {
  it("a healthy numeric column produces no findings", () => {
    expect(columnFindings(col())).toEqual([]);
  });

  it("flags an empty column and stops there", () => {
    expect(rules(col({ nulls: 1000, distinct: 0 }))).toEqual(["empty_column"]);
  });

  it("grades missing values by share", () => {
    expect(rules(col({ nulls: 600 }))).toContain("mostly_missing");
    expect(rules(col({ nulls: 80 }))).toContain("some_missing");
    expect(rules(col({ nulls: 10 }))).not.toContain("some_missing");
  });

  it("recognises a candidate key and a near-unique column", () => {
    expect(rules(col({ distinct: 1000 }))).toContain("unique_key");
    expect(rules(col({ distinct: 999 }))).toContain("near_unique");
  });

  it("flags constants, outliers and rare negatives", () => {
    expect(rules(col({ distinct: 1, top: [{ value: "LOS", count: 1000 }] }))).toContain("constant");
    expect(rules(col({ outliers: 25 }))).toContain("outliers");
    expect(rules(col({ negatives: 5 }))).toContain("rare_negatives");
    expect(rules(col({ negatives: 400 }))).not.toContain("rare_negatives");
  });

  it("catches text problems: spaces, numbers as text, inconsistent labels", () => {
    expect(rules(text({ untrimmed: 12 }))).toContain("untrimmed");
    expect(rules(text({ numericLikeText: 990 }))).toContain("numbers_as_text");
    expect(rules(text({ numericLikeText: 1000 }))).not.toContain("numbers_as_text");
    const messy = text({ distinct: 4, top: [{ value: "Approved", count: 550 }, { value: "approved", count: 50 }, { value: "Declined", count: 300 }, { value: "Pending", count: 100 }] });
    expect(rules(messy)).toContain("inconsistent_labels");
  });

  it("marks email-like columns as personal data", () => {
    const email = text({ name: "email", distinct: 990, patterns: { email: 1000 }, top: [] });
    const f = columnFindings(email).find((x) => x.rule === "pii");
    expect(f?.severity).toBe("info");
    expect(f?.title).toContain("emails");
  });
});

describe("dataset rules and score", () => {
  it("duplicate rows become critical above 1%", () => {
    expect(datasetFindings(dataset([col({ distinct: 1000 })], { duplicateRows: 5 }))[0].severity).toBe("warning");
    expect(datasetFindings(dataset([col({ distinct: 1000 })], { duplicateRows: 50 }))[0].severity).toBe("critical");
  });

  it("notes when no column can serve as a key", () => {
    expect(datasetFindings(dataset([col()])).map((f) => f.rule)).toEqual(["no_key"]);
  });

  it("sorts critical first and scores 100 minus weighted findings", () => {
    const d = dataset([col({ nulls: 600, distinct: 300 }), text({ untrimmed: 3 })], { duplicateRows: 2 });
    const f = allFindings(d);
    expect(f[0].severity).toBe("critical");
    expect(f.at(-1)!.severity).toBe("info");
    // mostly_missing (critical) + duplicate_rows (warning) + untrimmed (warning)
    expect(healthScore(f)).toBe(100 - 15 - 5 - 5);
    expect(healthScore(Array(10).fill(f[0]))).toBe(0);
  });
});
