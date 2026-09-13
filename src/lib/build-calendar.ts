/**
 * Glue between the host APIs and the pure projection module.
 *
 * For every equity-type holding across all accounts:
 *   1. history  = api.market.fetchDividends(symbol + MIC, last 24 months)  (host provider)
 *   2. primary  = Yahoo primary (US) listing found by name; its crumb-free `chart?events=div`
 *                 exposes the latest DECLARED dividend (ex-date in the future) weeks earlier
 *                 than the European listing.
 *   3. project(history, { declared })
 *   4. scale per-share amounts by quantity and convert to base currency with the holding fx rate
 */
import type { AddonContext, Holding } from "@wealthfolio/addon-sdk";
import { project, type PastDividend, type Projection, type UpcomingPayment } from "./projection";
import { fetchPrimaryDividends, findPrimarySymbol, lastSearchError } from "./yahoo-calendar";

export interface AssetCalendar {
  assetId: string;
  symbol: string;
  name: string;
  currency: string;
  quantity: number;
  price: number | null;
  /** average cost per unit in local currency, when known */
  avgCost: number | null;
  fxRate: number; // local -> base
  projection: Projection;
  /** upcoming payments already multiplied by quantity, in base currency */
  upcoming: Array<UpcomingPayment & { amountBase: number; amountLocal: number }>;
  /** forward annual yield on current price and on cost, as fractions */
  yieldOnPrice: number | null;
  yieldOnCost: number | null;
  /** annual per-share income used for yields (TTM of the holding's own history) */
  annualPerShare: number | null;
  primarySymbol: string | null;
  /** why there is no declared calendar data (diagnostic) */
  calendarNote?: string;
  error?: string;
}

export interface CalendarResult {
  assets: AssetCalendar[];
  baseCurrency: string;
  generatedAt: number;
}

const DAY = 86_400;
const HISTORY_MONTHS = 24;

function isoDate(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(0, 10);
}

/** Merge the same instrument held in several accounts. */
function mergeHoldings(all: Holding[]): Holding[] {
  const byInstrument = new Map<string, Holding>();
  for (const h of all) {
    if (h.holdingType !== "security" || !h.instrument || h.quantity <= 0) continue;
    const key = h.instrument.id;
    const prev = byInstrument.get(key);
    if (!prev) {
      byInstrument.set(key, { ...h });
      continue;
    }
    byInstrument.set(key, {
      ...prev,
      quantity: prev.quantity + h.quantity,
      marketValue: {
        local: prev.marketValue.local + h.marketValue.local,
        base: prev.marketValue.base + h.marketValue.base,
      },
      costBasis:
        prev.costBasis && h.costBasis
          ? { local: prev.costBasis.local + h.costBasis.local, base: prev.costBasis.base + h.costBasis.base }
          : (prev.costBasis ?? h.costBasis ?? null),
    });
  }
  return [...byInstrument.values()];
}

/** Minimal MIC -> Yahoo suffix map (the host has the full one). */
const MIC_SUFFIX: Record<string, string> = {
  XFRA: ".F", XETR: ".DE", XSTU: ".SG", XDUS: ".DU", XMUN: ".MU", XHAM: ".HM", XBER: ".BE",
  XLON: ".L", XAMS: ".AS", XPAR: ".PA", XMIL: ".MI", XMAD: ".MC", XBRU: ".BR", XLIS: ".LS",
  XSWX: ".SW", XVTX: ".SW", XTSE: ".TO", XASX: ".AX", XTKS: ".T", XHKG: ".HK",
  XNAS: "", XNYS: "", ARCX: "", XASE: "", BATS: "",
};
function yahooSymbolFor(symbol: string, mic: string | null): string {
  if (!mic || symbol.includes(".")) return symbol;
  const suffix = MIC_SUFFIX[mic];
  return suffix === undefined ? symbol : symbol + suffix;
}

function emptyProjection(): Projection {
  return { cadence: null, lastAmount: null, lastPayDate: null, lastChangePct: null, ttmPerShare: 0, upcoming: [] };
}

/**
 * Convert a primary-listing per-share amount into the holding currency using the ratio
 * between the two listings' last paid amounts (same cash dividend, so the ratio IS the FX
 * rate at that payment). Falls back to 1 when there is nothing to compare.
 */
function primaryToLocalRatio(local: PastDividend[], primary: PastDividend[]): number {
  const l = local.at(-1);
  if (!l) return 1;
  let best: PastDividend | null = null;
  for (const p of primary) {
    if (!best || Math.abs(p.date - l.date) < Math.abs(best.date - l.date)) best = p;
  }
  if (!best || Math.abs(best.date - l.date) > 45 * DAY || best.amount <= 0) return 1;
  return l.amount / best.amount;
}

export async function buildCalendar(ctx: AddonContext, opts: { now?: number; horizonMonths?: number } = {}): Promise<CalendarResult> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const horizon = opts.horizonMonths ?? 12;
  const api = ctx.api;

  const accounts = await api.accounts.getAll();
  const perAccount = await Promise.all(
    accounts.filter((a) => a.isActive !== false).map((a) => api.portfolio.getHoldings(a.id).catch(() => [] as Holding[])),
  );
  const holdings = mergeHoldings(perAccount.flat());
  const baseCurrency = holdings[0]?.baseCurrency ?? "EUR";

  const assets = await Promise.all(
    holdings.map(async (h): Promise<AssetCalendar> => {
      const inst = h.instrument!;
      const symbol = inst.symbol;
      const fxRate = h.fxRate ?? (h.marketValue.local ? h.marketValue.base / h.marketValue.local : 1);
      const avgCost = h.costBasis && h.quantity ? h.costBasis.local / h.quantity : null;
      const base = {
        assetId: inst.id,
        symbol,
        name: inst.name ?? symbol,
        currency: inst.currency,
        quantity: h.quantity,
        price: h.price ?? null,
        avgCost,
        fxRate,
      };
      const empty = (error?: string): AssetCalendar => ({
        ...base,
        projection: emptyProjection(),
        upcoming: [],
        yieldOnPrice: null,
        yieldOnCost: null,
        annualPerShare: null,
        primarySymbol: null,
        error,
      });

      try {
        const profile = await api.assets.getProfile(inst.id).catch(() => null);
        const instrumentType = profile?.instrumentType ?? null;
        if (instrumentType && instrumentType !== "EQUITY") return empty("not-equity");

        // 1. History through the host (provider-aware). Pass symbol + MIC so the host
        //    resolver turns `RY6` + `XFRA` into Yahoo's `RY6.F`.
        const providerSymbol = profile?.instrumentSymbol ?? symbol;
        const mic = profile?.instrumentExchangeMic ?? null;
        const raw = await api.market
          .fetchDividends(providerSymbol, {
            startDate: isoDate(now - HISTORY_MONTHS * 30 * DAY),
            endDate: isoDate(now),
            quoteCcy: profile?.quoteCcy ?? inst.currency,
            exchangeMic: mic ?? undefined,
            instrumentType: instrumentType ?? "EQUITY",
            providerId: inst.preferredProvider ?? undefined,
          })
          .catch(() => []);
        const history: PastDividend[] = raw.map((d) => ({ amount: d.amount, date: d.date }));

        // 2. Declared next dividend from the US primary listing (crumb-free chart API).
        const yahooLocal = yahooSymbolFor(providerSymbol, mic);
        const isin = typeof profile?.metadata?.["isin"] === "string" ? (profile.metadata["isin"] as string) : null;
        let primary: string | null = null;
        if (isin) primary = await findPrimarySymbol(api.network, isin);
        if (!primary && inst.name) primary = await findPrimarySymbol(api.network, inst.name);
        if (primary === yahooLocal) primary = null; // we already hold the primary

        let declared: { amount: number; exDate: number } | null = null;
        let calendarNote: string | undefined;
        if (primary) {
          const pd = await fetchPrimaryDividends(api.network, primary, HISTORY_MONTHS);
          const future = pd.events.filter((e) => e.date > now).sort((a, b) => a.date - b.date)[0];
          if (future) {
            const ratio = primaryToLocalRatio(history, pd.events);
            declared = { amount: future.amount * ratio, exDate: future.date };
          } else {
            calendarNote = pd.note ?? "no-declared-yet";
          }
        } else {
          calendarNote = lastSearchError ?? "no-primary";
        }

        const projection = project(history, { now, horizonMonths: horizon, declared });
        const annualPerShare = projection.ttmPerShare || null;
        const upcoming = projection.upcoming.map((u) => ({
          ...u,
          amountLocal: u.amountPerShare * h.quantity,
          amountBase: u.amountPerShare * h.quantity * fxRate,
        }));
        return {
          ...base,
          projection,
          upcoming,
          annualPerShare,
          yieldOnPrice: annualPerShare && h.price ? annualPerShare / h.price : null,
          yieldOnCost: annualPerShare && avgCost ? annualPerShare / avgCost : null,
          primarySymbol: primary,
          calendarNote: declared ? undefined : calendarNote,
        };
      } catch (e) {
        return empty(e instanceof Error ? e.message : String(e));
      }
    }),
  );

  return { assets: assets.filter((a) => a.error !== "not-equity"), baseCurrency, generatedAt: now };
}
