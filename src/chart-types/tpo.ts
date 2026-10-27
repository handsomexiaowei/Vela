// The built-in TPO price style. Sections follow the hosted chart: Sessions,
// Display, Structure, Volume profile, Markers.
import { msg } from '../core/i18n/message';
import { ACCENT, INFO } from '../core/palette';
import { tpoEngine } from './orderflow-engines';
import { registerChartType } from './registry';

const AUTO = msg('chart.tpo.tickAuto', 'Auto');

export function registerTpoChartType(): void {
    registerChartType({
        id: 'tpo',
        label: msg('chart.priceStyle.tpo', 'TPO'),
        tickerModifier: false,
        basePainting: 'none',
        dataEngine: tpoEngine,
        settings: {
            title: msg('chart.tpo.settingsTitle', 'TPO'),
            visibility: 'active',
            placement: 'after-symbol',
            subsections: [
                {
                    title: msg('chart.tpo.tab.sessions', 'Sessions'),
                    rows: [
                        { kind: 'select', key: 'sessionKind', label: msg('chart.tpo.session', 'Session'), defval: 'day', options: [
                            ['day', msg('chart.tpo.session.day', 'Day')],
                            ['week', msg('chart.tpo.session.week', 'Week')],
                        ] },
                        { kind: 'select', key: 'tradingHours', label: msg('chart.tpo.tradingHours', 'Trading hours'), defval: 'full', options: [
                            ['full', msg('chart.tpo.tradingHours.full', 'Full day')],
                            ['custom', msg('chart.tpo.tradingHours.custom', 'Custom')],
                        ] },
                        { kind: 'number', key: 'sessionHours', label: msg('chart.tpo.sessionHours', 'Session length (hours)'), defval: 24, min: 1, max: 168, step: 1, when: { key: 'tradingHours', equals: 'custom' } },
                        { kind: 'number', key: 'sessionOffsetHours', label: msg('chart.tpo.sessionOffsetHours', 'Session offset (hours)'), defval: 0, min: -23, max: 23, step: 1, when: { key: 'tradingHours', equals: 'custom' } },
                        { kind: 'number', key: 'blockMinutes', label: msg('chart.tpo.blockInterval', 'Block interval (minutes)'), defval: 30, min: 1, max: 1440, step: 1 },
                        {
                            kind: 'row',
                            label: msg('chart.tpo.rowSize', 'Row size'),
                            controls: [{ kind: 'number', key: 'tickSize', label: msg('chart.tpo.rowSize', 'Row size'), defval: 0, min: 0, step: 0.01, placeholder: AUTO }],
                        },
                    ],
                },
                {
                    title: msg('chart.tpo.tab.display', 'Display'),
                    rows: [
                        { kind: 'toggle', key: 'showBlocks', label: msg('chart.tpo.showBlocks', 'Show blocks'), defval: true },
                        { kind: 'toggle', key: 'colorByTime', label: msg('chart.tpo.colorByTime', 'Color row by time'), defval: false },
                        { kind: 'select', key: 'theme', label: msg('chart.tpo.theme', 'Theme'), defval: 'simple', options: [
                            ['simple', msg('chart.tpo.theme.simple', 'Simple')],
                        ] },
                        { kind: 'number', key: 'outsideOpacity', label: msg('chart.tpo.outsideOpacity', 'Outside VA opacity %'), defval: 35, min: 0, max: 100, step: 1 },
                        { kind: 'toggle', key: 'showLetters', label: msg('chart.tpo.showLetters', 'Show letters'), defval: true },
                        { kind: 'color', key: 'blockColor', label: msg('chart.tpo.blockColor', 'Block color'), defval: ACCENT },
                    ],
                },
                {
                    title: msg('chart.tpo.tab.structure', 'Structure'),
                    rows: [
                        { kind: 'number', key: 'valueAreaPct', label: msg('chart.tpo.valueArea', 'Value area %'), defval: 70, min: 1, max: 100, step: 1 },
                        { kind: 'toggle', key: 'vaFill', label: msg('chart.tpo.vaFill', 'VA fill'), defval: true, colors: [{ key: 'vaColor', label: msg('chart.tpo.vaColor', 'Value area color'), defval: INFO }] },
                        { kind: 'toggle', key: 'showPoc', label: msg('chart.tpo.poc', 'Point of control'), defval: true, colors: [{ key: 'pocColor', label: msg('chart.tpo.pocColor', 'POC color'), defval: '#f2f2f2' }] },
                        { kind: 'toggle', key: 'extendPoc', label: msg('chart.tpo.extendPoc', 'Extend POC until reached'), defval: false },
                        { kind: 'toggle', key: 'levelLabels', label: msg('chart.tpo.levelLabels', 'POC/VAH/VAL labels'), defval: true },
                        { kind: 'toggle', key: 'showInitialBalance', label: msg('chart.tpo.initialBalance', 'Initial balance'), defval: true, number: { key: 'ibMinutes', label: msg('chart.tpo.ibMinutes', 'IB minutes'), defval: 60, min: 1, max: 1440, step: 1 }, colors: [{ key: 'ibColor', label: msg('chart.tpo.ibColor', 'Initial balance color'), defval: ACCENT }] },
                        { kind: 'toggle', key: 'singlePrints', label: msg('chart.tpo.singlePrints', 'Single prints'), defval: true },
                        { kind: 'toggle', key: 'poorExtremes', label: msg('chart.tpo.poorExtremes', 'Poor high/low'), defval: true },
                    ],
                },
                {
                    title: msg('chart.tpo.tab.volume', 'Volume profile'),
                    enableKey: 'volumeProfile',
                    rows: [
                        { kind: 'toggle', key: 'volumeProfile', label: msg('chart.tpo.volumeProfile', 'Volume profile'), defval: true },
                        { kind: 'select', key: 'vpPosition', label: msg('chart.tpo.vpPosition', 'Position'), defval: 'right', options: [
                            ['right', msg('chart.tpo.vpPosition.right', 'Right')],
                            ['left', msg('chart.tpo.vpPosition.left', 'Left')],
                        ] },
                        { kind: 'number', key: 'vpWidthPct', label: msg('chart.tpo.vpWidth', 'Width %'), defval: 30, min: 5, max: 80, step: 1 },
                        { kind: 'toggle', key: 'vpPoc', label: msg('chart.tpo.vpPoc', 'Volume POC'), defval: true },
                        { kind: 'number', key: 'vpValueAreaPct', label: msg('chart.tpo.vpValueArea', 'Value area %'), defval: 70, min: 1, max: 100, step: 1 },
                        { kind: 'number', key: 'vpVaOpacity', label: msg('chart.tpo.vpVaOpacity', 'VA opacity %'), defval: 70, min: 0, max: 100, step: 1 },
                        { kind: 'toggle', key: 'vpLabels', label: msg('chart.tpo.vpLabels', 'POC/VAH/VAL labels'), defval: true },
                        { kind: 'color', key: 'vpColor', label: msg('chart.tpo.vpColor', 'Profile color'), defval: ACCENT },
                    ],
                },
                {
                    title: msg('chart.tpo.tab.markers', 'Markers'),
                    enableKey: 'markers',
                    rows: [
                        { kind: 'toggle', key: 'markers', label: msg('chart.tpo.markers', 'Markers'), defval: true },
                        { kind: 'toggle', key: 'openClose', label: msg('chart.tpo.openClose', 'Open/close markers'), defval: true },
                        { kind: 'toggle', key: 'midpoint', label: msg('chart.tpo.midpoint', 'Midpoint'), defval: true },
                    ],
                },
            ],
        },
    });
}
