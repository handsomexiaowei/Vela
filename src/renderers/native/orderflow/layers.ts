// Renderer layers for the built-in footprint and TPO styles. The layer id is the
// native-data channel the chart type's engine pushes into. Registered from the
// composition root, before a renderer mounts.
import type { OHLCV } from '../../../core/model/ohlcv';
import type { FootprintSeries, TpoProfile } from '../../../core/orderflow';
import { registerRendererLayer, type RendererLayerArgs, type RendererLayerInstance } from '../layers';
import { beginPlotFrame } from '../core/plotDirection';
import { paintFootprint } from './paintFootprint';
import { paintTpo } from './paintTpo';

export function registerOrderFlowLayers(): void {
    registerRendererLayer({
        id: 'footprint',
        placement: 'above-data',
        repaintOnCursor: true,
        create: () => new FootprintLayer(),
    });
    registerRendererLayer({ id: 'tpo', placement: 'above-data', create: () => new TpoLayer() });
}

class FootprintLayer implements RendererLayerInstance {
    private canvas: HTMLCanvasElement | null = null;
    private ctx: CanvasRenderingContext2D | null = null;

    mount(canvas: HTMLCanvasElement): void {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
    }

    render(args: RendererLayerArgs): void {
        const ctx = this.clear(args);
        if (!ctx || args.priceStyle !== 'footprint') return;
        const series = asFootprint(args.data);
        if (!series) return;
        paintFootprint(ctx, {
            series,
            times: args.bars.map((b: OHLCV) => b.time),
            bars: args.bars,
            settings: args.settings,
            coords: args.coords,
            scale: args.scale,
            bounds: args.bounds,
            i18n: args.i18n,
            cursor: args.cursor,
        });
    }

    /** "Hide candles" drops the candle bodies for the whole style. Otherwise narrow
     *  bars stay candles and only wide columns carry a ladder. */
    modulateBase(args: RendererLayerArgs) {
        if (args.priceStyle !== 'footprint') return null;
        return args.settings.hideCandles === true ? { candleBodyAlpha: 0, candleBodyScale: 0 } : null;
    }

    destroy(): void {
        this.canvas = null;
        this.ctx = null;
    }

    private clear(args: RendererLayerArgs): CanvasRenderingContext2D | null {
        const ctx = this.ctx;
        const canvas = this.canvas;
        if (!ctx || !canvas) return null;
        beginPlotFrame(ctx, args.coords.dpr);
        ctx.clearRect(0, 0, canvas.width / args.coords.dpr, canvas.height / args.coords.dpr);
        if (args.bounds.height <= 0) return null;
        return ctx;
    }
}

class TpoLayer implements RendererLayerInstance {
    private canvas: HTMLCanvasElement | null = null;
    private ctx: CanvasRenderingContext2D | null = null;

    mount(canvas: HTMLCanvasElement): void {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
    }

    render(args: RendererLayerArgs): void {
        const ctx = this.ctx;
        const canvas = this.canvas;
        if (!ctx || !canvas) return;
        beginPlotFrame(ctx, args.coords.dpr);
        ctx.clearRect(0, 0, canvas.width / args.coords.dpr, canvas.height / args.coords.dpr);
        if (args.priceStyle !== 'tpo' || args.bounds.height <= 0) return;
        const profiles = asProfiles(args.data);
        if (!profiles) return;
        paintTpo(ctx, {
            profiles,
            bars: args.bars,
            settings: args.settings,
            coords: args.coords,
            scale: args.scale,
            bounds: args.bounds,
            i18n: args.i18n,
        });
    }

    destroy(): void {
        this.canvas = null;
        this.ctx = null;
    }
}

function asFootprint(data: unknown): FootprintSeries | null {
    if (!data || typeof data !== 'object') return null;
    const series = data as FootprintSeries;
    if (!Array.isArray(series.bars) || !(series.tickSize > 0)) return null;
    return series;
}

function asProfiles(data: unknown): TpoProfile[] | null {
    if (!data || typeof data !== 'object') return null;
    const profiles = (data as { profiles?: unknown }).profiles;
    return Array.isArray(profiles) ? (profiles as TpoProfile[]) : null;
}
