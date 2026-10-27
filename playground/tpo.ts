// TPO playground. Sixteen half-hour bars from UTC midnight; the chart type builds
// the profile itself (no setChartTypeData), with a fixed 0.5 tick so the letters
// stay a readable size.
import { Vela } from '../src/index';
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

void chart.ready().then(() => {
    chart.renderer.applyConfig({
        chartTypes: {
            tpo: { tickSize: 0.5, periodMinutes: 30, valueAreaPct: 70, showLetters: true, showInitialBalance: true, showValueArea: true, showPoc: true },
        },
    });
    const last = bars[bars.length - 1]!;
    chart.setVisibleRange({ from: bars[0]!.time, to: last.time + period });
});

(window as unknown as { chart: Vela }).chart = chart;
