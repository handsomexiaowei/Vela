// Footprint columns: one price row per cell, colored by which side dominates,
// with `bid × ask` once the cell is large enough to hold it. Heatmap otherwise.
import type { Translator } from '../../../core/i18n/types';
import { withAlpha } from '../../../core/color';
import { BEARISH, BULLISH, HIGHLIGHT, NEUTRAL } from '../../../core/palette';
import {
    footprintDrawsText,
    footprintPoc,
    footprintSide,
    footprintSummary,
    type FootprintBar,
    type FootprintSeries,
} from '../../../core/orderflow';
import type { CoordinateSystem, PaneBounds, PriceScale } from '../core/CoordinateSystem';

const TEXT = '#f4f4f4';
const FIGURES = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export interface FootprintPaintInput {
    series: FootprintSeries;
    /** Chart bars, index-aligned with the coordinate system. */
    times: readonly number[];
    settings: Record<string, unknown>;
    coords: CoordinateSystem;
    scale: PriceScale;
    bounds: PaneBounds;
    i18n: Translator;
}

export function paintFootprint(ctx: CanvasRenderingContext2D, input: FootprintPaintInput): void {
    const { series, times, coords, scale, bounds, i18n } = input;
    if (series.bars.length === 0 || !(series.tickSize > 0) || times.length === 0) return;
    const style = readStyle(input.settings);
    const byTime = new Map<number, FootprintBar>();
    for (const bar of series.bars) byTime.set(bar.time, bar);

    const range = coords.visibleLogicalRange();
    const i0 = Math.max(0, Math.floor(range.from));
    const i1 = Math.min(times.length - 1, Math.ceil(range.to));
    const pitch = coords.pxPerBar();
    const colW = Math.max(1, pitch - 1);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, bounds.top, coords.width, bounds.height);
    ctx.clip();
    ctx.font = `11px ${FIGURES}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = i0; i <= i1; i += 1) {
        const bar = byTime.get(times[i]!);
        if (!bar || bar.levels.length === 0) continue;
        const cx = coords.logicalToX(i);
        const x = cx - colW / 2;
        let maxTotal = 0;
        for (const level of bar.levels) {
            const total = level.bid + level.ask;
            if (total > maxTotal) maxTotal = total;
        }
        const poc = style.showPoc ? footprintPoc(bar) : null;
        let top = Infinity;
        let bottom = -Infinity;
        for (const level of bar.levels) {
            const y1 = coords.priceToY(level.price + series.tickSize, scale, bounds);
            const y2 = coords.priceToY(level.price, scale, bounds);
            const y = Math.min(y1, y2);
            const h = Math.abs(y2 - y1);
            if (h < 0.4 || y > bounds.top + bounds.height || y + h < bounds.top) continue;
            const gap = h > 4 ? 1 : 0;
            const total = level.bid + level.ask;
            const side = footprintSide(level, style.imbalanceRatio);
            const ink = side === 'ask' ? style.askColor : side === 'bid' ? style.bidColor : style.neutralColor;
            const strength = maxTotal > 0 ? total / maxTotal : 0;
            const text = style.showNumbers && footprintDrawsText(colW, h - gap);
            const alpha = text ? Math.max(0.78, 0.35 + 0.6 * strength) : 0.22 + 0.62 * strength;
            ctx.fillStyle = withAlpha(ink, alpha);
            ctx.fillRect(x, y + gap / 2, colW, Math.max(1, h - gap));
            if (poc && poc.price === level.price) {
                ctx.strokeStyle = style.pocColor;
                ctx.lineWidth = 1.5;
                ctx.strokeRect(x + 0.5, y + gap / 2 + 0.5, Math.max(0, colW - 1), Math.max(0, h - gap - 1));
            }
            if (text) {
                const label = `${qty(level.bid, i18n)}×${qty(level.ask, i18n)}`;
                if (ctx.measureText(label).width <= colW - 4) {
                    ctx.fillStyle = TEXT;
                    ctx.fillText(label, cx, y + h / 2);
                }
            }
            if (y < top) top = y;
            if (y + h > bottom) bottom = y + h;
        }
        if (style.showDelta && footprintDrawsText(colW, 14) && Number.isFinite(top)) {
            paintSummary(ctx, bar, cx, top, bottom, bounds, style, i18n);
        }
    }
    ctx.restore();
}

function paintSummary(
    ctx: CanvasRenderingContext2D,
    bar: FootprintBar,
    cx: number,
    top: number,
    bottom: number,
    bounds: PaneBounds,
    style: FootprintStyle,
    i18n: Translator,
): void {
    const summary = footprintSummary(bar);
    const delta = signed(summary.delta, i18n);
    const volume = qty(summary.volume, i18n);
    ctx.font = `10px ${FIGURES}`;
    const line = 12;
    let y = bottom + line;
    if (y + line > bounds.top + bounds.height) y = top - line * 2;
    if (y < bounds.top) return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = summary.delta > 0 ? style.askColor : summary.delta < 0 ? style.bidColor : style.neutralColor;
    ctx.fillText(delta, cx, y);
    ctx.fillStyle = withAlpha(TEXT, 0.85);
    ctx.fillText(volume, cx, y + line);
    ctx.font = `11px ${FIGURES}`;
}

interface FootprintStyle {
    imbalanceRatio: number;
    showNumbers: boolean;
    showDelta: boolean;
    showPoc: boolean;
    askColor: string;
    bidColor: string;
    neutralColor: string;
    pocColor: string;
}

function readStyle(bag: Record<string, unknown>): FootprintStyle {
    return {
        imbalanceRatio: numberOf(bag, 'imbalanceRatio', 3),
        showNumbers: flag(bag, 'showNumbers', true),
        showDelta: flag(bag, 'showDelta', true),
        showPoc: flag(bag, 'showPoc', true),
        askColor: colorOf(bag, 'askColor', BULLISH),
        bidColor: colorOf(bag, 'bidColor', BEARISH),
        neutralColor: colorOf(bag, 'neutralColor', NEUTRAL),
        pocColor: colorOf(bag, 'pocColor', HIGHLIGHT),
    };
}

function qty(n: number, i18n: Translator): string {
    const abs = Math.abs(n);
    if (abs >= 1000) return i18n.format.compact(n, { decimals: 1, surface: 'legend' });
    const whole = Math.abs(n - Math.round(n)) < 1e-6 * Math.max(1, abs);
    const decimals = abs >= 100 || whole ? 0 : abs >= 10 ? 1 : 2;
    return i18n.format.price(n, { decimals, surface: 'legend' });
}

function signed(n: number, i18n: Translator): string {
    const text = qty(n, i18n);
    if (n > 0 && !text.startsWith('+') && !text.startsWith('-')) return `+${text}`;
    return text;
}

function flag(bag: Record<string, unknown>, key: string, fallback: boolean): boolean {
    const v = bag[key];
    return typeof v === 'boolean' ? v : fallback;
}

function numberOf(bag: Record<string, unknown>, key: string, fallback: number): number {
    const v = bag[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function colorOf(bag: Record<string, unknown>, key: string, fallback: string): string {
    const v = bag[key];
    return typeof v === 'string' && v !== '' ? v : fallback;
}
