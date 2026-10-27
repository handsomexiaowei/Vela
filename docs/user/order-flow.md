# Footprint and market profile

Two price styles draw order flow in place of the candles. Pick them like any other
style — `priceStyle: 'footprint'` or `'tpo'`, the style menu, or
`chart.renderer.set('priceStyle', 'footprint')` — and feed them with
`chart.setChartTypeData` when you have the underlying prints or sub-bars. Both are
native-renderer styles. Their colors, the imbalance ratio, the value area and the
session shape are rows in the chart-settings dialog, saved with the rest of the
chart config.

## Footprint

A footprint bar is a column of price rows. Each row prints **bid × ask**: sell-aggressor
size, then buy-aggressor size. A row turns green when ask size is at least the
imbalance ratio times bid size (the default ratio is 3), and red the other way. A
row with size on only one side takes that side's color. The heaviest row of the bar
is outlined — the point of control — and, when the column is wide enough, the bar's
delta (ask − bid) and total size sit under the column.

Numbers are drawn only when the cell is at least 36×12 pixels. Below that the cell
stays a colored block, darker where the row traded more, so a zoomed-out chart is
still a heatmap.

```ts
import { Vela, buildFootprintFromTrades, type TradePrint } from '@luxalgo/vela';

// `isBuyerMaker: true` means the buyer was the maker, so the seller was the
// aggressor (bid). This is the flag on a public aggregated trade.
const trades: TradePrint[] = [
  { time: 1_700_000_000_000, price: 100.2, qty: 3, isBuyerMaker: true },
  { time: 1_700_000_001_000, price: 100.8, qty: 5, isBuyerMaker: false },
];

const bars = [/* the chart's OHLCV, open times in epoch ms */];
const footprint = buildFootprintFromTrades(trades, {
  barTimes: bars.map((b) => b.time),
  barMs: 60_000,     // length of the last bar; earlier bars end at the next open
  tickSize: 0.5,     // omit for an automatic size, ~10–20 rows on a typical bar
});

const chart = new Vela('#chart', { data: bars, priceStyle: 'footprint', volume: false });
chart.setChartTypeData('footprint', footprint);
```

`barTimes` are the bar opens. A print in `[open, next open)` joins that bar; anything
outside the first open and one bar-length past the last open is dropped. Pass the
whole return value, or just `footprint.bars`.

Until you set data, the chart spreads each bar's own volume from its low to its high
so the style is not blank. That series is marked `estimated: true` and is **not**
bid/ask. Replace it as soon as prints are available, including on each live bar —
call `setChartTypeData` again. A market change drops the series; set it again after
`market:changed`.

`buildFootprintFromTrades`, `footprintSide`, `footprintPoc` and `footprintSummary`
are pure. `autoTickSize` and `bucketPrice` are the row math they share with TPO.

## Market profile (TPO)

One profile per session. The default session is a UTC day (24 hours from UTC
midnight); the settings change the length and the hour offset. Inside a session
each period — 30 minutes, unless you change it — receives one letter, **A–Z then
a–x**. The letter is printed on every price row that period traded, packed left to
right, so the longest row is the point of control.

The value area starts at the point of control and grows by the heavier neighboring
row until it holds 70% of the letters (an equal pair grows toward the lower price).
Its high and low, and the point of control, are horizontal lines labeled VAH, VAL
and POC. The initial balance is the price span of the first two periods, drawn as
a box; turn it off, or change how many periods it covers, in the settings.

Letters become blocks once a cell is under 8×10 pixels.

```ts
import { Vela, computeTpoProfiles, computeTpoFromTrades } from '@luxalgo/vela';

// From the chart's own candles (sub-bars at or below the period):
const profiles = computeTpoProfiles(bars, {
  periodMs: 30 * 60_000,
  sessionMs: 24 * 60 * 60_000, // omit for a UTC day
  tickSize: 0.5,               // omit to auto-size a session to ~10–20 rows
  valueArea: 0.7,
  initialBalancePeriods: 2,    // 0 omits it
});

// Or from prints — each print marks only its own price:
const fromTrades = computeTpoFromTrades(trades, { tickSize: 0.5 });

const chart = new Vela('#chart', { data: bars, priceStyle: 'tpo', volume: false });
chart.setChartTypeData('tpo', profiles);
```

Leave the data unset and the chart runs `computeTpoProfiles` on its own bars
whenever they change, using the settings dialog's period, session, tick and value
area. A bar is attributed to the session of its **open**. A bar no longer than the
period prints its low-to-high on that one letter; a longer bar prints the same
range on every period it overlaps, and stops at the session's last letter rather
than spilling into the next session. For an honest profile, pass sub-bars at or
below the period.

`tpoLetter(0)` is `'A'`. `profileWithValueArea` and `profileWithInitialBalance`
rebuild those two marks on a profile you already computed.

## What the chart does not do

The chart does not open a trade socket. Whoever has the prints — your feed, a
playback — builds the series and calls `setChartTypeData`. The playground pages
`footprint.html` and `tpo.html` ship a fixed sample and, on the footprint page, a
control that loads recent public aggregated trades for BTCUSDT.
