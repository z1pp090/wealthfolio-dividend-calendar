import { Badge, Card, CardContent, CardHeader, CardTitle } from "@wealthfolio/ui";
import { useMemo } from "react";
import type { AssetCalendar, CalendarResult } from "../lib/build-calendar";
import { monthKey, monthKeys } from "../lib/projection";

interface Props {
  data: CalendarResult;
  hidden: boolean;
}

const fmtMoney = (v: number, ccy: string, hidden: boolean) =>
  hidden ? "••••" : new Intl.NumberFormat(undefined, { style: "currency", currency: ccy, maximumFractionDigits: 2 }).format(v);
const fmtPct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(2)} %`);
const fmtDate = (unix: number | null) =>
  unix == null ? "—" : new Date(unix * 1000).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
const fmtMonth = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: "short", year: "2-digit", timeZone: "UTC" });
};

const cadenceLabel: Record<string, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  semiannual: "Semi-annual",
  annual: "Annual",
};

export function CalendarView({ data, hidden }: Props) {
  const ccy = data.baseCurrency;
  const months = useMemo(() => monthKeys(data.generatedAt, 12), [data.generatedAt]);

  const rows = useMemo(() => {
    return data.assets
      .map((a) => {
        const byMonth = new Map<string, number>();
        for (const u of a.upcoming) byMonth.set(monthKey(u.payDate), (byMonth.get(monthKey(u.payDate)) ?? 0) + u.amountBase);
        const total = a.upcoming.reduce((s, u) => s + u.amountBase, 0);
        return { asset: a, byMonth, total };
      })
      .sort((x, y) => y.total - x.total);
  }, [data]);

  const monthTotals = useMemo(() => months.map((m) => rows.reduce((s, r) => s + (r.byMonth.get(m) ?? 0), 0)), [rows, months]);
  const total12 = monthTotals.reduce((s, v) => s + v, 0);
  const declaredCount = data.assets.reduce((s, a) => s + a.upcoming.filter((u) => u.status === "declared").length, 0);

  const upcomingList = useMemo(
    () =>
      data.assets
        .flatMap((a) => a.upcoming.map((u) => ({ a, u })))
        .sort((x, y) => x.u.payDate - y.u.payDate)
        .slice(0, 24),
    [data],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat title="Next 12 months (estimated)" value={fmtMoney(total12, ccy, hidden)} />
        <Stat title="Monthly average" value={fmtMoney(total12 / 12, ccy, hidden)} />
        <Stat
          title="Payments"
          value={`${data.assets.reduce((s, a) => s + a.upcoming.length, 0)}`}
          hint={`${declaredCount} declared · rest projected from history`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Upcoming payments</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-left text-xs">
              <tr>
                <th className="py-1 pr-3">Pay date</th>
                <th className="py-1 pr-3">Ex-date</th>
                <th className="py-1 pr-3">Asset</th>
                <th className="py-1 pr-3 text-right">Per share</th>
                <th className="py-1 pr-3 text-right">Estimated</th>
                <th className="py-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {upcomingList.map(({ a, u }, i) => (
                <tr key={`${a.assetId}-${u.payDate}-${i}`} className="border-border/50 border-t">
                  <td className="py-1.5 pr-3 whitespace-nowrap">{fmtDate(u.payDate)}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{fmtDate(u.exDate)}</td>
                  <td className="py-1.5 pr-3">
                    <span className="font-medium">{a.symbol}</span>
                    <span className="text-muted-foreground ml-2 hidden sm:inline">{a.name}</span>
                  </td>
                  <td className="py-1.5 pr-3 text-right whitespace-nowrap">{hidden ? "••••" : `${u.amountPerShare.toFixed(4)} ${a.currency}`}</td>
                  <td className="py-1.5 pr-3 text-right whitespace-nowrap">{fmtMoney(u.amountBase, ccy, hidden)}</td>
                  <td className="py-1.5">
                    <Badge variant={u.status === "declared" ? "default" : "secondary"}>{u.status}</Badge>
                  </td>
                </tr>
              ))}
              {upcomingList.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-muted-foreground py-4 text-center">
                    No dividend history found for your holdings.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Next 12 months by asset</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground text-left">
              <tr>
                <th className="py-1 pr-2">Asset</th>
                {months.map((m) => (
                  <th key={m} className="py-1 px-1 text-right whitespace-nowrap">{fmtMonth(m)}</th>
                ))}
                <th className="py-1 pl-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ asset, byMonth, total }) => (
                <tr key={asset.assetId} className="border-border/50 border-t">
                  <td className="py-1 pr-2 font-medium whitespace-nowrap">{asset.symbol}</td>
                  {months.map((m) => {
                    const v = byMonth.get(m);
                    return (
                      <td key={m} className="py-1 px-1 text-right tabular-nums">{v ? fmtMoney(v, ccy, hidden) : <span className="text-muted-foreground">·</span>}</td>
                    );
                  })}
                  <td className="py-1 pl-2 text-right font-medium tabular-nums">{fmtMoney(total, ccy, hidden)}</td>
                </tr>
              ))}
              <tr className="border-border border-t font-medium">
                <td className="py-1 pr-2">Total</td>
                {monthTotals.map((v, i) => (
                  <td key={months[i]} className="py-1 px-1 text-right tabular-nums">{v ? fmtMoney(v, ccy, hidden) : "·"}</td>
                ))}
                <td className="py-1 pl-2 text-right tabular-nums">{fmtMoney(total12, ccy, hidden)}</td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Per asset</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-left text-xs">
              <tr>
                <th className="py-1 pr-3">Asset</th>
                <th className="py-1 pr-3">Cadence</th>
                <th className="py-1 pr-3 text-right">Last paid</th>
                <th className="py-1 pr-3 text-right">vs. year ago</th>
                <th className="py-1 pr-3 text-right">Annual / share</th>
                <th className="py-1 pr-3 text-right">Yield</th>
                <th className="py-1 pr-3 text-right">Yield on cost</th>
                <th className="py-1">Source</th>
              </tr>
            </thead>
            <tbody>
              {data.assets.map((a) => (
                <AssetRow key={a.assetId} a={a} hidden={hidden} />
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function AssetRow({ a, hidden }: { a: AssetCalendar; hidden: boolean }) {
  const p = a.projection;
  return (
    <tr className="border-border/50 border-t">
      <td className="py-1.5 pr-3">
        <span className="font-medium">{a.symbol}</span>
        <span className="text-muted-foreground ml-2 hidden md:inline">{a.name}</span>
      </td>
      <td className="py-1.5 pr-3">{p.cadence ? cadenceLabel[p.cadence] : "—"}</td>
      <td className="py-1.5 pr-3 text-right whitespace-nowrap">
        {p.lastAmount != null ? `${hidden ? "••••" : p.lastAmount.toFixed(4)} ${a.currency}` : "—"}
        {p.lastPayDate && <span className="text-muted-foreground ml-1 text-xs">{fmtDate(p.lastPayDate)}</span>}
      </td>
      <td className={`py-1.5 pr-3 text-right ${p.lastChangePct == null ? "" : p.lastChangePct >= 0 ? "text-success" : "text-destructive"}`}>
        {p.lastChangePct == null ? "—" : `${p.lastChangePct >= 0 ? "+" : ""}${(p.lastChangePct * 100).toFixed(1)} %`}
      </td>
      <td className="py-1.5 pr-3 text-right whitespace-nowrap">{a.annualPerShare != null ? `${hidden ? "••••" : a.annualPerShare.toFixed(4)} ${a.currency}` : "—"}</td>
      <td className="py-1.5 pr-3 text-right">{fmtPct(a.yieldOnPrice)}</td>
      <td className="py-1.5 pr-3 text-right">{fmtPct(a.yieldOnCost)}</td>
      <td className="py-1.5 text-xs">
        {a.error ? (
          <span className="text-destructive">{a.error}</span>
        ) : a.projection.upcoming.some((u) => u.status === "declared") ? (
          <span className="text-muted-foreground">calendar via {a.primarySymbol ?? a.symbol}</span>
        ) : (
          <span className="text-muted-foreground" title={a.calendarNote}>history{a.calendarNote ? ` (${a.calendarNote})` : ""}</span>
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
