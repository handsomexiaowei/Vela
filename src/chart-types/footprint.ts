// The built-in footprint price style: a per-bar bid × ask ladder. Registered through
// the same chart-type seam a plugin uses; the matching renderer layer paints it.
import { msg } from '../core/i18n/message';
import { BEARISH, BULLISH, HIGHLIGHT, NEUTRAL } from '../core/palette';
import { footprintEngine } from './orderflow-engines';
import { registerChartType } from './registry';

const AUTO = msg('chart.footprint.tickAuto', 'Auto');

export function registerFootprintChartType(): void {
    registerChartType({
        id: 'footprint',
        label: msg('chart.priceStyle.footprint', 'Footprint'),
        // No bar transform and no ticker modifier: the bars stay the raw OHLC the
        // ladder is aligned to. The layer replaces the candles.
        tickerModifier: false,
        basePainting: 'none',
        dataEngine: footprintEngine,
        settings: {
            title: msg('chart.footprint.settingsTitle', 'Footprint'),
            visibility: 'active',
            rows: [
                {
                    kind: 'row',
                    label: msg('chart.footprint.tickSize', 'Tick size'),
                    controls: [{ kind: 'number', key: 'tickSize', label: msg('chart.footprint.tickSize', 'Tick size'), defval: 0, min: 0, step: 0.01, placeholder: AUTO }],
                },
                { kind: 'number', key: 'imbalanceRatio', label: msg('chart.footprint.imbalanceRatio', 'Imbalance ratio'), defval: 3, min: 1, max: 100, step: 0.5 },
                { kind: 'toggle', key: 'showNumbers', label: msg('chart.footprint.showNumbers', 'Show numbers'), defval: true },
                { kind: 'toggle', key: 'showDelta', label: msg('chart.footprint.barSummary', 'Bar summary'), defval: true },
                { kind: 'toggle', key: 'showPoc', label: msg('chart.footprint.showPoc', 'Highlight POC'), defval: true },
                { kind: 'color', key: 'askColor', label: msg('chart.footprint.askColor', 'Ask dominant'), defval: BULLISH },
                { kind: 'color', key: 'bidColor', label: msg('chart.footprint.bidColor', 'Bid dominant'), defval: BEARISH },
                { kind: 'color', key: 'neutralColor', label: msg('chart.footprint.neutralColor', 'Neutral'), defval: NEUTRAL },
                { kind: 'color', key: 'pocColor', label: msg('chart.footprint.pocColor', 'POC'), defval: HIGHLIGHT },
            ],
        },
    });
}
