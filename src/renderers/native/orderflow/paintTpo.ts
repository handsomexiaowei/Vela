// One market profile per session: letters (or blocks, once a cell is too small)
// packed left to right on each price row, with the value area, the point of
// control and the initial balance drawn across the session's traded time.
import { msg } from '../../../core/i18n/message';
import type { Translator } from '../../../core/i18n/types';
import { withAlpha } from '../../../core/color';
import { ACCENT, HIGHLIGHT, INFO } from '../../../core/palette';
import { tpoDrawsLetters, tpoLetter, type TpoProfile } from '../../../core/orderflow';
import type { CoordinateSystem, PaneBounds, PriceScale } from '../core/CoordinateSystem';

const POC = msg('chart.tpo.poc', 'POC');
const VAH = msg('chart.tpo.vah', 'VAH');
const VAL = msg('chart.tpo.val', 'VAL');
const LETTER = '#e6e6e6';
const FIGURES = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export interface TpoPaintInput {
    profiles: readonly TpoProfile[];
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
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;

    for (const profile of profiles) {
        if (!(profile.tickSize > 0) || profile.rows.length === 0) continue;
        const x0 = coords.timeToX(profile.from);
        const x1 = Math.max(coords.timeToX(profile.to), x0 + 4);
        if (x1 < 0 || x0 > coords.width) continue;

        if (style.showValueArea) {
            const yVaTop = coords.priceToY(profile.vah, scale, bounds);
            const yVaBot = coords.priceToY(profile.val, scale, bounds);
            ctx.fillStyle = withAlpha(style.vaColor, 0.16);
            ctx.fillRect(x0, Math.min(yVaTop, yVaBot), Math.max(1, x1 - x0), Math.abs(yVaBot - yVaTop));
        }

        if (style.showInitialBalance && profile.ib) {
            const ibEnd = profile.sessionStart + profile.ib.periods * profile.periodMs;
            const left = Math.max(x0, coords.timeToX(profile.sessionStart));
            const right = Math.min(x1, Math.max(left + 2, coords.timeToX(ibEnd)));
            const yHi = coords.priceToY(profile.ib.high, scale, bounds);
            const yLo = coords.priceToY(profile.ib.low, scale, bounds);
            ctx.strokeStyle = style.ibColor;
            ctx.setLineDash([]);
            ctx.strokeRect(left + 0.5, Math.min(yHi, yLo) + 0.5, Math.max(1, right - left - 1), Math.max(1, Math.abs(yLo - yHi) - 1));
        }

        const maxCount = profile.rows.reduce((m, row) => Math.max(m, row.periods.length), 1);
        const span = Math.max(1, x1 - x0);
        const cellW = Math.min(16, span / maxCount);

        let labelY = -Infinity;
        const level = (price: number, text: string, color: string): void => {
            if (!style.showPoc && text === i18n.t(POC)) return;
            const y = coords.priceToY(price, scale, bounds);
            ctx.strokeStyle = color;
            ctx.setLineDash(text === i18n.t(POC) ? [] : [4, 3]);
            ctx.beginPath();
            ctx.moveTo(x0, y);
            ctx.lineTo(x1, y);
            ctx.stroke();
            if (Math.abs(y - labelY) < 11) return;
            labelY = y;
            ctx.setLineDash([]);
            ctx.font = `10px ${FIGURES}`;
            ctx.fillStyle = color;
            ctx.textAlign = 'left';
            const lx = x1 + 28 < coords.width ? x1 + 4 : Math.max(x0, x1 - 28);
            ctx.fillText(text, lx, y);
            ctx.textAlign = 'center';
        };
        if (style.showValueArea) {
            level(profile.vah, i18n.t(VAH), style.vaColor);
            level(profile.val, i18n.t(VAL), style.vaColor);
        }
        if (style.showPoc) level(profile.pocPrice + profile.tickSize / 2, i18n.t(POC), style.pocColor);

        for (const row of profile.rows) {
            const y1 = coords.priceToY(row.price + profile.tickSize, scale, bounds);
            const y2 = coords.priceToY(row.price, scale, bounds);
            const y = Math.min(y1, y2);
            const h = Math.abs(y2 - y1);
            if (h < 0.4 || y > bounds.top + bounds.height || y + h < bounds.top) continue;
            const inVa = row.price >= profile.val - profile.tickSize * 1e-6 && row.price + profile.tickSize <= profile.vah + profile.tickSize * 1e-6;
            const letters = style.showLetters && tpoDrawsLetters(cellW - 1, h - 1);
            const fontPx = Math.max(8, Math.min(15, Math.floor(Math.min(cellW, h) * 0.72)));
            if (letters) ctx.font = `${fontPx}px ${FIGURES}`;
            ctx.fillStyle = withAlpha(style.letterColor, inVa ? 0.95 : 0.55);
            const isPoc = Math.abs(row.price - profile.pocPrice) <= profile.tickSize * 1e-6;
            for (let k = 0; k < row.periods.length; k += 1) {
                const cx = x0 + (k + 0.5) * cellW;
                const cy = y + h / 2;
                if (letters) {
                    ctx.fillText(tpoLetter(row.periods[k]!), cx, cy);
                } else {
                    const bw = Math.max(1, cellW - 1);
                    const bh = Math.max(1, h - 1);
                    ctx.fillRect(cx - bw / 2, y + 0.5, bw, bh);
                }
            }
            if (style.showPoc && isPoc) {
                ctx.strokeStyle = style.pocColor;
                ctx.setLineDash([]);
                ctx.strokeRect(x0 + 0.5, y + 0.5, Math.max(1, row.periods.length * cellW - 1), Math.max(1, h - 1));
            }
        }
    }
    ctx.restore();
}

interface TpoStyle {
    showLetters: boolean;
    showPoc: boolean;
    showValueArea: boolean;
    showInitialBalance: boolean;
    letterColor: string;
    vaColor: string;
    pocColor: string;
    ibColor: string;
}

function readStyle(bag: Record<string, unknown>): TpoStyle {
    return {
        showLetters: flag(bag, 'showLetters', true),
        showPoc: flag(bag, 'showPoc', true),
        showValueArea: flag(bag, 'showValueArea', true),
        showInitialBalance: flag(bag, 'showInitialBalance', true),
        letterColor: colorOf(bag, 'letterColor', LETTER),
        vaColor: colorOf(bag, 'vaColor', INFO),
        pocColor: colorOf(bag, 'pocColor', HIGHLIGHT),
        ibColor: colorOf(bag, 'ibColor', ACCENT),
    };
}

function flag(bag: Record<string, unknown>, key: string, fallback: boolean): boolean {
    const v = bag[key];
    return typeof v === 'boolean' ? v : fallback;
}

function colorOf(bag: Record<string, unknown>, key: string, fallback: string): string {
    const v = bag[key];
    return typeof v === 'string' && v !== '' ? v : fallback;
}
