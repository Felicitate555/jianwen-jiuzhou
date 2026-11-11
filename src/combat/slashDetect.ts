/**
 * 有效斩击轨迹段识别。
 *
 * 从最近一小段 ACTIVE 轨迹中识别一次普通剑击：
 * - 剑尖持续移动时点入当前段，路径长度累计；
 * - 段关闭条件：离开 ACTIVE、剑尖停顿超过 idleCloseMs、段时长超过 windowMs；
 * - 段「就绪」（可结算命中）：路径长度 ≥ 最低阈值、平均速度 ≥ 最低有效速度、未被消费；
 * - 一次穿越一次命中：结算后标记 consumed，同一段不再结算；
 *   下一次命中必须来自新段（重新累计有效移动）。
 *
 * 暂不识别斜劈、十字、回风等招式，全部为普通剑击（招式识别见 src/technique/，
 * 只读取本模块已形成的段，不改输入链路）。
 */
export interface SlashPoint {
  x: number;
  y: number;
  t: number;
}

export interface SlashSegment {
  id: number;
  points: SlashPoint[];
  pathLen: number;
  startT: number;
  endT: number;
  consumed: boolean;
}

export interface ReadySegment {
  id: number;
  pathLen: number;
  durationMs: number;
  /** 平均速度 px/ms */
  avgSpeed: number;
  /** 起终点直线距离 */
  straightDist: number;
  last: SlashPoint;
  /** 段内全部点（引擎用于计算与敌人的最近距离，即命中位置） */
  points: SlashPoint[];
}

export interface SlashThresholds {
  minPathPx: number;
  minAvgSpeedPxPerSec: number;
  segmentWindowMs: number;
  segmentIdleCloseMs: number;
}

export class SlashDetector {
  private segmentId = 0;
  private current: SlashSegment | null = null;
  private _lastPoint: SlashPoint | null = null;
  /** 最近已关闭段（第四阶段：十字剑跨段拼合的只读材料，不作二次结算） */
  private recentClosed: SlashSegment[] = [];

  /**
   * 喂入一帧剑尖（仅 ACTIVE 帧）。
   * @param p 平滑剑尖点
   * @param active 当前是否 ACTIVE
   * @param nowMs 当前时间（用于停顿判定）
   */
  feed(p: SlashPoint, active: boolean, nowMs: number): void {
    if (!active) {
      this.closeSegment();
      return;
    }
    if (!this.current) {
      this.segmentId++;
      this.current = {
        id: this.segmentId,
        points: [p],
        pathLen: 0,
        startT: p.t,
        endT: p.t,
        consumed: false,
      };
      this._lastPoint = p;
      return;
    }
    const seg = this.current;
    // 段超时：关闭作废，从新段开始
    if (nowMs - seg.startT > 0 && p.t - seg.startT >= this.thresholds.segmentWindowMs) {
      this.closeSegment();
      this.feed(p, true, nowMs);
      return;
    }
    const prev = seg.points[seg.points.length - 1];
    const d = Math.hypot(p.x - prev.x, p.y - prev.y);
    seg.points.push(p);
    seg.pathLen += d;
    seg.endT = p.t;
    this._lastPoint = p;
  }

  /** 段超时/停顿检查（由引擎在 update 中调用，使用当前剑尖最后位置） */
  tickIdle(nowMs: number): void {
    if (!this.current) return;
    const idleMs = nowMs - this.current.endT;
    if (idleMs >= this.thresholds.segmentIdleCloseMs) {
      this.closeSegment();
    }
  }

  /** 关闭当前段（不结算，仅封存；达标段进入最近历史供招式跨段拼合） */
  closeSegment(): void {
    this.sealCurrent();
  }

  private sealCurrent(): void {
    const seg = this.current;
    this.current = null;
    if (seg && seg.points.length >= 2 && seg.pathLen >= this.thresholds.minPathPx) {
      this.recentClosed.push(seg);
      if (this.recentClosed.length > 2) this.recentClosed.shift();
    }
  }

  /**
   * 取当前可结算的段：路径与速度达阈值且未被消费。
   * 不会消费段——命中结算由引擎确认后调用 markConsumed。
   */
  tryStrike(): ReadySegment | null {
    const seg = this.current;
    if (!seg || seg.consumed) return null;
    if (seg.points.length < 2) return null;
    if (seg.pathLen < this.thresholds.minPathPx) return null;
    const durationMs = Math.max(1, seg.endT - seg.startT);
    const avgSpeed = seg.pathLen / durationMs; // px/ms
    if (avgSpeed * 1000 < this.thresholds.minAvgSpeedPxPerSec) return null;
    const first = seg.points[0];
    const last = seg.points[seg.points.length - 1];
    return {
      id: seg.id,
      pathLen: seg.pathLen,
      durationMs,
      avgSpeed,
      straightDist: Math.hypot(last.x - first.x, last.y - first.y),
      last,
      points: seg.points,
    };
  }

  /** 结算成功：当前段标记消费，同段不再命中 */
  markConsumed(): void {
    if (this.current) this.current.consumed = true;
  }

  /** 最近已关闭段（只读，招式跨段拼合材料） */
  get recentSegments(): readonly SlashSegment[] {
    return this.recentClosed;
  }

  /** 输入源切换/重置时清空跨段拼合材料（旧窗口不得污染下一剑） */
  clearRecent(): void {
    this.recentClosed = [];
  }

  /** 最近一次喂入的点（引擎用于碰撞检测） */
  get lastPoint(): SlashPoint | null {
    return this._lastPoint;
  }

  reset(): void {
    this.current = null;
    this._lastPoint = null;
    this.recentClosed = [];
  }

  /** 引擎按舞台宽更新比例阈值换算出的 px 阈值（resize 安全） */
  setThresholds(minPathPx: number, minAvgSpeedPxPerSec: number): void {
    this.thresholds.minPathPx = minPathPx;
    this.thresholds.minAvgSpeedPxPerSec = minAvgSpeedPxPerSec;
  }

  constructor(private thresholds: SlashThresholds) {}
}