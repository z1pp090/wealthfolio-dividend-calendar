# Dividend Calendar — Wealthfolio addon

Upcoming dividends for your holdings, next 12 months:

- **Upcoming payments** list (pay date, ex-date when known, per-share, estimated total with your quantity, declared/projected).
- **Month × asset grid** for the next 12 months with totals.
- **Per asset**: cadence (monthly / quarterly / semi-annual / annual), last paid, change vs. same period a year ago, trailing annual per share, yield on price and on cost.

## How it works

1. For every equity holding (crypto, FX and manual assets are skipped) it reads the last 24 months of dividends through the host's market-data providers (`fetchDividends`).
2. It infers the payment cadence from the median gap between payments and projects the next 12 months using the last paid amount and your current quantity.
3. If the instrument has a US primary listing (found by name via Yahoo search), it also reads that listing's `chart?events=div`, which exposes the latest **declared** dividend (ex-date in the future) weeks before European listings show it. Declared payments are flagged and shift the projection.

Everything is computed locally; the only network calls are to `query1/query2.finance.yahoo.com` through the host's brokered network API.

## Known limitations

- Ex-dividend and pay dates of the next payment (`quoteSummary?modules=calendarEvents`) require Yahoo's cookie + crumb handshake, which the addon network broker deliberately blocks. Projected pay dates are therefore "last pay date + cadence"; for declared ones, "ex-date + 15 days". A native implementation can do better: see [wealthfolio/wealthfolio#1730](https://github.com/wealthfolio/wealthfolio/discussions/1730).
- Some providers report the ex-date as the event date for secondary listings, so a monthly REIT may show the ex-date instead of the pay date.
- UCITS ETFs have no US primary listing: they are always projected.

## Development

```
pnpm install
pnpm test          # projection unit tests (node:test)
pnpm type-check
pnpm bundle        # build + zip into dist/
```

Install the zip from **Settings → Add-ons → Install from file**, and tick the two Yahoo hosts in the permission dialog.

## License

MIT
