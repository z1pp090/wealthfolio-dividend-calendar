import test from "node:test";
import assert from "node:assert/strict";
import { projectLongTerm } from "../dist-test/long-term.js";

test("no contributions, no growth, no reinvest: flat income, goal never reached", () => {
  const r = projectLongTerm({ annualNet: 120, marketValue: 4000, monthlyContribution: 0, dividendGrowth: 0, reinvest: false, goalMonthly: 400, startYear: 2026, maxYears: 10 });
  assert.equal(r.points.length, 11);
  assert.ok(r.points.every((p) => Math.abs(p.monthly - 10) < 1e-9));
  assert.equal(r.goalYear, null);
  assert.ok(Math.abs(r.yieldUsed - 0.03) < 1e-9);
});

test("contributions buy income at the current yield; reinvesting compounds", () => {
  const base = { annualNet: 120, marketValue: 4000, monthlyContribution: 100, dividendGrowth: 0, goalMonthly: 0, startYear: 2026, maxYears: 1 };
  const noReinvest = projectLongTerm({ ...base, reinvest: false });
  // year 1: 120 + 1200 × 0.03 = 156
  assert.ok(Math.abs(noReinvest.points[1].monthly * 12 - 156) < 1e-9);
  const reinvest = projectLongTerm({ ...base, reinvest: true });
  // year 1: 120 + (1200 + 120) × 0.03 = 159.6
  assert.ok(Math.abs(reinvest.points[1].monthly * 12 - 159.6) < 1e-9);
  assert.equal(reinvest.points[1].contributed, 1200);
});

test("goal year is the first year the monthly income reaches the goal", () => {
  const r = projectLongTerm({ annualNet: 1200, marketValue: 30000, monthlyContribution: 200, dividendGrowth: 0.03, reinvest: true, goalMonthly: 400, startYear: 2026, maxYears: 40 });
  assert.ok(r.goalYear !== null && r.goalYear > 2026 && r.goalYear <= 2066);
  const idx = r.goalYear - 2026;
  assert.ok(r.points[idx].monthly >= 400 && r.points[idx - 1].monthly < 400);
});

test("empty portfolio: zero yield, income stays zero", () => {
  const r = projectLongTerm({ annualNet: 0, marketValue: 0, monthlyContribution: 100, dividendGrowth: 0.03, reinvest: true, goalMonthly: 10, startYear: 2026, maxYears: 5 });
  assert.equal(r.yieldUsed, 0);
  assert.equal(r.goalYear, null);
});
