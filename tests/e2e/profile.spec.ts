import { expect, test } from "@playwright/test";
import path from "node:path";

test("profiles the messy sample and surfaces its known problems", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Auto loan applications/ }).click();

  await expect(page.locator(".summary h2")).toHaveText("loan_applications.csv");
  await expect(page.locator(".stats")).toContainText("5,040");

  const findings = page.locator(".findings");
  await expect(findings).toContainText("40 duplicate rows");
  await expect(findings).toContainText("Same category written differently");
  await expect(findings).toContainText("Numbers stored as text");
  await expect(findings).toContainText("negative values");

  await expect(page.locator("#code")).toContainText("- name: loan_applications");
  await page.getByRole("tab", { name: "Snowflake DDL" }).click();
  await expect(page.locator("#code")).toContainText("CREATE TABLE loan_applications");
  await expect(page.locator("#code")).toContainText("TIMESTAMP_NTZ");
});

test("clicking a finding opens that column's detail", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Auto loan applications/ }).click();
  await page.locator(".col-link", { hasText: "amount_requested" }).first().click();
  const row = page.locator('.col[data-name="amount_requested"]');
  await expect(row.locator(".col-head")).toHaveAttribute("aria-expanded", "true");
  await expect(row.locator(".col-body")).toContainText("Zeros / negatives");
});

test("a clean file scores high and offers a primary key", async ({ page }) => {
  await page.goto("/");
  await page.locator("#file").setInputFiles(path.join(import.meta.dirname, "../../public/samples/store_orders.csv"));
  await expect(page.locator(".score-num")).toHaveText(/^(9\d|100)$/);
  await page.getByRole("tab", { name: "Postgres DDL" }).click();
  await expect(page.locator("#code")).toContainText("PRIMARY KEY (order_id)");
});

test("filters columns by name", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Store orders/ }).click();
  await page.getByLabel("Filter columns").fill("order");
  await expect(page.locator(".col:visible")).toHaveCount(3);
});

test("explains empty and header-only files instead of showing a blank report", async ({ page }) => {
  await page.goto("/");
  const file = page.locator("#file");
  await file.setInputFiles({ name: "empty.csv", mimeType: "text/csv", buffer: Buffer.from("") });
  await expect(page.locator("#status")).toHaveText("empty.csv is empty.");
  await file.setInputFiles({ name: "header.csv", mimeType: "text/csv", buffer: Buffer.from("id,name\n") });
  await expect(page.locator("#status")).toHaveText("header.csv has a header but no data rows.");
  await expect(page.locator("#start")).toBeVisible();
});
