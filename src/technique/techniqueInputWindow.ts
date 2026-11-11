import { SlashDetector, type ReadySegment } from '@/combat/slashDetect';
import type { InputFrame, TrailPoint } from '@/lib/types';
import type { ConcreteTechniqueKind, TechniqueEngine, TechniqueResult } from './techniqueEngine';

// Separate namespace from body-strike IDs; never reuse an ID after reset or source changes.
let recognitionSequence = 1_000_000_000;
const MOTION_MS = 1200;
const RELEASE_MS = 550;
const MIN_SAMPLE_MS = 8; // <= 150 points per motion window, even for unbounded pointer event rates.

/** Independent, bounded input history. Combat may consume its own detector at any time. */
export class TechniqueInputWindow {
  private readonly detector = new SlashDetector({
    minPathPx: 1,
    minAvgSpeedPxPerSec: 0,
    segmentWindowMs: MOTION_MS,
    segmentIdleCloseMs: 250,
  });
  private source: InputFrame['source'] | null = null;
  private lastSampleT = -Infinity;
  private latestReady: ReadySegment | null = null;
  private sampledSegment: ReadySegment | null = null;
  private beginT = 0;
  private ids = new Map<number, number>();
  private emitted = new Map<number, Set<ConcreteTechniqueKind>>();

  /** Exact geometry at the most recent successful sample, unaffected by subsequent feed calls. */
  get currentSegment(): ReadySegment | null { return this.sampledSegment; }
  /** Original motion start (first stroke for a cross), suitable for practice-event binding. */
  get startedAt(): number { return this.beginT; }

  feed(frame: InputFrame, point: TrailPoint | null): void {
    if (this.source !== null && this.source !== frame.source) this.reset();
    this.source = frame.source;
    const now = frame.timestamp;
    if (!Number.isFinite(now)) return;
    if (now < this.lastSampleT) this.reset();
    this.detector.tickIdle(now);
    const p = point ?? { x: frame.x, y: frame.y, t: now };
    if (frame.actionState !== 'ACTIVE' || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.y < 0) {
      this.detector.closeSegment();
      this.lastSampleT = -Infinity;
      return;
    }
    if (now - this.lastSampleT < MIN_SAMPLE_MS) return;
    this.detector.feed({ x: p.x, y: p.y, t: now }, true, now);
    this.lastSampleT = now;
    const ready = this.detector.tryStrike();
    if (ready) this.latestReady = ready;
    this.prune(ready?.id);
  }

  reset(): void {
    this.detector.reset();
    this.source = null;
    this.lastSampleT = -Infinity;
    this.latestReady = null;
    this.sampledSegment = null;
    this.beginT = 0;
    this.ids.clear();
    this.emitted.clear();
  }

  sample(engine: TechniqueEngine, width: number, now: number, onlyKind?: ConcreteTechniqueKind): TechniqueResult | null {
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(now)) return null;
    this.detector.tickIdle(now);
    const current = this.detector.tryStrike();
    const raw = current ?? this.latestReady;
    if (!raw || now - raw.last.t > RELEASE_MS || now < raw.last.t) return null;
    let id = this.ids.get(raw.id);
    if (id === undefined) {
      id = ++recognitionSequence;
      this.ids.set(raw.id, id);
    }
    const seg = { ...raw, id };
    const history = this.detector.recentSegments.filter((h) => h.id !== raw.id);
    const result = engine.classify(seg, history, width, now, onlyKind ? { onlyKind, ignoreCooldown: true } : undefined);
    if (!result.recognized || result.kind === 'NONE') return null;
    const emitted = this.emitted.get(raw.id) ?? new Set<ConcreteTechniqueKind>();
    if (emitted.has(result.kind)) return null;
    emitted.add(result.kind);
    this.emitted.set(raw.id, emitted);
    this.sampledSegment = { ...seg, points: seg.points.map((p) => ({ ...p })), last: { ...seg.last } };
    this.beginT = seg.points[0].t;
    if (result.kind === 'CROSS') {
      const first = [...history].reverse().find((h) => h.endT <= this.beginT && this.beginT - h.endT <= RELEASE_MS);
      if (first) this.beginT = first.startT;
    }
    this.prune(raw.id);
    return result;
  }

  /** An air swing can grow into a hit before release; retain one successful application per kind. */
  retrySample(kind: ConcreteTechniqueKind): void {
    if (!this.sampledSegment) return;
    for (const [rawId, id] of this.ids) {
      if (id === this.sampledSegment.id) this.emitted.get(rawId)?.delete(kind);
    }
  }

  private prune(currentId?: number): void {
    const live = new Set(this.detector.recentSegments.map((seg) => seg.id));
    if (currentId !== undefined) live.add(currentId);
    if (this.latestReady) live.add(this.latestReady.id);
    for (const id of this.ids.keys()) if (!live.has(id)) this.ids.delete(id);
    for (const id of this.emitted.keys()) if (!live.has(id)) this.emitted.delete(id);
  }
}
