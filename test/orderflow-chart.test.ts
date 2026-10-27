// The footprint / TPO chart types push a series through the native-data channel,
// and a host payload replaces whatever the engine derived from the bars.
import { describe, expect, it } from 'vitest';
import { Vela } from '../src/index';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { IChartRenderer, RendererCapabilities, IndicatorRenderHandle, VisibleRange } from '../src/core/ports/IChartRenderer';
import type { VelaTheme } from '../src/core/options';
import type { Pane } from '../src/core/model/scene';
import type { IndicatorModel } from '../src/core/model/indicator';
import type { ScenePatch } from '../src/core/model/patch';
import type { InputValue } from '../src/core/model/inputs';
import type { Unsubscribe } from '../src/core/util/types';
import type { FootprintSeries } from '../src/core/orderflow';
import { buildFootprintFromTrades } from '../src/core/orderflow';

const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
};

function bars(): OHLCV[] {
    return [
        { time: Date.UTC(2024, 5, 3, 14, 0), open: 100, high: 102, low: 99, close: 101, volume: 50 },
        { time: Date.UTC(2024, 5, 3, 14, 30), open: 101, high: 103, low: 100, close: 102, volume: 40 },
    ];
}

class FakeRenderer implements IChartRenderer {
    readonly capabilities: RendererCapabilities = {
        panes: true, paneManagement: false, fills: 'primitive', bgcolor: 'primitive', hline: 'native',
        markers: true, barcolor: 'approximated', perPointColor: true, drawings: true, userDrawings: false, tables: true, inputsUI: true,
    };
    readonly name = 'fake';
    readonly features: readonly string[] = [];
    priceStyleFeature: unknown;
    pushes: Array<[string, unknown]> = [];

    constructor(style: string) {
        this.priceStyleFeature = style;
    }

    applyFeature(): void {}
    readFeature(key: string): unknown {
        return key === 'priceStyle' ? this.priceStyleFeature : undefined;
    }
    mount(): void {}
    setTheme(_t: VelaTheme): void {}
    resize(): void {}
    destroy(): void {}
    setBars(): void {}
    updateBar(): void {}
    ensurePane(_p: Pane): void {}
    removePane(): void {}
    mountIndicator(model: IndicatorModel): IndicatorRenderHandle {
        return { id: model.id };
    }
    updateIndicator(_h: IndicatorRenderHandle, _p: ScenePatch): void {}
    removeIndicator(): void {}
    setIndicatorInputs(_h: IndicatorRenderHandle, _v: Record<string, InputValue>): void {}
    onInputChange(): Unsubscribe { return () => {}; }
    onRemoveIndicator(): Unsubscribe { return () => {}; }
    onCrosshairMove(): Unsubscribe { return () => {}; }
    onClick(): Unsubscribe { return () => {}; }
    getVisibleRange(): VisibleRange | null { return null; }
    setVisibleRange(): void {}
    onViewportChange(): Unsubscribe { return () => {}; }
    setNativeData(type: string, data: unknown): void { this.pushes.push([type, data]); }
    onChartTypeSettingsChange(): Unsubscribe { return () => {}; }
    onPriceStyleChange(): Unsubscribe { return () => {}; }
}

function last(renderer: FakeRenderer, type: string): unknown {
    const hits = renderer.pushes.filter((p) => p[0] === type);
    return hits[hits.length - 1]?.[1];
}

describe('footprint and TPO chart types', () => {
    it('estimates a footprint from bar volume until the host supplies prints', async () => {
        const renderer = new FakeRenderer('footprint');
        const chart = new Vela({} as unknown as HTMLElement, { data: bars(), volume: false, priceStyle: 'footprint' }, { renderer });
        await chart.ready();
        await flush();
        const estimated = last(renderer, 'footprint') as FootprintSeries;
        expect(estimated.estimated).toBe(true);
        expect(estimated.bars).toHaveLength(2);
        expect(estimated.bars[0]!.levels.length).toBeGreaterThan(0);

        const built = buildFootprintFromTrades(
            [{ time: bars()[0]!.time + 1, price: 100, qty: 7, isBuyerMaker: true }],
            { barTimes: bars().map((b) => b.time), barMs: 30 * 60_000, tickSize: 1 },
        );
        chart.setChartTypeData('footprint', built);
        const supplied = last(renderer, 'footprint') as FootprintSeries;
        expect(supplied.estimated).toBe(false);
        expect(supplied.bars[0]!.levels).toEqual([{ price: 100, bid: 7, ask: 0, bidCount: 1, askCount: 0 }]);
        chart.destroy();
    });

    it('builds one TPO profile from the chart bars', async () => {
        const renderer = new FakeRenderer('tpo');
        const chart = new Vela({} as unknown as HTMLElement, { data: bars(), volume: false, priceStyle: 'tpo' }, { renderer });
        await chart.ready();
        await flush();
        const payload = last(renderer, 'tpo') as { profiles: { rows: unknown[]; pocPrice: number }[] };
        expect(payload.profiles).toHaveLength(1);
        expect(payload.profiles[0]!.rows.length).toBeGreaterThan(0);
        expect(payload.profiles[0]!.pocPrice).toEqual(expect.any(Number));
        chart.destroy();
    });
});
