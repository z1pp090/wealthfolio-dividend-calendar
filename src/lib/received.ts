/**
 * Dividends actually received, from the host's DIVIDEND activities. Pure aggregation.
 */
/** "YYYY-MM" bucket in UTC (same as projection.monthKey; duplicated to keep this module standalone for tests). */
const monthKey = (unix: number): string => {
  const d = new Date(unix * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

export interface ReceivedDividend {
  /** unix seconds (UTC day) */
  date: number;
  symbol: string;
  /** cash that landed in the account, base currency */
  net: number;
  /** net + tax withheld, base currency */
  gross: number;
}

export interface MonthBucket {
  net: number;
  gross: number;
  bySymbol: Record<string, number>; // net
}

export interface YearRow {
  year: number;
  total: number; // net
  bySymbol: Record<string, number>; // net
  /** vs previous year, fraction; null without a previous year */
  growth: number | null;
}

export function byMonth(events: ReceivedDividend[]): Map<string, MonthBucket> {
  const out = new Map<string, MonthBucket>();
  for (const e of events) {
    const k = monthKey(e.date);
    const b = out.get(k) ?? { net: 0, gross: 0, bySymbol: {} };
    b.net += e.net;
    b.gross += e.gross;
    b.bySymbol[e.symbol] = (b.bySymbol[e.symbol] ?? 0) + e.net;
    out.set(k, b);
  }
  return out;
}

/** Running total of net received, one point per month with a payment (sorted). */
export function cumulative(events: ReceivedDividend[]): Array<{ month: string; total: number }> {
  const months = byMonth(events);
  const keys = [...months.keys()].sort();
  const out: Array<{ month: string; total: number }> = [];
  let acc = 0;
  for (const k of keys) {
    acc += months.get(k)!.net;
    out.push({ month: k, total: acc });
  }
  return out;
}

export function byYear(events: ReceivedDividend[]): YearRow[] {
  const years = new Map<number, YearRow>();
  for (const e of events) {
    const y = new Date(e.date * 1000).getUTCFullYear();
    const r = years.get(y) ?? { year: y, total: 0, bySymbol: {}, growth: null };
    r.total += e.net;
    r.bySymbol[e.symbol] = (r.bySymbol[e.symbol] ?? 0) + e.net;
    years.set(y, r);
  }
  const rows = [...years.values()].sort((a, b) => a.year - b.year);
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1].total;
    rows[i].growth = prev > 0 ? rows[i].total / prev - 1 : null;
  }
  return rows;
}

/** Sum of net received in the 12 months ending at `now` (inclusive of the current month). */
export function trailing12(events: ReceivedDividend[], now: number): number {
  const cutoff = now - 365 * 86_400;
  return events.filter((e) => e.date > cutoff && e.date <= now).reduce((s, e) => s + e.net, 0);
}
