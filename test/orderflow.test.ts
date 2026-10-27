import { describe, expect, it } from 'vitest';
import type { OHLCV } from '../src/core/model/ohlcv';
import {
    autoTickSize,
    bucketPrice,
    buildFootprintFromTrades,
    computeTpoFromTrades,
    computeTpoProfiles,
    estimateFootprintFromBars,
    footprintDrawsText,
    footprintPoc,
    footprintSide,
    footprintSummary,
    niceTickSize,
    profileWithValueArea,
    tpoDrawsLetters,
    tpoLetter,
    TPO_ALPHABET,
    type TradePrint,
} from '../src/core/orderflow';

const T0 = Date.UTC(2024, 5, 3);

describe('tick size', () => {
    it('snaps onto the 1 / 2 / 2.5 / 5 grid', () => {
        expect(niceTickSize(0.013)).toBe(0.01);
        expect(niceTickSize(0.017)).toBe(0.02);
        expect(niceTickSize(6.2)).toBe(5);
        expect(niceTickSize(8)).toBe(10);
        expect(niceTickSize(0)).toBe(1);
    });

    it('picks a tick that puts the median range in about 10–20 rows', () => {
        expect(autoTickSize([15, 15, 15])).toBe(1); // 15 rows
        // 100 / 5 = 20 and 100 / 10 = 10 are equally far from 15; the larger tick wins.
        expect(autoTickSize([100])).toBe(10);
        expect(autoTickSize([0, -1])).toBe(1);
        const tick = autoTickSize([30]);
        const rows = 30 / tick;
        expect(rows).toBeGreaterThanOrEqual(10);
        expect(rows).toBeLessThanOrEqual(20);
    });

    it('buckets a price onto the row that contains it', () => {
        expect(bucketPrice(100.2, 0.5)).toBe(100);
        expect(bucketPrice(100.5, 0.5)).toBe(100.5);
        expect(bucketPrice(100.499, 0.5)).toBe(100);
        expect(bucketPrice(100.25, 0.25)).toBe(100.25);
    });
});

describe('footprint aggregation', () => {
    const barMs = 60_000;
    const barTimes = [T0, T0 + barMs, T0 + 2 * barMs];

    function print(offsetMs: number, price: number, qty: number, isBuyerMaker: boolean): TradePrint {
        return { time: T0 + offsetMs, price, qty, isBuyerMaker };
    }

    it('splits sell-aggressor size onto bid and buy-aggressor size onto ask, per bar and per row', () => {
        const { bars, tickSize } = buildFootprintFromTrades(
            [
                print(1_000, 100.2, 5, true),
                print(2_000, 100.8, 2, false),
                print(3_000, 101.1, 4, false),
                print(barMs + 10, 102, 9, true),
                print(-10, 100, 100, false), // before the first bar
                print(3 * barMs, 100, 100, false), // at the end of the last bar, exclusive
            ],
            { barTimes, barMs, tickSize: 1 },
        );
        expect(tickSize).toBe(1);
        expect(bars.map((b) => b.time)).toEqual(barTimes);
        expect(bars[0]!.levels).toEqual([
            { price: 100, bid: 5, ask: 2 },
            { price: 101, bid: 0, ask: 4 },
        ]);
        expect(bars[1]!.levels).toEqual([{ price: 102, bid: 9, ask: 0 }]);
        expect(bars[2]!.levels).toEqual([]);
    });

    it('chooses a tick that leaves a typical bar with 10–20 rows', () => {
        const trades: TradePrint[] = [];
        for (let p = 0; p <= 30; p += 1) trades.push(print(1_000 + p, p, 1, p % 2 === 0));
        const { bars, tickSize } = buildFootprintFromTrades(trades, { barTimes: [T0], barMs });
        expect(bars[0]!.levels.length).toBeGreaterThanOrEqual(10);
        expect(bars[0]!.levels.length).toBeLessThanOrEqual(20);
        expect(tickSize).toBeGreaterThan(0);
    });

    it('colors a row by the imbalance ratio, including a one-sided row', () => {
        const level = { price: 1, bid: 2, ask: 7 };
        expect(footprintSide(level, 3)).toBe('ask'); // 7 >= 2 × 3
        expect(footprintSide(level, 4)).toBe('neutral');
        expect(footprintSide({ price: 1, bid: 9, ask: 2 }, 3)).toBe('bid');
        expect(footprintSide({ price: 1, bid: 0, ask: 1 }, 3)).toBe('ask');
        expect(footprintSide({ price: 1, bid: 0, ask: 0 }, 3)).toBe('neutral');
    });

    it('picks the heaviest row as POC, breaking ties toward the middle then the higher price', () => {
        const bar = {
            time: T0,
            levels: [
                { price: 1, bid: 5, ask: 0 },
                { price: 10, bid: 3, ask: 2 },
                { price: 11, bid: 5, ask: 0 },
            ],
        };
        // Totals 5, 5, 5. Mid price is 6. 10 is nearest.
        expect(footprintPoc(bar)!.price).toBe(10);
        const tied = { time: T0, levels: [{ price: 0, bid: 4, ask: 0 }, { price: 10, bid: 4, ask: 0 }] };
        expect(footprintPoc(tied)!.price).toBe(10);
        expect(footprintPoc({ time: T0, levels: [] })).toBeNull();
    });

    it('summarizes delta as ask minus bid', () => {
        expect(footprintSummary({ time: T0, levels: [{ price: 1, bid: 5, ask: 2 }, { price: 2, bid: 1, ask: 8 }] })).toEqual({
            bid: 6,
            ask: 10,
            delta: 4,
            volume: 16,
        });
    });

    it('draws numbers only when the cell is large enough', () => {
        expect(footprintDrawsText(36, 12)).toBe(true);
        expect(footprintDrawsText(35, 12)).toBe(false);
        expect(footprintDrawsText(40, 11)).toBe(false);
        expect(tpoDrawsLetters(8, 10)).toBe(true);
        expect(tpoDrawsLetters(7, 10)).toBe(false);
    });

    it('spreads a bar\'s volume across its rows without inventing or dropping size', () => {
        const bars: OHLCV[] = [{ time: T0, open: 100, high: 103, low: 100, close: 103, volume: 80 }];
        const series = estimateFootprintFromBars(bars, { tickSize: 1 });
        expect(series.estimated).toBe(true);
        expect(series.bars[0]!.levels.map((l) => l.price)).toEqual([100, 101, 102, 103]);
        const summary = footprintSummary(series.bars[0]!);
        expect(summary.volume).toBeCloseTo(80, 8);
        // An up bar leans ask toward the high.
        expect(series.bars[0]!.levels[3]!.ask).toBeGreaterThan(series.bars[0]!.levels[0]!.ask);
    });
});

describe('TPO profiles', () => {
    const period = 30 * 60_000;

    it('names periods A–Z then a–x', () => {
        expect(tpoLetter(0)).toBe('A');
        expect(tpoLetter(25)).toBe('Z');
        expect(tpoLetter(26)).toBe('a');
        expect(tpoLetter(49)).toBe('x');
        expect(tpoLetter(50)).toBe('y');
        expect(TPO_ALPHABET).toHaveLength(50);
    });

    it('prints each period\'s letter on every row the bar traded, and grows a 70% value area from the POC', () => {
        // Two 30-minute bars inside one UTC day. Tick 1.
        // A: 100–101 → rows 100, 101. B: 101–102 → rows 101, 102.
        const candles: OHLCV[] = [
            { time: T0, open: 100, high: 101, low: 100, close: 101 },
            { time: T0 + period, open: 101, high: 102, low: 101, close: 102 },
        ];
        const [profile] = computeTpoProfiles(candles, { tickSize: 1, valueArea: 0.7, initialBalancePeriods: 2 });
        expect(profile).toBeDefined();
        expect(profile!.rows).toEqual([
            { price: 100, periods: [0] },
            { price: 101, periods: [0, 1] },
            { price: 102, periods: [1] },
        ]);
        // Letters: 1 + 2 + 1 = 4. 70% is 2.8. POC is 101 (2). Tie of the wings expands down,
        // so the area takes 100 and stops at 101. VAH is the top of that row.
        expect(profile!.pocPrice).toBe(101);
        expect(profile!.totalTpos).toBe(4);
        expect(profile!.val).toBe(100);
        expect(profile!.vah).toBe(102);
        expect(profile!.ib).toEqual({ low: 100, high: 103, periods: 2 });
        expect(tpoLetter(profile!.rows[1]!.periods[0]!)).toBe('A');
        expect(tpoLetter(profile!.rows[1]!.periods[1]!)).toBe('B');
    });

    it('opens a new profile when the session rolls, and keeps a short bar on one letter', () => {
        // A 1s neighbour fixes each bar's duration, so a bar is not stretched across the
        // gap to the next session. 14:00 UTC is period 28 (letter c: A–Z, then a, b, c).
        const at = (ms: number, price: number): OHLCV => ({ time: ms, open: price, high: price, low: price, close: price });
        const fourteen = T0 + 14 * 3_600_000;
        const nextDay = T0 + 86_400_000;
        const profiles = computeTpoProfiles(
            [at(fourteen, 10), at(fourteen + 1_000, 50), at(nextDay, 20), at(nextDay + 1_000, 20)],
            { tickSize: 1, periodMs: period },
        );
        expect(profiles).toHaveLength(2);
        expect(profiles[0]!.sessionStart).toBe(T0);
        expect(profiles[0]!.rows.find((r) => r.price === 10)!.periods).toEqual([28]);
        expect(tpoLetter(28)).toBe('c');
        expect(profiles[1]!.sessionStart).toBe(nextDay);
        expect(profiles[1]!.rows.find((r) => r.price === 20)!.periods).toEqual([0]);
    });

    it('stamps a bar longer than the period onto every period it overlaps', () => {
        const hour: OHLCV[] = [
            { time: T0, open: 5, high: 6, low: 5, close: 6 },
            { time: T0 + 3_600_000, open: 5, high: 6, low: 5, close: 6 },
        ];
        const [profile] = computeTpoProfiles(hour, { tickSize: 1, periodMs: period });
        // The first bar lasts until the second opens (60 min) → periods 0 and 1. The second
        // lasts the median gap (60 min), so periods 2 and 3. Both bars trade the same rows.
        expect(profile!.rows[0]!.periods).toEqual([0, 1, 2, 3]);
    });

    it('builds the same row from prints as from a bar that only traded those prices', () => {
        const fromBars = computeTpoProfiles([{ time: T0, open: 10, high: 10, low: 10, close: 10 }], { tickSize: 1, initialBalancePeriods: 0 });
        const fromTrades = computeTpoFromTrades([{ time: T0 + 1_000, price: 10 }], { tickSize: 1, initialBalancePeriods: 0 });
        expect(fromTrades[0]!.rows).toEqual(fromBars[0]!.rows);
        expect(fromTrades[0]!.ib).toBeNull();
        expect(fromBars[0]!.ib).toBeNull();
    });

    it('re-grows the value area without touching the letters', () => {
        const [profile] = computeTpoProfiles(
            [
                { time: T0, open: 100, high: 101, low: 100, close: 101 },
                { time: T0 + period, open: 101, high: 102, low: 101, close: 102 },
            ],
            { tickSize: 1, valueArea: 0.7 },
        );
        const wide = profileWithValueArea(profile!, 1);
        expect(wide.rows).toBe(profile!.rows);
        expect(wide.val).toBe(100);
        expect(wide.vah).toBe(103);
        expect(wide.pocPrice).toBe(101);
    });
});
