import { QueryClientProvider, useQuery, type QueryClient } from "@tanstack/react-query";
import type { AddonContext, AddonRouteRenderContext } from "@wealthfolio/addon-sdk";
import { Button, EmptyPlaceholder, Icons, Page, PageContent, PageHeader, useBalancePrivacy } from "@wealthfolio/ui";
import { createRoot, type Root } from "react-dom/client";
import { CalendarView } from "./components/calendar-view";
import { buildCalendar } from "./lib/build-calendar";

const ROUTE_ID = "dividend-calendar";
const ROUTE_PATH = "/addons/dividend-calendar-addon";

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
  const { isBalanceHidden } = useBalancePrivacy();
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["dividend-calendar-addon", "calendar"],
    queryFn: () => buildCalendar(ctx),
    staleTime: 6 * 60 * 60 * 1000, // provider data changes at most daily
  });

  const header = (
    <PageHeader
      actions={
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <Icons.Refresh className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      }
    >
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold sm:text-xl">Dividend Calendar</h1>
        <p className="text-muted-foreground text-sm">
          Upcoming dividends for your holdings. Declared dates come from Yahoo Finance; the rest is projected
          from each asset&apos;s payment history and your current quantity.
        </p>
      </div>
    </PageHeader>
  );

  if (isLoading) {
    return (
      <Page>
        {header}
        <PageContent>
          <div className="flex min-h-[40vh] items-center justify-center">
            <div className="text-center">
              <Icons.Loader className="text-primary mx-auto mb-4 h-8 w-8 animate-spin" />
              <p className="text-muted-foreground text-sm">Reading holdings and dividend history…</p>
            </div>
          </div>
        </PageContent>
      </Page>
    );
  }

  if (error || !data) {
    return (
      <Page>
        {header}
        <PageContent>
          <EmptyPlaceholder
            icon={<Icons.AlertCircle className="h-10 w-10" />}
            title="Could not build the calendar"
            description={error instanceof Error ? error.message : "Unknown error"}
          />
        </PageContent>
      </Page>
    );
  }

  if (data.assets.length === 0) {
    return (
      <Page>
        {header}
        <PageContent>
          <EmptyPlaceholder
            icon={<Icons.Calendar className="h-10 w-10" />}
            title="No dividend-paying holdings"
            description="Add equity or ETF holdings with a market quote and come back."
          />
        </PageContent>
      </Page>
    );
  }

  return (
    <Page>
      {header}
      <PageContent>
        <CalendarView data={data} hidden={isBalanceHidden} />
      </PageContent>
    </Page>
  );
}

export default function enable(ctx: AddonContext) {
  addonCtx = ctx;
  ctx.api.logger.info("Dividend Calendar addon enabled");

  // The route id must match contributes.routes[].id in manifest.json.
  ctx.router.add({ id: ROUTE_ID, path: ROUTE_PATH, render });
  const sidebarItem = ctx.sidebar.addItem({
    id: ROUTE_ID,
    label: "Dividend Calendar",
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
