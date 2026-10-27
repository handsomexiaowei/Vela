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
    registerRendererLayer({ id: 'footprint', placement: 'above-data', create: () => new CanvasLayer('footprint', paintFootprintLayer) });
    registerRendererLayer({ id: 'tpo', placement: 'above-data', create: () => new CanvasLayer('tpo', paintTpoLayer) });
}

type Paint = (ctx: CanvasRenderingContext2D, args: RendererLayerArgs) => void;

class CanvasLayer implements RendererLayerInstance {
    private canvas: HTMLCanvasElement | null = null;
    private ctx: CanvasRenderingContext2D | null = null;

    constructor(
        private readonly styleId: string,
        private readonly paint: Paint,
    ) {}

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
        if (args.priceStyle !== this.styleId || args.bounds.height <= 0) return;
        this.paint(ctx, args);
    }

    destroy(): void {
        this.canvas = null;
        this.ctx = null;
    }
}

function paintFootprintLayer(ctx: CanvasRenderingContext2D, args: RendererLayerArgs): void {
    const series = asFootprint(args.data);
    if (!series) return;
    paintFootprint(ctx, {
        series,
        times: args.bars.map((b: OHLCV) => b.time),
        settings: args.settings,
        coords: args.coords,
        scale: args.scale,
        bounds: args.bounds,
        i18n: args.i18n,
    });
}

function paintTpoLayer(ctx: CanvasRenderingContext2D, args: RendererLayerArgs): void {
    const profiles = asProfiles(args.data);
    if (!profiles) return;
    paintTpo(ctx, {
        profiles,
        settings: args.settings,
        coords: args.coords,
        scale: args.scale,
        bounds: args.bounds,
        i18n: args.i18n,
    });
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
