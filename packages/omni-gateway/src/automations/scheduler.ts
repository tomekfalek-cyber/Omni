import * as fs from 'fs';
import * as path from 'path';

export interface Automation {
  id: string;
  name: string;
  prompt: string;
  kind: string;
  minutes: number;
  time: string;
  enabled: boolean;
  createdAt: number;
  lastRunAt: number;
  lastStatus: string;
  lastResult: string;
  nextRunAt: number;
}

export type AutomationRunner = (prompt: string, name: string) => Promise<string>;

/** Prosty harmonogram zadan: co ile minut albo codziennie o godzinie. */
export class AutomationScheduler {
  private readonly file: string;
  private jobs: Automation[] = [];
  private timer: any = null;
  private runner: AutomationRunner;
  private busy: boolean = false;

  constructor(baseDir: string, runner: AutomationRunner) {
    this.file = path.join(baseDir, 'automations.json');
    this.runner = runner;
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        this.jobs = Array.isArray(raw) ? raw : [];
      }
    } catch (error) { this.jobs = []; }
    const now = Date.now();
    for (const job of this.jobs) {
      if (!job.nextRunAt) { job.nextRunAt = this.computeNext(job, now); }
    }
  }

  private save(): void {
    try { fs.writeFileSync(this.file, JSON.stringify(this.jobs, null, 2), 'utf8'); } catch (error) { }
  }

  public list(): Automation[] { return this.jobs.slice(); }

  private computeNext(job: Automation, from: number): number {
    if (job.kind === 'interval') {
      const ms = Math.max(1, Number(job.minutes) || 60) * 60000;
      return from + ms;
    }
    const parts = String(job.time || '09:00').split(':');
    const hh = Math.max(0, Math.min(23, Number(parts[0]) || 9));
    const mm = Math.max(0, Math.min(59, Number(parts[1]) || 0));
    const d = new Date(from);
    d.setHours(hh, mm, 0, 0);
    let ts = d.getTime();
    if (ts <= from) { ts = ts + 24 * 3600 * 1000; }
    return ts;
  }

  public describe(job: Automation): string {
    if (job.kind === 'interval') { return 'co ' + job.minutes + ' min'; }
    return 'codziennie o ' + job.time;
  }

  public upsert(input: any): Automation {
    const now = Date.now();
    let job = this.jobs.filter((j) => j.id === input.id)[0];
    if (!job) {
      job = {
        id: 'auto_' + now + '_' + Math.floor(Math.random() * 1000),
        name: '', prompt: '', kind: 'interval', minutes: 60, time: '09:00',
        enabled: true, createdAt: now, lastRunAt: 0, lastStatus: '', lastResult: '', nextRunAt: 0,
      };
      this.jobs.push(job);
    }
    if (typeof input.name === 'string' && input.name.trim()) { job.name = input.name.trim(); }
    if (typeof input.prompt === 'string' && input.prompt.trim()) { job.prompt = input.prompt.trim(); }
    if (input.kind === 'interval' || input.kind === 'daily') { job.kind = input.kind; }
    if (input.minutes !== undefined) { job.minutes = Math.max(1, Number(input.minutes) || 60); }
    if (typeof input.time === 'string' && input.time.trim()) { job.time = input.time.trim(); }
    if (typeof input.enabled === 'boolean') { job.enabled = input.enabled; }
    if (!job.name) { job.name = 'Zadanie'; }
    job.nextRunAt = this.computeNext(job, now);
    this.save();
    return job;
  }

  public remove(id: string): void {
    this.jobs = this.jobs.filter((j) => j.id !== id);
    this.save();
  }

  public async runNow(id: string): Promise<Automation | null> {
    const job = this.jobs.filter((j) => j.id === id)[0];
    if (!job) { return null; }
    await this.runJob(job);
    return job;
  }

  private async runJob(job: Automation): Promise<void> {
    job.lastRunAt = Date.now();
    try {
      const result = await this.runner(job.prompt, job.name);
      job.lastStatus = 'ok';
      job.lastResult = String(result || '').slice(0, 2000);
    } catch (error: any) {
      job.lastStatus = 'blad';
      job.lastResult = String(error && error.message ? error.message : error).slice(0, 500);
    }
    job.nextRunAt = this.computeNext(job, Date.now());
    this.save();
  }

  public start(): void {
    if (this.timer) { return; }
    this.timer = setInterval(() => { this.tick(); }, 30000);
    console.log('[Automations] Scheduler uruchomiony. Zadan: ' + this.jobs.length);
  }

  private async tick(): Promise<void> {
    if (this.busy) { return; }
    const now = Date.now();
    const due = this.jobs.filter((j) => j.enabled && j.prompt && j.nextRunAt && j.nextRunAt <= now);
    if (!due.length) { return; }
    this.busy = true;
    try {
      for (const job of due) {
        console.log('[Automations] Uruchamiam zadanie: ' + job.name);
        await this.runJob(job);
      }
    } finally { this.busy = false; }
  }
}
