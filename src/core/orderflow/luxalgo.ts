// Optional adapter for the hosted footprint and candle feeds the chart app reads.
// Probed (unauthenticated GET, CORS *) on 2026-10-27:
//
//   GET {origin}/v1/{venue}/{symbol}/footprints?from=<ms>&to=<ms>&tf=<seconds>
//       [&session=extended]     — the live partial bar uses session=extended
//   → { tick, slices: [{ t, levels: [price, bid, ask, bidCount, askCount][] }],
//       meta: { from, to, level, pending, planLimit: { tickMult } } }
//
//   `tf` is the bar size in SECONDS (60 = one minute). `tick` is the row size in
//   price, not the exchange tick. The server may return a shorter window than
//   requested; `meta.from` / `meta.to` are what came back. `meta.pending` lists
//   ranges still computing.
//
//   Level columns, confirmed by pairing: index 1 sums with index 3, index 2 with
//   index 4. On a rising partial bar the upper rows carry almost all of their size
//   in column 2, which is buy-aggressor volume (ask). Column 1 is sell-aggressor
//   volume (bid).
//
//   GET {origin}/v1/{venue}/{symbol}/candles?tfMin=<minutes>&from&to&partial=1
//   → { bars: [{ t, o, h, l, c, v }], meta }
//
//   `tfMin` is the bar size in MINUTES. TPO is not a server profile: the app
//   requests 30-minute candles in day-sized chunks and builds the profile locally.
import type { OHLCV } from '../model/ohlcv';
import type { FootprintBar, FootprintSeries } from './footprint';

export const LUXALGO_DATA_ORIGIN = 'https://ap-northeast-1.02.data.prod.api.luxalgo.com';

export interface LuxalgoFootprintPayload {
    tick: number;
    slices: ReadonlyArray<{ t: number; levels: ReadonlyArray<readonly number[]> }>;
    meta?: {
        from?: number;
        to?: number;
        /** Bar size in seconds, echoing `tf`. */
        level?: number;
        pending?: unknown[];
        planLimit?: { tickMult?: number };
    };
}

export interface LuxalgoCandlePayload {
    bars: ReadonlyArray<{ t: number; o: number; h: number; l: number; c: number; v?: number }>;
    meta?: unknown;
}

export interface LuxalgoFootprintQuery {
    symbol: string;
    /** Venue path segment. Default `binance`. */
    venue?: string;
    from: number;
    to: number;
    /** Bar size in seconds. `60` is a one-minute footprint. */
    tf: number | string;
    /** Pass `'extended'` for the live partial bar, matching the hosted app. */
    session?: string;
    origin?: string;
}

export interface LuxalgoCandleQuery {
    symbol: string;
    venue?: string;
    from: number;
    to: number;
    /** Bar size in minutes. TPO uses `30`. */
    tfMin: number | string;
    /** Include the forming bar. Default true (`partial=1`). */
    partial?: boolean;
    origin?: string;
}

/** Map a footprints payload onto a {@link FootprintSeries}. Empty or malformed slices are dropped. */
export function footprintFromLuxalgo(payload: LuxalgoFootprintPayload): FootprintSeries {
    const tick = payload.tick > 0 && Number.isFinite(payload.tick) ? payload.tick : 1;
    const bars: FootprintBar[] = [];
    for (const slice of payload.slices ?? []) {
        if (!Number.isFinite(slice.t) || !Array.isArray(slice.levels)) continue;
        const levels = slice.levels
            .map(parseLevel)
            .filter((level): level is NonNullable<typeof level> => level != null)
            .sort((a, b) => a.price - b.price);
        bars.push({ time: slice.t, levels });
    }
    bars.sort((a, b) => a.time - b.time);
    return { bars, tickSize: tick, estimated: false };
}

/** Map a candles payload onto chart bars. */
export function candlesFromLuxalgo(payload: LuxalgoCandlePayload): OHLCV[] {
    const bars: OHLCV[] = [];
    for (const bar of payload.bars ?? []) {
        if (!Number.isFinite(bar.t) || !Number.isFinite(bar.o)) continue;
        bars.push({
            time: bar.t,
            open: bar.o,
            high: bar.h,
            low: bar.l,
            close: bar.c,
            ...(bar.v != null && Number.isFinite(bar.v) ? { volume: bar.v } : {}),
        });
    }
    bars.sort((a, b) => a.time - b.time);
    return bars;
}

export function luxalgoFootprintUrl(query: LuxalgoFootprintQuery): string {
    const origin = (query.origin ?? LUXALGO_DATA_ORIGIN).replace(/\/$/, '');
    const venue = query.venue ?? 'binance';
    const url = new URL(`${origin}/v1/${encodeURIComponent(venue)}/${encodeURIComponent(query.symbol)}/footprints`);
    url.searchParams.set('from', String(query.from));
    url.searchParams.set('to', String(query.to));
    url.searchParams.set('tf', String(query.tf));
    if (query.session) url.searchParams.set('session', query.session);
    return url.toString();
}

export function luxalgoCandlesUrl(query: LuxalgoCandleQuery): string {
    const origin = (query.origin ?? LUXALGO_DATA_ORIGIN).replace(/\/$/, '');
    const venue = query.venue ?? 'binance';
    const url = new URL(`${origin}/v1/${encodeURIComponent(venue)}/${encodeURIComponent(query.symbol)}/candles`);
    url.searchParams.set('from', String(query.from));
    url.searchParams.set('to', String(query.to));
    url.searchParams.set('tfMin', String(query.tfMin));
    url.searchParams.set('partial', query.partial === false ? '0' : '1');
    return url.toString();
}

/** Fetch and convert a footprints window. Throws when the response is not OK. */
export async function fetchLuxalgoFootprints(query: LuxalgoFootprintQuery): Promise<FootprintSeries> {
    const payload = (await getJson(luxalgoFootprintUrl(query))) as LuxalgoFootprintPayload;
    return footprintFromLuxalgo(payload);
}

/** Fetch and convert a candle window. Throws when the response is not OK. */
export async function fetchLuxalgoCandles(query: LuxalgoCandleQuery): Promise<OHLCV[]> {
    const payload = (await getJson(luxalgoCandlesUrl(query))) as LuxalgoCandlePayload;
    return candlesFromLuxalgo(payload);
}

function parseLevel(raw: readonly number[]): FootprintBar['levels'][number] | null {
    if (raw.length < 3) return null;
    const price = raw[0]!;
    const bid = raw[1]!;
    const ask = raw[2]!;
    if (!Number.isFinite(price) || !Number.isFinite(bid) || !Number.isFinite(ask)) return null;
    const level: FootprintBar['levels'][number] = { price, bid, ask };
    const bidCount = raw[3];
    const askCount = raw[4];
    if (bidCount != null && Number.isFinite(bidCount)) level.bidCount = bidCount;
    if (askCount != null && Number.isFinite(askCount)) level.askCount = askCount;
    return level;
}

async function getJson(url: string): Promise<unknown> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Data feed ${response.status} for ${url}`);
    return response.json() as Promise<unknown>;
}
