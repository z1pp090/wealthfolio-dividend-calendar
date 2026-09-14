/**
 * Net dividend after withholding at source and home-country income tax, with a
 * double-taxation credit capped at a treaty rate. All rates are percentages.
 *
 *   net = gross × (1 − w − max(0, t − min(w, cap)))
 *
 * Two views (see NetMode): at the broker a Spanish account receives gross × 0.85 × 0.81 = 0.6885
 * of a US dividend (15 % withheld, then 19 % on the rest); after the annual return the credit
 * brings it to 0.81. An Irish UCITS ETF pays 0.81 in both views.
 */
export type NetMode = "broker" | "afterReturn";

export interface TaxRates {
  /** withholding at source, % */
  withholdingPct: number;
  /** home income tax on dividends, % */
  homeTaxPct: number;
  /** maximum foreign tax creditable at home, % */
  creditCapPct: number;
  /**
   * "broker": what lands in the account. Brokers withhold the home tax on the amount left
   *   after the foreign withholding: net = gross × (1 − w) × (1 − t). The foreign tax is
   *   only recovered later, in the annual return.
   * "afterReturn": after that credit: net = gross × (1 − w − max(0, t − min(w, cap))).
   */
  mode?: NetMode;
}

const clampPct = (v: number) => (Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0);

export function netFactor(r: TaxRates): number {
  const w = clampPct(r.withholdingPct) / 100;
  const t = clampPct(r.homeTaxPct) / 100;
  const cap = clampPct(r.creditCapPct) / 100;
  if ((r.mode ?? "broker") === "broker") return (1 - w) * (1 - t);
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
