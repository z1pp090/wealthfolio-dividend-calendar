/**
 * Pure dividend projection logic. No React, no SDK: easy to unit test.
 *
 * Input: past dividend events of one holding (per-share amount + EX-DATE, which is what
 * Yahoo-style providers report as the event date) and, optionally, the next declared
 * dividend from a calendar source.
 * Output: the next N months of expected payments, each with an ex-date, a pay date
 * (ex-date + the holding's typical lag) and a status: "declared" (a provider said so)
 * or "projected" (inferred from cadence and the ex-date pattern of the history).
 */

export interface PastDividend {
  /** per-share amount in the instrument currency */
  amount: number;
  /** ex-dividend date, unix seconds */
  date: number;
}

export interface DeclaredDividend {
  /** per-share amount, ALREADY in the holding currency */
  amount?: number;
  exDate?: number; // unix seconds
  payDate?: number; // unix seconds
}

/** Default ex-date -> pay-date lag when the holding has no configured one. */
export const EX_TO_PAY_DAYS = 15;

export type Cadence = "monthly" | "quarterly" | "semiannual" | "annual";

export interface UpcomingPayment {
  payDate: number; // unix seconds
  exDate: number; // unix seconds
  amountPerShare: number;
  status: "declared" | "projected";
}

/**
 * How the ex-date falls inside its month. Inferred from history and used to place
 * projected ex-dates on a realistic calendar day (e.g. "last business day",
 * "second Thursday") instead of "same day-of-month as the last one".
 */
export type ExRule =
  | { kind: "nth-weekday"; weekday: number; n: number }
  | { kind: "last-weekday"; weekday: number }
  | { kind: "last-business-day" }
  | { kind: "day-of-month"; day: number };

export interface Projection {
  cadence: Cadence | null;
  exRule: ExRule | null;
  /** last per-share amount actually paid */
  lastAmount: number | null;
  /** ex-date of the last known payment */
  lastExDate: number | null;
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

/** Median gap in days between consecutive ex-dates decides the cadence. */
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

// ---------------------------------------------------------------------------
// Calendar helpers (all UTC, unix seconds at 00:00)

const toUnix = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m, d) / 1000);
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const isWeekend = (unix: number) => {
  const wd = new Date(unix * 1000).getUTCDay();
  return wd === 0 || wd === 6;
};

/** Move backwards to Friday when the date falls on a weekend. */
export function prevBusinessDay(unix: number): number {
  let u = unix;
  while (isWeekend(u)) u -= DAY;
  return u;
}

/** Move forwards to Monday when the date falls on a weekend. */
export function nextBusinessDay(unix: number): number {
  let u = unix;
  while (isWeekend(u)) u += DAY;
  return u;
}

/** Date of the n-th given weekday (0 = Sunday) of a month; null when it does not exist. */
export function nthWeekdayOfMonth(y: number, m: number, weekday: number, n: number): number | null {
  const first = new Date(Date.UTC(y, m, 1)).getUTCDay();
  const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  return day <= daysInMonth(y, m) ? toUnix(y, m, day) : null;
}

export function lastWeekdayOfMonth(y: number, m: number, weekday: number): number {
  const last = daysInMonth(y, m);
  const lastWd = new Date(Date.UTC(y, m, last)).getUTCDay();
  return toUnix(y, m, last - ((lastWd - weekday + 7) % 7));
}

export function lastBusinessDayOfMonth(y: number, m: number): number {
  return prevBusinessDay(toUnix(y, m, daysInMonth(y, m)));
}

/** Place the ex-date of a rule inside a given month. */
export function applyExRule(rule: ExRule, y: number, m: number): number {
  switch (rule.kind) {
    case "nth-weekday":
      return nthWeekdayOfMonth(y, m, rule.weekday, rule.n) ?? lastWeekdayOfMonth(y, m, rule.weekday);
    case "last-weekday":
      return lastWeekdayOfMonth(y, m, rule.weekday);
    case "last-business-day":
      return lastBusinessDayOfMonth(y, m);
    case "day-of-month":
      return prevBusinessDay(toUnix(y, m, Math.min(rule.day, daysInMonth(y, m))));
  }
}

/**
 * Pick the ex-date rule that explains most of the history. Needs at least 3 events and
 * a 60 % hit rate; otherwise null (the caller falls back to "same day as the last one").
 */
export function inferExRule(events: PastDividend[]): ExRule | null {
  const dates = [...new Set(events.map((e) => Math.floor(e.date / DAY) * DAY))].sort((a, b) => a - b);
  if (dates.length < 3) return null;

  const parts = dates.map((u) => {
    const d = new Date(u * 1000);
    return { u, y: d.getUTCFullYear(), m: d.getUTCMonth(), day: d.getUTCDate(), wd: d.getUTCDay() };
  });

  const candidates: ExRule[] = [];
  const seen = new Set<string>();
  const push = (r: ExRule) => {
    const k = JSON.stringify(r);
    if (!seen.has(k)) {
      seen.add(k);
      candidates.push(r);
    }
  };
  for (const p of parts) {
    push({ kind: "nth-weekday", weekday: p.wd, n: Math.ceil(p.day / 7) });
    push({ kind: "last-weekday", weekday: p.wd });
    push({ kind: "last-business-day" });
    push({ kind: "day-of-month", day: p.day });
  }

  // Secondary listings often report the ex-date a day or two off the primary's (weekend
  // and settlement shifts), so a near miss still counts for half.
  let best: { rule: ExRule; score: number } | null = null;
  for (const rule of candidates) {
    let score = 0;
    for (const p of parts) {
      const diff = Math.abs(applyExRule(rule, p.y, p.m) - p.u) / DAY;
      if (diff === 0) score += 2;
      else if (diff <= 3) score += 1;
    }
    if (!best || score > best.score) best = { rule, score };
  }
  return best && best.score / (2 * parts.length) >= 0.6 ? best.rule : null;
}

// ---------------------------------------------------------------------------

export interface ProjectOptions {
  /** unix seconds; defaults to now */
  now?: number;
  /** default 12 */
  horizonMonths?: number;
  declared?: DeclaredDividend | null;
  /** days between ex-date and pay date for this holding; default EX_TO_PAY_DAYS */
  payLagDays?: number;
}

/** Pay date for an ex-date: ex + lag, rolled forward off weekends. */
export function payDateFor(exDate: number, lagDays: number): number {
  return nextBusinessDay(exDate + Math.max(0, Math.round(lagDays)) * DAY);
}

/** The event closest to one year before `date`, within ±45 days. */
function yearAgoEvent(events: PastDividend[], date: number, exclude?: PastDividend): PastDividend | null {
  const target = date - 365 * DAY;
  let best: PastDividend | null = null;
  for (const e of events) {
    if (e === exclude) continue;
    const dist = Math.abs(e.date - target);
    if (dist <= 45 * DAY && (!best || dist < Math.abs(best.date - target))) best = e;
  }
  return best;
}

export function project(rawEvents: PastDividend[], opts: ProjectOptions = {}): Projection {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const horizon = opts.horizonMonths ?? 12;
  const lag = opts.payLagDays ?? EX_TO_PAY_DAYS;
  const events = dedupeSameDay(rawEvents.filter((e) => e.amount > 0 && e.date <= now));
  const cadence = inferCadence(events);
  const exRule = inferExRule(events);
  const last = events.at(-1) ?? null;
  const ttmPerShare = events
    .filter((e) => e.date > now - 365 * DAY)
    .reduce((s, e) => s + e.amount, 0);
  const lastChangePct = yoyChange(events, cadence);

  const upcoming: UpcomingPayment[] = [];
  const end = addMonths(now, horizon);

  // 0. Already ex-dividend but not yet paid: the amount is certain, only the pay date is
  //    estimated from the lag. Listed as "declared".
  for (const e of events) {
    const payDate = payDateFor(e.date, lag);
    if (payDate > now && payDate <= end) {
      upcoming.push({ payDate, exDate: e.date, amountPerShare: e.amount, status: "declared" });
    }
  }

  // 1. Declared next payment, when the calendar source has one whose ex-date is still
  //    ahead (or whose pay date is, when the source knows it).
  const decl = opts.declared;
  let declaredEx: number | null = null;
  if (decl?.exDate && decl.exDate > now) declaredEx = decl.exDate;
  else if (decl?.payDate && decl.payDate > now) declaredEx = decl.exDate ?? decl.payDate - lag * DAY;
  if (declaredEx) {
    const payDate = decl?.payDate && decl.payDate > now ? decl.payDate : payDateFor(declaredEx, lag);
    if (payDate <= end) {
      upcoming.push({
        payDate,
        exDate: declaredEx,
        amountPerShare: decl?.amount ?? last?.amount ?? 0,
        status: "declared",
      });
    }
  }

  // 2. Projected payments from cadence, one period after the last known (or declared)
  //    ex-date, never in the past. The ex-date is placed with the inferred rule when there
  //    is one. The amount is the last paid one for monthly payers; for the rest, the payment
  //    of the same period a year earlier scaled by the latest year-on-year change (ETFs
  //    distribute different amounts each quarter), falling back to the last amount.
  if (cadence && last) {
    const step = cadenceMonths(cadence);
    const anchor = declaredEx ?? last.date;
    const growth = cadence !== "monthly" && lastChangePct != null ? 1 + lastChangePct : 1;
    const amountFor = (ex: number): number => {
      if (decl?.amount != null && cadence === "monthly") return decl.amount;
      if (cadence === "monthly") return last.amount;
      const ya = yearAgoEvent(events, ex);
      return ya ? ya.amount * growth : (decl?.amount ?? last.amount);
    };

    let k = 1;
    for (;;) {
      const base = addMonths(anchor, step * k);
      const d = new Date(base * 1000);
      const ex = exRule ? applyExRule(exRule, d.getUTCFullYear(), d.getUTCMonth()) : prevBusinessDay(base);
      k++;
      if (ex <= now) continue;
      const payDate = payDateFor(ex, lag);
      if (payDate > end) break;
      upcoming.push({ payDate, exDate: ex, amountPerShare: amountFor(ex), status: "projected" });
      if (k > 60) break; // safety
    }
  }

  upcoming.sort((a, b) => a.payDate - b.payDate);
  return {
    cadence,
    exRule,
    lastAmount: last?.amount ?? null,
    lastExDate: last?.date ?? null,
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
  let best = yearAgoEvent(events, last.date, last);
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
