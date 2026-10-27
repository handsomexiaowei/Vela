/**
 * Footprint aggregation: per-bar bid/ask volume at each price row.
 *
 * Bid volume is sell-aggressor size (the buyer was the maker — Binance `m: true`).
 * Ask volume is buy-aggressor size. Delta is ask − bid, so a positive delta means
 * buyers lifted offers. The point of control is the row with the most total size.
 */
import { autoTickSize, bucketPrice } from './tick-size';

/** One price row inside a bar. `price` is the row's lower edge. */
export interface FootprintLevel {
    price: number;
    /** Sell-aggressor volume. */
    bid: number;
    /** Buy-aggressor volume. */
    ask: number;
}

/** One bar's price-level volume. `time` is the bar open, epoch milliseconds, and must
 *  match the chart bar it draws on. */
export interface FootprintBar {
    time: number;
    levels: FootprintLevel[];
}

/** A trade print. `isBuyerMaker` follows the public trade schema: true when the buyer
 *  was the maker, so the seller was the aggressor. */
export interface TradePrint {
    time: number;
    price: number;
    qty: number;
    isBuyerMaker: boolean;
}

/** What {@link buildFootprintFromTrades} and the chart's own estimate both hand the renderer. */
export interface FootprintSeries {
    bars: FootprintBar[];
    tickSize: number;
    /** True when the series was split out of bar volume, not built from prints. */
    estimated: boolean;
}

export interface FootprintBuildOptions {
    /** Ascending bar-open times. A print in `[times[i], times[i + 1])` joins bar `i`.
     *  The last bar runs for `barMs`, or for the median gap when `barMs` is omitted. */
    barTimes: readonly number[];
    /** Length of the last bar, and of every bar when the times are not enough to measure a gap. */
    barMs?: number;
    /** Row height in price. Omit to pick one that puts a typical bar in about 10–20 rows. */
    tickSize?: number;
    /** Desired rows per bar when `tickSize` is omitted. Clamped to 10–20. Default 15. */
    targetRows?: number;
}

export interface FootprintEstimateOptions {
    tickSize?: number;
    targetRows?: number;
}

/** Which side dominates a row at `ratio` (ask ≥ ratio × bid, or the reverse). */
export type FootprintSide = 'ask' | 'bid' | 'neutral';

/** Totals for one bar. Delta is ask − bid. */
export interface FootprintSummary {
    bid: number;
    ask: number;
    delta: number;
    volume: number;
}

/** Cells draw `bid × ask` only once both axes clear these CSS-pixel floors; below either
 *  one the cell is a heatmap block. */
export const FOOTPRINT_TEXT_MIN_WIDTH = 36;
export const FOOTPRINT_TEXT_MIN_HEIGHT = 12;

export function footprintDrawsText(cellWidth: number, cellHeight: number): boolean {
    return cellWidth >= FOOTPRINT_TEXT_MIN_WIDTH && cellHeight >= FOOTPRINT_TEXT_MIN_HEIGHT;
}

/**
 * Ask-dominant when buy-aggressor size is at least `ratio` times sell-aggressor size,
 * bid-dominant the other way. A side with size and a zero opposite side is dominant.
 * `ratio` below 1 is treated as 1. The default used by the chart is 3.
 */
export function footprintSide(level: FootprintLevel, ratio: number): FootprintSide {
    const r = Number.isFinite(ratio) && ratio > 0 ? Math.max(1, ratio) : 3;
    const { bid, ask } = level;
    if (!(bid > 0) && !(ask > 0)) return 'neutral';
    if (ask > 0 && (bid <= 0 || ask >= bid * r)) return 'ask';
    if (bid > 0 && (ask <= 0 || bid >= ask * r)) return 'bid';
    return 'neutral';
}

/** Bid, ask, delta (ask − bid) and total volume of one bar. */
export function footprintSummary(bar: FootprintBar): FootprintSummary {
    let bid = 0;
    let ask = 0;
    for (const level of bar.levels) {
        if (level.bid > 0) bid += level.bid;
        if (level.ask > 0) ask += level.ask;
    }
    return { bid, ask, delta: ask - bid, volume: bid + ask };
}

/**
 * The point-of-control row: the greatest bid + ask. Ties go to the row nearer the
 * bar's mid price, then to the higher price. Null when the bar has no size.
 */
export function footprintPoc(bar: FootprintBar): FootprintLevel | null {
    let best: FootprintLevel | null = null;
    let bestTotal = 0;
    let bestDist = Infinity;
    const mid = levelMid(bar.levels);
    for (const level of bar.levels) {
        const total = (level.bid > 0 ? level.bid : 0) + (level.ask > 0 ? level.ask : 0);
        if (!(total > 0)) continue;
        const dist = mid == null ? 0 : Math.abs(level.price - mid);
        const closer = dist < bestDist - 1e-12 || (Math.abs(dist - bestDist) <= 1e-12 && (best == null || level.price > best.price));
        if (best == null || total > bestTotal + 1e-12 || (Math.abs(total - bestTotal) <= 1e-12 && closer)) {
            best = level;
            bestTotal = total;
            bestDist = dist;
        }
    }
    return best;
}

/**
 * Bucket prints into the given bars. Prints outside `[first open, last open + bar length)`
 * are dropped. Rows within a bar are sorted by price ascending and only rows that traded
 * are kept. The returned `tickSize` is the one the rows were built on.
 */
export function buildFootprintFromTrades(trades: readonly TradePrint[], options: FootprintBuildOptions): FootprintSeries {
    const barTimes = uniqueSorted(options.barTimes);
    if (barTimes.length === 0) return { bars: [], tickSize: positive(options.tickSize) ?? 1, estimated: false };
    const barMs = barLength(barTimes, options.barMs);
    const lastEnd = barTimes[barTimes.length - 1]! + barMs;
    const grouped: TradePrint[][] = barTimes.map(() => []);
    for (const trade of trades) {
        if (!isPrint(trade)) continue;
        const i = barIndex(trade.time, barTimes, lastEnd);
        if (i >= 0) grouped[i]!.push(trade);
    }
    const tick = positive(options.tickSize) ?? autoTickSize(grouped.map(tradeRange), options.targetRows ?? 15);
    const bars: FootprintBar[] = barTimes.map((time, i) => ({ time, levels: bucketTrades(grouped[i]!, tick) }));
    return { bars, tickSize: tick, estimated: false };
}

/**
 * A display stand-in for when no prints have been supplied: each bar's volume is
 * spread evenly across the rows from its low to its high, then tilted so an up bar
 * carries more ask toward the high and a down bar more bid toward the low. The sum
 * of bid + ask equals the bar's volume. This is not order flow — pass prints through
 * {@link buildFootprintFromTrades} for that.
 */
export function estimateFootprintFromBars(
    bars: readonly { time: number; open: number; high: number; low: number; close: number; volume?: number }[],
    options: FootprintEstimateOptions = {},
): FootprintSeries {
    const usable = bars.filter((b) => (b.volume ?? 0) > 0 && Number.isFinite(b.low) && Number.isFinite(b.high));
    const tick = positive(options.tickSize) ?? autoTickSize(usable.map((b) => b.high - b.low), options.targetRows ?? 15);
    const out: FootprintBar[] = [];
    for (const bar of bars) {
        const volume = bar.volume ?? 0;
        if (!(volume > 0) || !Number.isFinite(bar.low) || !Number.isFinite(bar.high)) {
            out.push({ time: bar.time, levels: [] });
            continue;
        }
        const edges = edgesOf(bar.low, bar.high, tick);
        const n = edges.length;
        const up = bar.close >= bar.open;
        const levels: FootprintLevel[] = edges.map((price, i) => {
            const t = n === 1 ? 0.5 : i / (n - 1);
            const askShare = up ? 0.25 + 0.6 * t : 0.75 - 0.6 * t;
            const slice = volume / n;
            const ask = slice * askShare;
            return { price, ask, bid: slice - ask };
        });
        out.push({ time: bar.time, levels });
    }
    return { bars: out, tickSize: tick, estimated: true };
}

/** The smallest positive gap between row prices, or 1 when a series has a single row. */
export function inferTickSize(bars: readonly FootprintBar[]): number {
    let min = Infinity;
    for (const bar of bars) {
        const prices = bar.levels.map((l) => l.price).filter((p) => Number.isFinite(p)).sort((a, b) => a - b);
        for (let i = 1; i < prices.length; i += 1) {
            const d = prices[i]! - prices[i - 1]!;
            if (d > 1e-12 && d < min) min = d;
        }
    }
    return Number.isFinite(min) ? min : 1;
}

function bucketTrades(trades: readonly TradePrint[], tick: number): FootprintLevel[] {
    const rows = new Map<number, FootprintLevel>();
    for (const trade of trades) {
        const price = bucketPrice(trade.price, tick);
        let row = rows.get(price);
        if (!row) {
            row = { price, bid: 0, ask: 0 };
            rows.set(price, row);
        }
        if (trade.isBuyerMaker) row.bid += trade.qty;
        else row.ask += trade.qty;
    }
    return [...rows.values()].sort((a, b) => a.price - b.price);
}

function tradeRange(trades: readonly TradePrint[]): number {
    let lo = Infinity;
    let hi = -Infinity;
    for (const t of trades) {
        if (t.price < lo) lo = t.price;
        if (t.price > hi) hi = t.price;
    }
    return Number.isFinite(lo) ? hi - lo : 0;
}

function edgesOf(low: number, high: number, tick: number): number[] {
    const start = bucketPrice(Math.min(low, high), tick);
    const end = bucketPrice(Math.max(low, high), tick);
    const out: number[] = [];
    const maxRows = 500;
    for (let i = 0; i < maxRows; i += 1) {
        const p = Number((start + i * tick).toPrecision(12));
        if (p > end + tick * 1e-9) break;
        out.push(p);
    }
    return out.length > 0 ? out : [start];
}

function levelMid(levels: readonly FootprintLevel[]): number | null {
    let lo = Infinity;
    let hi = -Infinity;
    for (const level of levels) {
        if (level.price < lo) lo = level.price;
        if (level.price > hi) hi = level.price;
    }
    return Number.isFinite(lo) ? (lo + hi) / 2 : null;
}

function barLength(times: readonly number[], barMs: number | undefined): number {
    if (barMs != null && barMs > 0 && Number.isFinite(barMs)) return barMs;
    const gaps: number[] = [];
    for (let i = 1; i < times.length; i += 1) {
        const g = times[i]! - times[i - 1]!;
        if (g > 0) gaps.push(g);
    }
    if (gaps.length === 0) return 60_000;
    gaps.sort((a, b) => a - b);
    return gaps[Math.floor((gaps.length - 1) / 2)]!;
}

function barIndex(time: number, times: readonly number[], lastEnd: number): number {
    if (!(time >= times[0]!) || time >= lastEnd) return -1;
    let lo = 0;
    let hi = times.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (times[mid]! <= time) lo = mid;
        else hi = mid - 1;
    }
    return lo;
}

function uniqueSorted(times: readonly number[]): number[] {
    const out: number[] = [];
    for (const t of [...times].sort((a, b) => a - b)) {
        if (Number.isFinite(t) && (out.length === 0 || t !== out[out.length - 1])) out.push(t);
    }
    return out;
}

function positive(value: number | undefined): number | undefined {
    return value != null && value > 0 && Number.isFinite(value) ? value : undefined;
}

function isPrint(trade: TradePrint): boolean {
    return Number.isFinite(trade.time) && Number.isFinite(trade.price) && trade.qty > 0 && Number.isFinite(trade.qty);
}
