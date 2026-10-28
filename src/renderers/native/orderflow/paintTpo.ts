// Session market profile over the candles. Each period is a column at its own
// time, starting at the session open and growing right, and the column stays
// inside that session. Blocks are translucent and shaded by period so the
// candles and any study on the data canvas stay visible. The point of control
// is a white outline of that row; the initial balance is a bracket on the left.
import { msg } from '../../../core/i18n/message';
import type { Translator } from '../../../core/i18n/types';
import type { OHLCV } from '../../../core/model/ohlcv';
import { withAlpha } from '../../../core/color';
import { ACCENT, BEARISH, BULLISH, HIGHLIGHT, INFO, WARNING } from '../../../core/palette';
import {
    TPO_TARGET_ROW_PX,
    autoRowTick,
    computeTpoProfiles,
    priceRevisitedAt,
    rebucketTpoProfile,
    tpoDrawsLetters,
    tpoLetter,
    tpoPeriodSlot,
    tpoPoorExtremes,
    tpoSinglePrintRows,
    type TpoProfile,
    type TpoRow,
} from '../../../core/orderflow';
import type { CoordinateSystem, PaneBounds, PriceScale } from '../core/CoordinateSystem';

const POC = msg('chart.tpo.pocLabel', 'POC');
const VAH = msg('chart.tpo.vah', 'VAH');
const VAL = msg('chart.tpo.val', 'VAL');
const POOR_HIGH = msg('chart.tpo.poorHigh', 'Poor high');
const POOR_LOW = msg('chart.tpo.poorLow', 'Poor low');
const FIGURES = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export interface TpoPaintInput {
    profiles: readonly TpoProfile[];
    bars: readonly OHLCV[];
    settings: Record<string, unknown>;
    coords: CoordinateSystem;
    scale: PriceScale;
    bounds: PaneBounds;
    i18n: Translator;
}

export function paintTpo(ctx: CanvasRenderingContext2D, input: TpoPaintInput): void {
    const { coords, scale, bounds, i18n } = input;
    const profiles = profilesForFrame(input);
    if (profiles.length === 0) return;
    const style = readStyle(input.settings);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, bounds.top, coords.width, bounds.height);
    ctx.clip();
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;

    for (const profile of profiles) {
        if (!(profile.tickSize > 0) || profile.rows.length === 0) continue;
        const sessionX = coords.timeToX(profile.sessionStart);
        const sessionW = Math.max(1, coords.timeToX(profile.sessionEnd) - sessionX);
        if (sessionX >= coords.width || sessionX + sessionW <= 0) continue;
        const periodCount = Math.max(1, Math.round((profile.sessionEnd - profile.sessionStart) / profile.periodMs));
        const maxPeriod = profile.rows.reduce((m, row) => Math.max(m, ...row.periods), 0);
        const single = new Set(style.singlePrints ? tpoSinglePrintRows(profile).map((row) => row.price) : []);
        const poor = style.poorExtremes ? tpoPoorExtremes(profile) : { poorHigh: false, poorLow: false };
        const vpW = style.volumeProfile ? Math.max(12, sessionW * (style.vpWidthPct / 100)) : 0;

        if (style.vaFill && style.showValueArea) {
            const yTop = coords.priceToY(profile.vah, scale, bounds);
            const yBot = coords.priceToY(profile.val, scale, bounds);
            ctx.fillStyle = withAlpha(style.vaColor, 0.14);
            ctx.fillRect(sessionX, Math.min(yTop, yBot), sessionW, Math.abs(yBot - yTop));
        }

        if (style.showBlocks || style.showLetters) {
            for (const row of profile.rows) {
                const box = rowBox(coords, scale, bounds, row.price, profile.tickSize);
                if (!box) continue;
                const inVa = row.price >= profile.val - 1e-9 && row.price + profile.tickSize <= profile.vah + 1e-9;
                for (const period of row.periods) {
                    const slot = tpoPeriodSlot(period, periodCount, sessionW);
                    const cx = sessionX + slot.x;
                    const paint = blockPaint(period, maxPeriod, inVa, style);
                    if (style.showBlocks) {
                        ctx.fillStyle = paint.fill;
                        ctx.fillRect(cx, box.y, slot.width, box.h);
                    }
                    if (style.showLetters && tpoDrawsLetters(slot.width, box.h)) {
                        ctx.fillStyle = paint.text;
                        ctx.font = `${Math.max(7, Math.min(13, Math.floor(Math.min(slot.width, box.h) * 0.72)))}px ${FIGURES}`;
                        ctx.textAlign = 'center';
                        ctx.fillText(tpoLetter(period), cx + slot.width / 2, box.y + box.h / 2);
                    }
                }
                if (single.has(row.price)) {
                    const first = tpoPeriodSlot(row.periods[0]!, periodCount, sessionW);
                    const last = tpoPeriodSlot(row.periods[row.periods.length - 1]!, periodCount, sessionW);
                    ctx.strokeStyle = '#e6e6e6';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(sessionX + first.x + 0.5, box.y + 0.5, Math.max(1, last.x + last.width - first.x - 1), Math.max(1, box.h - 1));
                }
            }
        }

        if (style.showPoc) paintPoc(ctx, input, profile, sessionX, sessionW, periodCount, style);
        if (style.showInitialBalance && profile.ib) paintIbBracket(ctx, coords, scale, bounds, Math.max(1, sessionX), profile.ib.high, profile.ib.low, style.ibColor);
        if (style.levelLabels) {
            label(ctx, coords, scale, bounds, i18n.t(VAH), profile.vah, sessionX + sessionW, style.vaColor);
            label(ctx, coords, scale, bounds, i18n.t(VAL), profile.val, sessionX + sessionW, style.vaColor);
            if (style.showPoc) label(ctx, coords, scale, bounds, i18n.t(POC), profile.pocPrice + profile.tickSize / 2, sessionX + sessionW, style.pocColor);
        }
        if (poor.poorHigh) tag(ctx, coords, scale, bounds, i18n.t(POOR_HIGH), profile.rows[profile.rows.length - 1]!, profile.tickSize, sessionX);
        if (poor.poorLow) tag(ctx, coords, scale, bounds, i18n.t(POOR_LOW), profile.rows[0]!, profile.tickSize, sessionX);

        if (style.volumeProfile) paintVolumeProfile(ctx, profile, style.vpPosition === 'left' ? sessionX : sessionX + sessionW - vpW, vpW, coords, scale, bounds, style);
        if (style.markers) paintMarkers(ctx, profile, Math.max(10, sessionX), coords, scale, bounds, style);
    }
    ctx.restore();
}

/** Auto row size follows the price scale (~9 CSS px per row). An explicit select wins.
 *  A coarser tick merges rows; a finer one is rebuilt from the candles, which is the
 *  only way to add rows the engine's 10–20 target did not produce. */
function profilesForFrame(input: TpoPaintInput): TpoProfile[] {
    const profiles = input.profiles;
    if (profiles.length === 0) return [];
    const base = profiles[0]!.tickSize;
    const chosen = explicitRowSize(input.settings);
    const raw = priceSpan(input.coords, input.scale, input.bounds, TPO_TARGET_ROW_PX);
    const tick = chosen ?? (raw > 0 ? autoRowTick(raw) : base);
    if (!(tick > 0) || !(base > 0)) return [...profiles];
    if (tick > base * 1.01) return profiles.map((profile) => rebucketTpoProfile(profile, tick));
    if (tick < base * 0.99 && input.bars.length > 0) {
        const sample = profiles[0]!;
        const sessionMs = sample.sessionEnd - sample.sessionStart;
        // A partial session at the start of the data has no initial balance. Copy the
        // period count from whichever session did compute one, so rebuilding rows does
        // not clear the bracket on the sessions that still have their opening periods.
        const ibPeriods = profiles.reduce((n, profile) => Math.max(n, profile.ib?.periods ?? 0), 0);
        const rebuilt = computeTpoProfiles(input.bars, {
            tickSize: tick,
            periodMs: sample.periodMs,
            ...(sessionMs > 0 ? { sessionMs, sessionOffsetMs: mod(sample.sessionStart, sessionMs) } : {}),
            valueArea: sample.valueArea,
            initialBalancePeriods: ibPeriods,
        });
        if (rebuilt.length > 0) return rebuilt;
    }
    return [...profiles];
}

function paintPoc(
    ctx: CanvasRenderingContext2D,
    input: TpoPaintInput,
    profile: TpoProfile,
    sessionX: number,
    sessionW: number,
    periodCount: number,
    style: TpoStyle,
): void {
    const row = profile.rows.find((candidate) => candidate.price === profile.pocPrice);
    const box = rowBox(input.coords, input.scale, input.bounds, profile.pocPrice, profile.tickSize);
    if (row && box) {
        ctx.strokeStyle = style.pocColor;
        ctx.lineWidth = 1.25;
        ctx.setLineDash([]);
        for (const period of row.periods) {
            const slot = tpoPeriodSlot(period, periodCount, sessionW);
            ctx.strokeRect(sessionX + slot.x + 0.5, box.y + 0.5, Math.max(1, slot.width - 1), Math.max(1, box.h - 1));
        }
    }
    if (!style.extendPoc) return;
    const y = input.coords.priceToY(profile.pocPrice + profile.tickSize / 2, input.scale, input.bounds);
    const end = revisitX(input, profile.to, profile.pocPrice + profile.tickSize / 2);
    ctx.strokeStyle = style.pocColor;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(sessionX + sessionW, y);
    ctx.lineTo(Math.max(end, sessionX + sessionW), y);
    ctx.stroke();
}

/** Orange bracket on the session's left edge, spanning the initial balance. */
function paintIbBracket(
    ctx: CanvasRenderingContext2D,
    coords: CoordinateSystem,
    scale: PriceScale,
    bounds: PaneBounds,
    x: number,
    high: number,
    low: number,
    color: string,
): void {
    const yHi = coords.priceToY(high, scale, bounds);
    const yLo = coords.priceToY(low, scale, bounds);
    const top = Math.min(yHi, yLo);
    const bot = Math.max(yHi, yLo);
    const arm = 7;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x + arm, top);
    ctx.lineTo(x, top);
    ctx.lineTo(x, bot);
    ctx.lineTo(x + arm, bot);
    ctx.stroke();
}

function paintVolumeProfile(
    ctx: CanvasRenderingContext2D,
    profile: TpoProfile,
    x: number,
    width: number,
    coords: CoordinateSystem,
    scale: PriceScale,
    bounds: PaneBounds,
    style: TpoStyle,
): void {
    const bins = volumeBins(profile, style.vpRows);
    let max = 0;
    for (const bin of bins) max = Math.max(max, bin.weight);
    if (!(max > 0) || width < 4) return;
    const va = volumeValueArea(bins, style.vpValueAreaPct / 100);
    for (const bin of bins) {
        const box = rowBox(coords, scale, bounds, bin.price, bin.tick);
        if (!box) continue;
        const w = (bin.weight / max) * width;
        const inside = bin.price >= va.val && bin.price < va.vah;
        ctx.fillStyle = withAlpha(style.vpColor, inside ? style.vpVaOpacity / 100 : 0.35);
        const left = style.vpPosition === 'left' ? x : x + width - w;
        ctx.fillRect(left, box.y, w, box.h);
    }
    if (style.vpPoc) {
        const y = coords.priceToY(va.poc + va.tick / 2, scale, bounds);
        ctx.strokeStyle = style.pocColor;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + width, y);
        ctx.stroke();
    }
    if (style.vpLabels) {
        ctx.font = `10px ${FIGURES}`;
        ctx.fillStyle = style.vaColor;
        ctx.textAlign = 'left';
        ctx.fillText('VAH', x + width + 2, coords.priceToY(va.vah, scale, bounds));
        ctx.fillText('VAL', x + width + 2, coords.priceToY(va.val, scale, bounds));
    }
}

interface VolumeBin {
    price: number;
    tick: number;
    weight: number;
}

/** The volume profile's own row count (default 24), spread across the session's range. */
function volumeBins(profile: TpoProfile, buckets: number): VolumeBin[] {
    const rows = profile.rows;
    const low = rows[0]!.price;
    const high = rows[rows.length - 1]!.price + profile.tickSize;
    const n = Math.max(1, Math.round(buckets));
    const tick = (high - low) / n;
    if (!(tick > 0)) return rows.map((row) => ({ price: row.price, tick: profile.tickSize, weight: row.volume ?? row.periods.length }));
    const weights = new Array<number>(n).fill(0);
    for (const row of rows) {
        const weight = row.volume ?? row.periods.length;
        const index = Math.min(n - 1, Math.max(0, Math.floor((row.price - low) / tick)));
        weights[index] = (weights[index] ?? 0) + weight;
    }
    return weights.map((weight, index) => ({ price: low + index * tick, tick, weight }));
}

function volumeValueArea(bins: readonly VolumeBin[], fraction: number): { poc: number; vah: number; val: number; tick: number } {
    let total = 0;
    let max = 0;
    let poc = 0;
    for (let i = 0; i < bins.length; i += 1) {
        total += bins[i]!.weight;
        if (bins[i]!.weight > max) {
            max = bins[i]!.weight;
            poc = i;
        }
    }
    const target = total * Math.min(1, Math.max(0, fraction));
    let from = poc;
    let to = poc;
    let acc = bins[poc]!.weight;
    while (acc < target - 1e-9 && (from > 0 || to < bins.length - 1)) {
        const below = from > 0 ? bins[from - 1]!.weight : -1;
        const above = to < bins.length - 1 ? bins[to + 1]!.weight : -1;
        if (above > below) {
            to += 1;
            acc += above;
        } else {
            from -= 1;
            acc += below;
        }
    }
    const tick = bins[poc]!.tick;
    return { poc: bins[poc]!.price, val: bins[from]!.price, vah: bins[to]!.price + tick, tick };
}

function paintMarkers(ctx: CanvasRenderingContext2D, profile: TpoProfile, x: number, coords: CoordinateSystem, scale: PriceScale, bounds: PaneBounds, style: TpoStyle): void {
    if (style.openClose) {
        if (profile.open != null) dot(ctx, x - 8, coords.priceToY(profile.open, scale, bounds), BULLISH);
        if (profile.close != null) dot(ctx, x - 8, coords.priceToY(profile.close, scale, bounds), BEARISH);
    }
    if (style.midpoint && profile.rows.length > 0) {
        const low = profile.rows[0]!.price;
        const high = profile.rows[profile.rows.length - 1]!.price + profile.tickSize;
        const y = coords.priceToY((low + high) / 2, scale, bounds);
        ctx.strokeStyle = '#e6e6e6';
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(x - 12, y);
        ctx.lineTo(x + 6, y);
        ctx.stroke();
        ctx.setLineDash([]);
    }
    void bounds;
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
}

function revisitX(input: TpoPaintInput, after: number, price: number): number {
    const at = priceRevisitedAt(input.bars, after, price);
    return at == null ? input.coords.width : input.coords.timeToX(at);
}

function label(ctx: CanvasRenderingContext2D, coords: CoordinateSystem, scale: PriceScale, bounds: PaneBounds, text: string, price: number, x: number, color: string): void {
    const y = coords.priceToY(price, scale, bounds);
    if (y < bounds.top || y > bounds.top + bounds.height) return;
    ctx.font = `10px ${FIGURES}`;
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.fillText(text, Math.min(x + 4, coords.width - 28), y);
}

function tag(ctx: CanvasRenderingContext2D, coords: CoordinateSystem, scale: PriceScale, bounds: PaneBounds, text: string, row: TpoRow, tick: number, x: number): void {
    const y = coords.priceToY(row.price + tick / 2, scale, bounds);
    ctx.font = `10px ${FIGURES}`;
    ctx.fillStyle = HIGHLIGHT;
    ctx.textAlign = 'right';
    ctx.fillText(text, Math.max(4, x - 4), y);
}

function rowBox(coords: CoordinateSystem, scale: PriceScale, bounds: PaneBounds, price: number, tick: number): { y: number; h: number } | null {
    const y1 = coords.priceToY(price + tick, scale, bounds);
    const y2 = coords.priceToY(price, scale, bounds);
    const y = Math.min(y1, y2);
    const h = Math.max(1, Math.abs(y2 - y1) - 1);
    if (y > bounds.top + bounds.height || y + h < bounds.top) return null;
    return { y, h };
}

/** Early periods are a darker grey-blue; later periods a brighter blue. Inside the
 *  value area the tint is lighter. Later letters are darker. */
function blockPaint(index: number, max: number, inVa: boolean, style: TpoStyle): { fill: string; text: string } {
    const t = max <= 0 ? 0 : Math.max(0, Math.min(1, index / max));
    const text = `hsl(0, 0%, ${Math.round(90 - t * 52)}%)`;
    if (!style.colorByTime) {
        return { fill: withAlpha(style.blockColor, inVa ? 0.58 : style.outsideOpacity / 100), text };
    }
    const hue = Math.round(216 - t * 10);
    const sat = inVa ? Math.round(24 + t * 14) : Math.round(52 + t * 22);
    const light = inVa ? Math.round(48 + t * 8) : Math.round(42 + t * 18);
    const alpha = inVa ? 0.58 : style.outsideOpacity / 100;
    return { fill: `hsla(${hue}, ${sat}%, ${light}%, ${alpha})`, text };
}

function explicitRowSize(settings: Record<string, unknown>): number | undefined {
    const row = settings.rowSize;
    if (row === 'auto') return undefined;
    if (typeof row === 'string' && row !== '') {
        const n = Number(row);
        if (n > 0 && Number.isFinite(n)) return n;
    }
    if (typeof row === 'number' && row > 0) return row;
    if (row == null && typeof settings.tickSize === 'number' && settings.tickSize > 0) return settings.tickSize;
    return undefined;
}

function priceSpan(coords: CoordinateSystem, scale: PriceScale, bounds: PaneBounds, px: number): number {
    if (bounds.height <= 0) return 0;
    const y = bounds.top + bounds.height * 0.5;
    return Math.abs(coords.yToPrice(y, scale, bounds) - coords.yToPrice(y + px, scale, bounds));
}

function mod(value: number, period: number): number {
    return ((value % period) + period) % period;
}

interface TpoStyle {
    showBlocks: boolean;
    showLetters: boolean;
    colorByTime: boolean;
    blockColor: string;
    outsideOpacity: number;
    showValueArea: boolean;
    vaFill: boolean;
    valueAreaPct: number;
    vaColor: string;
    showPoc: boolean;
    extendPoc: boolean;
    pocColor: string;
    levelLabels: boolean;
    showInitialBalance: boolean;
    ibColor: string;
    singlePrints: boolean;
    poorExtremes: boolean;
    volumeProfile: boolean;
    vpRows: number;
    vpPosition: 'left' | 'right';
    vpWidthPct: number;
    vpValueAreaPct: number;
    vpVaOpacity: number;
    vpPoc: boolean;
    vpLabels: boolean;
    vpColor: string;
    markers: boolean;
    openClose: boolean;
    midpoint: boolean;
}

function readStyle(bag: Record<string, unknown>): TpoStyle {
    return {
        showBlocks: flag(bag, 'showBlocks', true),
        showLetters: flag(bag, 'showLetters', true),
        colorByTime: flag(bag, 'colorByTime', true),
        blockColor: colorOf(bag, 'blockColor', ACCENT),
        outsideOpacity: numberOf(bag, 'outsideOpacity', 45),
        showValueArea: flag(bag, 'showValueArea', true),
        vaFill: flag(bag, 'vaFill', false),
        valueAreaPct: numberOf(bag, 'valueAreaPct', 70),
        vaColor: colorOf(bag, 'vaColor', INFO),
        showPoc: flag(bag, 'showPoc', true),
        extendPoc: flag(bag, 'extendPoc', false),
        pocColor: colorOf(bag, 'pocColor', '#f2f2f2'),
        levelLabels: flag(bag, 'levelLabels', false),
        showInitialBalance: flag(bag, 'showInitialBalance', true),
        ibColor: colorOf(bag, 'ibColor', WARNING),
        singlePrints: flag(bag, 'singlePrints', false),
        poorExtremes: flag(bag, 'poorExtremes', false),
        volumeProfile: flag(bag, 'volumeProfile', false),
        vpRows: Math.max(1, Math.round(numberOf(bag, 'vpRows', 24))),
        vpPosition: bag.vpPosition === 'left' ? 'left' : 'right',
        vpWidthPct: numberOf(bag, 'vpWidthPct', 30),
        vpValueAreaPct: numberOf(bag, 'vpValueAreaPct', 70),
        vpVaOpacity: numberOf(bag, 'vpVaOpacity', 62),
        vpPoc: flag(bag, 'vpPoc', true),
        vpLabels: flag(bag, 'vpLabels', true),
        vpColor: colorOf(bag, 'vpColor', ACCENT),
        markers: flag(bag, 'markers', true),
        openClose: flag(bag, 'openClose', true),
        midpoint: flag(bag, 'midpoint', false),
    };
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
