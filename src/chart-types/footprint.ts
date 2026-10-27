// The built-in footprint price style. Settings follow the hosted chart's sections:
// Display, VA & POC, Imbalances, Unfinished auctions, Stat table, Filters.
// Candles stay underneath until a column is wide enough to hold a ladder.
import { msg } from '../core/i18n/message';
import { BEARISH, BULLISH, SLATE_DEEP } from '../core/palette';
import { footprintEngine } from './orderflow-engines';
import { registerChartType } from './registry';

const AUTO = msg('chart.footprint.tickAuto', 'Auto');
const OFF = msg('chart.footprint.filterOff', 'Off');

export function registerFootprintChartType(): void {
    registerChartType({
        id: 'footprint',
        label: msg('chart.priceStyle.footprint', 'Footprint'),
        tickerModifier: false,
        // Candles remain for columns too narrow to hold a ladder. "Hide candles" fades them.
        basePainting: 'candles',
        dataEngine: footprintEngine,
        settings: {
            title: msg('chart.footprint.settingsTitle', 'Footprint'),
            visibility: 'active',
            placement: 'after-symbol',
            subsections: [
                {
                    title: msg('chart.footprint.tab.display', 'Display'),
                    rows: [
                        { kind: 'select', key: 'mode', label: msg('chart.footprint.mode', 'Mode'), defval: 'bidAsk', options: [
                            ['bidAsk', msg('chart.footprint.mode.bidAsk', 'Bid x Ask Profile')],
                            ['volume', msg('chart.footprint.mode.volume', 'Volume')],
                            ['delta', msg('chart.footprint.mode.delta', 'Delta')],
                        ] },
                        { kind: 'select', key: 'cellValues', label: msg('chart.footprint.cellValues', 'Cell values'), defval: 'auto', options: [
                            ['auto', msg('chart.footprint.cellValues.auto', 'Auto')],
                            ['bidAsk', msg('chart.footprint.cellValues.bidAsk', 'Bid x Ask')],
                            ['volume', msg('chart.footprint.cellValues.volume', 'Volume')],
                            ['delta', msg('chart.footprint.cellValues.delta', 'Delta')],
                        ] },
                        { kind: 'toggle', key: 'averageTradeSize', label: msg('chart.footprint.averageTradeSize', 'Average trade size'), defval: false },
                        { kind: 'select', key: 'position', label: msg('chart.footprint.position', 'Position'), defval: 'right', options: [
                            ['right', msg('chart.footprint.position.right', 'Right')],
                            ['left', msg('chart.footprint.position.left', 'Left')],
                            ['center', msg('chart.footprint.position.center', 'Center')],
                        ] },
                        {
                            kind: 'row',
                            label: msg('chart.footprint.rowSize', 'Row size'),
                            controls: [{ kind: 'number', key: 'tickSize', label: msg('chart.footprint.rowSize', 'Row size'), defval: 0, min: 0, step: 0.01, placeholder: AUTO }],
                        },
                        { kind: 'toggle', key: 'hideCandles', label: msg('chart.footprint.hideCandles', 'Hide candles'), defval: false },
                        { kind: 'header', label: msg('chart.footprint.values', 'Values') },
                        { kind: 'toggle', key: 'autoTextSize', label: msg('chart.footprint.autoTextSize', 'Auto text size'), defval: true },
                        { kind: 'number', key: 'textSize', label: msg('chart.footprint.textSize', 'Text size'), defval: 11, min: 8, max: 18, step: 1, when: { key: 'autoTextSize', equals: false } },
                        { kind: 'color', key: 'textColor', label: msg('chart.footprint.textColor', 'Text color'), defval: '#f4f4f4' },
                        { kind: 'toggle', key: 'shrinkNumbers', label: msg('chart.footprint.shrinkNumbers', 'Shrink numbers to fit'), defval: true },
                        { kind: 'toggle', key: 'showNumbers', label: msg('chart.footprint.showNumbers', 'Show numbers'), defval: true },
                        { kind: 'header', label: msg('chart.footprint.colors', 'Colors') },
                        { kind: 'toggle', key: 'gradientCells', label: msg('chart.footprint.gradientCells', 'Gradient cells'), defval: true },
                        { kind: 'color', key: 'askColor', label: msg('chart.footprint.askColor', 'Ask color'), defval: BULLISH },
                        { kind: 'color', key: 'bidColor', label: msg('chart.footprint.bidColor', 'Bid color'), defval: BEARISH },
                        { kind: 'color', key: 'areaBackground', label: msg('chart.footprint.areaBackground', 'Area background'), defval: SLATE_DEEP },
                    ],
                },
                {
                    title: msg('chart.footprint.tab.va', 'VA & POC'),
                    rows: [
                        { kind: 'toggle', key: 'valueArea', label: msg('chart.footprint.valueArea', 'Value area'), defval: true, number: { key: 'valueAreaPct', label: msg('chart.footprint.valueAreaPct', 'Value area %'), defval: 70, min: 1, max: 100, step: 1 }, width: { key: 'vaWidth', label: msg('chart.footprint.lineWidth', 'Line width'), defval: 1 } },
                        { kind: 'toggle', key: 'showPoc', label: msg('chart.footprint.poc', 'Point of control'), defval: true, width: { key: 'pocWidth', label: msg('chart.footprint.pocWidth', 'POC width'), defval: 2 }, colors: [{ key: 'pocColor', label: msg('chart.footprint.pocColor', 'POC'), defval: '#f2f2f2' }] },
                        { kind: 'toggle', key: 'extendPoc', label: msg('chart.footprint.extendPoc', 'Extend POC until broken'), defval: false },
                    ],
                },
                {
                    title: msg('chart.footprint.tab.imbalances', 'Imbalances'),
                    enableKey: 'imbalance',
                    rows: [
                        { kind: 'toggle', key: 'imbalance', label: msg('chart.footprint.imbalance', 'Highlight imbalances'), defval: true },
                        { kind: 'number', key: 'imbalanceRatioPct', label: msg('chart.footprint.imbalanceRatioPct', 'Ratio %'), defval: 300, min: 100, max: 1000, step: 10 },
                        { kind: 'number', key: 'imbalanceWidth', label: msg('chart.footprint.highlightWidth', 'Highlight width'), defval: 1, min: 1, max: 4, step: 1 },
                        { kind: 'toggle', key: 'recolorValues', label: msg('chart.footprint.recolorValues', 'Recolor values'), defval: false },
                        { kind: 'toggle', key: 'stacked', label: msg('chart.footprint.stacked', 'Stacked imbalances'), defval: true, number: { key: 'stackedMin', label: msg('chart.footprint.stackedMin', 'Min stacked rows'), defval: 3, min: 2, max: 10, step: 1 } },
                    ],
                },
                {
                    title: msg('chart.footprint.tab.unfinished', 'Unfinished auctions'),
                    enableKey: 'unfinished',
                    rows: [
                        { kind: 'toggle', key: 'unfinished', label: msg('chart.footprint.unfinished', 'Unfinished auctions'), defval: false },
                        { kind: 'number', key: 'unfinishedMin', label: msg('chart.footprint.unfinishedMin', 'Min volume per side'), defval: 0, min: 0, step: 0.1 },
                        { kind: 'number', key: 'unfinishedWidth', label: msg('chart.footprint.unfinishedWidth', 'Line width'), defval: 1, min: 1, max: 4, step: 1 },
                        { kind: 'toggle', key: 'unfinishedExtend', label: msg('chart.footprint.unfinishedExtend', 'Extend until revisited'), defval: true },
                    ],
                },
                {
                    title: msg('chart.footprint.tab.stats', 'Stat table'),
                    enableKey: 'statTable',
                    rows: [
                        { kind: 'select', key: 'statPosition', label: msg('chart.footprint.statPosition', 'Position'), defval: 'below', options: [
                            ['below', msg('chart.footprint.statPosition.below', 'Below')],
                            ['above', msg('chart.footprint.statPosition.above', 'Above')],
                        ] },
                        { kind: 'number', key: 'statTextSize', label: msg('chart.footprint.statTextSize', 'Text size'), defval: 10, min: 8, max: 16, step: 1 },
                        { kind: 'toggle', key: 'statTable', label: msg('chart.footprint.statTable', 'Stat table'), defval: true },
                        { kind: 'toggle', key: 'statTotal', label: msg('chart.footprint.statTotal', 'Total volume'), defval: true },
                        { kind: 'toggle', key: 'statBuy', label: msg('chart.footprint.statBuy', 'Buy volume'), defval: false },
                        { kind: 'toggle', key: 'statSell', label: msg('chart.footprint.statSell', 'Sell volume'), defval: false },
                        { kind: 'toggle', key: 'statBuyPct', label: msg('chart.footprint.statBuyPct', 'Buy %'), defval: false },
                        { kind: 'toggle', key: 'statSellPct', label: msg('chart.footprint.statSellPct', 'Sell %'), defval: false },
                        { kind: 'toggle', key: 'statDelta', label: msg('chart.footprint.statDelta', 'Delta'), defval: true },
                        { kind: 'toggle', key: 'statDeltaPct', label: msg('chart.footprint.statDeltaPct', 'Delta %'), defval: false },
                        { kind: 'toggle', key: 'statTrades', label: msg('chart.footprint.statTrades', 'Trade count'), defval: false },
                        { kind: 'toggle', key: 'statBidCount', label: msg('chart.footprint.statBidCount', 'Bid count'), defval: false },
                        { kind: 'toggle', key: 'statAskCount', label: msg('chart.footprint.statAskCount', 'Ask count'), defval: false },
                    ],
                },
                {
                    title: msg('chart.footprint.tab.filters', 'Filters'),
                    rows: [
                        { kind: 'range', label: msg('chart.footprint.filterVolume', 'Volume'), minKey: 'volMin', maxKey: 'volMax', defval: 0, min: 0, placeholder: OFF },
                        { kind: 'range', label: msg('chart.footprint.filterBid', 'Bid volume'), minKey: 'bidMin', maxKey: 'bidMax', defval: 0, min: 0, placeholder: OFF },
                        { kind: 'range', label: msg('chart.footprint.filterAsk', 'Ask volume'), minKey: 'askMin', maxKey: 'askMax', defval: 0, min: 0, placeholder: OFF },
                    ],
                },
            ],
        },
    });
}
