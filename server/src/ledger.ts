// Usage ledger: one JSON line per paid (or mock) use, in server/work/usage.jsonl.
// The spending cap is shared in spirit with the pipeline: real spend here plus
// real (non-dry) spend in pipeline/work/ledger.jsonl must stay under
// PHI_BUDGET_USD. Mock entries are written too, cost nothing, and still count
// towards the daily live-minute cap so the caps can be tested without money.
// Entries hold kinds, models, durations and dollars. Never audio or text.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface UsageEntry {
  at: number;
  /** local date, YYYY-MM-DD */
  day: string;
  kind: 'live' | 'stt' | 'text';
  model: string;
  units: { seconds: number; connections?: number; bytes?: number; tokensIn?: number; tokensOut?: number };
  usd: number;
  mock: boolean;
  note?: string;
}

export function localDay(t = Date.now()): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function readLines(file: string): unknown[] {
  if (!existsSync(file)) return [];
  const out: unknown[] = [];
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* a torn line: skip */
    }
  }
  return out;
}

export class BudgetExceeded extends Error {}

export class Ledger {
  private entries: UsageEntry[];
  private file: string;
  private pipelineFile: string;
  private budgetUsd: number;

  constructor(file: string, pipelineFile: string, budgetUsd: number) {
    this.file = file;
    this.pipelineFile = pipelineFile;
    this.budgetUsd = budgetUsd;
    mkdirSync(dirname(file), { recursive: true });
    this.entries = readLines(file) as UsageEntry[];
  }

  record(e: Omit<UsageEntry, 'at' | 'day'> & { at?: number }): UsageEntry {
    const at = e.at ?? Date.now();
    const full: UsageEntry = { ...e, at, day: localDay(at), usd: e.mock ? 0 : Math.round(e.usd * 1e6) / 1e6 };
    this.entries.push(full);
    appendFileSync(this.file, JSON.stringify(full) + '\n', 'utf8');
    return full;
  }

  /** Real dollars spent by this server. */
  serverSpent(): number {
    return this.entries.reduce((s, e) => s + (e.mock ? 0 : e.usd || 0), 0);
  }

  /** Real dollars spent by the pipeline (re-read each time; it may be running). */
  pipelineSpent(): number {
    let total = 0;
    for (const e of readLines(this.pipelineFile) as { dry?: boolean; usd?: number }[]) {
      if (!e.dry) total += Number(e.usd) || 0;
    }
    return total;
  }

  spent(): number {
    return this.serverSpent() + this.pipelineSpent();
  }

  cap(): number {
    return this.budgetUsd;
  }

  /** Throws if spending `usd` more would pass the shared cap. */
  reserve(usd: number, what: string) {
    const s = this.spent();
    if (s + usd > this.budgetUsd) {
      throw new BudgetExceeded(`${what}: $${s.toFixed(2)} spent + $${usd.toFixed(3)} would pass the $${this.budgetUsd} cap`);
    }
  }

  /** Live seconds already recorded today (mock included). */
  liveSecondsOn(day = localDay()): number {
    return this.entries.filter((e) => e.kind === 'live' && e.day === day).reduce((s, e) => s + e.units.seconds, 0);
  }

  /** School of the Night custom-lesson requests today (mock included); the calls inside one are not counted. */
  customRequestsOn(day = localDay()): number {
    return this.entries.filter((e) => e.kind === 'text' && e.day === day && e.note === 'school.request').length;
  }

  sttCallsOn(day = localDay()): number {
    return this.entries.filter((e) => e.kind === 'stt' && e.day === day).length;
  }
}
