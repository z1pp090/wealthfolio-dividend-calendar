import { QueryClientProvider, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { registerTranslations, useAddonTranslation, type AddonContext, type AddonRouteRenderContext } from "@wealthfolio/addon-sdk";
import { Button, EmptyPlaceholder, Icons, Page, PageContent, PageHeader, useBalancePrivacy } from "@wealthfolio/ui";
import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CalendarView } from "./components/calendar-view";
import { SettingsPanel } from "./components/settings-panel";
import { buildCalendar } from "./lib/build-calendar";
import { translations } from "./lib/i18n";
import { loadSettings, saveSettings, type CalendarSettings } from "./lib/settings";

const ROUTE_ID = "dividend-calendar";
const ROUTE_PATH = "/addons/dividend-calendar-addon";
const QK_SETTINGS = ["dividend-calendar-addon", "settings"] as const;
const QK_CALENDAR = ["dividend-calendar-addon", "calendar"] as const;

// One React root per addon route (creating one per render leaks trees in the sandbox).
let addonCtx: AddonContext | undefined;
let reactRoot: Root | undefined;
let rootElement: HTMLElement | undefined;

function DividendCalendarRoute() {
  return (
    <QueryClientProvider client={addonCtx!.api.query.getClient() as QueryClient}>
      <DividendCalendarPage ctx={addonCtx!} />
    </QueryClientProvider>
  );
}

function render({ root }: AddonRouteRenderContext) {
  if (!reactRoot || rootElement !== root) {
    reactRoot?.unmount();
    reactRoot = createRoot(root);
    rootElement = root;
  }
  reactRoot.render(<DividendCalendarRoute />);
}

function DividendCalendarPage({ ctx }: { ctx: AddonContext }) {
  const { t } = useAddonTranslation();
  const { isBalanceHidden } = useBalancePrivacy();
  const queryClient = useQueryClient();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const settingsQuery = useQuery({
    queryKey: QK_SETTINGS,
    queryFn: () => loadSettings(ctx),
    staleTime: Infinity,
  });
  const settings = settingsQuery.data;

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: [...QK_CALENDAR, settings],
    queryFn: () => buildCalendar(ctx, settings!),
    enabled: !!settings,
    staleTime: 6 * 60 * 60 * 1000, // provider data changes at most daily
  });

  const onSave = async (s: CalendarSettings) => {
    await saveSettings(ctx, s);
    queryClient.setQueryData(QK_SETTINGS, s);
    ctx.api.toast.success(t("settingsPanel.saved"));
  };

  const header = (
    <PageHeader
      actions={
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)} disabled={!data}>
            <Icons.Settings className="mr-2 h-4 w-4" />
            {t("settings")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching || !settings}>
            <Icons.Refresh className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            {t("refresh")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold sm:text-xl">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
      </div>
    </PageHeader>
  );

  if (isLoading || settingsQuery.isLoading) {
    return (
      <Page>
        {header}
        <PageContent>
          <div className="flex min-h-[40vh] items-center justify-center">
            <div className="text-center">
              <Icons.Loader className="text-primary mx-auto mb-4 h-8 w-8 animate-spin" />
              <p className="text-muted-foreground text-sm">{t("loading")}</p>
            </div>
          </div>
        </PageContent>
      </Page>
    );
  }

  if (error || !data || !settings) {
    return (
      <Page>
        {header}
        <PageContent>
          <EmptyPlaceholder
            icon={<Icons.AlertCircle className="h-10 w-10" />}
            title={t("errorTitle")}
            description={error instanceof Error ? error.message : t("unknownError")}
          />
        </PageContent>
      </Page>
    );
  }

  const settingsDialog = (
    <SettingsPanel
      open={settingsOpen}
      onOpenChange={setSettingsOpen}
      settings={settings}
      assets={data.assets}
      baseCurrency={data.baseCurrency}
      onSave={onSave}
    />
  );

  if (data.assets.length === 0) {
    return (
      <Page>
        {header}
        <PageContent>
          <EmptyPlaceholder icon={<Icons.Calendar className="h-10 w-10" />} title={t("emptyTitle")} description={t("emptyDesc")} />
        </PageContent>
        {settingsDialog}
      </Page>
    );
  }

  return (
    <Page>
      {header}
      <PageContent>
        <CalendarView data={data} hidden={isBalanceHidden} />
      </PageContent>
      {settingsDialog}
    </Page>
  );
}

/** The sidebar label is set once at enable(), outside React: best effort from the browser locale. */
function sidebarLabel(): string {
  const lang = (typeof navigator !== "undefined" ? navigator.language : "en").slice(0, 2).toLowerCase();
  const bundle = translations[lang] ?? translations.en;
  return (bundle.title as string) ?? "Dividend Calendar";
}

export default function enable(ctx: AddonContext) {
  addonCtx = ctx;
  registerTranslations(translations);
  ctx.api.logger.info("Dividend Calendar addon enabled");

  // The route id must match contributes.routes[].id in manifest.json.
  ctx.router.add({ id: ROUTE_ID, path: ROUTE_PATH, render });
  const sidebarItem = ctx.sidebar.addItem({
    id: ROUTE_ID,
    label: sidebarLabel(),
    icon: "calendar-dots",
    route: ROUTE_PATH,
    order: 210,
  });

  ctx.onDisable(() => {
    sidebarItem?.remove?.();
    reactRoot?.unmount();
    reactRoot = undefined;
    rootElement = undefined;
    addonCtx = undefined;
  });
}
