// Session market profile: blue blocks (lighter outside the value area), letters,
// a white point-of-control line, VAH/VAL, the initial balance, single prints,
// poor high/low, a volume profile on the right, and open/close markers.
import { msg } from '../../../core/i18n/message';
import type { Translator } from '../../../core/i18n/types';
import type { OHLCV } from '../../../core/model/ohlcv';
import { withAlpha } from '../../../core/color';
import { ACCENT, HIGHLIGHT, INFO, WARNING } from '../../../core/palette';
import { priceRevisitedAt, tpoDrawsLetters, tpoLetter, tpoPoorExtremes, tpoSinglePrintRows, type TpoProfile, type TpoRow } from '../../../core/orderflow';
import type { CoordinateSystem, PaneBounds, PriceScale } from '../core/CoordinateSystem';

const POC = msg('chart.tpo.pocLabel', 'POC');
const VAH = msg('chart.tpo.vah', 'VAH');
const VAL = msg('chart.tpo.val', 'VAL');
const POOR_HIGH = msg('chart.tpo.poorHigh', 'Poor high');
const POOR_LOW = msg('chart.tpo.poorLow', 'Poor low');
const LETTER = '#e6e6e6';
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
    const { profiles, coords, scale, bounds, i18n } = input;
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
        const x0 = coords.timeToX(profile.from);
        const x1 = Math.max(coords.timeToX(profile.to), x0 + 8);
        if (x1 < 0 || x0 > coords.width) continue;
        const span = x1 - x0;
        const vpW = style.volumeProfile ? Math.max(12, span * (style.vpWidthPct / 100)) : 0;
        const letterSpan = Math.max(8, span - vpW);
        const maxCount = profile.rows.reduce((m, row) => Math.max(m, row.periods.length), 1);
        const maxPeriod = profile.rows.reduce((m, row) => Math.max(m, ...row.periods), 0);
        const cellW = Math.min(18, letterSpan / maxCount);
        const single = new Set(style.singlePrints ? tpoSinglePrintRows(profile).map((row) => row.price) : []);
        const poor = style.poorExtremes ? tpoPoorExtremes(profile) : { poorHigh: false, poorLow: false };

        if (style.vaFill && style.showValueArea) {
            const yTop = coords.priceToY(profile.vah, scale, bounds);
            const yBot = coords.priceToY(profile.val, scale, bounds);
            ctx.fillStyle = withAlpha(style.vaColor, 0.14);
            ctx.fillRect(x0, Math.min(yTop, yBot), Math.max(1, letterSpan), Math.abs(yBot - yTop));
        }

        if (style.showInitialBalance && profile.ib) {
            const ibEnd = profile.sessionStart + profile.ib.periods * profile.periodMs;
            const left = x0;
            const right = Math.min(x0 + letterSpan, Math.max(left + 2, coords.timeToX(ibEnd)));
            const yHi = coords.priceToY(profile.ib.high, scale, bounds);
            const yLo = coords.priceToY(profile.ib.low, scale, bounds);
            ctx.strokeStyle = style.ibColor;
            ctx.setLineDash([]);
            ctx.strokeRect(left + 0.5, Math.min(yHi, yLo) + 0.5, Math.max(1, right - left - 1), Math.max(1, Math.abs(yLo - yHi) - 1));
        }

        if (style.showBlocks || style.showLetters) {
            for (const row of profile.rows) {
                const box = rowBox(coords, scale, bounds, row.price, profile.tickSize);
                if (!box) continue;
                const inVa = row.price >= profile.val - 1e-9 && row.price + profile.tickSize <= profile.vah + 1e-9;
                const alpha = inVa ? 0.92 : style.outsideOpacity / 100;
                for (let k = 0; k < row.periods.length; k += 1) {
                    const cx = x0 + k * cellW;
                    const color = style.colorByTime ? periodColor(row.periods[k]!, maxPeriod) : style.blockColor;
                    if (style.showBlocks) {
                        ctx.fillStyle = withAlpha(color, alpha);
                        ctx.fillRect(cx, box.y, Math.max(1, cellW - 1), box.h);
                    }
                    if (style.showLetters && tpoDrawsLetters(cellW - 1, box.h - 1)) {
                        ctx.fillStyle = LETTER;
                        ctx.font = `${Math.max(8, Math.min(14, Math.floor(Math.min(cellW, box.h) * 0.72)))}px ${FIGURES}`;
                        ctx.textAlign = 'center';
                        ctx.fillText(tpoLetter(row.periods[k]!), cx + cellW / 2, box.y + box.h / 2);
                    }
                }
                if (single.has(row.price)) {
                    ctx.strokeStyle = LETTER;
                    ctx.lineWidth = 1;
                    ctx.strokeRect(x0 + 0.5, box.y + 0.5, Math.max(1, row.periods.length * cellW - 1), Math.max(1, box.h - 1));
                }
            }
        }

        if (style.showPoc) {
            const y = coords.priceToY(profile.pocPrice + profile.tickSize / 2, scale, bounds);
            const end = style.extendPoc ? revisitX(input, profile.to, profile.pocPrice + profile.tickSize / 2) : x0 + letterSpan;
            ctx.strokeStyle = style.pocColor;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(x0, y);
            ctx.lineTo(Math.max(end, x0 + letterSpan), y);
            ctx.stroke();
        }
        if (style.levelLabels) {
            label(ctx, coords, scale, bounds, i18n.t(VAH), profile.vah, x0 + letterSpan, style.vaColor);
            label(ctx, coords, scale, bounds, i18n.t(VAL), profile.val, x0 + letterSpan, style.vaColor);
            if (style.showPoc) label(ctx, coords, scale, bounds, i18n.t(POC), profile.pocPrice + profile.tickSize / 2, x0 + letterSpan, style.pocColor);
        }
        if (poor.poorHigh) tag(ctx, coords, scale, bounds, i18n.t(POOR_HIGH), profile.rows[profile.rows.length - 1]!, profile.tickSize, x0);
        if (poor.poorLow) tag(ctx, coords, scale, bounds, i18n.t(POOR_LOW), profile.rows[0]!, profile.tickSize, x0);

        if (style.volumeProfile) paintVolumeProfile(ctx, profile, x1 - vpW, vpW, coords, scale, bounds, style);
        if (style.markers) paintMarkers(ctx, profile, x0, coords, scale, bounds, style);
    }
    ctx.restore();
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
    let max = 0;
    for (const row of profile.rows) max = Math.max(max, row.volume ?? row.periods.length);
    if (!(max > 0) || width < 4) return;
    const va = footprintLikeVa(profile, style.vpValueAreaPct / 100);
    for (const row of profile.rows) {
        const box = rowBox(coords, scale, bounds, row.price, profile.tickSize);
        if (!box) continue;
        const weight = row.volume ?? row.periods.length;
        const w = (weight / max) * width;
        const inside = row.price >= va.val && row.price < va.vah;
        ctx.fillStyle = withAlpha(style.vpColor, inside ? style.vpVaOpacity / 100 : 0.35);
        const left = style.vpPosition === 'left' ? x : x + width - w;
        ctx.fillRect(left, box.y, w, box.h);
    }
    if (style.vpPoc) {
        const y = coords.priceToY(va.poc + profile.tickSize / 2, scale, bounds);
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

/** Volume-weighted value area over the profile rows. Falls back to the letter value area. */
function footprintLikeVa(profile: TpoProfile, fraction: number): { poc: number; vah: number; val: number } {
    const rows = profile.rows;
    const weight = (row: TpoRow) => row.volume ?? row.periods.length;
    let total = 0;
    let max = 0;
    let poc = 0;
    for (let i = 0; i < rows.length; i += 1) {
        const w = weight(rows[i]!);
        total += w;
        if (w > max) {
            max = w;
            poc = i;
        }
    }
    const target = total * Math.min(1, Math.max(0, fraction));
    let from = poc;
    let to = poc;
    let acc = weight(rows[poc]!);
    while (acc < target - 1e-9 && (from > 0 || to < rows.length - 1)) {
        const below = from > 0 ? weight(rows[from - 1]!) : -1;
        const above = to < rows.length - 1 ? weight(rows[to + 1]!) : -1;
        if (above > below) {
            to += 1;
            acc += above;
        } else {
            from -= 1;
            acc += below;
        }
    }
    return { poc: rows[poc]!.price, val: rows[from]!.price, vah: rows[to]!.price + profile.tickSize };
}

function paintMarkers(ctx: CanvasRenderingContext2D, profile: TpoProfile, x: number, coords: CoordinateSystem, scale: PriceScale, bounds: PaneBounds, style: TpoStyle): void {
    if (style.openClose) {
        if (profile.open != null) dot(ctx, x - 6, coords.priceToY(profile.open, scale, bounds), HIGHLIGHT);
        if (profile.close != null) dot(ctx, x - 6, coords.priceToY(profile.close, scale, bounds), WARNING);
    }
    if (style.midpoint && profile.rows.length > 0) {
        const low = profile.rows[0]!.price;
        const high = profile.rows[profile.rows.length - 1]!.price + profile.tickSize;
        const y = coords.priceToY((low + high) / 2, scale, bounds);
        ctx.strokeStyle = LETTER;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(x - 10, y);
        ctx.lineTo(x + 8, y);
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

function periodColor(index: number, max: number): string {
    const t = max <= 0 ? 0 : index / max;
    const hue = Math.round(215 - t * 50);
    return `hsl(${hue}, 72%, 58%)`;
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
        colorByTime: flag(bag, 'colorByTime', false),
        blockColor: colorOf(bag, 'blockColor', ACCENT),
        outsideOpacity: numberOf(bag, 'outsideOpacity', 35),
        showValueArea: flag(bag, 'showValueArea', true),
        vaFill: flag(bag, 'vaFill', true),
        valueAreaPct: numberOf(bag, 'valueAreaPct', 70),
        vaColor: colorOf(bag, 'vaColor', INFO),
        showPoc: flag(bag, 'showPoc', true),
        extendPoc: flag(bag, 'extendPoc', false),
        pocColor: colorOf(bag, 'pocColor', '#f2f2f2'),
        levelLabels: flag(bag, 'levelLabels', true),
        showInitialBalance: flag(bag, 'showInitialBalance', true),
        ibColor: colorOf(bag, 'ibColor', ACCENT),
        singlePrints: flag(bag, 'singlePrints', true),
        poorExtremes: flag(bag, 'poorExtremes', true),
        volumeProfile: flag(bag, 'volumeProfile', true),
        vpPosition: bag.vpPosition === 'left' ? 'left' : 'right',
        vpWidthPct: numberOf(bag, 'vpWidthPct', 30),
        vpValueAreaPct: numberOf(bag, 'vpValueAreaPct', 70),
        vpVaOpacity: numberOf(bag, 'vpVaOpacity', 70),
        vpPoc: flag(bag, 'vpPoc', true),
        vpLabels: flag(bag, 'vpLabels', true),
        vpColor: colorOf(bag, 'vpColor', ACCENT),
        markers: flag(bag, 'markers', true),
        openClose: flag(bag, 'openClose', true),
        midpoint: flag(bag, 'midpoint', true),
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
