// Footprint columns in the hosted chart's arrangement: a wide box per bar. In
// Bid x Ask Profile the red bid bar grows left from the row's center and the green
// ask bar grows right, with each number hugging that center. Volume and Delta keep
// a single bar from the left edge. Narrow columns stay candles.
import type { OHLCV } from '../../../core/model/ohlcv';
import type { Translator } from '../../../core/i18n/types';
import { msg } from '../../../core/i18n/message';
import { withAlpha } from '../../../core/color';
import { BEARISH, BULLISH, HIGHLIGHT, SLATE_DEEP } from '../../../core/palette';
import {
    bidAskRowGeometry,
    footprintColumnVisible,
    footprintDrawsText,
    footprintRowPasses,
    footprintSide,
    footprintStacks,
    footprintStats,
    footprintValueArea,
    formatFootprintQty,
    priceRevisitedAt,
    unfinishedAuctions,
    type FootprintBar,
    type FootprintLevel,
    type FootprintSeries,
} from '../../../core/orderflow';
import type { CoordinateSystem, PaneBounds, PriceScale } from '../core/CoordinateSystem';

const TEXT = '#f4f4f4';
const POC_INK = '#f2f2f2';
const FIGURES = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const TIP_BID_ASK = msg('chart.footprint.tip.bidAsk', 'Bid x Ask');
const TIP_VOLUME = msg('chart.footprint.tip.volume', 'Volume');
const TIP_DELTA = msg('chart.footprint.tip.delta', 'Delta');
const TIP_SHIFT = msg('chart.footprint.tip.shift', 'Shift to magnify');

export interface FootprintPaintInput {
    series: FootprintSeries;
    times: readonly number[];
    bars: readonly OHLCV[];
    settings: Record<string, unknown>;
    coords: CoordinateSystem;
    scale: PriceScale;
    bounds: PaneBounds;
    i18n: Translator;
    cursor: { x: number; y: number } | null;
}

interface CellHit {
    bar: FootprintBar;
    level: FootprintLevel;
    tick: number;
    x: number;
    y: number;
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
    const colW = Math.max(4, pitch * 0.92);
    const ratio = style.imbalanceRatioPct / 100;
    let hit: CellHit | null = null;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, bounds.top, coords.width, bounds.height);
    ctx.clip();
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'miter';

    for (let i = i0; i <= i1; i += 1) {
        const bar = byTime.get(times[i]!);
        if (!bar || bar.levels.length === 0) continue;
        const wide = footprintColumnVisible(colW);
        if (!wide && !style.hideCandles) continue;
        const cx = coords.logicalToX(i);
        const x = placeColumn(cx, pitch, colW, style.position);
        const levels = bar.levels.filter((level) => footprintRowPasses(level, style.filters));
        if (levels.length === 0) continue;
        const va = style.valueArea ? footprintValueArea(levels, series.tickSize, style.valueAreaPct / 100) : null;
        const pocPrice = va?.pocPrice ?? null;
        let maxSide = 0;
        let maxTotal = 0;
        let maxAbsDelta = 0;
        for (const level of levels) {
            maxSide = Math.max(maxSide, level.bid, level.ask);
            maxTotal = Math.max(maxTotal, level.bid + level.ask);
            maxAbsDelta = Math.max(maxAbsDelta, Math.abs(level.ask - level.bid));
        }
        const showText = style.showNumbers && (style.shrinkNumbers || footprintDrawsText(colW, 12));
        let top = Infinity;
        let bottom = -Infinity;

        for (const level of levels) {
            const box = rowBox(coords, scale, bounds, level.price, series.tickSize);
            if (!box) continue;
            const { y, h } = box;
            ctx.fillStyle = style.areaBackground;
            ctx.fillRect(x, y, colW, h);
            paintSides(ctx, x, y, colW, h, level, style.mode === 'volume' ? maxTotal : style.mode === 'delta' ? maxAbsDelta : maxSide, style);
            if (style.imbalance && footprintSide(level, ratio) !== 'neutral') {
                ctx.strokeStyle = footprintSide(level, ratio) === 'ask' ? style.askColor : style.bidColor;
                ctx.lineWidth = style.imbalanceWidth;
                ctx.strokeRect(x + 0.5, y + 0.5, colW - 1, Math.max(1, h - 1));
            }
            if (style.showPoc && pocPrice != null && level.price === pocPrice) {
                ctx.strokeStyle = style.pocColor;
                ctx.lineWidth = style.pocWidth;
                ctx.strokeRect(x + 0.5, y + 0.5, colW - 1, Math.max(1, h - 1));
            }
            if (showText && h >= 10) paintCellText(ctx, x, y, colW, h, level, style, ratio);
            if (y < top) top = y;
            if (y + h > bottom) bottom = y + h;
            if (input.cursor && contains(input.cursor, x, y, colW, h)) hit = { bar, level, tick: series.tickSize, x, y };
        }
        if (!Number.isFinite(top)) continue;

        if (style.valueArea && va) {
            rule(ctx, coords, scale, bounds, va.vah, x, colW, style.vaColor, style.vaWidth);
            rule(ctx, coords, scale, bounds, va.val, x, colW, style.vaColor, style.vaWidth);
        }
        if (style.showPoc && style.extendPoc && pocPrice != null) {
            extendRule(ctx, input, times[i]!, pocPrice, x + colW, style.pocColor, style.pocWidth);
        }
        if (style.unfinished) {
            for (const auction of unfinishedAuctions(levels, style.unfinishedMin)) {
                const y = coords.priceToY(auction.price + series.tickSize / 2, scale, bounds);
                const end = style.unfinishedExtend ? revisitX(input, times[i]!, auction.price) : x + colW + 18;
                ctx.strokeStyle = HIGHLIGHT;
                ctx.lineWidth = style.unfinishedWidth;
                ctx.setLineDash([3, 2]);
                ctx.beginPath();
                ctx.moveTo(x + colW, y);
                ctx.lineTo(end, y);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }
        if (style.stacked) {
            for (const stack of footprintStacks(levels, ratio, style.stackedMin)) {
                const y1 = coords.priceToY(stack.toPrice + series.tickSize, scale, bounds);
                const y2 = coords.priceToY(stack.fromPrice, scale, bounds);
                ctx.fillStyle = stack.side === 'ask' ? style.askColor : style.bidColor;
                const bx = stack.side === 'ask' ? x + colW - 3 : x;
                ctx.fillRect(bx, Math.min(y1, y2), 3, Math.abs(y2 - y1));
            }
        }
        if (style.statTable && wide) paintStats(ctx, bar, x, colW, top, bottom, bounds, style, i18n);
    }

    if (hit && input.cursor) paintTooltip(ctx, hit, input.cursor, bounds, coords, i18n);
    ctx.restore();
}

function paintSides(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    colW: number,
    h: number,
    level: FootprintLevel,
    maxSide: number,
    style: FootprintStyle,
): void {
    const gap = h > 3 ? 1 : 0;
    const yy = y + gap / 2;
    const hh = Math.max(1, h - gap);
    if (style.mode === 'delta') {
        const delta = level.ask - level.bid;
        const w = maxSide > 0 ? (Math.abs(delta) / maxSide) * colW : 0;
        ctx.fillStyle = withAlpha(delta >= 0 ? style.askColor : style.bidColor, style.gradientCells ? 0.85 : 0.7);
        ctx.fillRect(x, yy, w, hh);
        return;
    }
    if (style.mode === 'volume') {
        const total = level.bid + level.ask;
        const w = maxSide > 0 ? (total / maxSide) * colW : 0;
        const up = level.ask >= level.bid;
        ctx.fillStyle = withAlpha(up ? style.askColor : style.bidColor, 0.75);
        ctx.fillRect(x, yy, w, hh);
        return;
    }
    const row = bidAskRowGeometry(x, colW, level.bid, level.ask, maxSide);
    if (row.bidW > 0) {
        ctx.fillStyle = withAlpha(style.bidColor, style.gradientCells ? 0.35 + 0.55 * (level.bid / maxSide) : 0.8);
        ctx.fillRect(row.bidX, yy, row.bidW, hh);
    }
    if (row.askW > 0) {
        ctx.fillStyle = withAlpha(style.askColor, style.gradientCells ? 0.35 + 0.55 * (level.ask / maxSide) : 0.8);
        ctx.fillRect(row.askX, yy, row.askW, hh);
    }
}

function paintCellText(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    colW: number,
    h: number,
    level: FootprintLevel,
    style: FootprintStyle,
    ratio: number,
): void {
    const values = cellValuesOf(level, style);
    let size = style.autoTextSize ? Math.max(9, Math.min(13, Math.floor(h * 0.72))) : style.textSize;
    const side = footprintSide(level, ratio);
    const ink = style.recolorValues && side !== 'neutral' ? (side === 'ask' ? style.askColor : style.bidColor) : style.textColor;
    ctx.fillStyle = ink;
    if (values.kind === 'pair') {
        const room = colW / 2 - 6;
        for (;;) {
            ctx.font = `${size}px ${FIGURES}`;
            const wide = Math.max(ctx.measureText(values.bid).width, ctx.measureText(values.ask).width);
            if (!style.shrinkNumbers || wide <= room || size <= 8) break;
            size -= 1;
        }
        if (Math.max(ctx.measureText(values.bid).width, ctx.measureText(values.ask).width) > colW / 2 - 2) return;
        const geo = bidAskRowGeometry(x, colW, 0, 0, 1);
        const cy = y + h / 2;
        ctx.textAlign = 'right';
        ctx.fillText(values.bid, geo.bidLabelX, cy);
        ctx.textAlign = 'left';
        ctx.fillText(values.ask, geo.askLabelX, cy);
        return;
    }
    for (;;) {
        ctx.font = `${size}px ${FIGURES}`;
        if (!style.shrinkNumbers || ctx.measureText(values.text).width <= colW - 4 || size <= 8) break;
        size -= 1;
    }
    if (ctx.measureText(values.text).width > colW - 2) return;
    ctx.textAlign = 'center';
    ctx.fillText(values.text, x + colW / 2, y + h / 2);
}

function cellValuesOf(level: FootprintLevel, style: FootprintStyle): { kind: 'pair'; bid: string; ask: string } | { kind: 'single'; text: string } {
    const values = style.cellValues === 'auto' ? (style.mode === 'bidAsk' ? 'bidAsk' : style.mode) : style.cellValues;
    if (values === 'volume') return { kind: 'single', text: formatFootprintQty(level.bid + level.ask) };
    if (values === 'delta') return { kind: 'single', text: signedQty(level.ask - level.bid) };
    if (style.averageTradeSize) {
        const bid = level.bidCount ? level.bid / level.bidCount : level.bid;
        const ask = level.askCount ? level.ask / level.askCount : level.ask;
        return { kind: 'pair', bid: formatFootprintQty(bid), ask: formatFootprintQty(ask) };
    }
    return { kind: 'pair', bid: formatFootprintQty(level.bid), ask: formatFootprintQty(level.ask) };
}

function paintStats(
    ctx: CanvasRenderingContext2D,
    bar: FootprintBar,
    x: number,
    colW: number,
    top: number,
    bottom: number,
    bounds: PaneBounds,
    style: FootprintStyle,
    i18n: Translator,
): void {
    const stats = footprintStats(bar);
    const lines: string[] = [];
    if (style.statTotal) lines.push(formatFootprintQty(stats.volume));
    if (style.statBuy) lines.push(formatFootprintQty(stats.ask));
    if (style.statSell) lines.push(formatFootprintQty(stats.bid));
    if (style.statBuyPct) lines.push(`${Math.round(stats.buyPct)}%`);
    if (style.statSellPct) lines.push(`${Math.round(stats.sellPct)}%`);
    if (style.statDelta) lines.push(signedQty(stats.delta));
    if (style.statDeltaPct) lines.push(`${stats.deltaPct >= 0 ? '+' : ''}${Math.round(stats.deltaPct)}%`);
    if (style.statTrades) lines.push(String(stats.tradeCount));
    if (style.statBidCount) lines.push(String(stats.bidCount));
    if (style.statAskCount) lines.push(String(stats.askCount));
    if (lines.length === 0) return;
    const size = style.statTextSize;
    const lineH = size + 2;
    const block = lines.length * lineH;
    let y = style.statPosition === 'above' ? top - block - 2 : bottom + 2;
    if (y < bounds.top) y = bounds.top;
    if (y + block > bounds.top + bounds.height) y = bounds.top + bounds.height - block;
    ctx.font = `${size}px ${FIGURES}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = style.textColor;
    lines.forEach((line, i) => ctx.fillText(line, x + colW / 2, y + i * lineH + size / 2));
    void i18n;
}

function paintTooltip(ctx: CanvasRenderingContext2D, hit: CellHit, cursor: { x: number; y: number }, bounds: PaneBounds, coords: CoordinateSystem, i18n: Translator): void {
    const stats = footprintStats(hit.bar);
    const lines = [
        `${formatPrice(hit.level.price)} – ${formatPrice(hit.level.price + hit.tick)}`,
        `${i18n.t(TIP_BID_ASK)}  ${formatFootprintQty(hit.level.bid)} x ${formatFootprintQty(hit.level.ask)}`,
        `${i18n.t(TIP_VOLUME)}  ${formatFootprintQty(stats.volume)}`,
        `${i18n.t(TIP_DELTA)}  ${signedQty(stats.delta)}`,
        i18n.t(TIP_SHIFT),
    ];
    ctx.font = `11px ${FIGURES}`;
    const width = Math.max(...lines.map((line) => ctx.measureText(line).width)) + 16;
    const height = lines.length * 14 + 8;
    let x = cursor.x + 14;
    let y = cursor.y + 14;
    if (x + width > coords.width) x = cursor.x - width - 8;
    if (y + height > bounds.top + bounds.height) y = cursor.y - height - 8;
    ctx.fillStyle = '#121212';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = '#3a3a3a';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
    ctx.fillStyle = TEXT;
    ctx.textAlign = 'left';
    lines.forEach((line, i) => ctx.fillText(line, x + 8, y + 12 + i * 14));
}

function extendRule(ctx: CanvasRenderingContext2D, input: FootprintPaintInput, time: number, price: number, x0: number, color: string, width: number): void {
    const x1 = revisitX(input, time, price);
    const y = input.coords.priceToY(price, input.scale, input.bounds);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
}

function revisitX(input: FootprintPaintInput, time: number, price: number): number {
    const at = priceRevisitedAt(input.bars, time, price);
    return at == null ? input.coords.width : input.coords.timeToX(at);
}

function rule(ctx: CanvasRenderingContext2D, coords: CoordinateSystem, scale: PriceScale, bounds: PaneBounds, price: number, x: number, colW: number, color: string, width: number): void {
    const y = coords.priceToY(price, scale, bounds);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + colW, y);
    ctx.stroke();
}

function rowBox(coords: CoordinateSystem, scale: PriceScale, bounds: PaneBounds, price: number, tick: number): { y: number; h: number } | null {
    const y1 = coords.priceToY(price + tick, scale, bounds);
    const y2 = coords.priceToY(price, scale, bounds);
    const y = Math.min(y1, y2);
    const h = Math.abs(y2 - y1);
    if (h < 0.4 || y > bounds.top + bounds.height || y + h < bounds.top) return null;
    return { y, h };
}

function placeColumn(cx: number, pitch: number, colW: number, position: 'left' | 'center' | 'right'): number {
    if (position === 'left') return cx - pitch / 2 + 1;
    if (position === 'center') return cx - colW / 2;
    return cx + pitch / 2 - colW - 1;
}

function contains(cursor: { x: number; y: number }, x: number, y: number, w: number, h: number): boolean {
    return cursor.x >= x && cursor.x <= x + w && cursor.y >= y && cursor.y <= y + h;
}

function signedQty(value: number): string {
    const text = formatFootprintQty(value);
    return value > 0 ? `+${text}` : text;
}

function formatPrice(price: number): string {
    if (Math.abs(price) >= 100) return String(Math.round(price));
    return String(Number(price.toPrecision(6)));
}

interface FootprintStyle {
    mode: 'bidAsk' | 'volume' | 'delta';
    cellValues: 'auto' | 'bidAsk' | 'volume' | 'delta';
    showNumbers: boolean;
    averageTradeSize: boolean;
    position: 'left' | 'center' | 'right';
    hideCandles: boolean;
    autoTextSize: boolean;
    textSize: number;
    textColor: string;
    shrinkNumbers: boolean;
    gradientCells: boolean;
    askColor: string;
    bidColor: string;
    areaBackground: string;
    valueArea: boolean;
    valueAreaPct: number;
    vaWidth: number;
    vaColor: string;
    showPoc: boolean;
    pocColor: string;
    pocWidth: number;
    extendPoc: boolean;
    imbalance: boolean;
    imbalanceRatioPct: number;
    imbalanceWidth: number;
    recolorValues: boolean;
    stacked: boolean;
    stackedMin: number;
    unfinished: boolean;
    unfinishedMin: number;
    unfinishedWidth: number;
    unfinishedExtend: boolean;
    statTable: boolean;
    statPosition: 'below' | 'above';
    statTextSize: number;
    statTotal: boolean;
    statBuy: boolean;
    statSell: boolean;
    statBuyPct: boolean;
    statSellPct: boolean;
    statDelta: boolean;
    statDeltaPct: boolean;
    statTrades: boolean;
    statBidCount: boolean;
    statAskCount: boolean;
    filters: { volume?: [number, number]; bid?: [number, number]; ask?: [number, number] };
}

function readStyle(bag: Record<string, unknown>): FootprintStyle {
    const mode = pick(bag.mode, ['bidAsk', 'volume', 'delta'], 'bidAsk');
    return {
        mode,
        cellValues: pick(bag.cellValues, ['auto', 'bidAsk', 'volume', 'delta'], 'auto'),
        showNumbers: flag(bag, 'showNumbers', true),
        averageTradeSize: flag(bag, 'averageTradeSize', false),
        position: pick(bag.position, ['left', 'center', 'right'], 'right'),
        hideCandles: flag(bag, 'hideCandles', false),
        autoTextSize: flag(bag, 'autoTextSize', true),
        textSize: Math.max(8, Math.round(numberOf(bag, 'textSize', 11))),
        textColor: colorOf(bag, 'textColor', TEXT),
        shrinkNumbers: flag(bag, 'shrinkNumbers', true),
        gradientCells: flag(bag, 'gradientCells', true),
        askColor: colorOf(bag, 'askColor', BULLISH),
        bidColor: colorOf(bag, 'bidColor', BEARISH),
        areaBackground: colorOf(bag, 'areaBackground', SLATE_DEEP),
        valueArea: flag(bag, 'valueArea', true),
        valueAreaPct: numberOf(bag, 'valueAreaPct', 70),
        vaWidth: numberOf(bag, 'vaWidth', 1),
        vaColor: colorOf(bag, 'vaColor', '#c8c8c8'),
        showPoc: flag(bag, 'showPoc', true),
        pocColor: colorOf(bag, 'pocColor', POC_INK),
        pocWidth: numberOf(bag, 'pocWidth', 1.5),
        extendPoc: flag(bag, 'extendPoc', false),
        imbalance: flag(bag, 'imbalance', true),
        imbalanceRatioPct: numberOf(bag, 'imbalanceRatioPct', numberOf(bag, 'imbalanceRatio', 3) > 20 ? numberOf(bag, 'imbalanceRatio', 300) : numberOf(bag, 'imbalanceRatio', 3) * 100),
        imbalanceWidth: numberOf(bag, 'imbalanceWidth', 1),
        recolorValues: flag(bag, 'recolorValues', false),
        stacked: flag(bag, 'stacked', true),
        stackedMin: Math.max(2, Math.round(numberOf(bag, 'stackedMin', 3))),
        unfinished: flag(bag, 'unfinished', false),
        unfinishedMin: numberOf(bag, 'unfinishedMin', 0),
        unfinishedWidth: numberOf(bag, 'unfinishedWidth', 1),
        unfinishedExtend: flag(bag, 'unfinishedExtend', true),
        statTable: flag(bag, 'statTable', true),
        statPosition: pick(bag.statPosition, ['below', 'above'], 'below'),
        statTextSize: Math.max(8, Math.round(numberOf(bag, 'statTextSize', 10))),
        statTotal: flag(bag, 'statTotal', true),
        statBuy: flag(bag, 'statBuy', false),
        statSell: flag(bag, 'statSell', false),
        statBuyPct: flag(bag, 'statBuyPct', false),
        statSellPct: flag(bag, 'statSellPct', false),
        statDelta: flag(bag, 'statDelta', true),
        statDeltaPct: flag(bag, 'statDeltaPct', false),
        statTrades: flag(bag, 'statTrades', false),
        statBidCount: flag(bag, 'statBidCount', false),
        statAskCount: flag(bag, 'statAskCount', false),
        filters: {
            volume: pair(bag, 'volMin', 'volMax'),
            bid: pair(bag, 'bidMin', 'bidMax'),
            ask: pair(bag, 'askMin', 'askMax'),
        },
    };
}

function pair(bag: Record<string, unknown>, minKey: string, maxKey: string): [number, number] | undefined {
    const min = numberOf(bag, minKey, 0);
    const max = numberOf(bag, maxKey, 0);
    return min > 0 || max > 0 ? [min, max] : undefined;
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

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}
