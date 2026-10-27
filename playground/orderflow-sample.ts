// Fixed samples for the footprint and TPO playground pages. The numbers are built
// by the same functions the library exports, so the page shows the real aggregation
// rather than a hand-drawn picture. Prices stay in a tight band so a full-window
// chart has rows tall enough to read.
import type { OHLCV } from '../src/core/model/ohlcv';
import {
    buildFootprintFromTrades,
    footprintSummary,
    type FootprintSeries,
    type TradePrint,
} from '../src/core/orderflow';

const START = Date.UTC(2024, 5, 3, 14, 0, 0);
export const FOOTPRINT_BAR_MS = 5 * 60_000;
export const FOOTPRINT_TICK = 0.25;

function quarter(n: number): number {
    return Math.round(n * 4) / 4;
}

/** Twelve five-minute bars and the footprint built from their prints at a 0.25 tick. */
export function sampleFootprint(): { bars: OHLCV[]; series: FootprintSeries } {
    const bars: OHLCV[] = [];
    const trades: TradePrint[] = [];
    let mid = 101;
    for (let i = 0; i < 12; i += 1) {
        const open = quarter(mid);
        const close = quarter(mid + Math.sin(i / 2) * 0.5);
        const high = quarter(Math.max(open, close) + 1.5);
        const low = quarter(Math.min(open, close) - 1);
        const t0 = START + i * FOOTPRINT_BAR_MS;
        for (let p = low; p <= high + 1e-9; p = quarter(p + FOOTPRINT_TICK)) {
            const span = high - low || FOOTPRINT_TICK;
            const t = (p - low) / span;
            const up = close >= open;
            const bulge = Math.abs(t - 0.45) < 0.18 ? 4 : 1;
            const ask = Math.round((18 + (up ? 70 * t : 24 * (1 - t)) + ((i * 3 + p * 4) % 11)) * bulge);
            const bid = Math.round((18 + (up ? 22 * (1 - t) : 74 * t) + ((i * 5 + p) % 9)) * bulge);
            trades.push({ time: t0 + 1_000, price: p, qty: ask, isBuyerMaker: false });
            trades.push({ time: t0 + 2_000, price: p, qty: bid, isBuyerMaker: true });
        }
        bars.push({ time: t0, open, high, low, close, volume: 0 });
        mid = close;
    }
    const series = buildFootprintFromTrades(trades, {
        barTimes: bars.map((b) => b.time),
        barMs: FOOTPRINT_BAR_MS,
        tickSize: FOOTPRINT_TICK,
    });
    for (const bar of bars) {
        const match = series.bars.find((b) => b.time === bar.time);
        bar.volume = match ? footprintSummary(match).volume : 0;
    }
    return { bars, series };
}

/** Sixteen half-hour bars from UTC midnight, so the profile letters start at A. */
export function sampleTpoBars(): OHLCV[] {
    const start = Date.UTC(2024, 5, 3, 0, 0, 0);
    const period = 30 * 60_000;
    const bars: OHLCV[] = [];
    for (let i = 0; i < 16; i += 1) {
        const center = 100 + Math.sin((i / 15) * Math.PI) * 2.5;
        const half = 0.75 + (i > 3 && i < 12 ? 0.75 : 0);
        const low = Math.round((center - half) * 2) / 2;
        const high = Math.round((center + half) * 2) / 2;
        bars.push({ time: start + i * period, open: low, high, low, close: high, volume: 1 });
    }
    return bars;
}
