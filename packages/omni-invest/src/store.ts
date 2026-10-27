import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Snapshot } from './types.js';

export class SnapshotStore {
  private dir: string;
  constructor(dir?: string) {
    this.dir = dir || path.join(os.homedir(), '.omni', 'invest', 'snapshots');
    fs.mkdirSync(this.dir, { recursive: true });
  }
  public save(s: Omit<Snapshot, 'id'>): Snapshot {
    const id = 'snap-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    const full: Snapshot = { id, ...s };
    fs.writeFileSync(path.join(this.dir, id + '.json'), JSON.stringify(full, null, 2), 'utf8');
    return full;
  }
  public list(limit = 10): Snapshot[] {
    try {
      const files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.json')).sort().reverse().slice(0, limit);
      return files.map((f) => { try { return JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')) as Snapshot; } catch (e) { return null; } }).filter((x): x is Snapshot => !!x);
    } catch (e) { return []; }
  }
  public last(): Snapshot | null {
    const l = this.list(1);
    return l.length ? l[0] : null;
  }
  public dirPath(): string { return this.dir; }
}
