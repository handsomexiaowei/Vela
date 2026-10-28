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
is outlined — the point of control — and, under the column, the bar's sell
volume and buy volume sit on one line.

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

In Bid x Ask Profile the two bars grow out from the middle of the row: bid (red)
to the left, ask (green) to the right. Length is that side divided by the largest
bid or ask in the bar, so the longest side reaches the edge of the cell. The bid
number sits just left of the center, right-aligned; the ask number sits just right
of it, left-aligned (`80.3` then `100.0`, not one centered `bid x ask` string).
Volume and Delta keep a single bar drawn from the left edge and one centered
number. The point of control is outlined in white. Sizes use a `k` / `m` suffix
(`1.2k`). The box is about nine tenths of the bar spacing, so neighboring ladders
keep a gap. Ladders open once neighboring bars are about 60 CSS pixels apart;
wider zooms stay candles. Hide candles removes the bodies for the whole style.
Row size Auto targets a row about 16 CSS pixels tall and snaps that step onto a
readable multiple of the feed's own tick (a step such as 64 can win). The select
also offers fixed sizes; Auto is the default.

Under the box, the default stat line is sell volume then buy volume, in one small
line. Total, delta, and the other columns are off until you turn them on.

Hovering a cell shows that row: a bold price range (`80768 – 80832`), Bid × Ask
with the bid in red and the ask in green, the row's volume, its delta in green or
red, and the hint "⇧ Shift to magnify". Shift still zooms the chart through the
normal key; the ladder does not open a separate magnifier.

### Settings

The Footprint section in chart settings has these groups:

| Group | What it controls |
|---|---|
| Display | Mode (Bid x Ask Profile, Volume, Delta), cell values, average trade size, position (Right / Left / Center), row size (Auto or a price), Hide candles, text size and color, shrink-to-fit, gradient cells, ask color, bid color, area background |
| VA & POC | Value area and its percent, line width, point of control, POC width, extend POC until a later bar trades through it |
| Imbalances | Highlight, ratio in percent (300 = 3×), highlight width, recolor the numbers, stacked imbalances and the minimum run |
| Unfinished auctions | On/off, minimum volume that counts as a side, line width, extend the line until price revisits that level |
| Stat table | Position (Below by default) and text size. Toggles for total, buy, sell, buy %, sell %, delta, delta %, trade count, bid count, ask count. Sell volume and buy volume are the ones on by default, printed on one line |
| Filters | Optional min–max on volume, bid volume, and ask volume. A bound left at 0 is off |

An extreme is unfinished when either side at that row is not strictly above the
minimum. A stack is a run of the same imbalance side at least as long as the
minimum (default 3).

## Market profile (TPO)

One profile per session. The default session is a UTC day (24 hours from UTC
midnight); the settings change the length and the hour offset. Inside a session
each period — 30 minutes, unless you change it — receives one letter, **A–Z then
a–x**. The letter is printed on every price row that period traded. Each letter
sits in that period's own column, starting at the session open on the left and
growing right with time. A day's columns stay inside that day; they do not run
into the next session. The longest row is the point of control.

The value area starts at the point of control and grows by the heavier neighboring
row until it holds 70% of the letters (an equal pair grows toward the lower price).
By default the area is not filled and VAH, VAL, and POC are not labeled. The point
of control is a white outline of that row, not a line across the session (Extend
POC draws the line). The initial balance is the price span of the first hour,
drawn as an orange bracket on the session's left edge.

Blocks are translucent and sit over the candles, so the candles and any study
painted with them stay visible. Color by time is on: early periods are a darker
grey-blue, later periods a brighter blue, and rows inside the value area use a
lighter tint. Outside the value area the blocks use 45% opacity. Letters in later
periods are darker. Row size Auto targets a row about 9 CSS pixels tall.

Letters become blocks once a cell is under 8×7 pixels.

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

## Hosted footprint and candle feeds

The hosted chart reads precomputed footprints and the candles TPO is built from.
Both are optional adapters — pass the JSON through the pure converter, or let
`fetchLuxalgoFootprints` / `fetchLuxalgoCandles` do the GET.

```ts
import { fetchLuxalgoFootprints, fetchLuxalgoCandles, footprintFromLuxalgo } from '@luxalgo/vela';

const series = await fetchLuxalgoFootprints({
  symbol: 'BTCUSDT',   // venue defaults to 'binance'
  from, to,            // epoch milliseconds
  tf: 60,              // bar size in SECONDS (60 = one minute)
  session: 'extended', // the live partial bar; omit for closed history
});
chart.setChartTypeData('footprint', series);

const candles = await fetchLuxalgoCandles({
  symbol: 'BTCUSDT',
  from, to,
  tfMin: 30,           // bar size in MINUTES — what a TPO session is built from
});
```

`GET /v1/{venue}/{symbol}/footprints?from&to&tf` returns:

```json
{
  "tick": 10,
  "slices": [{ "t": 1710000000000, "levels": [[80640, 1.5, 2.5, 7, 15]] }],
  "meta": { "from": 1710000000000, "to": 1710003600000, "level": 60, "pending": [], "planLimit": { "tickMult": 5 } }
}
```

Each level is `[price, bid, ask, bidCount, askCount]`: sell-aggressor volume,
buy-aggressor volume, then the print counts. `tick` is the row size in price.
`tf` is seconds. The server can return a shorter window than you asked for;
`meta.from` and `meta.to` are that window, and `meta.pending` lists ranges still
computing. `footprintFromLuxalgo` accepts this object if you already have it.

`GET /v1/{venue}/{symbol}/candles?tfMin&from&to&partial=1` returns
`{ "bars": [{ "t", "o", "h", "l", "c", "v" }] }`. `tfMin` is minutes. TPO is not
a server profile: request 30-minute candles (a day at a time is the usual chunk)
and pass them to the chart or to `computeTpoProfiles`.

## TPO settings

| Group | What it controls |
|---|---|
| Sessions | Session Day or Week, trading hours Full day or Custom, block interval in minutes (default 30), row size Auto |
| Display | Show blocks, color each block by its period, theme Simple, outside-value-area opacity, show letters, block color |
| Structure | Value area percent, VA fill, point of control, extend POC until price is reached again, POC/VAH/VAL labels, initial balance and its length in minutes (default 60), single prints, poor high/low |
| Volume profile | Off by default. When on: 24 rows, position Right or Left, width 30%, its own POC, value area 70%, VA opacity 62%, labels |
| Markers | Open (teal) and close (red) dots on the left of the session. The midpoint dash is off until you turn it on |

A single print is a row with one letter; the outline is off by default. A poor high
or poor low is that one-letter row sitting on the extreme of the profile; the tag
is off by default. Both stay available in Structure. Blocks inside the value area
use a lighter tint; blocks outside use the outside opacity (default 45%). The
initial balance defaults to 60 minutes, which is two 30-minute blocks. Value-area
fill defaults to off.

## What the chart does not do

The chart does not open a trade socket by itself. Call `fetchLuxalgoFootprints`
(or build prints yourself) and `setChartTypeData` again as the live bar moves.
The settings dialog does not embed a simulated preview of the ladder; the options
apply to the chart directly. Imbalance is measured on a row (ask versus bid at
the same price), not on the diagonal between neighboring rows. The TPO theme
list has Simple only. Shift-to-magnify is named in the footprint tooltip and uses
the chart's own zoom keys rather than a second magnifier. A bar that crosses a
session boundary stays on the session of its open.

The playground pages `footprint.html` and `tpo.html` load the hosted feed when it
answers, and otherwise draw a fixed sample. The footprint page can also load
recent public aggregated trades.
