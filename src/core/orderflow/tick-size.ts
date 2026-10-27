/**
 * Price-row sizing shared by footprint columns and TPO profiles.
 * A "nice" tick is 1, 2, 2.5 or 5 times a power of ten, so rows land on prices
 * a person can read. Automatic sizing targets a row count and prefers a tick
 * that keeps that count inside 10–20 when any nice tick can.
 */

const NICE_STEPS = [1, 2, 2.5, 5] as const;

/** Round a raw step onto the 1 / 2 / 2.5 / 5 grid. Non-positive input returns 1. */
export function niceTickSize(raw: number): number {
    if (!(raw > 0) || !Number.isFinite(raw)) return 1;
    const exp = Math.floor(Math.log10(raw));
    const base = 10 ** exp;
    const frac = raw / base;
    let best: number = NICE_STEPS[0];
    let bestDiff = Infinity;
    for (const step of NICE_STEPS) {
        const diff = Math.abs(frac - step);
        if (diff < bestDiff) {
            bestDiff = diff;
            best = step;
        }
    }
    // `frac` just under the next decade is closer to 10× than to 5×.
    if (Math.abs(frac - 10) < bestDiff) return snap(10 * base);
    return snap(best * base);
}

/**
 * Tick size for a set of ranges (each a bar's or a session's high − low).
 * Uses the median range. `targetRows` is clamped to 10–20: the result is the
 * nice tick whose median row count is closest to that target, preferring one
 * that actually lands inside the band. Equal distance keeps the larger tick
 * (fewer, taller rows). No positive range returns 1.
 */
export function autoTickSize(ranges: readonly number[], targetRows = 15): number {
    const positive = ranges.filter((r) => r > 0 && Number.isFinite(r)).sort((a, b) => a - b);
    if (positive.length === 0) return 1;
    const median = positive[Math.floor((positive.length - 1) / 2)]!;
    const target = Math.min(20, Math.max(10, targetRows));
    const raw = median / target;
    const exp = Math.floor(Math.log10(raw > 0 ? raw : 1));
    const candidates: number[] = [];
    for (let e = exp - 1; e <= exp + 1; e += 1) {
        const base = 10 ** e;
        for (const step of NICE_STEPS) candidates.push(snap(step * base));
    }
    const rowsFor = (tick: number): number => median / tick;
    const inBand = candidates.filter((t) => {
        const rows = rowsFor(t);
        return rows >= 10 - 1e-9 && rows <= 20 + 1e-9;
    });
    const pool = inBand.length > 0 ? inBand : candidates;
    let best = pool[0]!;
    let bestScore = Infinity;
    for (const t of pool) {
        const score = Math.abs(rowsFor(t) - target);
        if (score < bestScore - 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && t > best)) {
            bestScore = score;
            best = t;
        }
    }
    return best;
}

/** Lower edge of the row that contains `price` (`[edge, edge + tick)`). */
export function bucketPrice(price: number, tick: number): number {
    if (!(tick > 0) || !Number.isFinite(price)) return price;
    // floor, with a hair of tolerance so a price that landed on a tick by
    // construction (100.25 / 0.25) is not pushed into the row below by float dust.
    const k = Math.round(price / tick - 0.5 + 1e-8);
    return snap(k * tick);
}

/** Inclusive row edges from `low` through `high` on a tick grid. */
export function rowEdges(low: number, high: number, tick: number): number[] {
    if (!(tick > 0)) return [];
    const lo = Math.min(low, high);
    const hi = Math.max(low, high);
    const start = bucketPrice(lo, tick);
    const end = bucketPrice(hi, tick);
    const out: number[] = [];
    // Cap a pathological span (a bad tick) so a single bar cannot allocate millions of rows.
    const maxRows = 500;
    for (let i = 0, p = start; p <= end + tick * 1e-6 && i < maxRows; i += 1, p = snap(start + i * tick)) {
        out.push(p);
    }
    return out.length > 0 ? out : [start];
}

function snap(value: number): number {
    return Number(value.toPrecision(12));
}
