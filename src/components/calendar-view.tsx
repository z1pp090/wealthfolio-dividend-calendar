import { useAddonTranslation } from "@wealthfolio/addon-sdk";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  Progress,
  type ChartConfig,
} from "@wealthfolio/ui";
import { useMemo } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import type { AssetCalendar, CalendarResult } from "../lib/build-calendar";
import { projectLongTerm } from "../lib/long-term";
import { monthKey, monthKeys, type ExRule } from "../lib/projection";
import { byMonth as receivedByMonth, byYear, cumulative, trailing12 } from "../lib/received";
import { useNarrow } from "../lib/use-narrow";
import { MonthGrid } from "./month-grid";

interface Props {
  data: CalendarResult;
  hidden: boolean;
}

const LOCALES: Record<string, string> = { en: "en-GB", es: "es-ES", fr: "fr-FR", de: "de-DE", it: "it-IT", pt: "pt-PT", nl: "nl-NL" };
const localeFor = (lang: string) => LOCALES[lang] ?? lang;

/** Distinct hues that read on both themes (the host's --chart-N tokens are shades of one hue). */
const PALETTE = ["#4f9d9d", "#c9a227", "#8e7cc3", "#d97757", "#6aa84f", "#c95d8a", "#5b8def"];

/** Previous N month keys ending the month before `now`. */
function pastMonthKeys(now: number, n: number): string[] {
  const d = new Date(now * 1000);
  const keys: string[] = [];
  for (let i = n; i >= 1; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    keys.push(monthKey(Math.floor(m.getTime() / 1000)));
  }
  return keys;
}

export function CalendarView({ data, hidden }: Props) {
  const { t, language } = useAddonTranslation();
  const locale = localeFor(language);
  const ccy = data.baseCurrency;
  const now = data.generatedAt;
  const narrow = useNarrow();

  const fmtMoney = (v: number) =>
    hidden ? "••••" : new Intl.NumberFormat(locale, { style: "currency", currency: ccy, maximumFractionDigits: 2 }).format(v);
  const fmtMoney0 = (v: number) =>
    hidden ? "••••" : new Intl.NumberFormat(locale, { style: "currency", currency: ccy, maximumFractionDigits: 0 }).format(v);
  const fmtPct = (v: number | null) => (v == null ? "—" : `${(v * 100).toLocaleString(locale, { maximumFractionDigits: 2 })} %`);
  const fmtDate = (unix: number | null) =>
    unix == null ? "—" : new Date(unix * 1000).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
  const fmtMonth = (key: string) => {
    const [y, m] = key.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(locale, { month: "short", year: "2-digit", timeZone: "UTC" });
  };
  const weekdayName = (wd: number) =>
    new Date(Date.UTC(2024, 0, 7 + wd)).toLocaleDateString(locale, { weekday: "long", timeZone: "UTC" });
  const exRuleLabel = (r: ExRule | null) => {
    if (!r) return t("exRule.unknown");
    switch (r.kind) {
      case "nth-weekday":
        return t("exRule.nthWeekday", { n: t(`ordinal.${r.n}`), weekday: weekdayName(r.weekday) });
      case "last-weekday":
        return t("exRule.lastWeekday", { weekday: weekdayName(r.weekday) });
      case "last-business-day":
        return t("exRule.lastBusinessDay");
      case "day-of-month":
        return t("exRule.dayOfMonth", { day: r.day });
    }
  };

  // ---- future (projected) -----------------------------------------------------------
  const months = useMemo(() => monthKeys(now, 12), [now]);

  const rows = useMemo(() => {
    return data.assets
      .map((a) => {
        const byMonth = new Map<string, { gross: number; net: number }>();
        for (const u of a.upcoming) {
          const k = monthKey(u.payDate);
          const prev = byMonth.get(k) ?? { gross: 0, net: 0 };
          byMonth.set(k, { gross: prev.gross + u.amountBase, net: prev.net + u.netBase });
        }
        const totalGross = a.upcoming.reduce((s, u) => s + u.amountBase, 0);
        const totalNet = a.upcoming.reduce((s, u) => s + u.netBase, 0);
        return { asset: a, byMonth, totalGross, totalNet };
      })
      .sort((x, y) => y.totalNet - x.totalNet);
  }, [data]);

  const monthTotals = useMemo(
    () =>
      months.map((m) =>
        rows.reduce(
          (s, r) => {
            const v = r.byMonth.get(m);
            return { gross: s.gross + (v?.gross ?? 0), net: s.net + (v?.net ?? 0) };
          },
          { gross: 0, net: 0 },
        ),
      ),
    [rows, months],
  );
  const total12Gross = monthTotals.reduce((s, v) => s + v.gross, 0);
  const total12Net = monthTotals.reduce((s, v) => s + v.net, 0);
  const monthlyNet = total12Net / 12;
  const declaredCount = data.assets.reduce((s, a) => s + a.upcoming.filter((u) => u.status === "declared").length, 0);
  const paymentsCount = data.assets.reduce((s, a) => s + a.upcoming.length, 0);

  const upcomingList = useMemo(
    () => data.assets.flatMap((a) => a.upcoming.map((u) => ({ a, u }))).sort((x, y) => x.u.payDate - y.u.payDate),
    [data],
  );

  // ---- past (received) ----------------------------------------------------------------
  const received = data.received;
  const receivedMonths = useMemo(() => receivedByMonth(received), [received]);
  const received12 = trailing12(received, now);
  const received12Count = received.filter((e) => e.date > now - 365 * 86_400 && e.date <= now).length;
  const receivedTotal = received.reduce((s, e) => s + e.net, 0);
  const firstReceived = received[0]?.date ?? null;
  const cumulativeSeries = useMemo(() => cumulative(received), [received]);
  const yearRows = useMemo(() => byYear(received), [received]);

  // ---- series: current holdings; dividends of positions no longer held are folded into one
  //      "sold" series so the legend and the tables only list what is in the portfolio ----------
  const OTHER = "__sold__";
  const held = useMemo(() => rows.map((r) => r.asset.symbol), [rows]);
  const hasSold = received.some((e) => !held.includes(e.symbol));
  const symbols = useMemo(() => (hasSold ? [...held, OTHER] : held), [held, hasSold]);
  const seriesOf = (symbol: string) => (held.includes(symbol) ? symbol : OTHER);
  const labelOf = (s: string) => (s === OTHER ? t("months.sold") : s);
  const colorOf = (symbol: string) => (seriesOf(symbol) === OTHER ? "#8a8a8a" : PALETTE[Math.max(0, held.indexOf(symbol)) % PALETTE.length]);
  const chartConfig: ChartConfig = Object.fromEntries(symbols.map((s) => [s, { label: labelOf(s), color: colorOf(s) }]));
  const sumBySeries = (bySymbol: Record<string, number>): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [sym, v] of Object.entries(bySymbol)) out[seriesOf(sym)] = (out[seriesOf(sym)] ?? 0) + v;
    return out;
  };

  // ---- 24-month chart: 12 received + 12 projected ---------------------------------------
  const pastKeys = useMemo(() => pastMonthKeys(now, 12), [now]);
  const chart24 = useMemo(() => {
    const out: Array<Record<string, number | string | boolean>> = [];
    for (const k of pastKeys) {
      const b = receivedMonths.get(k);
      const bySeries = b ? sumBySeries(b.bySymbol) : {};
      const row: Record<string, number | string | boolean> = { month: fmtMonth(k), key: k, past: true, total: b?.net ?? 0 };
      for (const s of symbols) row[s] = bySeries[s] ?? 0;
      out.push(row);
    }
    months.forEach((k, i) => {
      const row: Record<string, number | string | boolean> = { month: fmtMonth(k), key: k, past: false, total: monthTotals[i].net };
      for (const s of symbols) row[s] = rows.find((r) => r.asset.symbol === s)?.byMonth.get(k)?.net ?? 0;
      // the current month may also hold payments already received
      const b = receivedMonths.get(k);
      if (b) {
        const bySeries = sumBySeries(b.bySymbol);
        for (const s of symbols) row[s] = (row[s] as number) + (bySeries[s] ?? 0);
        row.total = (row.total as number) + b.net;
      }
      out.push(row);
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastKeys, months, receivedMonths, rows, monthTotals, symbols, locale]);

  // ---- goal + long-term -----------------------------------------------------------------
  const goal = data.settings.goalMonthly;
  const goalPct = goal > 0 ? Math.min(1, monthlyNet / goal) : 0;
  const longTerm = useMemo(
    () =>
      projectLongTerm({
        annualNet: total12Net,
        marketValue: data.marketValue,
        monthlyContribution: data.settings.monthlyContribution,
        dividendGrowth: data.settings.dividendGrowthPct / 100,
        reinvest: data.settings.reinvest,
        goalMonthly: goal,
        startYear: new Date(now * 1000).getUTCFullYear(),
        maxYears: 40,
      }),
    [total12Net, data.marketValue, data.settings, goal, now],
  );
  const longTermPoints = useMemo(() => {
    const end = longTerm.goalYear ? Math.min(longTerm.points.length - 1, longTerm.goalYear - longTerm.points[0].year + 3) : 30;
    return longTerm.points.slice(0, end + 1);
  }, [longTerm]);

  // Own tooltip: series labels through labelOf (the sold bucket has an internal key) and
  // zero rows hidden, which the stock ChartTooltipContent cannot do.
  const moneyTooltip = (
    <MoneyTooltip
      labelOf={(k) => (k === "monthly" ? t("longTerm.monthly") : k === "total" ? t("cumulative.title") : labelOf(k))}
      fmt={fmtMoney}
    />
  );
  const axisMoney = (v: number) => (hidden ? "••" : new Intl.NumberFormat(locale, { maximumFractionDigits: Math.abs(v) < 20 ? 1 : 0 }).format(v));

  return (
    <div className="flex flex-col gap-4">
      <div className={narrow ? "grid grid-cols-2 gap-2" : "grid gap-4 sm:grid-cols-2 lg:grid-cols-4"}>
        <Stat compact={narrow} title={t("stats.next12")} value={fmtMoney(total12Net)} hint={narrow ? t("stats.next12Gross", { value: fmtMoney(total12Gross) }) : `${t("stats.next12Gross", { value: fmtMoney(total12Gross) })} · ${t("stats.paymentsHint", { count: paymentsCount, declared: declaredCount })}`} />
        <Stat compact={narrow} title={t("stats.monthlyAvg")} value={fmtMoney(monthlyNet)} hint={narrow ? t("stats.paymentsHint", { count: paymentsCount, declared: declaredCount }) : undefined} />
        <Stat compact={narrow} title={t("stats.received12")} value={fmtMoney(received12)} hint={t("stats.received12Hint", { count: received12Count })} />
        <Stat compact={narrow} title={t("stats.receivedTotal")} value={fmtMoney(receivedTotal)} hint={firstReceived ? t("stats.receivedTotalHint", { date: fmtDate(firstReceived) }) : undefined} />
      </div>

      {goal > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t("goal.title")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Progress value={goalPct * 100} className="h-3" />
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm">
                {t("goal.progress", { current: fmtMoney(monthlyNet), goal: fmtMoney(goal), pct: fmtPct(monthlyNet / goal) })}
              </span>
              {!narrow && <span className="text-muted-foreground text-xs">{t("goal.hint")}</span>}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">{t("months.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-64 w-full">
            <BarChart data={chart24} margin={{ left: 4, right: 4, top: 16, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={11} interval="preserveStartEnd" minTickGap={28} />
              <YAxis tickLine={false} axisLine={false} fontSize={11} width={56} tickFormatter={axisMoney} />
              <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.4 }} content={moneyTooltip} />
              <ChartLegend content={<ChartLegendContent />} />
              {symbols.map((s) => (
                <Bar key={s} dataKey={s} stackId="net" fill={`var(--color-${s})`} radius={0}>
                  {chart24.map((row, i) => (
                    <Cell key={i} fillOpacity={row.past ? 0.45 : 1} />
                  ))}
                </Bar>
              ))}
            </BarChart>
          </ChartContainer>
          <p className="text-muted-foreground mt-1 text-xs">
            <span style={{ opacity: 0.45 }}>■</span> {t("months.received")} · ■ {t("months.projected")}
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t("cumulative.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            {cumulativeSeries.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("cumulative.empty")}</p>
            ) : (
              <ChartContainer config={{ total: { label: t("cumulative.title"), color: PALETTE[0] } }} className="h-48 w-full">
                <AreaChart data={cumulativeSeries.map((p) => ({ month: fmtMonth(p.month), total: p.total }))} margin={{ left: 4, right: 4, top: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={11} interval="preserveStartEnd" minTickGap={28} />
                  <YAxis tickLine={false} axisLine={false} fontSize={11} width={56} tickFormatter={axisMoney} />
                  <ChartTooltip content={moneyTooltip} />
                  <Area type="monotone" dataKey="total" stroke="var(--color-total)" fill="var(--color-total)" fillOpacity={0.25} />
                </AreaChart>
              </ChartContainer>
            )}
            <p className="text-muted-foreground mt-1 text-xs">{t("cumulative.hint")}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t("longTerm.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-2 text-sm font-medium">
              {goal <= 0
                ? t("longTerm.noGoal")
                : longTerm.goalYear
                  ? t("longTerm.reach", { goal: fmtMoney0(goal), year: longTerm.goalYear })
                  : t("longTerm.notReached", { years: 40 })}
            </p>
            <ChartContainer config={{ monthly: { label: t("longTerm.monthly"), color: PALETTE[1] } }} className="h-40 w-full">
              <LineChart data={longTermPoints} margin={{ left: 4, right: 4, top: 8, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="year" tickLine={false} axisLine={false} fontSize={11} interval="preserveStartEnd" minTickGap={28} />
                <YAxis tickLine={false} axisLine={false} fontSize={11} width={56} tickFormatter={axisMoney} />
                <ChartTooltip content={moneyTooltip} />
                {goal > 0 && (
                  <ReferenceLine
                    y={goal}
                    stroke="var(--muted-foreground)"
                    strokeDasharray="4 4"
                    label={{ value: t("longTerm.goalLine"), position: "insideTopLeft", fontSize: 10, fill: "var(--muted-foreground)" }}
                  />
                )}
                <Line type="monotone" dataKey="monthly" stroke="var(--color-monthly)" dot={false} strokeWidth={2} />
              </LineChart>
            </ChartContainer>
            <p className="text-muted-foreground mt-1 text-xs">
              {t("longTerm.hint", {
                yield: fmtPct(longTerm.yieldUsed),
                growth: fmtPct(data.settings.dividendGrowthPct / 100),
                contribution: fmtMoney0(data.settings.monthlyContribution),
                reinvest: data.settings.reinvest ? t("longTerm.reinvestOn") : t("longTerm.reinvestOff"),
              })}
            </p>
          </CardContent>
        </Card>
      </div>

      <MonthGrid assets={data.assets} received={received} colorOf={colorOf} now={now} locale={locale} hidden={hidden} fmtMoney={fmtMoney} />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">{t("upcoming.title")}</CardTitle>
        </CardHeader>
        {/* Inline styles: the addon ships no Tailwind CSS of its own, only classes the host already has. */}
        <CardContent style={{ maxHeight: "22rem", overflow: "auto" }}>
          {narrow ? (
            <ul className="flex flex-col">
              {upcomingList.map(({ a, u }, i) => (
                <li key={`${a.assetId}-${u.payDate}-${i}`} className="border-border/50 flex items-center gap-3 border-t py-2 text-sm">
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: colorOf(a.symbol), flex: "0 0 auto" }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium">{fmtDate(u.payDate)}</span>
                      <span className="text-muted-foreground text-xs">{a.symbol}</span>
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {t("upcoming.exDate")} {fmtDate(u.exDate)} · {hidden ? "••••" : `${u.amountPerShare.toFixed(4)} ${a.currency}`}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium tabular-nums">{fmtMoney(u.netBase)}</div>
                    <div className="text-muted-foreground text-xs">{t(`upcoming.${u.status}`)}</div>
                  </div>
                </li>
              ))}
              {upcomingList.length === 0 && <li className="text-muted-foreground py-4 text-center text-sm">{t("noHistory")}</li>}
            </ul>
          ) : (
          <table className="w-full text-sm">
            <thead className="bg-card text-muted-foreground text-left text-xs" style={{ position: "sticky", top: 0, zIndex: 1 }}>
              <tr>
                <th className="py-1 pr-3">{t("upcoming.payDate")}</th>
                <th className="py-1 pr-3">{t("upcoming.exDate")}</th>
                <th className="py-1 pr-3">{t("upcoming.asset")}</th>
                <th className="py-1 pr-3 text-right">{t("upcoming.perShare")}</th>
                <th className="py-1 pr-3 text-right">{t("upcoming.gross")}</th>
                <th className="py-1 pr-3 text-right">{t("upcoming.net")}</th>
                <th className="py-1">{t("upcoming.status")}</th>
              </tr>
            </thead>
            <tbody>
              {upcomingList.map(({ a, u }, i) => (
                <tr key={`${a.assetId}-${u.payDate}-${i}`} className="border-border/50 border-t">
                  <td className="py-1.5 pr-3 whitespace-nowrap">{fmtDate(u.payDate)}</td>
                  <td className="text-muted-foreground py-1.5 pr-3 whitespace-nowrap">{fmtDate(u.exDate)}</td>
                  <td className="py-1.5 pr-3">
                    <span className="font-medium">{a.symbol}</span>
                    <span className="text-muted-foreground ml-2 hidden sm:inline">{a.name}</span>
                  </td>
                  <td className="py-1.5 pr-3 text-right whitespace-nowrap">{hidden ? "••••" : `${u.amountPerShare.toFixed(4)} ${a.currency}`}</td>
                  <td className="text-muted-foreground py-1.5 pr-3 text-right whitespace-nowrap">{fmtMoney(u.amountBase)}</td>
                  <td className="py-1.5 pr-3 text-right font-medium whitespace-nowrap">{fmtMoney(u.netBase)}</td>
                  <td className="py-1.5">
                    <Badge variant={u.status === "declared" ? "default" : "secondary"}>{t(`upcoming.${u.status}`)}</Badge>
                  </td>
                </tr>
              ))}
              {upcomingList.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-muted-foreground py-4 text-center">
                    {t("noHistory")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">{t("grid.title")}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {narrow ? (
            <ul className="flex flex-col">
              {months.map((m, i) => (
                <li key={m} className="border-border/50 flex items-start justify-between gap-3 border-t py-2 text-sm">
                  <div>
                    <div className="font-medium capitalize">{fmtMonth(m)}</div>
                    <div className="text-muted-foreground flex flex-wrap gap-x-3 text-xs">
                      {rows
                        .filter((r) => r.byMonth.get(m)?.net)
                        .map((r) => (
                          <span key={r.asset.assetId}>
                            {r.asset.symbol} {fmtMoney(r.byMonth.get(m)!.net)}
                          </span>
                        ))}
                    </div>
                  </div>
                  <span className="font-medium tabular-nums">{monthTotals[i].net ? fmtMoney(monthTotals[i].net) : "·"}</span>
                </li>
              ))}
              <li className="border-border flex items-center justify-between border-t py-2 text-sm font-medium">
                <span>{t("grid.total")}</span>
                <span className="tabular-nums">{fmtMoney(total12Net)}</span>
              </li>
            </ul>
          ) : (
          <table className="w-full text-xs">
            <thead className="text-muted-foreground text-left">
              <tr>
                <th className="py-1 pr-2">{t("grid.asset")}</th>
                {months.map((m) => (
                  <th key={m} className="px-1 py-1 text-right whitespace-nowrap">{fmtMonth(m)}</th>
                ))}
                <th className="py-1 pl-2 text-right">{t("grid.total")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ asset, byMonth, totalNet }) => (
                <tr key={asset.assetId} className="border-border/50 border-t">
                  <td className="py-1 pr-2 font-medium whitespace-nowrap">{asset.symbol}</td>
                  {months.map((m) => {
                    const v = byMonth.get(m)?.net;
                    return (
                      <td key={m} className="px-1 py-1 text-right tabular-nums">{v ? fmtMoney(v) : <span className="text-muted-foreground">·</span>}</td>
                    );
                  })}
                  <td className="py-1 pl-2 text-right font-medium tabular-nums">{fmtMoney(totalNet)}</td>
                </tr>
              ))}
              <tr className="border-border border-t font-medium">
                <td className="py-1 pr-2">{t("grid.total")}</td>
                {monthTotals.map((v, i) => (
                  <td key={months[i]} className="px-1 py-1 text-right tabular-nums">{v.net ? fmtMoney(v.net) : "·"}</td>
                ))}
                <td className="py-1 pl-2 text-right tabular-nums">{fmtMoney(total12Net)}</td>
              </tr>
            </tbody>
          </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">{t("years.title")}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {yearRows.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("years.empty")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-left text-xs">
                <tr>
                  <th className="py-1 pr-3">{t("years.year")}</th>
                  {!narrow &&
                    symbols.map((s) => (
                      <th key={s} className="py-1 pr-3 text-right">{labelOf(s)}</th>
                    ))}
                  <th className="py-1 pr-3 text-right">{t("years.total")}</th>
                  <th className="py-1 text-right">{t("years.growth")}</th>
                </tr>
              </thead>
              <tbody>
                {yearRows.map((r) => {
                  const bySeries = sumBySeries(r.bySymbol);
                  return (
                  <tr key={r.year} className="border-border/50 border-t">
                    <td className="py-1.5 pr-3 font-medium">{r.year}</td>
                    {!narrow &&
                      symbols.map((s) => (
                        <td key={s} className="py-1.5 pr-3 text-right tabular-nums">{bySeries[s] ? fmtMoney(bySeries[s]) : <span className="text-muted-foreground">·</span>}</td>
                      ))}
                    <td className="py-1.5 pr-3 text-right font-medium tabular-nums">{fmtMoney(r.total)}</td>
                    <td className={`py-1.5 text-right ${r.growth == null ? "text-muted-foreground" : r.growth >= 0 ? "text-success" : "text-destructive"}`}>
                      {r.growth == null ? "—" : `${r.growth >= 0 ? "+" : ""}${(r.growth * 100).toFixed(1)} %`}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">{t("perAsset.title")}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {narrow ? (
            <ul className="flex flex-col">
              {data.assets.map((a) => {
                const p = a.projection;
                const kv: Array<[string, string]> = [
                  [t("perAsset.cadence"), p.cadence ? t(`cadence.${p.cadence}`) : "—"],
                  [t("perAsset.exRule"), exRuleLabel(p.exRule)],
                  [t("perAsset.lastPaid"), p.lastAmount != null ? `${hidden ? "••••" : p.lastAmount.toFixed(4)} ${a.currency} · ${fmtDate(p.lastExDate)}` : "—"],
                  [t("perAsset.yoy"), p.lastChangePct == null ? "—" : `${p.lastChangePct >= 0 ? "+" : ""}${(p.lastChangePct * 100).toFixed(1)} %`],
                  [t("perAsset.annual"), a.annualPerShare != null ? `${hidden ? "••••" : a.annualPerShare.toFixed(4)} ${a.currency}` : "—"],
                  [t("perAsset.yield"), fmtPct(a.yieldOnPrice)],
                  [t("perAsset.yoc"), fmtPct(a.yieldOnCost)],
                  [t("perAsset.withholding"), `${a.withholdingPct} %`],
                  [t("perAsset.source"), a.error ?? (a.declaredFromPrimary && a.primarySymbol ? t("perAsset.viaCalendar", { symbol: a.primarySymbol }) : `${t("perAsset.history")}${a.calendarNote ? ` (${a.calendarNote})` : ""}`)],
                ];
                return (
                  <li key={a.assetId} className="border-border/50 border-t py-2 text-sm">
                    <div className="mb-1 flex items-center gap-2">
                      <span style={{ width: 8, height: 8, borderRadius: 999, background: colorOf(a.symbol) }} />
                      <span className="font-medium">{a.symbol}</span>
                      <span className="text-muted-foreground truncate text-xs">{a.name}</span>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                      {kv.map(([k, v]) => (
                        <div key={k} className="contents">
                          <dt className="text-muted-foreground">{k}</dt>
                          <dd className="text-right tabular-nums">{v}</dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                );
              })}
            </ul>
          ) : (
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-left text-xs">
              <tr>
                <th className="py-1 pr-3">{t("perAsset.asset")}</th>
                <th className="py-1 pr-3">{t("perAsset.cadence")}</th>
                <th className="py-1 pr-3">{t("perAsset.exRule")}</th>
                <th className="py-1 pr-3 text-right">{t("perAsset.lastPaid")}</th>
                <th className="py-1 pr-3 text-right">{t("perAsset.yoy")}</th>
                <th className="py-1 pr-3 text-right">{t("perAsset.annual")}</th>
                <th className="py-1 pr-3 text-right">{t("perAsset.yield")}</th>
                <th className="py-1 pr-3 text-right">{t("perAsset.yoc")}</th>
                <th className="py-1 pr-3 text-right">{t("perAsset.withholding")}</th>
                <th className="py-1">{t("perAsset.source")}</th>
              </tr>
            </thead>
            <tbody>
              {data.assets.map((a) => (
                <AssetRow key={a.assetId} a={a} hidden={hidden} fmtDate={fmtDate} fmtPct={fmtPct} exRuleLabel={exRuleLabel} />
              ))}
            </tbody>
          </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface TooltipItem {
  name?: string | number;
  dataKey?: string | number;
  value?: number | string;
  color?: string;
}

function MoneyTooltip({
  active,
  payload,
  label,
  labelOf,
  fmt,
}: {
  active?: boolean;
  payload?: TooltipItem[];
  label?: string | number;
  labelOf: (key: string) => string;
  fmt: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => Number(p.value) > 0);
  if (!rows.length) return null;
  return (
    <div className="border-border/50 bg-background grid gap-1 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl" style={{ minWidth: "9rem" }}>
      {label != null && <div className="font-medium">{String(label)}</div>}
      {rows.map((p, i) => (
        <div key={i} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5">
            <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color ?? "currentColor", display: "inline-block" }} />
            <span className="text-muted-foreground">{labelOf(String(p.dataKey ?? p.name ?? ""))}</span>
          </span>
          <span className="font-mono font-medium tabular-nums">{fmt(Number(p.value))}</span>
        </div>
      ))}
    </div>
  );
}

function AssetRow({
  a,
  hidden,
  fmtDate,
  fmtPct,
  exRuleLabel,
}: {
  a: AssetCalendar;
  hidden: boolean;
  fmtDate: (u: number | null) => string;
  fmtPct: (v: number | null) => string;
  exRuleLabel: (r: ExRule | null) => string;
}) {
  const { t } = useAddonTranslation();
  const p = a.projection;
  return (
    <tr className="border-border/50 border-t">
      <td className="py-1.5 pr-3">
        <span className="font-medium">{a.symbol}</span>
        <span className="text-muted-foreground ml-2 hidden md:inline">{a.name}</span>
      </td>
      <td className="py-1.5 pr-3">{p.cadence ? t(`cadence.${p.cadence}`) : "—"}</td>
      <td className="py-1.5 pr-3 whitespace-nowrap">{exRuleLabel(p.exRule)}</td>
      <td className="py-1.5 pr-3 text-right whitespace-nowrap">
        {p.lastAmount != null ? `${hidden ? "••••" : p.lastAmount.toFixed(4)} ${a.currency}` : "—"}
        {p.lastExDate && <span className="text-muted-foreground ml-1 text-xs">{fmtDate(p.lastExDate)}</span>}
      </td>
      <td className={`py-1.5 pr-3 text-right ${p.lastChangePct == null ? "" : p.lastChangePct >= 0 ? "text-success" : "text-destructive"}`}>
        {p.lastChangePct == null ? "—" : `${p.lastChangePct >= 0 ? "+" : ""}${(p.lastChangePct * 100).toFixed(1)} %`}
      </td>
      <td className="py-1.5 pr-3 text-right whitespace-nowrap">{a.annualPerShare != null ? `${hidden ? "••••" : a.annualPerShare.toFixed(4)} ${a.currency}` : "—"}</td>
      <td className="py-1.5 pr-3 text-right">{fmtPct(a.yieldOnPrice)}</td>
      <td className="py-1.5 pr-3 text-right">{fmtPct(a.yieldOnCost)}</td>
      <td className="py-1.5 pr-3 text-right whitespace-nowrap">{a.withholdingPct} %</td>
      <td className="py-1.5 text-xs">
        {a.error ? (
          <span className="text-destructive">{a.error}</span>
        ) : a.declaredFromPrimary && a.primarySymbol ? (
          <span className="text-muted-foreground">{t("perAsset.viaCalendar", { symbol: a.primarySymbol })}</span>
        ) : (
          <span className="text-muted-foreground" title={a.calendarNote}>
            {t("perAsset.history")}
            {a.calendarNote ? ` (${a.calendarNote})` : ""}
          </span>
        )}
      </td>
    </tr>
  );
}

function Stat({ title, value, hint, compact }: { title: string; value: string; hint?: string; compact?: boolean }) {
  if (compact) {
    return (
      <Card>
        <CardContent className="p-3">
          <div className="text-muted-foreground text-xs leading-tight">{title}</div>
          <div className="mt-1 text-lg font-bold leading-tight tabular-nums">{value}</div>
          {hint && <p className="text-muted-foreground mt-0.5 text-[11px] leading-tight">{hint}</p>}
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
      </CardContent>
    </Card>
  );
}
