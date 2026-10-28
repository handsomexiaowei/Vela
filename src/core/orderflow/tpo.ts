/**
 * TPO (market profile): one profile per session, built from sub-bars or from prints.
 *
 * Each period inside the session gets a letter, A–Z then a–x (fifty letters, the
 * usual half-hour alphabet for a full day). A letter is printed on every price row
 * the period traded. The point of control is the row with the most letters. The
 * value area grows out from it until it holds the requested share of letters
 * (70% unless told otherwise). The initial balance is the price span of the first
 * periods (two, unless told otherwise).
 */
import { autoTickSize, bucketPrice } from './tick-size';

/** A–Z then a–x. Index 0 is the session's first period. */
export const TPO_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwx';

const TPO_OVERFLOW = 'yz0123456789';

/** The letter for a period index. Past the fifty-letter alphabet, y, z and digits. */
export function tpoLetter(index: number): string {
    if (index >= 0 && index < TPO_ALPHABET.length) return TPO_ALPHABET[index]!;
    const over = index - TPO_ALPHABET.length;
    if (over >= 0 && over < TPO_OVERFLOW.length) return TPO_OVERFLOW[over]!;
    return '*';
}

/** Letters draw when a cell clears both floors; otherwise the row is blocks.
 *  Height is low enough that an auto row (~9 CSS px) still prints its letter. */
export const TPO_LETTER_MIN_WIDTH = 8;
export const TPO_LETTER_MIN_HEIGHT = 7;
/** Target height of one auto-sized TPO row, in CSS pixels. */
export const TPO_TARGET_ROW_PX = 9;

export function tpoDrawsLetters(cellWidth: number, cellHeight: number): boolean {
    return cellWidth >= TPO_LETTER_MIN_WIDTH && cellHeight >= TPO_LETTER_MIN_HEIGHT;
}

export interface TpoRow {
    /** Lower edge of the row. */
    price: number;
    /** Period indexes (into the session) that traded this row, ascending. */
    periods: number[];
    /** Volume printed into this row, when the source bars carried volume. Split evenly
     *  across the rows a bar touched, so the rows of one bar sum back to that bar. */
    volume?: number;
}

/** Price span of the leading periods. `high` is the top edge of the highest row they touched. */
export interface TpoInitialBalance {
    low: number;
    high: number;
    periods: number;
}

export interface TpoProfile {
    /** Session window the letters are numbered from, `[sessionStart, sessionEnd)`. */
    sessionStart: number;
    sessionEnd: number;
    /** First print or bar open in the session. Profiles are drawn from here, not from an empty open. */
    from: number;
    /** Exclusive end of the last contributing bar or period. */
    to: number;
    tickSize: number;
    periodMs: number;
    rows: TpoRow[];
    /** Lower edge of the point-of-control row. */
    pocPrice: number;
    /** Top edge of the value area. */
    vah: number;
    /** Bottom edge of the value area. */
    val: number;
    /** Fraction of letters the value area was grown to cover. */
    valueArea: number;
    /** Letter count across every row. */
    totalTpos: number;
    ib: TpoInitialBalance | null;
    /** First bar's open, or the first print's price. */
    open?: number;
    /** Last bar's close, or the last print's price. */
    close?: number;
}

export interface TpoComputeOptions {
    /** Session length. Default 24 hours, aligned to the unix epoch (UTC midnight). */
    sessionMs?: number;
    /** Shift of the session boundary relative to the epoch, in milliseconds. Default 0. */
    sessionOffsetMs?: number;
    /** Period length. Default 30 minutes. */
    periodMs?: number;
    /** Row height in price. Omit to size a typical session to about 10–20 rows. */
    tickSize?: number;
    /** Desired rows per session when `tickSize` is omitted. Clamped to 10–20. Default 16. */
    targetRows?: number;
    /** Value-area fraction, 0–1. Default 0.7. */
    valueArea?: number;
    /** How many leading periods form the initial balance. Default 2. `0` omits it. */
    initialBalancePeriods?: number;
}

interface Candle {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
}

/** A price span one period traded, still in raw prices. Expanded onto the tick grid once
 *  the session's tick size is known — the tick depends on every span's range. */
interface Span {
    low: number;
    high: number;
    period: number;
    volume?: number;
}

interface SessionBuild {
    sessionStart: number;
    from: number;
    to: number;
    spans: Span[];
    low: number;
    high: number;
    open?: number;
    close?: number;
    openTime?: number;
    closeTime?: number;
}

const DAY_MS = 86_400_000;
const THIRTY_MIN_MS = 1_800_000;
/** A single period cannot paint more rows than this, whatever tick it was given. */
const MAX_ROWS = 500;

/**
 * One profile per session from OHLC sub-bars. A bar no longer than the period
 * prints its low-to-high range on the period that contains its open. A longer
 * bar prints that same range on every period it overlaps — pass sub-bars at or
 * below the period for an honest profile.
 */
export function computeTpoProfiles(candles: readonly Candle[], options: TpoComputeOptions = {}): TpoProfile[] {
    const cfg = resolve(options);
    const ordered = candles.filter(isCandle).slice().sort((a, b) => a.time - b.time);
    if (ordered.length === 0) return [];
    const durations = barDurations(ordered);
    const sessions = new Map<number, SessionBuild>();
    for (let i = 0; i < ordered.length; i += 1) {
        const bar = ordered[i]!;
        const duration = durations[i]!;
        const end = bar.time + duration;
        const start = sessionOf(bar.time, cfg.sessionMs, cfg.offsetMs);
        // A bar is attributed to the session of its open. A bar that runs past the
        // session close still stops at that session's last period — it does not
        // open a letter on the next session.
        const lastPeriod = Math.max(0, Math.floor((cfg.sessionMs - 1) / cfg.periodMs));
        const period0 = Math.min(lastPeriod, periodOf(bar.time, start, cfg.periodMs));
        const period1 = Math.min(lastPeriod, periodOf(Math.max(bar.time, end - 1), start, cfg.periodMs));
        const session = ensure(sessions, start, bar.time, end, bar.low, bar.high);
        notePrint(session, bar.time, bar.open, bar.close);
        const nPeriods = period1 - period0 + 1;
        const per = bar.volume != null && bar.volume > 0 ? bar.volume / nPeriods : undefined;
        for (let p = period0; p <= period1; p += 1) session.spans.push({ low: bar.low, high: bar.high, period: p, volume: per });
    }
    return finish(sessions, cfg);
}

/** One profile per session from prints. Each print marks only its own price row. */
export function computeTpoFromTrades(
    trades: readonly { time: number; price: number }[],
    options: TpoComputeOptions = {},
): TpoProfile[] {
    const cfg = resolve(options);
    const sessions = new Map<number, SessionBuild>();
    for (const trade of trades) {
        if (!Number.isFinite(trade.time) || !Number.isFinite(trade.price)) continue;
        const start = sessionOf(trade.time, cfg.sessionMs, cfg.offsetMs);
        const period = periodOf(trade.time, start, cfg.periodMs);
        const periodEnd = start + (period + 1) * cfg.periodMs;
        const session = ensure(sessions, start, trade.time, periodEnd, trade.price, trade.price);
        notePrint(session, trade.time, trade.price, trade.price);
        session.spans.push({ low: trade.price, high: trade.price, period });
    }
    return finish(sessions, cfg);
}

/**
 * Rebuild the value area on an existing profile (same rows, same point of control).
 * Used when the value-area percent changes without new source data.
 */
export function profileWithValueArea(profile: TpoProfile, valueArea: number): TpoProfile {
    const frac = clampFrac(valueArea);
    const { poc, vaFrom, vaTo } = grow(profile.rows, frac);
    const tick = profile.tickSize;
    return {
        ...profile,
        valueArea: frac,
        pocPrice: profile.rows[poc]!.price,
        vah: profile.rows[vaTo]!.price + tick,
        val: profile.rows[vaFrom]!.price,
    };
}

/** Rebuild the initial balance from the rows' period indexes. `periods <= 0` clears it. */
export function profileWithInitialBalance(profile: TpoProfile, periods: number): TpoProfile {
    const n = Math.round(periods);
    return { ...profile, ib: n > 0 ? initialBalance(profile.rows, profile.tickSize, n) : null };
}

function finish(sessions: Map<number, SessionBuild>, cfg: Resolved): TpoProfile[] {
    const builds = [...sessions.values()].sort((a, b) => a.sessionStart - b.sessionStart);
    const tick = cfg.tickSize ?? autoTickSize(builds.map((s) => s.high - s.low), cfg.targetRows);
    const out: TpoProfile[] = [];
    for (const build of builds) {
        const rows = expand(build.spans, tick);
        if (rows.length === 0) continue;
        const profile = assemble(build, rows, tick, cfg);
        if (profile) out.push(profile);
    }
    return out;
}

function expand(spans: readonly Span[], tick: number): TpoRow[] {
    const byPrice = new Map<number, Set<number>>();
    const volByPrice = new Map<number, number>();
    for (const span of spans) {
        const start = bucketPrice(Math.min(span.low, span.high), tick);
        const end = bucketPrice(Math.max(span.low, span.high), tick);
        const prices: number[] = [];
        for (let i = 0; i < MAX_ROWS; i += 1) {
            const price = Number((start + i * tick).toPrecision(12));
            if (price > end + tick * 1e-9) break;
            prices.push(price);
            let set = byPrice.get(price);
            if (!set) {
                set = new Set();
                byPrice.set(price, set);
            }
            set.add(span.period);
        }
        if (span.volume != null && span.volume > 0 && prices.length > 0) {
            const share = span.volume / prices.length;
            for (const price of prices) volByPrice.set(price, (volByPrice.get(price) ?? 0) + share);
        }
    }
    return [...byPrice.entries()]
        .map(([price, periods]) => {
            const volume = volByPrice.get(price);
            const row: TpoRow = { price, periods: [...periods].sort((a, b) => a - b) };
            if (volume != null && volume > 0) row.volume = volume;
            return row;
        })
        .sort((a, b) => a.price - b.price);
}

function notePrint(session: SessionBuild, time: number, open: number, close: number): void {
    if (session.openTime == null || time < session.openTime) {
        session.openTime = time;
        session.open = open;
    }
    if (session.closeTime == null || time >= session.closeTime) {
        session.closeTime = time;
        session.close = close;
    }
}

function assemble(build: SessionBuild, rows: TpoRow[], tick: number, cfg: Resolved): TpoProfile | null {
    const { poc, vaFrom, vaTo, total } = grow(rows, cfg.valueArea);
    if (!(total > 0)) return null;
    return {
        sessionStart: build.sessionStart,
        sessionEnd: build.sessionStart + cfg.sessionMs,
        from: build.from,
        to: build.to,
        tickSize: tick,
        periodMs: cfg.periodMs,
        rows,
        pocPrice: rows[poc]!.price,
        vah: rows[vaTo]!.price + tick,
        val: rows[vaFrom]!.price,
        valueArea: cfg.valueArea,
        totalTpos: total,
        ib: cfg.ibPeriods > 0 ? initialBalance(rows, tick, cfg.ibPeriods) : null,
        ...(build.open != null ? { open: build.open } : {}),
        ...(build.close != null ? { close: build.close } : {}),
    };
}

/** Where one period's block sits inside a session drawn from its start, growing right.
 *  `sessionWidth` is the pixel width of `[sessionStart, sessionEnd)`. The block stays
 *  inside that slot, so one day never runs into the next. */
export function tpoPeriodSlot(periodIndex: number, periodCount: number, sessionWidth: number): { x: number; width: number } {
    const n = Math.max(1, Math.round(periodCount) || 1);
    const slot = sessionWidth / n;
    const index = Math.min(n - 1, Math.max(0, periodIndex));
    return { x: index * slot, width: Math.max(1, slot - 1) };
}

/**
 * Fold a profile onto a coarser tick (auto row size while zoomed out). Periods that
 * traded a merged row are united. A tick finer than the profile's own is ignored.
 */
export function rebucketTpoProfile(profile: TpoProfile, tick: number): TpoProfile {
    if (!(tick > profile.tickSize * 1.01)) return profile;
    const merged = new Map<number, { periods: Set<number>; volume: number }>();
    for (const row of profile.rows) {
        const edge = bucketPrice(row.price, tick);
        let cell = merged.get(edge);
        if (!cell) {
            cell = { periods: new Set(), volume: 0 };
            merged.set(edge, cell);
        }
        for (const period of row.periods) cell.periods.add(period);
        if (row.volume != null && row.volume > 0) cell.volume += row.volume;
    }
    const rows: TpoRow[] = [...merged.entries()]
        .map(([price, cell]) => {
            const row: TpoRow = { price, periods: [...cell.periods].sort((a, b) => a - b) };
            if (cell.volume > 0) row.volume = cell.volume;
            return row;
        })
        .sort((a, b) => a.price - b.price);
    if (rows.length === 0) return profile;
    return profileWithValueArea(
        { ...profile, tickSize: tick, rows, pocPrice: rows[0]!.price, vah: rows[rows.length - 1]!.price + tick, val: rows[0]!.price },
        profile.valueArea,
    );
}

/** Rows that a single period printed — a one-letter row. */
export function tpoSinglePrintRows(profile: TpoProfile): TpoRow[] {
    return profile.rows.filter((row) => row.periods.length === 1);
}

/** A poor high (or low) is an extreme row with only one letter: price barely traded there. */
export function tpoPoorExtremes(profile: TpoProfile): { poorHigh: boolean; poorLow: boolean } {
    const rows = profile.rows;
    if (rows.length === 0) return { poorHigh: false, poorLow: false };
    return { poorLow: rows[0]!.periods.length === 1, poorHigh: rows[rows.length - 1]!.periods.length === 1 };
}

/**
 * Grow from the point of control by absorbing the heavier adjacent row until the
 * accumulated letters cover `valueArea` of the total. An equal pair expands down
 * (the lower price), matching the fixed-range volume profile.
 */
function grow(rows: readonly TpoRow[], valueArea: number): { poc: number; vaFrom: number; vaTo: number; total: number } {
    let total = 0;
    let max = 0;
    let poc = 0;
    for (let i = 0; i < rows.length; i += 1) {
        const n = rows[i]!.periods.length;
        total += n;
        if (n > max) {
            max = n;
            poc = i;
        }
    }
    // Ties: the row nearer the middle of the profile, then the higher price.
    const mid = (rows[0]!.price + rows[rows.length - 1]!.price) / 2;
    for (let i = 0; i < rows.length; i += 1) {
        if (rows[i]!.periods.length !== max) continue;
        const better =
            Math.abs(rows[i]!.price - mid) < Math.abs(rows[poc]!.price - mid) - 1e-12 ||
            (Math.abs(Math.abs(rows[i]!.price - mid) - Math.abs(rows[poc]!.price - mid)) <= 1e-12 && rows[i]!.price > rows[poc]!.price);
        if (better) poc = i;
    }
    const target = total * valueArea;
    let vaFrom = poc;
    let vaTo = poc;
    let acc = max;
    while (acc < target - 1e-9 && (vaFrom > 0 || vaTo < rows.length - 1)) {
        const below = vaFrom > 0 ? rows[vaFrom - 1]!.periods.length : -1;
        const above = vaTo < rows.length - 1 ? rows[vaTo + 1]!.periods.length : -1;
        if (above > below) {
            vaTo += 1;
            acc += above;
        } else {
            vaFrom -= 1;
            acc += below;
        }
    }
    return { poc, vaFrom, vaTo, total };
}

function initialBalance(rows: readonly TpoRow[], tick: number, periods: number): TpoInitialBalance | null {
    let low = Infinity;
    let high = -Infinity;
    for (const row of rows) {
        if (!row.periods.some((p) => p < periods)) continue;
        if (row.price < low) low = row.price;
        const top = row.price + tick;
        if (top > high) high = top;
    }
    return Number.isFinite(low) ? { low, high, periods } : null;
}

function ensure(
    sessions: Map<number, SessionBuild>,
    sessionStart: number,
    time: number,
    end: number,
    low: number,
    high: number,
): SessionBuild {
    let session = sessions.get(sessionStart);
    if (!session) {
        session = { sessionStart, from: time, to: end, spans: [], low, high };
        sessions.set(sessionStart, session);
        return session;
    }
    if (time < session.from) session.from = time;
    if (end > session.to) session.to = end;
    if (low < session.low) session.low = low;
    if (high > session.high) session.high = high;
    return session;
}

interface Resolved {
    sessionMs: number;
    offsetMs: number;
    periodMs: number;
    tickSize: number | undefined;
    targetRows: number;
    valueArea: number;
    ibPeriods: number;
}

function resolve(options: TpoComputeOptions): Resolved {
    return {
        sessionMs: positive(options.sessionMs) ?? DAY_MS,
        offsetMs: Number.isFinite(options.sessionOffsetMs) ? options.sessionOffsetMs! : 0,
        periodMs: positive(options.periodMs) ?? THIRTY_MIN_MS,
        tickSize: positive(options.tickSize),
        targetRows: options.targetRows ?? 16,
        valueArea: clampFrac(options.valueArea ?? 0.7),
        ibPeriods: options.initialBalancePeriods == null ? 2 : Math.max(0, Math.round(options.initialBalancePeriods)),
    };
}

function sessionOf(time: number, sessionMs: number, offsetMs: number): number {
    return Math.floor((time - offsetMs) / sessionMs) * sessionMs + offsetMs;
}

function periodOf(time: number, sessionStart: number, periodMs: number): number {
    return Math.max(0, Math.floor((time - sessionStart) / periodMs));
}

function barDurations(bars: readonly Candle[]): number[] {
    const gaps: number[] = [];
    for (let i = 1; i < bars.length; i += 1) {
        const g = bars[i]!.time - bars[i - 1]!.time;
        if (g > 0) gaps.push(g);
    }
    gaps.sort((a, b) => a - b);
    const median = gaps.length > 0 ? gaps[Math.floor((gaps.length - 1) / 2)]! : THIRTY_MIN_MS;
    return bars.map((bar, i) => {
        const next = bars[i + 1];
        if (next && next.time > bar.time) return next.time - bar.time;
        return median;
    });
}

function isCandle(bar: Candle): boolean {
    return Number.isFinite(bar.time) && Number.isFinite(bar.low) && Number.isFinite(bar.high) && bar.high >= bar.low;
}

function positive(value: number | undefined): number | undefined {
    return value != null && value > 0 && Number.isFinite(value) ? value : undefined;
}

function clampFrac(value: number): number {
    if (!Number.isFinite(value)) return 0.7;
    return Math.min(1, Math.max(0, value));
}
