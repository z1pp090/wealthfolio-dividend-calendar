import { useAddonTranslation } from "@wealthfolio/addon-sdk";
import { Button, Card, CardContent, CardHeader, CardTitle, Icons } from "@wealthfolio/ui";
import { useMemo, useState } from "react";
import type { AssetCalendar } from "../lib/build-calendar";
import type { ReceivedDividend } from "../lib/received";
import { useNarrow } from "../lib/use-narrow";

interface Props {
  assets: AssetCalendar[];
  received: ReceivedDividend[];
  colorOf: (symbol: string) => string;
  now: number;
  locale: string;
  hidden: boolean;
  fmtMoney: (v: number) => string;
}

const DAY = 86_400;

interface DayMark {
  symbol: string;
  kind: "ex" | "pay" | "received";
  amount: number | null; // net, base
}

/**
 * One month at a time, getquin-style: every day is a cell, payments show the amount,
 * ex-dates show a hollow marker, past payments come from the received activities.
 */
export function MonthGrid({ assets, received, colorOf, now, locale, hidden, fmtMoney }: Props) {
  const { t } = useAddonTranslation();
  const today = new Date(now * 1000);
  const [cursor, setCursor] = useState({ y: today.getUTCFullYear(), m: today.getUTCMonth() });
  const [selected, setSelected] = useState<number | null>(null);
  const narrow = useNarrow();

  const marks = useMemo(() => {
    const map = new Map<number, DayMark[]>(); // day-of-month -> marks
    const push = (unix: number, mark: DayMark) => {
      const d = new Date(unix * 1000);
      if (d.getUTCFullYear() !== cursor.y || d.getUTCMonth() !== cursor.m) return;
      const day = d.getUTCDate();
      map.set(day, [...(map.get(day) ?? []), mark]);
    };
    for (const a of assets) {
      for (const u of a.upcoming) {
        push(u.exDate, { symbol: a.symbol, kind: "ex", amount: null });
        push(u.payDate, { symbol: a.symbol, kind: "pay", amount: u.netBase });
      }
    }
    for (const r of received) push(r.date, { symbol: r.symbol, kind: "received", amount: r.net });
    return map;
  }, [assets, received, cursor]);

  const first = new Date(Date.UTC(cursor.y, cursor.m, 1));
  const daysInMonth = new Date(Date.UTC(cursor.y, cursor.m + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const cells: Array<number | null> = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(locale, { weekday: "short", timeZone: "UTC" }),
  );
  const rawTitle = first.toLocaleDateString(locale, { month: "long", year: "numeric", timeZone: "UTC" });
  const title = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1);
  const isToday = (day: number) =>
    cursor.y === today.getUTCFullYear() && cursor.m === today.getUTCMonth() && day === today.getUTCDate();
  const monthTotal = [...marks.values()].flat().reduce((s, m) => s + (m.kind === "ex" ? 0 : (m.amount ?? 0)), 0);
  const nowDay = Math.floor(now / DAY) * DAY;

  const go = (delta: number) => {
    const d = new Date(Date.UTC(cursor.y, cursor.m + delta, 1));
    setCursor({ y: d.getUTCFullYear(), m: d.getUTCMonth() });
    setSelected(null);
  };
  const selectedMarks = selected ? (marks.get(selected) ?? []) : [];
  const dayLabel = (day: number) =>
    new Date(Date.UTC(cursor.y, cursor.m, day)).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="min-w-0 text-sm font-medium">
          {t("monthGrid.title")} · {title}
          <span className="text-muted-foreground ml-2 text-xs font-normal">{monthTotal ? fmtMoney(monthTotal) : ""}</span>
        </CardTitle>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => go(-1)} aria-label="previous month">
            <Icons.ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setCursor({ y: today.getUTCFullYear(), m: today.getUTCMonth() })}>
            {t("monthGrid.today")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => go(1)} aria-label="next month">
            <Icons.ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 4 }}>
          {weekdays.map((w) => (
            <div key={w} className="text-muted-foreground pb-1 text-center text-xs capitalize">
              {w}
            </div>
          ))}
          {cells.map((day, i) => {
            const dayMarks = day ? (marks.get(day) ?? []) : [];
            const unix = day ? Math.floor(Date.UTC(cursor.y, cursor.m, day) / 1000) : 0;
            const past = unix < nowDay;
            const dayTotal = dayMarks.reduce((s, m) => s + (m.amount ?? 0), 0);
            return (
              <div
                key={i}
                role={day ? "button" : undefined}
                onClick={() => day && setSelected(selected === day ? null : day)}
                className={`border-border/50 rounded-md border ${day ? "cursor-pointer" : "opacity-0"} ${isToday(day ?? 0) ? "ring-primary ring-1" : ""} ${selected === day ? "bg-muted" : ""}`}
                style={{ minHeight: narrow ? 44 : 64, padding: 4, opacity: day ? (past ? 0.75 : 1) : 0 }}
              >
                {day && narrow && (
                  <>
                    <div className={`text-xs ${isToday(day) ? "font-semibold" : "text-muted-foreground"}`}>{day}</div>
                    <div className="mt-1 flex flex-wrap gap-0.5">
                      {dayMarks.map((m, j) => (
                        <span
                          key={j}
                          style={{
                            display: "inline-block",
                            width: 7,
                            height: 7,
                            borderRadius: 999,
                            background: m.kind === "ex" ? "transparent" : colorOf(m.symbol),
                            border: `2px solid ${colorOf(m.symbol)}`,
                          }}
                        />
                      ))}
                    </div>
                    {dayTotal > 0 && <div className="text-muted-foreground mt-0.5 text-[10px] leading-none whitespace-nowrap">{hidden ? "••" : fmtMoney(dayTotal)}</div>}
                  </>
                )}
                {day && !narrow && (
                  <>
                    <div className={`text-xs ${isToday(day) ? "font-semibold" : "text-muted-foreground"}`}>{day}</div>
                    <div className="mt-1 flex flex-col gap-0.5">
                      {dayMarks.map((m, j) => (
                        <div key={j} className="flex items-center gap-1 text-xs leading-tight" title={`${m.symbol} · ${t(`monthGrid.${m.kind === "received" ? "pay" : m.kind}`)}`}>
                          <span
                            style={{
                              display: "inline-block",
                              width: 8,
                              height: 8,
                              borderRadius: 999,
                              flex: "0 0 auto",
                              background: m.kind === "ex" ? "transparent" : colorOf(m.symbol),
                              border: `2px solid ${colorOf(m.symbol)}`,
                            }}
                          />
                          <span className="truncate font-medium">{m.symbol}</span>
                          {m.amount != null && <span className="text-muted-foreground ml-auto whitespace-nowrap">{hidden ? "••" : fmtMoney(m.amount)}</span>}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
        {selected && (
          <div className="border-border/50 mt-3 rounded-md border p-2 text-sm">
            <div className="mb-1 font-medium capitalize">{dayLabel(selected)}</div>
            {selectedMarks.length === 0 ? (
              <p className="text-muted-foreground text-xs">{t("monthGrid.empty")}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {selectedMarks.map((m, j) => (
                  <li key={j} className="flex items-center gap-2 text-xs">
                    <span
                      style={{
                        display: "inline-block",
                        width: 8,
                        height: 8,
                        borderRadius: 999,
                        background: m.kind === "ex" ? "transparent" : colorOf(m.symbol),
                        border: `2px solid ${colorOf(m.symbol)}`,
                      }}
                    />
                    <span className="font-medium">{m.symbol}</span>
                    <span className="text-muted-foreground">{t(`monthGrid.${m.kind === "received" ? "pay" : m.kind}`)}</span>
                    {m.amount != null && <span className="ml-auto tabular-nums">{hidden ? "••" : fmtMoney(m.amount)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="text-muted-foreground mt-2 flex flex-wrap gap-4 text-xs">
          <span className="flex items-center gap-1">
            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, border: "2px solid currentColor" }} /> {t("monthGrid.ex")}
          </span>
          <span className="flex items-center gap-1">
            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: "currentColor" }} /> {t("monthGrid.pay")}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
