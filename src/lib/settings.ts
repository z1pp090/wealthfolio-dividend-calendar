/**
 * User settings, persisted through the host's per-addon key-value storage
 * (`ctx.api.storage`, baseline permission; `localStorage` is unavailable in the sandbox).
 */
import type { AddonContext } from "@wealthfolio/addon-sdk";
import { EX_TO_PAY_DAYS } from "./projection";

export interface AssetSettings {
  /** days from ex-date to pay date */
  payLagDays?: number;
  /** withholding at source, %; undefined = default from the ISIN country */
  withholdingPct?: number;
}

export interface CalendarSettings {
  /** monthly net income target in base currency; 0 hides the goal bar */
  goalMonthly: number;
  /** home income tax on dividends, % */
  homeTaxPct: number;
  /** maximum foreign withholding creditable at home, % */
  creditCapPct: number;
  /** keyed by instrument symbol */
  assets: Record<string, AssetSettings>;
}

export const DEFAULT_SETTINGS: CalendarSettings = {
  goalMonthly: 0,
  homeTaxPct: 19,
  creditCapPct: 15,
  assets: {},
};

const KEY = "settings.v1";

const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

export function normalizeSettings(raw: unknown): CalendarSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const assets: Record<string, AssetSettings> = {};
  const ra = (r.assets && typeof r.assets === "object" ? r.assets : {}) as Record<string, Record<string, unknown>>;
  for (const [symbol, a] of Object.entries(ra)) {
    if (!a || typeof a !== "object") continue;
    const entry: AssetSettings = {};
    if (typeof a.payLagDays === "number" && Number.isFinite(a.payLagDays)) entry.payLagDays = a.payLagDays;
    if (typeof a.withholdingPct === "number" && Number.isFinite(a.withholdingPct)) entry.withholdingPct = a.withholdingPct;
    if (Object.keys(entry).length) assets[symbol] = entry;
  }
  return {
    goalMonthly: Math.max(0, num(r.goalMonthly, DEFAULT_SETTINGS.goalMonthly)),
    homeTaxPct: num(r.homeTaxPct, DEFAULT_SETTINGS.homeTaxPct),
    creditCapPct: num(r.creditCapPct, DEFAULT_SETTINGS.creditCapPct),
    assets,
  };
}

export async function loadSettings(ctx: AddonContext): Promise<CalendarSettings> {
  try {
    const raw = await ctx.api.storage.get(KEY);
    return raw ? normalizeSettings(JSON.parse(raw)) : { ...DEFAULT_SETTINGS, assets: {} };
  } catch (e) {
    ctx.api.logger.warn(`settings unreadable, using defaults: ${e instanceof Error ? e.message : String(e)}`);
    return { ...DEFAULT_SETTINGS, assets: {} };
  }
}

export async function saveSettings(ctx: AddonContext, s: CalendarSettings): Promise<void> {
  await ctx.api.storage.set(KEY, JSON.stringify(normalizeSettings(s)));
}

export function payLagFor(s: CalendarSettings, symbol: string): number {
  return s.assets[symbol]?.payLagDays ?? EX_TO_PAY_DAYS;
}
