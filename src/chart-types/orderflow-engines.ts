// Data engines for the built-in footprint and TPO price styles. They push a series
// the matching renderer layer paints. A host-supplied payload (`chart.setChartTypeData`)
// wins; otherwise the engine derives one from the chart's own bars — an estimate for
// the footprint (bar volume is not aggressor flow), a real profile for TPO.
import {
    estimateFootprintFromBars,
    inferTickSize,
    profileWithInitialBalance,
    profileWithValueArea,
    type FootprintBar,
    type FootprintLevel,
    type FootprintSeries,
    type TpoProfile,
    type TpoRow,
} from '../core/orderflow';
import { computeTpoProfiles } from '../core/orderflow/tpo';
import type { SeriesDataEngine, SeriesDataEngineHost } from './registry';

export function footprintEngine(): SeriesDataEngine {
    return new PublishingEngine((host, settings) => {
        const external = coerceFootprint(host.externalData());
        if (external) return external;
        return estimateFootprintFromBars(host.bars(), { tickSize: positive(settings.tickSize), targetRows: 15 });
    });
}

export function tpoEngine(): SeriesDataEngine {
    return new PublishingEngine((host, settings) => {
        const external = coerceTpo(host.externalData());
        const valueArea = fraction(settings.valueAreaPct, 70);
        const ibPeriods = count(settings.ibPeriods, 2);
        if (external) {
            return {
                profiles: external.map((p) => profileWithInitialBalance(profileWithValueArea(p, valueArea), ibPeriods)),
            };
        }
        const profiles = computeTpoProfiles(host.bars(), {
            tickSize: positive(settings.tickSize),
            targetRows: 16,
            periodMs: minutes(settings.periodMinutes, 30),
            sessionMs: (positive(settings.sessionHours) ?? 24) * 3_600_000,
            sessionOffsetMs: offsetHours(settings.sessionOffsetHours) * 3_600_000,
            valueArea,
            initialBalancePeriods: ibPeriods,
        });
        return { profiles };
    });
}

/** Remembers settings, publishes on start / resume / bars / settings / external data. */
class PublishingEngine implements SeriesDataEngine {
    private host: SeriesDataEngineHost | null = null;
    private settings: Record<string, unknown> = {};
    private alive = false;

    constructor(private readonly build: (host: SeriesDataEngineHost, settings: Record<string, unknown>) => unknown) {}

    start(host: SeriesDataEngineHost): void {
        this.host = host;
        this.alive = true;
        this.publish();
    }

    suspend(): void {}

    resume(): void {
        this.publish();
    }

    stop(): void {
        this.alive = false;
        this.host = null;
    }

    onBars(): void {
        this.publish();
    }

    onSettings(values: Record<string, unknown>): void {
        this.settings = values;
        this.publish();
    }

    onExternalData(): void {
        this.publish();
    }

    private publish(): void {
        if (!this.alive || !this.host) return;
        this.host.pushData(this.build(this.host, this.settings));
    }
}

function coerceFootprint(data: unknown): FootprintSeries | null {
    if (Array.isArray(data)) return { bars: data.filter(isFootprintBar), tickSize: inferTickSize(data.filter(isFootprintBar)), estimated: false };
    if (!data || typeof data !== 'object') return null;
    const rec = data as Partial<FootprintSeries>;
    if (!Array.isArray(rec.bars)) return null;
    const bars = rec.bars.filter(isFootprintBar);
    const tick = typeof rec.tickSize === 'number' && rec.tickSize > 0 ? rec.tickSize : inferTickSize(bars);
    return { bars, tickSize: tick, estimated: false };
}

function isFootprintBar(value: unknown): value is FootprintBar {
    if (!value || typeof value !== 'object') return false;
    const bar = value as FootprintBar;
    return Number.isFinite(bar.time) && Array.isArray(bar.levels) && bar.levels.every(isLevel);
}

function isLevel(value: unknown): value is FootprintLevel {
    if (!value || typeof value !== 'object') return false;
    const level = value as FootprintLevel;
    return Number.isFinite(level.price) && Number.isFinite(level.bid) && level.bid >= 0 && Number.isFinite(level.ask) && level.ask >= 0;
}

function coerceTpo(data: unknown): TpoProfile[] | null {
    const list = Array.isArray(data)
        ? data
        : data && typeof data === 'object' && Array.isArray((data as { profiles?: unknown }).profiles)
          ? (data as { profiles: unknown[] }).profiles
          : null;
    if (!list) return null;
    return list.filter(isProfile);
}

function isProfile(value: unknown): value is TpoProfile {
    if (!value || typeof value !== 'object') return false;
    const p = value as TpoProfile;
    return (
        Number.isFinite(p.sessionStart) &&
        Number.isFinite(p.from) &&
        Number.isFinite(p.to) &&
        p.tickSize > 0 &&
        p.periodMs > 0 &&
        Number.isFinite(p.pocPrice) &&
        Array.isArray(p.rows) &&
        p.rows.length > 0 &&
        p.rows.every(isRow)
    );
}

function isRow(value: unknown): value is TpoRow {
    if (!value || typeof value !== 'object') return false;
    const row = value as TpoRow;
    return Number.isFinite(row.price) && Array.isArray(row.periods) && row.periods.every((n) => Number.isInteger(n) && n >= 0);
}

function positive(value: unknown): number | undefined {
    return typeof value === 'number' && value > 0 && Number.isFinite(value) ? value : undefined;
}

function fraction(value: unknown, fallbackPct: number): number {
    const pct = typeof value === 'number' && Number.isFinite(value) ? value : fallbackPct;
    return Math.min(1, Math.max(0, pct / 100));
}

function count(value: unknown, fallback: number): number {
    const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
    return Math.max(0, n);
}

function minutes(value: unknown, fallback: number): number {
    const n = typeof value === 'number' && value > 0 && Number.isFinite(value) ? value : fallback;
    return n * 60_000;
}

function offsetHours(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
