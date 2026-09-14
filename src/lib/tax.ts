/**
 * Net dividend after withholding at source and home-country income tax, with a
 * double-taxation credit capped at a treaty rate. All rates are percentages.
 *
 *   net = gross × (1 − w − max(0, t − min(w, cap)))
 *
 * Example (Spain, US stock): w = 15, t = 19, cap = 15 → net = gross × 0.81.
 * Example (Spain, Irish UCITS ETF): w = 0, t = 19 → net = gross × 0.81.
 * Example (Spain, 30 % withheld without W-8BEN): w = 30, t = 19, cap = 15 → 0.66.
 */
export interface TaxRates {
  /** withholding at source, % */
  withholdingPct: number;
  /** home income tax on dividends, % */
  homeTaxPct: number;
  /** maximum foreign tax creditable at home, % */
  creditCapPct: number;
}

const clampPct = (v: number) => (Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0);

export function netFactor(r: TaxRates): number {
  const w = clampPct(r.withholdingPct) / 100;
  const t = clampPct(r.homeTaxPct) / 100;
  const cap = clampPct(r.creditCapPct) / 100;
  const credit = Math.min(w, cap);
  const home = Math.max(0, t - credit);
  return Math.max(0, 1 - w - home);
}

/**
 * Default withholding at source by ISIN country prefix. Only the common cases;
 * everything else defaults to 0 and can be overridden per asset in the settings.
 */
export function defaultWithholdingPct(isin: string | null | undefined): number {
  const cc = (isin ?? "").slice(0, 2).toUpperCase();
  const table: Record<string, number> = {
    US: 15, // with W-8BEN on file at the broker
    CA: 15,
    DE: 26.375,
    FR: 25,
    IT: 26,
    ES: 19,
    NL: 15,
    CH: 35,
    GB: 0,
    IE: 0,
    LU: 0,
    JE: 0,
  };
  return table[cc] ?? 0;
}
