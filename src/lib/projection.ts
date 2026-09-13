/**
 * Pure dividend projection logic. No React, no SDK: easy to unit test.
 *
 * Input: past dividend events of one holding (per-share amount + pay date)
 * and, optionally, the next declared dividend from a calendar source.
 * Output: the next N months of expected payments, each flagged as
 * "declared" (a provider said so) or "projected" (inferred from cadence).
 */

export interface PastDividend {
  /** per-share amount in the instrument currency */
  amount: number;
  /** pay date, unix seconds */
  date: number;
}

export interface DeclaredDividend {
  /** per-share amount, ALREADY in the holding currency */
  amount?: number;
  exDate?: number; // unix seconds
  payDate?: number; // unix seconds
}

/** Typical ex-date -> pay-date lag when the pay date is unknown. */
export const EX_TO_PAY_DAYS = 15;

export type Cadence = "monthly" | "quarterly" | "semiannual" | "annual";

export interface UpcomingPayment {
  payDate: number; // unix seconds
  exDate: number | null;
  amountPerShare: number;
  status: "declared" | "projected";
}

export interface Projection {
  cadence: Cadence | null;
  /** last per-share amount actually paid */
  lastAmount: number | null;
  lastPayDate: number | null;
  /**
   * Change of the last payment vs the payment one year earlier (same period),
   * as a fraction (0.05 = +5 %). Comparing with the immediately previous payment
   * is misleading for ETFs whose quarterly distributions differ within a year.
   */
  lastChangePct: number | null;
  /** trailing 12-month per-share total */
  ttmPerShare: number;
  upcoming: UpcomingPayment[];
}

const DAY = 86_400;

/** Median gap in days between consecutive pay dates decides the cadence. */
export function inferCadence(events: PastDividend[]): Cadence | null {
  const dates = [...new Set(events.map((e) => e.date))].sort((a, b) => a - b);
  if (dates.length < 2) return null;
  const gaps = dates
    .slice(1)
    .map((d, i) => (d - dates[i]) / DAY)
    .sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  if (median <= 45) return "monthly";
  if (median <= 135) return "quarterly";
  if (median <= 270) return "semiannual";
  return "annual";
}

export function cadenceMonths(c: Cadence): number {
  return { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 }[c];
}

/** Add N months keeping the day of month where possible (UTC, clamped to month end). */
export function addMonths(unix: number, months: number): number {
  const d = new Date(unix * 1000);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return Math.floor(target.getTime() / 1000);
}

/**
 * Providers sometimes split one distribution into several same-day rows or
 * return an event twice. Merge everything that falls on the same UTC day.
 */
export function dedupeSameDay(events: PastDividend[]): PastDividend[] {
  const byDay = new Map<number, number>();
  for (const e of events) {
    const day = Math.floor(e.date / DAY);
    byDay.set(day, (byDay.get(day) ?? 0) + e.amount);
  }
  return [...byDay.entries()]
    .map(([day, amount]) => ({ date: day * DAY, amount }))
    .sort((a, b) => a.date - b.date);
}

export interface ProjectOptions {
  /** unix seconds; defaults to now */
  now?: number;
  /** default 12 */
  horizonMonths?: number;
  declared?: DeclaredDividend | null;
}

export function project(rawEvents: PastDividend[], opts: ProjectOptions = {}): Projection {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const horizon = opts.horizonMonths ?? 12;
  const events = dedupeSameDay(rawEvents.filter((e) => e.amount > 0 && e.date <= now));
  const cadence = inferCadence(events);
  const last = events.at(-1) ?? null;
  const ttmPerShare = events
    .filter((e) => e.date > now - 365 * DAY)
    .reduce((s, e) => s + e.amount, 0);
  const lastChangePct = yoyChange(events, cadence);

  const upcoming: UpcomingPayment[] = [];
  const end = addMonths(now, horizon);

  // 1. Declared next payment, when the calendar source has one in the future.
  //    If only the ex-date is known, assume payment EX_TO_PAY_DAYS later.
  const decl = opts.declared;
  let declaredPay: number | null = null;
  if (decl?.payDate && decl.payDate > now) declaredPay = decl.payDate;
  else if (decl?.exDate && decl.exDate > now) declaredPay = decl.exDate + EX_TO_PAY_DAYS * DAY;
  if (declaredPay && declaredPay <= end) {
    upcoming.push({
      payDate: declaredPay,
      exDate: decl?.exDate ?? null,
      amountPerShare: decl?.amount ?? last?.amount ?? 0,
      status: "declared",
    });
  }

  // 2. Projected payments from cadence, one period after the last known
  //    (or declared) payment, never in the past.
  if (cadence && last) {
    const step = cadenceMonths(cadence);
    let next = declaredPay ? addMonths(declaredPay, step) : addMonths(last.date, step);
    while (next <= now) next = addMonths(next, step);
    const amount = decl?.amount ?? last.amount;
    while (next <= end) {
      upcoming.push({ payDate: next, exDate: null, amountPerShare: amount, status: "projected" });
      next = addMonths(next, step);
    }
  }

  upcoming.sort((a, b) => a.payDate - b.payDate);
  return {
    cadence,
    lastAmount: last?.amount ?? null,
    lastPayDate: last?.date ?? null,
    lastChangePct,
    ttmPerShare,
    upcoming,
  };
}

/**
 * Last payment vs the one closest to 12 months earlier (±45 days). Falls back to
 * the previous payment only for annual payers, where that IS the year-earlier one.
 */
export function yoyChange(events: PastDividend[], cadence: Cadence | null): number | null {
  const last = events.at(-1);
  if (!last) return null;
  const target = last.date - 365 * DAY;
  let best: PastDividend | null = null;
  for (const e of events) {
    if (e === last) continue;
    const dist = Math.abs(e.date - target);
    if (dist <= 45 * DAY && (!best || dist < Math.abs(best.date - target))) best = e;
  }
  if (!best && cadence === "annual") best = events.at(-2) ?? null;
  return best && best.amount > 0 ? last.amount / best.amount - 1 : null;
}

/** "YYYY-MM" bucket in UTC. */
export function monthKey(unix: number): string {
  const d = new Date(unix * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The next N month keys starting at the month of `now`. */
export function monthKeys(now: number, n: number): string[] {
  const d = new Date(now * 1000);
  const keys: string[] = [];
  for (let i = 0; i < n; i++) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i, 1));
    keys.push(monthKey(Math.floor(m.getTime() / 1000)));
  }
  return keys;
}
