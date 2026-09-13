/**
 * Extra dividend signal from Yahoo Finance for the PRIMARY listing of a holding.
 *
 * Findings that shape this module (verified 2026-09-14):
 * - `quoteSummary?modules=calendarEvents` (ex-date + pay date of the NEXT dividend) needs the
 *   cookie + crumb handshake. The addon network broker strips `Cookie` on purpose
 *   (`crates/core/src/addons/network.rs`), so an addon cannot use it. That is a job for the
 *   host Yahoo provider (see design discussion wealthfolio/wealthfolio#1730).
 * - `v8/finance/chart?events=div` works without cookies and, on the primary listing (e.g. `O`),
 *   lists the latest DECLARED dividend with its ex-date as soon as it is announced, weeks before
 *   the European listing (`RY6.F`) shows anything.
 * - `v1/finance/search` works without cookies and resolves a name/ISIN to the primary listing.
 * - UCITS ETFs have no US primary listing; they stay on projection.
 *
 * All requests go through the addon network broker (hosts declared in manifest.json).
 */
import type { NetworkAPI } from "@wealthfolio/addon-sdk";
import type { PastDividend } from "./projection";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

export let lastSearchError: string | null = null;

/**
 * Find the PRIMARY (US) listing of an instrument by ISIN or by name
 * (e.g. "Realty Income Corporation" -> `O`). Returns null when there is none.
 */
export async function findPrimarySymbol(net: NetworkAPI, query: string): Promise<string | null> {
  try {
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`;
    const res = await net.request({ url, method: "GET", headers: { "User-Agent": UA } });
    if (res.status !== 200) {
      lastSearchError = `search-http-${res.status}`;
      return null;
    }
    const json = JSON.parse(res.body) as { quotes?: Array<{ symbol?: string; exchange?: string }> };
    const us = (json.quotes ?? []).find(
      (q) => q.symbol && q.exchange && ["NYQ", "NMS", "NGM", "PCX", "ASE"].includes(q.exchange),
    );
    lastSearchError = null;
    return us?.symbol ?? null;
  } catch (e) {
    lastSearchError = e instanceof Error ? e.message : String(e);
    return null;
  }
}

export interface PrimaryDividends {
  /** dividend events on the primary listing (ex-dates, per-share in its currency) */
  events: PastDividend[];
  currency: string | null;
  note?: string;
}

/**
 * Dividend events of the primary listing over the last `months` via the crumb-free chart API.
 * Includes already-declared events whose ex-date is still in the future.
 */
export async function fetchPrimaryDividends(net: NetworkAPI, symbol: string, months = 24): Promise<PrimaryDividends> {
  const now = Math.floor(Date.now() / 1000);
  const start = now - months * 30 * 86_400;
  const end = now + 120 * 86_400; // pick up declared future ex-dates
  try {
    const url =
      `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?interval=1d&period1=${start}&period2=${end}&events=div`;
    const res = await net.request({ url, method: "GET", headers: { "User-Agent": UA } });
    if (res.status !== 200) return { events: [], currency: null, note: `chart-http-${res.status}` };
    const json = JSON.parse(res.body) as {
      chart?: {
        result?: Array<{
          meta?: { currency?: string };
          events?: { dividends?: Record<string, { amount: number; date: number }> };
        }> | null;
      };
    };
    const r = json.chart?.result?.[0];
    if (!r) return { events: [], currency: null, note: "no-result" };
    const events = Object.values(r.events?.dividends ?? {})
      .filter((d) => d && d.amount > 0 && d.date > 0)
      .map((d) => ({ amount: d.amount, date: d.date }))
      .sort((a, b) => a.date - b.date);
    return { events, currency: r.meta?.currency ?? null };
  } catch (e) {
    return { events: [], currency: null, note: e instanceof Error ? e.message : String(e) };
  }
}
