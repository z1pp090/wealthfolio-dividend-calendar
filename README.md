# Dividend Calendar — Wealthfolio addon

Upcoming dividends for your holdings, next 12 months, gross and **net of taxes**:

- **Monthly goal bar** (optional): net monthly average vs. your target.
- **Net income by month** chart, stacked by asset.
- **Upcoming payments** list: pay date, ex-date, per-share, gross, net, declared/projected.
- **Month × asset grid** (net) with totals.
- **Per asset**: cadence, inferred ex-date pattern (e.g. "last business day", "2nd Thursday"), last paid, change vs. the same period a year ago, trailing annual per share, yield, yield on cost, withholding applied.
- **Settings** (persisted in the host's addon storage): monthly goal, home tax rate, foreign-tax credit cap, and per asset the ex-to-pay lag and the withholding at source.
- Follows the host language (English and Spanish bundled).

## How it works

1. For every equity holding (crypto, FX and manual assets are skipped) it reads the last 24 months of dividends through the host's market-data providers (`fetchDividends`). Provider event dates are **ex-dates**.
2. It infers the cadence from the median gap between ex-dates and the **ex-date pattern** (n-th weekday, last weekday, last business day, or fixed day of month; near misses of a couple of days count half, since secondary listings drift). Projected ex-dates follow that pattern; without one they keep the last day-of-month, off weekends.
3. Pay date = ex-date + the asset's lag (default 15 days, configurable), rolled forward off weekends. A dividend whose ex-date already passed but whose pay date is still ahead is listed as *declared*.
4. Amounts: monthly payers repeat the last amount; quarterly/semi-annual/annual payers use the **same period a year earlier scaled by the latest year-on-year change** (ETF distributions differ within a year).
5. If the instrument has a US primary listing (found by ISIN or name via Yahoo search), it also reads that listing's `chart?events=div`, which exposes the latest **declared** dividend (ex-date in the future) weeks before European listings show it. Its amount is converted with the ratio between the two listings' last payments.
6. Taxes: `net = gross × (1 − w − max(0, t − min(w, cap)))` with `w` = withholding at source (user override, else by ISIN country, else 15 % when a US primary listing exists), `t` = home tax, `cap` = creditable foreign tax. Defaults: t = 19 %, cap = 15 % (Spain); change them in Settings.

Everything is computed locally; the only network calls are to `query1/query2.finance.yahoo.com` through the host's brokered network API.

## Known limitations

- Ex-dividend and pay dates of the next payment (`quoteSummary?modules=calendarEvents`) require Yahoo's cookie + crumb handshake, which the addon network broker deliberately blocks. Pay dates are therefore ex-date + lag. A native implementation can do better: see [wealthfolio/wealthfolio#1730](https://github.com/wealthfolio/wealthfolio/discussions/1730).
- UCITS ETFs have no US primary listing: they are always projected.
- The host does not persist the ISIN, so the withholding default relies on the primary-listing lookup; set it per asset in Settings when it is wrong.
- The sidebar label is chosen once at load from the browser locale; the page itself follows the host language.

## Development

```
pnpm install
pnpm test          # projection + tax unit tests (node:test)
pnpm type-check
pnpm bundle        # build + zip into dist/
```

Install the zip from **Settings → Add-ons → Install from file**, and tick the two Yahoo hosts in the permission dialog.

## License

MIT
