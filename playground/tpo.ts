// TPO playground. Sixteen half-hour bars from UTC midnight; the chart type builds
// the profile itself (no setChartTypeData), with a fixed 0.5 tick so the letters
// stay a readable size.
import { Vela } from '../src/index';
import { fetchLuxalgoCandles } from '../src/core/orderflow';
import { sampleTpoBars } from './orderflow-sample';

const bars = sampleTpoBars();
const period = 30 * 60_000;

const chart = new Vela('#chart', {
    data: bars,
    priceStyle: 'tpo',
    volume: false,
    drawings: false,
    currentPriceLine: false,
    animations: false,
    theme: 'dark',
});

void chart.ready().then(async () => {
    const hosted = await loadHosted().catch(() => false);
    if (!hosted) {
        chart.renderer.applyConfig({
            chartTypes: {
                tpo: { tickSize: 0.5, blockMinutes: 30, valueAreaPct: 70, showLetters: true, showBlocks: true, showInitialBalance: true, showPoc: true },
            },
        });
        const last = bars[bars.length - 1]!;
        chart.setVisibleRange({ from: bars[0]!.time, to: last.time + period });
    }
    requestAnimationFrame(() => requestAnimationFrame(() => {
        (window as unknown as { __velaReady?: boolean }).__velaReady = true;
    }));
});

/** 30-minute candles, the input a TPO session is built from. Row size stays automatic. */
async function loadHosted(): Promise<boolean> {
    const to = Date.now();
    const from = to - 2 * 86_400_000;
    const hosted = await fetchLuxalgoCandles({ symbol: 'BTCUSDT', from, to, tfMin: 30 });
    if (hosted.length < 16) return false;
    chart.renderer.applyConfig({
        chartTypes: { tpo: { tickSize: 0, blockMinutes: 30, sessionKind: 'day', tradingHours: 'full', showLetters: true, showBlocks: true } },
    });
    await chart.setMarket({ data: hosted, timeframe: '30' });
    const last = hosted[hosted.length - 1]!.time;
    const sessionStart = Math.floor(last / 86_400_000) * 86_400_000;
    // Two sessions, each left-aligned inside its own day.
    chart.setVisibleRange({ from: sessionStart - 86_400_000, to: sessionStart + 86_400_000 });
    const status = document.querySelector<HTMLElement>('#bar');
    if (status) status.textContent = `Playground · TPO from 30-minute candles · ${hosted.length} bars`;
    return true;
}

(window as unknown as { chart: Vela }).chart = chart;
