import test from "node:test";
import assert from "node:assert/strict";
import {
  inferCadence,
  inferExRule,
  applyExRule,
  project,
  addMonths,
  dedupeSameDay,
  monthKeys,
  payDateFor,
  nthWeekdayOfMonth,
  lastBusinessDayOfMonth,
} from "../dist-test/projection.js";

const day = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 1000);
const iso = (u) => new Date(u * 1000).toISOString().slice(0, 10);

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

test("single event: no cadence, no projections; only its pending payment is listed", () => {
  const p = project([{ amount: 0.07, date: day(2026, 9, 10) }], { now: day(2026, 9, 14) });
  assert.equal(p.cadence, null);
  assert.equal(p.lastAmount, 0.07);
  assert.equal(p.upcoming.length, 1); // ex 10-Sep passed, pay 25-Sep still ahead
  assert.equal(p.upcoming[0].status, "declared");
  const old = project([{ amount: 0.07, date: day(2026, 6, 10) }], { now: day(2026, 9, 14) });
  assert.equal(old.upcoming.length, 0);
});

// --- ex-date rules -----------------------------------------------------------

test("calendar helpers", () => {
  assert.equal(iso(nthWeekdayOfMonth(2026, 9, 4, 2)), "2026-10-08"); // 2nd Thursday of October 2026 (month index 9)
  assert.equal(iso(nthWeekdayOfMonth(2026, 8, 4, 2)), "2026-09-10"); // 2nd Thursday of September 2026
  assert.equal(iso(lastBusinessDayOfMonth(2026, 4)), "2026-05-29"); // 31-May-2026 is Sunday
  assert.equal(iso(lastBusinessDayOfMonth(2026, 7)), "2026-08-31"); // Monday
});

test("infers 'last business day' for a monthly REIT (Realty Income style)", () => {
  // real 2026 ex-dates of O: last business day of each month
  const ev = ["2026-01-30", "2026-02-27", "2026-03-31", "2026-04-30", "2026-05-29", "2026-06-30", "2026-07-31", "2026-08-31"].map(
    (s) => ({ amount: 0.27, date: Math.floor(Date.parse(s + "T00:00:00Z") / 1000) }),
  );
  assert.deepEqual(inferExRule(ev), { kind: "last-business-day" });
});

test("infers 'second Thursday' for a monthly ETF (LDGL style)", () => {
  const ev = ["2026-02-12", "2026-03-12", "2026-04-09", "2026-05-15", "2026-06-11", "2026-07-16", "2026-08-13", "2026-09-10"].map(
    (s) => ({ amount: 0.0353, date: Math.floor(Date.parse(s + "T00:00:00Z") / 1000) }),
  );
  // 6 of 8 land on the 2nd Thursday (May and July are the 3rd): 75 % >= 60 %
  assert.deepEqual(inferExRule(ev), { kind: "nth-weekday", weekday: 4, n: 2 });
});

test("infers 'third Thursday' for a quarterly ETF (VHYL style)", () => {
  const ev = ["2025-03-20", "2025-06-19", "2025-09-18", "2025-12-18", "2026-03-19", "2026-06-18"].map((s) => ({
    amount: 0.6,
    date: Math.floor(Date.parse(s + "T00:00:00Z") / 1000),
  }));
  assert.deepEqual(inferExRule(ev), { kind: "nth-weekday", weekday: 4, n: 3 });
  assert.equal(iso(applyExRule({ kind: "nth-weekday", weekday: 4, n: 3 }, 2026, 8)), "2026-09-17");
});

test("fewer than 3 events or a scattered history: no rule", () => {
  assert.equal(inferExRule([{ amount: 1, date: day(2026, 1, 5) }, { amount: 1, date: day(2026, 2, 5) }]), null);
  const scattered = [day(2026, 1, 3), day(2026, 2, 17), day(2026, 3, 9), day(2026, 4, 28), day(2026, 5, 12)].map((d) => ({ amount: 1, date: d }));
  assert.equal(inferExRule(scattered), null);
});

test("pay date = ex-date + lag, rolled forward off weekends", () => {
  assert.equal(iso(payDateFor(day(2026, 8, 31), 15)), "2026-09-15"); // Tuesday
  assert.equal(iso(payDateFor(day(2026, 9, 10), 8)), "2026-09-18"); // Friday
  assert.equal(iso(payDateFor(day(2026, 9, 11), 8)), "2026-09-21"); // 19-Sep is Saturday -> Monday
});

// --- projection ----------------------------------------------------------------

test("monthly REIT: 12 projected ex-dates on the last business day, pay 15 days later", () => {
  const ev = ["2026-01-30", "2026-02-27", "2026-03-31", "2026-04-30", "2026-05-29", "2026-06-30", "2026-07-31", "2026-08-31"].map(
    (s) => ({ amount: 0.269, date: Math.floor(Date.parse(s + "T00:00:00Z") / 1000) }),
  );
  const p = project(ev, { now: day(2026, 9, 14), payLagDays: 15 });
  assert.equal(p.cadence, "monthly");
  assert.equal(p.upcoming.length, 12);
  // the August ex-date already passed but its payment (15-Sep) is still ahead: certain amount
  assert.equal(p.upcoming[0].status, "declared");
  assert.equal(iso(p.upcoming[0].exDate), "2026-08-31");
  assert.equal(iso(p.upcoming[0].payDate), "2026-09-15");
  assert.equal(iso(p.upcoming[1].exDate), "2026-09-30");
  assert.equal(iso(p.upcoming[1].payDate), "2026-10-15");
  assert.equal(iso(p.upcoming[2].exDate), "2026-10-30"); // 31-Oct-2026 is Saturday
  assert.equal(iso(p.upcoming[11].exDate), "2027-07-30"); // 31-Jul-2027 is Saturday
  assert.ok(p.upcoming.slice(1).every((u) => u.status === "projected"));
  assert.ok(p.upcoming.every((u) => u.amountPerShare === 0.269));
});

test("quarterly ETF: 4 payments, each with the amount of the same quarter a year ago scaled by YoY", () => {
  // Jun distributions are ~double the others, and the fund grew 10 % YoY
  const hist = [
    ["2024-09-19", 0.5], ["2024-12-19", 0.5], ["2025-03-20", 0.5], ["2025-06-19", 1.0],
    ["2025-09-18", 0.55], ["2025-12-18", 0.55], ["2026-03-19", 0.55], ["2026-06-18", 1.1],
  ].map(([s, a]) => ({ amount: a, date: Math.floor(Date.parse(s + "T00:00:00Z") / 1000) }));
  const p = project(hist, { now: day(2026, 9, 14), payLagDays: 13 });
  assert.equal(p.cadence, "quarterly");
  assert.equal(p.upcoming.length, 4);
  assert.equal(iso(p.upcoming[0].exDate), "2026-09-17");
  assert.equal(iso(p.upcoming[0].payDate), "2026-09-30");
  // Sep-2026 ≈ Sep-2025 (0.55) × 1.10
  assert.ok(Math.abs(p.upcoming[0].amountPerShare - 0.605) < 1e-9);
  // Jun-2027 ≈ Jun-2026 (1.1) × 1.10, NOT the last amount
  const jun = p.upcoming.find((u) => iso(u.exDate).startsWith("2027-06"));
  assert.ok(jun && Math.abs(jun.amountPerShare - 1.21) < 1e-9);
});

test("declared dividend goes first and shifts projections one period later", () => {
  const ev = ["2026-04-30", "2026-05-29", "2026-06-30", "2026-07-31", "2026-08-31"].map((s) => ({
    amount: 0.269,
    date: Math.floor(Date.parse(s + "T00:00:00Z") / 1000),
  }));
  const p = project(ev, {
    now: day(2026, 9, 14),
    payLagDays: 15,
    declared: { amount: 0.27, exDate: day(2026, 9, 30), payDate: day(2026, 10, 15) },
  });
  // [0] is the pending August payment (ex passed), [1] the declared September one
  assert.equal(p.upcoming[1].status, "declared");
  assert.equal(iso(p.upcoming[1].payDate), "2026-10-15");
  assert.equal(p.upcoming[1].amountPerShare, 0.27);
  assert.equal(p.upcoming[2].status, "projected");
  assert.equal(iso(p.upcoming[2].exDate), "2026-10-30");
  assert.equal(p.upcoming[2].amountPerShare, 0.27);
});

test("declared with only ex-date assumes payment lag days later", () => {
  const p = project([], { now: day(2026, 9, 14), declared: { amount: 0.5, exDate: day(2026, 9, 21) } });
  assert.equal(p.upcoming.length, 1);
  assert.equal(iso(p.upcoming[0].payDate), "2026-10-06"); // +15 = Tue 6-Oct
});

test("stale history: projections never land in the past", () => {
  const ev = [1, 2, 3].map((m) => ({ amount: 0.1, date: day(2025, m, 10) }));
  const p = project(ev, { now: day(2026, 9, 14) });
  assert.ok(p.upcoming.length > 0);
  assert.ok(p.upcoming.every((u) => u.exDate > day(2026, 9, 14)));
});

test("change vs same period a year ago, and TTM per share", () => {
  const ev = [
    { amount: 0.5, date: day(2025, 6, 20) },
    { amount: 0.3, date: day(2025, 9, 20) },
    { amount: 0.4, date: day(2025, 12, 20) },
    { amount: 0.35, date: day(2026, 3, 20) },
    { amount: 0.55, date: day(2026, 6, 20) },
  ];
  const p = project(ev, { now: day(2026, 9, 14) });
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

test("ex-date rule survives the ±1-day shifts of a secondary listing", () => {
  // Frankfurt listing of a US REIT: same months as the primary, a day off now and then
  const ev = ["2026-01-30", "2026-02-26", "2026-03-31", "2026-04-29", "2026-05-29", "2026-06-30", "2026-07-30", "2026-08-31"].map(
    (s) => ({ amount: 0.27, date: Math.floor(Date.parse(s + "T00:00:00Z") / 1000) }),
  );
  assert.deepEqual(inferExRule(ev), { kind: "last-business-day" });
});

test("without a rule, projected ex-dates still avoid weekends", () => {
  const ev = [day(2026, 7, 31), day(2026, 8, 31)].map((d) => ({ amount: 0.1, date: d }));
  const p = project(ev, { now: day(2026, 9, 14) });
  assert.equal(iso(p.upcoming.find((u) => u.status === "projected" && iso(u.exDate).startsWith("2026-10")).exDate), "2026-10-30");
});
