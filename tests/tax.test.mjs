import test from "node:test";
import assert from "node:assert/strict";
import { netFactor, defaultWithholdingPct } from "../dist-test/tax.js";

const close = (a, b) => Math.abs(a - b) < 1e-9;

test("Spain + US stock with W-8BEN: 15 % withheld, 19 % home, credit 15 -> 0.81", () => {
  assert.ok(close(netFactor({ withholdingPct: 15, homeTaxPct: 19, creditCapPct: 15 }), 0.81));
});

test("Spain + Irish UCITS ETF: nothing withheld -> 0.81", () => {
  assert.ok(close(netFactor({ withholdingPct: 0, homeTaxPct: 19, creditCapPct: 15 }), 0.81));
});

test("30 % withheld without treaty form: only 15 credited -> 0.66", () => {
  assert.ok(close(netFactor({ withholdingPct: 30, homeTaxPct: 19, creditCapPct: 15 }), 0.66));
});

test("no home tax: net = gross minus withholding", () => {
  assert.ok(close(netFactor({ withholdingPct: 15, homeTaxPct: 0, creditCapPct: 15 }), 0.85));
});

test("garbage rates are clamped, never negative", () => {
  assert.ok(close(netFactor({ withholdingPct: 200, homeTaxPct: 19, creditCapPct: 15 }), 0));
  assert.ok(close(netFactor({ withholdingPct: NaN, homeTaxPct: 19, creditCapPct: 15 }), 0.81));
});

test("default withholding by ISIN country", () => {
  assert.equal(defaultWithholdingPct("US7561091049"), 15);
  assert.equal(defaultWithholdingPct("IE00B8GKDB10"), 0);
  assert.equal(defaultWithholdingPct("CH0012032048"), 35);
  assert.equal(defaultWithholdingPct(null), 0);
});
