import test from "node:test";
import assert from "node:assert/strict";
import { inferCadence, project, addMonths, dedupeSameDay, monthKeys } from "../dist-test/projection.js";

const day = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 1000);

test("monthly cadence from ~30-day gaps", () => {
  const ev = [1, 2, 3, 4, 5, 6].map((m) => ({ amount: 0.26, date: day(2026, m, 15) }));
  assert.equal(inferCadence(ev), "monthly");
});

test("quarterly cadence from ~91-day gaps", () => {
  const ev = [day(2025, 3, 26), day(2025, 6, 25), day(2025, 9, 24), day(2025, 12, 24), day(2026, 3, 25)].map(
    (d) => ({ amount: 0.6, date: d }),
  );
  assert.equal(inferCadence(ev), "quarterly");
});

test("single event: no cadence, no projections, last amount kept", () => {
  const p = project([{ amount: 0.07, date: day(2026, 9, 10) }], { now: day(2026, 9, 14) });
  assert.equal(p.cadence, null);
  assert.equal(p.lastAmount, 0.07);
  assert.equal(p.upcoming.length, 0);
});

test("monthly REIT projects 12 payments on the same day of month", () => {
  const ev = [4, 5, 6, 7, 8].map((m) => ({ amount: 0.269, date: day(2026, m, 15) }));
  const p = project(ev, { now: day(2026, 9, 14) });
  assert.equal(p.cadence, "monthly");
  assert.equal(p.upcoming.length, 12);
  assert.equal(p.upcoming[0].payDate, day(2026, 9, 15));
  assert.equal(p.upcoming[11].payDate, day(2027, 8, 15));
  assert.ok(p.upcoming.every((u) => u.status === "projected" && u.amountPerShare === 0.269));
});

test("quarterly ETF projects 4 payments in 12 months", () => {
  const ev = [day(2025, 9, 24), day(2025, 12, 24), day(2026, 3, 25), day(2026, 6, 24)].map((d) => ({
    amount: 0.6,
    date: d,
  }));
  const p = project(ev, { now: day(2026, 9, 14) });
  assert.equal(p.cadence, "quarterly");
  assert.equal(p.upcoming.length, 4);
  assert.equal(p.upcoming[0].payDate, day(2026, 9, 24));
});

test("declared dividend goes first and shifts projections one period later", () => {
  const ev = [4, 5, 6, 7, 8].map((m) => ({ amount: 0.269, date: day(2026, m, 15) }));
  const p = project(ev, {
    now: day(2026, 9, 14),
    declared: { amount: 0.27, exDate: day(2026, 9, 30), payDate: day(2026, 10, 15) },
  });
  assert.equal(p.upcoming[0].status, "declared");
  assert.equal(p.upcoming[0].payDate, day(2026, 10, 15));
  assert.equal(p.upcoming[0].amountPerShare, 0.27);
  assert.equal(p.upcoming[1].status, "projected");
  assert.equal(p.upcoming[1].payDate, day(2026, 11, 15));
  assert.equal(p.upcoming[1].amountPerShare, 0.27);
});

test("declared with only ex-date assumes payment EX_TO_PAY_DAYS later", () => {
  const p = project([], { now: day(2026, 9, 14), declared: { amount: 0.5, exDate: day(2026, 9, 20) } });
  assert.equal(p.upcoming.length, 1);
  assert.equal(p.upcoming[0].payDate, day(2026, 10, 5));
});

test("stale history: projections never land in the past", () => {
  const ev = [1, 2, 3].map((m) => ({ amount: 0.1, date: day(2025, m, 10) }));
  const p = project(ev, { now: day(2026, 9, 14) });
  assert.ok(p.upcoming.length > 0);
  assert.ok(p.upcoming.every((u) => u.payDate > day(2026, 9, 14)));
});

test("change vs same period a year ago, and TTM per share", () => {
  // quarterly payer: Jun-2025 0.50, Sep-2025 0.30, Dec-2025 0.40, Mar-2026 0.35, Jun-2026 0.55
  const ev = [
    { amount: 0.5, date: day(2025, 6, 20) },
    { amount: 0.3, date: day(2025, 9, 20) },
    { amount: 0.4, date: day(2025, 12, 20) },
    { amount: 0.35, date: day(2026, 3, 20) },
    { amount: 0.55, date: day(2026, 6, 20) },
  ];
  const p = project(ev, { now: day(2026, 9, 14) });
  // Jun-2026 vs Jun-2025 = +10 %, NOT vs Mar-2026 (+57 %)
  assert.ok(Math.abs(p.lastChangePct - 0.1) < 1e-9);
  assert.ok(Math.abs(p.ttmPerShare - (0.3 + 0.4 + 0.35 + 0.55)) < 1e-9);
});

test("no year-ago payment -> change is null (not vs previous)", () => {
  const ev = [
    { amount: 0.25, date: day(2026, 7, 15) },
    { amount: 0.26, date: day(2026, 8, 15) },
  ];
  const p = project(ev, { now: day(2026, 9, 14) });
  assert.equal(p.lastChangePct, null);
});

test("same-day duplicates are merged", () => {
  const out = dedupeSameDay([
    { amount: 0.1, date: day(2026, 1, 1) + 3600 },
    { amount: 0.2, date: day(2026, 1, 1) + 7200 },
  ]);
  assert.equal(out.length, 1);
  assert.ok(Math.abs(out[0].amount - 0.3) < 1e-9);
});

test("addMonths clamps to month end", () => {
  assert.equal(addMonths(day(2026, 1, 31), 1), day(2026, 2, 28));
  assert.equal(addMonths(day(2026, 8, 31), 1), day(2026, 9, 30));
});

test("monthKeys covers 12 consecutive months", () => {
  const k = monthKeys(day(2026, 9, 14), 12);
  assert.equal(k[0], "2026-09");
  assert.equal(k[11], "2027-08");
});
