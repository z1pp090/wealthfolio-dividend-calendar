import { useAddonTranslation } from "@wealthfolio/addon-sdk";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  Progress,
  type ChartConfig,
} from "@wealthfolio/ui";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { AssetCalendar, CalendarResult } from "../lib/build-calendar";
import { monthKey, monthKeys, type ExRule } from "../lib/projection";

interface Props {
  data: CalendarResult;
  hidden: boolean;
}

const LOCALES: Record<string, string> = { en: "en-GB", es: "es-ES", fr: "fr-FR", de: "de-DE", it: "it-IT", pt: "pt-PT", nl: "nl-NL" };
const localeFor = (lang: string) => LOCALES[lang] ?? lang;

/** Distinct hues that read on both themes (the host's --chart-N tokens are shades of one hue). */
const PALETTE = ["#4f9d9d", "#c9a227", "#8e7cc3", "#d97757", "#6aa84f", "#c95d8a", "#5b8def"];

export function CalendarView({ data, hidden }: Props) {
  const { t, language } = useAddonTranslation();
  const locale = localeFor(language);
  const ccy = data.baseCurrency;

  const fmtMoney = (v: number) =>
    hidden ? "••••" : new Intl.NumberFormat(locale, { style: "currency", currency: ccy, maximumFractionDigits: 2 }).format(v);
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

  const months = useMemo(() => monthKeys(data.generatedAt, 12), [data.generatedAt]);

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
    () =>
      data.assets
        .flatMap((a) => a.upcoming.map((u) => ({ a, u })))
        .sort((x, y) => x.u.payDate - y.u.payDate)
        .slice(0, 36),
    [data],
  );

  // Chart: one stacked bar per month, one series per asset (net, base currency).
  const chartAssets = rows.map((r) => r.asset.symbol);
  const chartConfig: ChartConfig = Object.fromEntries(
    chartAssets.map((s, i) => [s, { label: s, color: PALETTE[i % PALETTE.length] }]),
  );
  const chartData = months.map((m, i) => {
    const row: Record<string, number | string> = { month: fmtMonth(m), total: monthTotals[i].net };
    for (const r of rows) row[r.asset.symbol] = r.byMonth.get(m)?.net ?? 0;
    return row;
  });

  const goal = data.settings.goalMonthly;
  const goalPct = goal > 0 ? Math.min(1, monthlyNet / goal) : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat title={t("stats.next12")} value={fmtMoney(total12Net)} hint={t("stats.next12Gross", { value: fmtMoney(total12Gross) })} />
        <Stat title={t("stats.monthlyAvg")} value={fmtMoney(monthlyNet)} />
        <Stat title={t("stats.payments")} value={`${paymentsCount}`} hint={t("stats.paymentsHint", { declared: declaredCount })} />
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
              <span className="text-muted-foreground text-xs">{t("goal.hint")}</span>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">{t("chart.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-56 w-full">
            <BarChart data={chartData} margin={{ left: 4, right: 4, top: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis
                tickLine={false}
                axisLine={false}
                fontSize={11}
                width={56}
                tickFormatter={(v: number) => (hidden ? "••" : new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(v))}
              />
              <ChartTooltip
                cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                content={
                  <ChartTooltipContent
                    formatter={(v, name) => (
                      <div className="flex w-full items-center justify-between gap-4">
                        <span className="text-muted-foreground">{name}</span>
                        <span className="font-mono font-medium tabular-nums">{fmtMoney(Number(v))}</span>
                      </div>
                    )}
                  />
                }
              />
              {chartAssets.map((s) => (
                <Bar key={s} dataKey={s} stackId="net" fill={`var(--color-${s})`} radius={0} />
              ))}
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">{t("upcoming.title")}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-left text-xs">
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">{t("grid.title")}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">{t("perAsset.title")}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
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
        </CardContent>
      </Card>
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

function Stat({ title, value, hint }: { title: string; value: string; hint?: string }) {
  return (
    <Card className="border-yellow-500/10 bg-yellow-500/10">
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
