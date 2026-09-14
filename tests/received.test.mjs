import test from "node:test";
import assert from "node:assert/strict";
import { byMonth, cumulative, byYear, trailing12 } from "../dist-test/received.js";

const day = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 1000);
const ev = [
  { date: day(2025, 11, 15), symbol: "A", net: 1, gross: 1.3 },
  { date: day(2025, 12, 15), symbol: "A", net: 1, gross: 1.3 },
  { date: day(2026, 1, 15), symbol: "A", net: 2, gross: 2.6 },
  { date: day(2026, 1, 20), symbol: "B", net: 0.5, gross: 0.5 },
  { date: day(2026, 8, 15), symbol: "A", net: 3, gross: 3.9 },
];

test("byMonth groups net and gross per month and per symbol", () => {
  const m = byMonth(ev);
  assert.equal(m.get("2026-01").net, 2.5);
  assert.equal(m.get("2026-01").gross, 3.1);
  assert.deepEqual(m.get("2026-01").bySymbol, { A: 2, B: 0.5 });
});

test("cumulative is a running total, one point per month with payments", () => {
  const c = cumulative(ev);
  assert.deepEqual(c.map((p) => [p.month, p.total]), [["2025-11", 1], ["2025-12", 2], ["2026-01", 4.5], ["2026-08", 7.5]]);
});

test("byYear totals per year with growth vs the previous year", () => {
  const y = byYear(ev);
  assert.equal(y.length, 2);
  assert.equal(y[0].year, 2025);
  assert.equal(y[0].total, 2);
  assert.equal(y[0].growth, null);
  assert.equal(y[1].total, 5.5);
  assert.ok(Math.abs(y[1].growth - 1.75) < 1e-9);
});

test("trailing12 keeps only the last 365 days", () => {
  assert.equal(trailing12(ev, day(2026, 9, 14)), 7.5); // everything is within 365 days
  assert.equal(trailing12(ev, day(2026, 11, 20)), 6.5); // Nov-2025 15th is 370 days back: out; Dec-2025 and all 2026 in
});
