// Footprint playground. The sample is deterministic (see orderflow-sample.ts). The
// button replaces it with recent public Binance aggregated trades — no key — bucketed
// by the same buildFootprintFromTrades the library exports.
import { Vela } from '../src/index';
import { buildFootprintFromTrades, fetchLuxalgoCandles, fetchLuxalgoFootprints, type FootprintSeries, type TradePrint } from '../src/core/orderflow';
import type { OHLCV } from '../src/core/model/ohlcv';
import { FOOTPRINT_BAR_MS, sampleFootprint } from './orderflow-sample';

const status = document.querySelector<HTMLElement>('#status')!;
const sample = sampleFootprint();

const chart = new Vela('#chart', {
    data: sample.bars,
    priceStyle: 'footprint',
    volume: false,
    drawings: false,
    currentPriceLine: false,
    animations: false,
    theme: 'dark',
});
chart.setChartTypeData('footprint', sample.series);

void chart.ready().then(async () => {
    const framed = await loadHosted().catch(() => false);
    if (!framed) {
        const last = sample.bars[sample.bars.length - 1]!;
        chart.setVisibleRange({ from: sample.bars[0]!.time, to: last.time + FOOTPRINT_BAR_MS });
        status.textContent = 'Sample prints';
    }
    requestAnimationFrame(() => requestAnimationFrame(() => {
        (window as unknown as { __velaReady?: boolean }).__velaReady = true;
    }));
});

/** The hosted footprint feed (tf is seconds). Falls back to the sample on any failure. */
async function loadHosted(): Promise<boolean> {
    const to = Date.now();
    const from = to - 6 * 60 * 60_000;
    const [series, bars] = await Promise.all([
        fetchLuxalgoFootprints({ symbol: 'BTCUSDT', from, to, tf: 60 }),
        fetchLuxalgoCandles({ symbol: 'BTCUSDT', from, to, tfMin: 1 }),
    ]);
    if (series.bars.length < 3 || bars.length < 3) return false;
    await chart.setMarket({ data: bars, timeframe: '1' });
    chart.setChartTypeData('footprint', series);
    const last = bars[bars.length - 1]!;
    // About 70px per bar on a 1920-wide playground, so the ladders are open
    // (the style switches in at ~60px) and any older bar without a footprint
    // stays a candle.
    const start = bars[Math.max(0, bars.length - 22)]!.time;
    chart.setVisibleRange({ from: start - 60_000, to: last.time + 2 * 60_000 });
    status.textContent = `Hosted footprints · tick ${series.tickSize} · ${series.bars.length} bars`;
    return true;
}

document.querySelector<HTMLButtonElement>('#live')!.onclick = () => {
    status.textContent = 'Loading Binance trades…';
    void loadBinanceFootprint()
        .then(async (live) => {
            if (!live) {
                status.textContent = 'Binance returned nothing — still showing the sample.';
                return;
            }
            await chart.setMarket({ data: live.bars, timeframe: '1' });
            chart.setChartTypeData('footprint', live.series);
            const last = live.bars[live.bars.length - 1]!;
            chart.setVisibleRange({ from: live.bars[Math.max(0, live.bars.length - 8)]!.time, to: last.time + 60_000 });
            status.textContent = `Binance BTCUSDT · ${live.trades} trades · tick ${live.series.tickSize}`;
        })
        .catch((err: unknown) => {
            status.textContent = `Binance unavailable (${err instanceof Error ? err.message : 'request failed'}) — still showing the sample.`;
        });
};

(window as unknown as { chart: Vela }).chart = chart;

interface AggTrade {
    T: number;
    p: string;
    q: string;
    m: boolean;
}

/** Last ~20 minutes of BTCUSDT 1m bars plus the aggregated trades inside them. */
async function loadBinanceFootprint(): Promise<{ bars: OHLCV[]; series: FootprintSeries; trades: number } | null> {
    const end = Date.now();
    const start = end - 20 * 60_000;
    const klineUrl = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&startTime=${start}&endTime=${end}&limit=20`;
    const klines = (await (await fetch(klineUrl)).json()) as unknown;
    if (!Array.isArray(klines) || klines.length === 0) return null;
    const bars: OHLCV[] = klines.map((k: (string | number)[]) => ({
        time: Number(k[0]),
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
        volume: Number(k[5]),
    }));
    const trades: TradePrint[] = [];
    let from = bars[0]!.time;
    const lastEnd = bars[bars.length - 1]!.time + 60_000;
    while (from < lastEnd && trades.length < 8000) {
        const url = `https://api.binance.com/api/v3/aggTrades?symbol=BTCUSDT&startTime=${from}&endTime=${lastEnd}&limit=1000`;
        const rows = (await (await fetch(url)).json()) as unknown;
        if (!Array.isArray(rows) || rows.length === 0) break;
        for (const row of rows as AggTrade[]) {
            trades.push({ time: row.T, price: Number(row.p), qty: Number(row.q), isBuyerMaker: row.m });
        }
        const next = (rows[rows.length - 1] as AggTrade).T + 1;
        if (next <= from) break;
        from = next;
        if (rows.length < 1000) break;
    }
    if (trades.length === 0) return null;
    const series = buildFootprintFromTrades(trades, { barTimes: bars.map((b) => b.time), barMs: 60_000 });
    return { bars, series, trades: trades.length };
}
