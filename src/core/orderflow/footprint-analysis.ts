// Derived footprint marks: value area, stacked imbalances, unfinished auctions,
// the stat row, quantity text (`1.2k`), and re-bucketing a series onto a coarser tick.
import { bucketPrice } from './tick-size';
import { footprintSide, type FootprintBar, type FootprintLevel, type FootprintSeries, type FootprintSide } from './footprint';

/** A footprint column is drawn only once it is at least this many CSS pixels wide.
 *  Narrower bars stay candles, so zooming in is what opens the ladders. */
export const FOOTPRINT_MIN_COLUMN_PX = 52;

export function footprintColumnVisible(columnWidth: number): boolean {
    return columnWidth >= FOOTPRINT_MIN_COLUMN_PX;
}

/** Compact size the way the ladder prints it: `1.2k`, `12k`, `1.5m`. Below 1000 the
 *  number is trimmed, not suffixed. */
export function formatFootprintQty(value: number): string {
    if (!Number.isFinite(value)) return '';
    const sign = value < 0 ? '-' : '';
    const abs = Math.abs(value);
    if (abs >= 1_000_000) return sign + trimNum(abs / 1_000_000) + 'm';
    if (abs >= 1000) return sign + trimNum(abs / 1000) + 'k';
    if (abs >= 100) return sign + String(Math.round(abs));
    return sign + trimNum(abs);
}

export interface FootprintValueArea {
    pocPrice: number;
    /** Top edge of the value area. */
    vah: number;
    /** Bottom edge of the value area. */
    val: number;
}

/**
 * Value area of one footprint bar. Weight is bid + ask. Grows from the point of
 * control by the heavier neighbor until `fraction` of the bar's volume is inside.
 * An equal pair grows down. Null when the bar has no size.
 */
export function footprintValueArea(levels: readonly FootprintLevel[], tick: number, fraction = 0.7): FootprintValueArea | null {
    const rows = [...levels].filter((l) => l.bid + l.ask > 0).sort((a, b) => a.price - b.price);
    if (rows.length === 0 || !(tick > 0)) return null;
    const weight = (l: FootprintLevel) => l.bid + l.ask;
    let total = 0;
    let max = 0;
    let poc = 0;
    for (let i = 0; i < rows.length; i += 1) {
        const w = weight(rows[i]!);
        total += w;
        if (w > max) {
            max = w;
            poc = i;
        }
    }
    const mid = (rows[0]!.price + rows[rows.length - 1]!.price) / 2;
    for (let i = 0; i < rows.length; i += 1) {
        if (Math.abs(weight(rows[i]!) - max) > 1e-9) continue;
        const better =
            Math.abs(rows[i]!.price - mid) < Math.abs(rows[poc]!.price - mid) - 1e-12 ||
            (Math.abs(Math.abs(rows[i]!.price - mid) - Math.abs(rows[poc]!.price - mid)) <= 1e-12 && rows[i]!.price > rows[poc]!.price);
        if (better) poc = i;
    }
    const frac = Math.min(1, Math.max(0, fraction));
    const target = total * frac;
    let vaFrom = poc;
    let vaTo = poc;
    let acc = weight(rows[poc]!);
    while (acc < target - 1e-9 && (vaFrom > 0 || vaTo < rows.length - 1)) {
        const below = vaFrom > 0 ? weight(rows[vaFrom - 1]!) : -1;
        const above = vaTo < rows.length - 1 ? weight(rows[vaTo + 1]!) : -1;
        if (above > below) {
            vaTo += 1;
            acc += above;
        } else {
            vaFrom -= 1;
            acc += below;
        }
    }
    return { pocPrice: rows[poc]!.price, val: rows[vaFrom]!.price, vah: rows[vaTo]!.price + tick };
}

export interface ImbalanceStack {
    side: Exclude<FootprintSide, 'neutral'>;
    /** Lower edge of the bottom row in the run. */
    fromPrice: number;
    /** Lower edge of the top row in the run. */
    toPrice: number;
    count: number;
}

/** Runs of the same imbalance side at least `minRows` long. Levels may be unsorted. */
export function footprintStacks(levels: readonly FootprintLevel[], ratio: number, minRows: number): ImbalanceStack[] {
    const rows = [...levels].sort((a, b) => a.price - b.price);
    const need = Math.max(2, Math.round(minRows) || 2);
    const out: ImbalanceStack[] = [];
    let runSide: Exclude<FootprintSide, 'neutral'> | null = null;
    let runStart = 0;
    const flush = (end: number): void => {
        if (!runSide) return;
        const count = end - runStart;
        if (count >= need) {
            out.push({ side: runSide, fromPrice: rows[runStart]!.price, toPrice: rows[end - 1]!.price, count });
        }
        runSide = null;
    };
    for (let i = 0; i < rows.length; i += 1) {
        const side = footprintSide(rows[i]!, ratio);
        if (side === 'neutral' || side !== runSide) {
            flush(i);
            if (side !== 'neutral') {
                runSide = side;
                runStart = i;
            }
        }
    }
    flush(rows.length);
    return out;
}

export interface UnfinishedAuction {
    /** Which extreme of the bar failed to trade both sides. */
    edge: 'high' | 'low';
    /** Lower edge of that row. */
    price: number;
}

/**
 * An extreme is unfinished when either side printed no more than `minVolume`
 * (default 0: a zero side). Both the high and the low are checked. The auction
 * is finished only when bid and ask are each strictly above `minVolume`.
 */
export function unfinishedAuctions(levels: readonly FootprintLevel[], minVolume = 0): UnfinishedAuction[] {
    const rows = levels.filter((l) => l.bid + l.ask > 0);
    if (rows.length === 0) return [];
    let low = rows[0]!;
    let high = rows[0]!;
    for (const row of rows) {
        if (row.price < low.price) low = row;
        if (row.price > high.price) high = row;
    }
    const floor = Number.isFinite(minVolume) && minVolume > 0 ? minVolume : 0;
    const open = (row: FootprintLevel) => !(row.bid > floor && row.ask > floor);
    const out: UnfinishedAuction[] = [];
    if (open(low)) out.push({ edge: 'low', price: low.price });
    if (high.price !== low.price && open(high)) out.push({ edge: 'high', price: high.price });
    return out;
}

/**
 * First later bar whose high-low range contains `price`, or null if none does.
 * Used to stop a POC or unfinished-auction line ("extend until broken / revisited").
 */
export function priceRevisitedAt(
    bars: readonly { time: number; high: number; low: number }[],
    afterTime: number,
    price: number,
): number | null {
    for (const bar of bars) {
        if (!(bar.time > afterTime)) continue;
        if (bar.low <= price && price <= bar.high) return bar.time;
    }
    return null;
}

export interface FootprintStats {
    bid: number;
    ask: number;
    volume: number;
    delta: number;
    /** Ask share of volume, 0–100. */
    buyPct: number;
    /** Bid share of volume, 0–100. */
    sellPct: number;
    /** Delta as a percent of volume, signed. */
    deltaPct: number;
    tradeCount: number;
    bidCount: number;
    askCount: number;
}

/** The stat-table figures for one bar. Counts stay 0 when the source did not provide them. */
export function footprintStats(bar: FootprintBar): FootprintStats {
    let bid = 0;
    let ask = 0;
    let bidCount = 0;
    let askCount = 0;
    for (const level of bar.levels) {
        if (level.bid > 0) bid += level.bid;
        if (level.ask > 0) ask += level.ask;
        if (level.bidCount != null && level.bidCount > 0) bidCount += level.bidCount;
        if (level.askCount != null && level.askCount > 0) askCount += level.askCount;
    }
    const volume = bid + ask;
    const delta = ask - bid;
    const buyPct = volume > 0 ? (ask / volume) * 100 : 0;
    const sellPct = volume > 0 ? (bid / volume) * 100 : 0;
    return {
        bid,
        ask,
        volume,
        delta,
        buyPct,
        sellPct,
        deltaPct: volume > 0 ? (delta / volume) * 100 : 0,
        tradeCount: bidCount + askCount,
        bidCount,
        askCount,
    };
}

/**
 * Fold a series onto a coarser tick. A tick finer than the series already has is
 * ignored — the rows cannot be split. Counts and size sum inside each new row.
 */
export function rebucketFootprint(series: FootprintSeries, tickSize: number): FootprintSeries {
    if (!(tickSize > 0) || !(series.tickSize > 0) || tickSize <= series.tickSize * 1.001) return series;
    const bars = series.bars.map((bar) => ({ time: bar.time, levels: mergeLevels(bar.levels, tickSize) }));
    return { bars, tickSize, estimated: series.estimated };
}

/** Pixel layout of one Bid x Ask row. Bars grow out from the cell's center: bid to the
 *  left, ask to the right. Length is that side divided by `maxSide` (the largest bid
 *  or ask in the bar), so the longest side reaches the cell edge. Labels sit against
 *  the center: bid is right-aligned just left of it, ask left-aligned just right of it. */
export interface BidAskRowGeometry {
    center: number;
    bidX: number;
    bidW: number;
    askX: number;
    askW: number;
    /** X for a right-aligned bid label. */
    bidLabelX: number;
    /** X for a left-aligned ask label. */
    askLabelX: number;
}

export function bidAskRowGeometry(
    cellX: number,
    cellW: number,
    bid: number,
    ask: number,
    maxSide: number,
    labelGap = 4,
): BidAskRowGeometry {
    const center = cellX + cellW / 2;
    const half = cellW / 2;
    const scale = maxSide > 0 ? half / maxSide : 0;
    const bidW = Math.max(0, bid) * scale;
    const askW = Math.max(0, ask) * scale;
    return {
        center,
        bidX: center - bidW,
        bidW,
        askX: center,
        askW,
        bidLabelX: center - labelGap,
        askLabelX: center + labelGap,
    };
}

/** Hide a row when a filter bound is set and the value falls outside it. A bound of 0 is off. */
export function footprintRowPasses(level: FootprintLevel, bounds: { volume?: [number, number]; bid?: [number, number]; ask?: [number, number] }): boolean {
    return inRange(level.bid + level.ask, bounds.volume) && inRange(level.bid, bounds.bid) && inRange(level.ask, bounds.ask);
}

function mergeLevels(levels: readonly FootprintLevel[], tick: number): FootprintLevel[] {
    const rows = new Map<number, FootprintLevel>();
    for (const level of levels) {
        const price = bucketPrice(level.price, tick);
        let row = rows.get(price);
        if (!row) {
            row = { price, bid: 0, ask: 0, bidCount: 0, askCount: 0 };
            rows.set(price, row);
        }
        row.bid += level.bid;
        row.ask += level.ask;
        row.bidCount = (row.bidCount ?? 0) + (level.bidCount ?? 0);
        row.askCount = (row.askCount ?? 0) + (level.askCount ?? 0);
    }
    return [...rows.values()].sort((a, b) => a.price - b.price);
}

function inRange(value: number, bounds: [number, number] | undefined): boolean {
    if (!bounds) return true;
    const [min, max] = bounds;
    if (min > 0 && value < min) return false;
    if (max > 0 && value > max) return false;
    return true;
}

function trimNum(value: number): string {
    const digits = value >= 100 ? 0 : value >= 10 ? 1 : value >= 1 ? 1 : 2;
    return value.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}
