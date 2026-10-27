// The built-in TPO (market profile) price style: one lettered profile per session.
import { msg } from '../core/i18n/message';
import { ACCENT, HIGHLIGHT, INFO } from '../core/palette';
import { tpoEngine } from './orderflow-engines';
import { registerChartType } from './registry';

const AUTO = msg('chart.tpo.tickAuto', 'Auto');
const LETTER = '#e6e6e6';

export function registerTpoChartType(): void {
    registerChartType({
        id: 'tpo',
        label: msg('chart.priceStyle.tpo', 'TPO'),
        tickerModifier: false,
        basePainting: 'none',
        dataEngine: tpoEngine,
        settings: {
            title: msg('chart.tpo.settingsTitle', 'Market profile'),
            visibility: 'active',
            rows: [
                { kind: 'number', key: 'periodMinutes', label: msg('chart.tpo.periodMinutes', 'Period (minutes)'), defval: 30, min: 1, max: 1440, step: 1 },
                { kind: 'number', key: 'sessionHours', label: msg('chart.tpo.sessionHours', 'Session length (hours)'), defval: 24, min: 1, max: 168, step: 1 },
                { kind: 'number', key: 'sessionOffsetHours', label: msg('chart.tpo.sessionOffsetHours', 'Session offset (hours)'), defval: 0, min: -23, max: 23, step: 1 },
                { kind: 'number', key: 'valueAreaPct', label: msg('chart.tpo.valueArea', 'Value area (%)'), defval: 70, min: 1, max: 100, step: 1 },
                {
                    kind: 'row',
                    label: msg('chart.tpo.tickSize', 'Tick size'),
                    controls: [{ kind: 'number', key: 'tickSize', label: msg('chart.tpo.tickSize', 'Tick size'), defval: 0, min: 0, step: 0.01, placeholder: AUTO }],
                },
                {
                    kind: 'toggle',
                    key: 'showInitialBalance',
                    label: msg('chart.tpo.initialBalance', 'Initial balance'),
                    defval: true,
                    number: { key: 'ibPeriods', label: msg('chart.tpo.ibPeriods', 'Periods'), defval: 2, min: 1, max: 12, step: 1 },
                },
                { kind: 'toggle', key: 'showLetters', label: msg('chart.tpo.showLetters', 'Show letters'), defval: true },
                { kind: 'toggle', key: 'showPoc', label: msg('chart.tpo.showPoc', 'POC'), defval: true },
                { kind: 'toggle', key: 'showValueArea', label: msg('chart.tpo.showValueArea', 'Value area'), defval: true },
                { kind: 'color', key: 'letterColor', label: msg('chart.tpo.letterColor', 'Letters'), defval: LETTER },
                { kind: 'color', key: 'vaColor', label: msg('chart.tpo.vaColor', 'Value area color'), defval: INFO },
                { kind: 'color', key: 'pocColor', label: msg('chart.tpo.pocColor', 'POC color'), defval: HIGHLIGHT },
                { kind: 'color', key: 'ibColor', label: msg('chart.tpo.ibColor', 'Initial balance color'), defval: ACCENT },
            ],
        },
    });
}
