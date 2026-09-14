import { useAddonTranslation } from "@wealthfolio/addon-sdk";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Switch,
} from "@wealthfolio/ui";
import { useEffect, useState } from "react";
import type { AssetCalendar } from "../lib/build-calendar";
import { normalizeSettings, type CalendarSettings } from "../lib/settings";
import type { NetMode } from "../lib/tax";
import { EX_TO_PAY_DAYS } from "../lib/projection";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: CalendarSettings;
  assets: AssetCalendar[];
  baseCurrency: string;
  onSave: (s: CalendarSettings) => Promise<void> | void;
}

/** Text state for the numeric inputs (empty string = "use default"). */
interface Draft {
  goalMonthly: string;
  homeTaxPct: string;
  creditCapPct: string;
  netMode: NetMode;
  monthlyContribution: string;
  dividendGrowthPct: string;
  reinvest: boolean;
  assets: Record<string, { payLagDays: string; withholdingPct: string }>;
}

const str = (v: number | undefined) => (v == null ? "" : String(v));
const parse = (v: string): number | undefined => {
  const t = v.trim().replace(",", ".");
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
};

function toDraft(s: CalendarSettings, assets: AssetCalendar[]): Draft {
  const d: Draft = {
    goalMonthly: str(s.goalMonthly),
    homeTaxPct: str(s.homeTaxPct),
    creditCapPct: str(s.creditCapPct),
    netMode: s.netMode,
    monthlyContribution: str(s.monthlyContribution),
    dividendGrowthPct: str(s.dividendGrowthPct),
    reinvest: s.reinvest,
    assets: {},
  };
  for (const a of assets) {
    d.assets[a.symbol] = {
      payLagDays: str(s.assets[a.symbol]?.payLagDays),
      withholdingPct: str(s.assets[a.symbol]?.withholdingPct),
    };
  }
  return d;
}

function fromDraft(d: Draft, prev: CalendarSettings): CalendarSettings {
  const assets: CalendarSettings["assets"] = { ...prev.assets };
  for (const [symbol, a] of Object.entries(d.assets)) {
    const entry: CalendarSettings["assets"][string] = {};
    const lag = parse(a.payLagDays);
    const w = parse(a.withholdingPct);
    if (lag != null) entry.payLagDays = lag;
    if (w != null) entry.withholdingPct = w;
    if (Object.keys(entry).length) assets[symbol] = entry;
    else delete assets[symbol];
  }
  return normalizeSettings({
    goalMonthly: parse(d.goalMonthly) ?? 0,
    homeTaxPct: parse(d.homeTaxPct) ?? prev.homeTaxPct,
    creditCapPct: parse(d.creditCapPct) ?? prev.creditCapPct,
    netMode: d.netMode,
    monthlyContribution: parse(d.monthlyContribution) ?? 0,
    dividendGrowthPct: parse(d.dividendGrowthPct) ?? prev.dividendGrowthPct,
    reinvest: d.reinvest,
    assets,
  });
}

export function SettingsPanel({ open, onOpenChange, settings, assets, baseCurrency, onSave }: Props) {
  const { t } = useAddonTranslation();
  const [draft, setDraft] = useState<Draft>(() => toDraft(settings, assets));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setDraft(toDraft(settings, assets));
  }, [open, settings, assets]);

  const setAsset = (symbol: string, field: "payLagDays" | "withholdingPct", value: string) =>
    setDraft((d) => ({ ...d, assets: { ...d.assets, [symbol]: { ...d.assets[symbol], [field]: value } } }));

  const save = async () => {
    setSaving(true);
    try {
      await onSave(fromDraft(draft, settings));
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("settingsPanel.title")}</DialogTitle>
          <DialogDescription>{t("settingsPanel.description")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dc-goal">{t("settingsPanel.goal", { ccy: baseCurrency })}</Label>
            <Input
              id="dc-goal"
              inputMode="decimal"
              value={draft.goalMonthly}
              onChange={(e) => setDraft({ ...draft, goalMonthly: e.target.value })}
            />
            <p className="text-muted-foreground text-xs">{t("settingsPanel.goalHint")}</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dc-home">{t("settingsPanel.homeTax")}</Label>
            <Input
              id="dc-home"
              inputMode="decimal"
              value={draft.homeTaxPct}
              onChange={(e) => setDraft({ ...draft, homeTaxPct: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dc-cap">{t("settingsPanel.creditCap")}</Label>
            <Input
              id="dc-cap"
              inputMode="decimal"
              value={draft.creditCapPct}
              onChange={(e) => setDraft({ ...draft, creditCapPct: e.target.value })}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>{t("settingsPanel.netMode")}</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            {(["broker", "afterReturn"] as NetMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setDraft({ ...draft, netMode: mode })}
                className={`rounded-md border p-2 text-left text-sm ${draft.netMode === mode ? "border-primary bg-primary/10" : "border-border"}`}
              >
                <div className="font-medium">{t(`settingsPanel.netMode${mode === "broker" ? "Broker" : "AfterReturn"}`)}</div>
                <div className="text-muted-foreground text-xs">{t(`settingsPanel.netMode${mode === "broker" ? "Broker" : "AfterReturn"}Hint`)}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-2">
          <h3 className="mb-2 text-sm font-medium">{t("settingsPanel.projection")}</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dc-contrib">{t("settingsPanel.contribution", { ccy: baseCurrency })}</Label>
              <Input
                id="dc-contrib"
                inputMode="decimal"
                value={draft.monthlyContribution}
                onChange={(e) => setDraft({ ...draft, monthlyContribution: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dc-growth">{t("settingsPanel.growth")}</Label>
              <Input
                id="dc-growth"
                inputMode="decimal"
                value={draft.dividendGrowthPct}
                onChange={(e) => setDraft({ ...draft, dividendGrowthPct: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dc-reinvest">{t("settingsPanel.reinvest")}</Label>
              <div className="flex h-9 items-center">
                <Switch id="dc-reinvest" checked={draft.reinvest} onCheckedChange={(v) => setDraft({ ...draft, reinvest: !!v })} />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-2">
          <h3 className="mb-2 text-sm font-medium">{t("settingsPanel.perAsset")}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-left text-xs">
                <tr>
                  <th className="py-1 pr-3">{t("settingsPanel.asset")}</th>
                  <th className="py-1 pr-3">{t("settingsPanel.payLag")}</th>
                  <th className="py-1">{t("settingsPanel.withholding")}</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => (
                  <tr key={a.assetId} className="border-border/50 border-t">
                    <td className="py-1.5 pr-3">
                      <span className="font-medium">{a.symbol}</span>
                      <span className="text-muted-foreground ml-2 hidden sm:inline">{a.name}</span>
                    </td>
                    <td className="py-1.5 pr-3">
                      <Input
                        inputMode="numeric"
                        className="h-8 w-24"
                        placeholder={String(EX_TO_PAY_DAYS)}
                        value={draft.assets[a.symbol]?.payLagDays ?? ""}
                        onChange={(e) => setAsset(a.symbol, "payLagDays", e.target.value)}
                      />
                    </td>
                    <td className="py-1.5">
                      <div className="flex items-center gap-2">
                        <Input
                          inputMode="decimal"
                          className="h-8 w-24"
                          placeholder={String(a.defaultWithholdingPct)}
                          value={draft.assets[a.symbol]?.withholdingPct ?? ""}
                          onChange={(e) => setAsset(a.symbol, "withholdingPct", e.target.value)}
                        />
                        <span className="text-muted-foreground text-xs">
                          {t("settingsPanel.withholdingDefault", { value: `${a.defaultWithholdingPct} %` })}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("settingsPanel.cancel")}
          </Button>
          <Button onClick={save} disabled={saving}>
            {t("settingsPanel.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
