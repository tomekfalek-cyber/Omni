export function toNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function mean(xs: number[]): number {
  if (!xs.length) { return 0; }
  let s = 0; for (const x of xs) { s += x; }
  return s / xs.length;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) { return 0; }
  const m = mean(xs);
  let s = 0; for (const x of xs) { s += (x - m) * (x - m); }
  return Math.sqrt(s / (xs.length - 1));
}

export function zscores(xs: Array<number | null>): Array<number | null> {
  const vals = xs.filter((x): x is number => x !== null && Number.isFinite(x));
  if (vals.length < 3) { return xs.map(() => null); }
  const m = mean(vals);
  const sd = stdev(vals);
  if (sd <= 1e-12) { return xs.map((x) => (x === null ? null : 0)); }
  return xs.map((x) => (x === null || !Number.isFinite(x) ? null : (x - m) / sd));
}

export function clampZ(z: number, limit = 3): number {
  return Math.max(-limit, Math.min(limit, z));
}

export function dailyReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i - 1], b = closes[i];
    if (a > 0 && Number.isFinite(a) && Number.isFinite(b)) { out.push(b / a - 1); }
  }
  return out;
}

export function annVol(rets: number[], periods = 252): number {
  return stdev(rets) * Math.sqrt(periods);
}

export function momentum(closes: number[], skipDays = 21, lookbackDays = 252): number | null {
  if (closes.length < skipDays + 30) { return null; }
  const end = closes.length - 1 - skipDays;
  const start = Math.max(0, end - lookbackDays);
  const a = closes[start], b = closes[end];
  if (!(a > 0) || !Number.isFinite(a) || !Number.isFinite(b)) { return null; }
  return b / a - 1;
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const idx = i++;
      if (idx >= items.length) { return; }
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function withRetry<T>(fn: () => Promise<T>, tries = 3, baseMs = 400): Promise<T> {
  let last: unknown = null;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { last = e; await new Promise((r) => setTimeout(r, baseMs * (i + 1))); }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export function pad2(n: number): string { return n < 10 ? '0' + n : String(n); }

export function isoDate(d: Date): string {
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}

export function daysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return isoDate(d);
}

export function todayIso(): string { return isoDate(new Date()); }

export function round(x: number, digits = 4): number {
  const f = Math.pow(10, digits);
  return Math.round(x * f) / f;
}

export function pct(x: number): string { return (x * 100).toFixed(1) + '%'; }

export function monthKey(iso: string): string { return String(iso).slice(0, 7); }

export function monthsBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso + 'T00:00:00Z'), b = new Date(toIso + 'T00:00:00Z');
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}
