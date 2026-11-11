/**
 * TechniqueEngine：第四阶段基础剑招识别（纯几何 + 显式时序状态）。
 *
 * 职责边界：只读取 SlashDetector 已形成的二维轨迹段（当前就绪段 + 最近已关闭段），
 * 输出 TechniqueResult 供 CombatEngine 在原有一次斩击结算中使用。
 * - 不接触摄像头 / landmarks / rAF / 异步任务；几何部分同输入同输出；
 * - 冷却、段去重、会话领悟标记是显式状态，resetRuntime 清窗口不清领悟；
 * - 不修改敌人 HP、玩家气机或胜负（伤害倍率与额外气机由 CombatEngine 应用）；
 * - 识别失败一律返回 NONE（安全回退普通剑击），宁漏勿滥。
 *
 * 三式识别（全部按舞台宽归一化）：
 * - 斜劈：单笔对角直线（方向角落在对角区间、直线率高、反向步进少）；
 * - 十字剑：同一窗口两笔对角线、斜率相反、几何交叉于中部（单段两笔或跨段拼合）；
 * - 回风式：受控弧形回转（带符号净转向达标、转向一致率高、终点回到起点附近）。
 */
import type { ReadySegment, SlashPoint, SlashSegment } from '@/combat/slashDetect';
import {
  DEFAULT_TECHNIQUE_CONFIG,
  type ConcreteTechniqueKind,
  type TechniqueConfig,
  type TechniqueKind,
} from './techniqueConfig';

export type { ConcreteTechniqueKind };

/** 招式剑气形态（全部字段必有初始值，旧视图不会读到 undefined） */
export interface TechniqueFxShape {
  type: 'diagonal' | 'cross' | 'wind';
  /** 斜劈起终点 / 十字第一笔起终点 */
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** 十字第二笔起终点 */
  cx: number;
  cy: number;
  dx: number;
  dy: number;
  /** 回风弧光中心 / 半径 / 起始角 / 扫过角（弧度，带符号） */
  centerX: number;
  centerY: number;
  radius: number;
  startAngle: number;
  sweep: number;
}

export interface TechniqueResult {
  kind: TechniqueKind;
  /** 几何识别且未处于冷却（CombatEngine 再按失控/低气机决定是否生效） */
  recognized: boolean;
  /** 触发分类的段 id（去重标识；NONE 时为当前段 id） */
  segmentId: number;
  /** 识别时刻（ms；未识别为 0） */
  recognizedAt: number;
  /** 置信度 0~1 */
  confidence: number;
  /** 成招额外气机成本（未识别为 0；是否收取由 CombatEngine 决定） */
  extraQiCost: number;
  /** 伤害倍率（未识别为 1；是否应用由 CombatEngine 决定） */
  damageMultiplier: number;
  /** 反馈文案（识别成功为招式名，否则空串） */
  feedback: string;
  /** 剑气形态（识别成功且未失控时由 CombatEngine 入列显示） */
  fxShape: TechniqueFxShape | null;
}

export interface TechniqueFx {
  id: number;
  kind: ConcreteTechniqueKind;
  shape: TechniqueFxShape;
  until: number;
  /** 预览形态（已识别·未命中）：虚线弱化，非成功命中 */
  preview?: boolean;
}

/** 招式反馈状态（第四阶段可见性：区分识别/命中/未成） */
export type TechniqueAttemptStatus = 'miss' | 'effective' | 'failed';

/** 最近一次招式尝试反馈（TTL 短暂存在，不参与任何战斗结算） */
export interface TechniqueAttempt {
  kind: ConcreteTechniqueKind;
  status: TechniqueAttemptStatus;
  /** 展示文本（如「斜劈 · 已识别，未命中」） */
  text: string;
  segmentId: number;
  createdAt: number;
  expiresAt: number;
}

/** 会话内领悟状态（页面会话存活；重试不清除） */
export interface TechniqueLearned {
  diagonalSlash: boolean;
  cross: boolean;
  returnWind: boolean;
}

interface Pt {
  x: number;
  y: number;
}

interface Stroke {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  len: number;
}

interface Recognized {
  kind: ConcreteTechniqueKind;
  confidence: number;
  fxShape: TechniqueFxShape;
}

const NONE_KIND: TechniqueKind = 'NONE';

/** 招式反馈（attempt）存活时长（ms）：足够阅读，一闪而过不可取 */
const ATTEMPT_TTL_MS = 1600;

function emptyShape(type: TechniqueFxShape['type']): TechniqueFxShape {
  return {
    type,
    ax: 0,
    ay: 0,
    bx: 0,
    by: 0,
    cx: 0,
    cy: 0,
    dx: 0,
    dy: 0,
    centerX: 0,
    centerY: 0,
    radius: 0,
    startAngle: 0,
    sweep: 0,
  };
}

function noneResult(segmentId: number): TechniqueResult {
  return {
    kind: NONE_KIND,
    recognized: false,
    segmentId,
    recognizedAt: 0,
    confidence: 0,
    extraQiCost: 0,
    damageMultiplier: 1,
    feedback: '',
    fxShape: null,
  };
}

/** 去除连续重复/极近点（识别专用降噪，不改 rawTrail/smoothedTrail） */
function dedupe(points: SlashPoint[], minStep: number): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= minStep) {
      out.push({ x: p.x, y: p.y });
    }
  }
  return out;
}

interface Metrics {
  pathLen: number;
  straightDist: number;
  dx: number;
  dy: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** 包围盒对角线长 */
  extent: number;
}

function metrics(pts: Pt[]): Metrics {
  let pathLen = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
    if (i > 0) pathLen += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y);
  }
  const dx = pts[pts.length - 1].x - pts[0].x;
  const dy = pts[pts.length - 1].y - pts[0].y;
  return {
    pathLen,
    straightDist: Math.hypot(dx, dy),
    dx,
    dy,
    minX,
    minY,
    maxX,
    maxY,
    extent: Math.hypot(maxX - minX, maxY - minY),
  };
}

/** 与水平线的夹角（度，0~90，方向无关） */
function angleToHorizontalDeg(dx: number, dy: number): number {
  return (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI;
}

/** 累计带符号转向（度）与转向符号一致率（受控弧形高、乱折返低） */
function turnStats(pts: Pt[]): { netDeg: number; consistency: number } {
  let prev: number | null = null;
  let net = 0;
  let pos = 0;
  let neg = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    if (dx === 0 && dy === 0) continue;
    const ang = Math.atan2(dy, dx);
    if (prev !== null) {
      let d = ang - prev;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      net += d;
      if (d > 0) pos += d;
      else neg += -d;
    }
    prev = ang;
  }
  const total = pos + neg;
  return {
    netDeg: (net * 180) / Math.PI,
    consistency: total < 1e-6 ? 1 : Math.max(pos, neg) / total,
  };
}

/** 反向步进统计（相邻有效位移点积 < 0） */
function reversalStats(pts: Pt[], minStep: number): { count: number; lenRatio: number } {
  let count = 0;
  let revLen = 0;
  let pathLen = 0;
  let px = 0;
  let py = 0;
  let hasPrev = false;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    const d = Math.hypot(dx, dy);
    if (d < minStep) continue;
    pathLen += d;
    if (hasPrev && px * dx + py * dy < 0) {
      count++;
      revLen += d;
    }
    px = dx;
    py = dy;
    hasPrev = true;
  }
  return { count, lenRatio: pathLen < 1e-6 ? 0 : revLen / pathLen };
}

/** 方向笔画分割：局部方向偏转超过分割角且已有足够长度时开新笔 */
function extractStrokes(
  pts: Pt[],
  minStep: number,
  minSplitLen: number,
  splitCos: number,
): Stroke[] {
  const strokes: Stroke[] = [];
  let ax = pts[0].x;
  let ay = pts[0].y;
  let vx = 0;
  let vy = 0;
  let accLen = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    const d = Math.hypot(dx, dy);
    if (d < minStep) continue;
    const vl = Math.hypot(vx, vy);
    const dot = vx * dx + vy * dy;
    if (accLen >= minSplitLen && vl > 1e-6 && dot < splitCos * vl * d) {
      strokes.push({ ax, ay, bx: pts[i - 1].x, by: pts[i - 1].y, len: accLen });
      ax = pts[i - 1].x;
      ay = pts[i - 1].y;
      vx = dx;
      vy = dy;
      accLen = d;
    } else {
      vx += dx;
      vy += dy;
      accLen += d;
    }
  }
  strokes.push({ ax, ay, bx: pts[pts.length - 1].x, by: pts[pts.length - 1].y, len: accLen });
  return strokes;
}

function longestStroke(strokes: Stroke[]): Stroke | null {
  let best: Stroke | null = null;
  for (const s of strokes) {
    if (!best || s.len > best.len) best = s;
  }
  return best;
}

/** 线段相交（参数化）；返回交点在两线段上的参数，不相交返回 null */
function segIntersect(
  s1: Stroke,
  s2: Stroke,
): { t: number; u: number } | null {
  const d1x = s1.bx - s1.ax;
  const d1y = s1.by - s1.ay;
  const d2x = s2.bx - s2.ax;
  const d2y = s2.by - s2.ay;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-9) return null; // 平行（含共线）
  const ex = s2.ax - s1.ax;
  const ey = s2.ay - s1.ay;
  const t = (ex * d2y - ey * d2x) / denom;
  const u = (ex * d1y - ey * d1x) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u };
}

/** 笔画直线率（|终点-起点| / 笔长） */
function strokeStraightness(s: Stroke): number {
  return s.len < 1e-6 ? 0 : Math.hypot(s.bx - s.ax, s.by - s.ay) / s.len;
}

export class TechniqueEngine {
  private config: TechniqueConfig;
  /** 已提交招式的段 id（同一段最多提交一次，防重复结算） */
  private lastCommittedSegmentId = 0;
  /** 各招式冷却截止时刻（ms） */
  private cooldownUntil: Record<ConcreteTechniqueKind, number> = {
    DIAGONAL_SLASH: 0,
    CROSS: 0,
    RETURN_WIND: 0,
  };
  private fx: TechniqueFx[] = [];
  private fxSeq = 0;
  /** 会话内领悟（重试保留；仅页面重开重置） */
  readonly learned: TechniqueLearned = {
    diagonalSlash: false,
    cross: false,
    returnWind: false,
  };
  /** 最近一次识别（HUD 展示用） */
  private last: { kind: ConcreteTechniqueKind; feedback: string; recognizedAt: number } | null =
    null;
  /** 最近一次招式尝试反馈（miss/effective/failed；TTL 过期自动隐藏） */
  private attempt: TechniqueAttempt | null = null;
  /** 已记录 attempt 的段 id（同段只记录一次） */
  private attemptedSegmentId = 0;
  /** v33：练习通道尝试与去重段 id（不污染战斗 attempt 展示） */
  private practiceAttempt: TechniqueAttempt | null = null;
  private practiceSegmentId = 0;

  constructor(config: TechniqueConfig = DEFAULT_TECHNIQUE_CONFIG) {
    this.config = config;
  }

  /**
   * 分类一段已就绪的斩击轨迹（纯几何，无副作用：不设冷却、不记领悟）。
   * 按「段 → 分类 → 碰撞与快准稳 → 一次性应用」契约，由 CombatEngine 在结算前调用；
   * 仅当段实际命中并消费后调用 commit 才产生冷却/领悟/最近识别等状态。
   * @param seg 当前就绪段（SlashDetector.tryStrike 产物）
   * @param recentSegments 最近已关闭段（十字跨段拼合材料，只读）
   */
  classify(
    seg: ReadySegment,
    recentSegments: readonly SlashSegment[],
    stageW: number,
    nowMs: number,
    options?: { onlyKind?: ConcreteTechniqueKind; ignoreCooldown?: boolean },
  ): TechniqueResult {
    const minStep = Math.max(1.5, this.config.dedupeMinStepRatio * stageW);
    const pts = dedupe(seg.points, minStep);
    if (pts.length < 4) return noneResult(seg.id);

    for (const kind of options?.onlyKind ? [options.onlyKind] : this.config.priority) {
      if (!options?.ignoreCooldown && nowMs < this.cooldownUntil[kind]) continue; // 练习可只读几何，正式仍遵守冷却
      const r = this.tryKind(kind, seg, recentSegments, pts, minStep, stageW);
      if (r) {
        const t = this.techOf(kind);
        return {
          kind,
          recognized: true,
          segmentId: seg.id,
          recognizedAt: nowMs,
          confidence: r.confidence,
          extraQiCost: t.extraQiCost,
          damageMultiplier: t.damageMultiplier,
          feedback: t.name,
          fxShape: r.fxShape,
        };
      }
    }
    return noneResult(seg.id);
  }

  /**
   * 提交一次已生效的招式识别（CombatEngine 在段命中且招式实际生效后调用）。
   * 设置冷却并记录最近识别；同一结果重复提交自动去重。
   * 第九阶段收口：commit 不再自动领悟——「领悟」是机缘事实（Life 层机缘事件
   * + 练习窗口验证后由 App 调 setLearned 写入）；战斗中偶然画出招式 ≠ 得其传承。
   */
  commit(result: TechniqueResult, nowMs: number): void {
    if (!result.recognized || result.kind === 'NONE') return;
    if (this.lastCommittedSegmentId === result.segmentId) return; // 同一段只提交一次
    this.lastCommittedSegmentId = result.segmentId;
    const kind = result.kind;
    this.cooldownUntil[kind] = nowMs + this.techOf(kind).cooldownMs;
    this.last = { kind, feedback: result.feedback, recognizedAt: nowMs };
  }

  /**
   * 机缘练习成招：由 App 在练习窗口内验证成功后调用（Life.completeTechniquePractice
   * 的前置回执）。未领悟的招式即便在战斗中反复生效也不会自动置位。
   */
  setLearned(kind: ConcreteTechniqueKind): void {
    this.markLearned(kind);
  }

  /** v33 权限门：该式是否已领悟（未领悟几何在 Combat 生效层按普通斩击处理） */
  isLearned(kind: ConcreteTechniqueKind): boolean {
    return this.learned[kind === 'DIAGONAL_SLASH' ? 'diagonalSlash' : kind === 'CROSS' ? 'cross' : 'returnWind'];
  }

  /**
   * v33 练习通道：记录一次「练习有效」尝试（几何识别 + 快准稳通过 + 气机充足，
   * 但尚未 MASTERED——不产生任何战斗副作用：无倍率/冷却/剑气/commit）。
   * 同段去重；供 App 在 TECHNIQUE_GATE LEARNING 阶段累计成招次数。
   */
  recordPracticeAttempt(result: TechniqueResult, text: string, nowMs: number): boolean {
    if (!result.recognized || result.kind === 'NONE') return false;
    if (this.practiceSegmentId === result.segmentId) return false;
    this.practiceSegmentId = result.segmentId;
    this.practiceAttempt = {
      kind: result.kind,
      status: 'effective',
      text,
      segmentId: result.segmentId,
      createdAt: nowMs,
      expiresAt: nowMs + ATTEMPT_TTL_MS,
    };
    return true;
  }

  /** 当前练习尝试（TTL 过期返回 null；只读，不参与战斗结算） */
  getPracticeAttempt(nowMs: number): TechniqueAttempt | null {
    if (this.practiceAttempt && this.practiceAttempt.expiresAt > nowMs) return this.practiceAttempt;
    return null;
  }

  /** 批量同步领悟状态（恢复存档/切局时用；只增不减） */
  syncLearned(learned: Partial<TechniqueLearned>): void {
    if (learned.diagonalSlash) this.learned.diagonalSlash = true;
    if (learned.cross) this.learned.cross = true;
    if (learned.returnWind) this.learned.returnWind = true;
  }

  replaceLearned(learned: TechniqueLearned): void {
    Object.assign(this.learned, learned);
  }

  /** 招式剑气入列（CombatEngine 调用；preview=true 为「已识别·未命中」的克制预览形态） */
  pushFx(kind: ConcreteTechniqueKind, shape: TechniqueFxShape, nowMs: number, preview = false): void {
    this.fx.push({
      id: ++this.fxSeq,
      kind,
      shape,
      until: nowMs + this.config.fxDurationMs,
      preview,
    });
    if (this.fx.length > 4) this.fx.shift();
  }

  /**
   * 记录一次招式尝试反馈（真实分类结果，无战斗副作用）。
   * 同一段只记录一次；不设冷却、不标记领悟、不改 HP/qi。
   * @returns 是否为该段首次记录（调用方据此决定是否 push 提示，防止未命中段每帧重复）
   */
  recordAttempt(
    result: TechniqueResult,
    status: TechniqueAttemptStatus,
    text: string,
    nowMs: number,
  ): boolean {
    if (!result.recognized || result.kind === 'NONE') return false;
    if (this.attemptedSegmentId === result.segmentId) return false; // 同段只记录一次
    this.attemptedSegmentId = result.segmentId;
    this.attempt = {
      kind: result.kind,
      status,
      text,
      segmentId: result.segmentId,
      createdAt: nowMs,
      expiresAt: nowMs + ATTEMPT_TTL_MS,
    };
    return true;
  }

  /** 当前招式反馈（TTL 过期返回 null） */
  getAttempt(nowMs: number): TechniqueAttempt | null {
    if (this.attempt && this.attempt.expiresAt <= nowMs) this.attempt = null;
    return this.attempt;
  }

  /** 段被消费但招式未生效（低气机/失控）时清除「最近识别」陈旧引用，避免旧招式污染 HUD */
  clearLast(): void {
    this.last = null;
  }

  /** 活跃招式视觉（过期自动过滤） */
  getActiveFx(nowMs: number): TechniqueFx[] {
    if (this.fx.length > 0) this.fx = this.fx.filter((f) => f.until > nowMs);
    return this.fx;
  }

  /** 清识别窗口/冷却/临时反馈（start / reset 调用）；领悟标记保留 */
  resetRuntime(): void {
    this.practiceAttempt = null;
    this.practiceSegmentId = 0;
    this.lastCommittedSegmentId = 0;
    this.cooldownUntil = { DIAGONAL_SLASH: 0, CROSS: 0, RETURN_WIND: 0 };
    this.fx = [];
    this.last = null;
    this.attempt = null;
    this.attemptedSegmentId = 0;
  }

  getLast() {
    return this.last;
  }

  // —— 内部：按优先级分发 ——

  private tryKind(
    kind: ConcreteTechniqueKind,
    seg: ReadySegment,
    recentSegments: readonly SlashSegment[],
    pts: Pt[],
    minStep: number,
    stageW: number,
  ): Recognized | null {
    if (kind === 'DIAGONAL_SLASH') return this.tryDiagonal(pts, stageW, minStep);
    if (kind === 'CROSS') return this.tryCross(seg, recentSegments, pts, minStep, stageW);
    return this.tryReturnWind(pts, stageW, minStep);
  }

  private techOf(
    kind: ConcreteTechniqueKind,
  ): TechniqueConfig['diagonalSlash'] | TechniqueConfig['cross'] | TechniqueConfig['returnWind'] {
    if (kind === 'DIAGONAL_SLASH') return this.config.diagonalSlash;
    if (kind === 'CROSS') return this.config.cross;
    return this.config.returnWind;
  }

  // —— 斜劈：单笔对角直线 ——

  private tryDiagonal(pts: Pt[], stageW: number, minStep: number): Recognized | null {
    const c = this.config.diagonalSlash;
    const m = metrics(pts);
    if (m.pathLen < c.minPathRatio * stageW) return null;
    const straightness = m.straightDist / m.pathLen;
    if (straightness < c.minStraightness) return null;
    const ang = angleToHorizontalDeg(m.dx, m.dy);
    if (ang < c.angleToHorizontalMinDeg || ang > c.angleToHorizontalMaxDeg) return null;
    const rev = reversalStats(pts, minStep);
    if (rev.count > c.maxReversalSteps || rev.lenRatio > c.maxReversalLenRatio) return null;

    const mid = (c.angleToHorizontalMinDeg + c.angleToHorizontalMaxDeg) / 2;
    const half = Math.max(1, (c.angleToHorizontalMaxDeg - c.angleToHorizontalMinDeg) / 2);
    const angT = Math.max(0, 1 - Math.abs(ang - mid) / half);
    const strT = (straightness - c.minStraightness) / Math.max(0.01, 1 - c.minStraightness);
    const revT = 1 - Math.min(1, rev.lenRatio / Math.max(0.01, c.maxReversalLenRatio));
    const confidence = Math.max(0, Math.min(1, 0.55 * strT + 0.25 * angT + 0.2 * revT));
    if (confidence < c.minConfidence) return null;

    const shape = emptyShape('diagonal');
    shape.ax = pts[0].x;
    shape.ay = pts[0].y;
    shape.bx = pts[pts.length - 1].x;
    shape.by = pts[pts.length - 1].y;
    return { kind: 'DIAGONAL_SLASH', confidence, fxShape: shape };
  }

  // —— 十字剑：两笔对角交叉（单段两笔或跨段拼合） ——

  private tryCross(
    seg: ReadySegment,
    recentSegments: readonly SlashSegment[],
    pts: Pt[],
    minStep: number,
    stageW: number,
  ): Recognized | null {
    const c = this.config.cross;
    const minSplitLen = this.config.strokeMinSplitLenRatio * stageW;
    const splitCos = Math.cos((this.config.strokeSplitAngleDeg * Math.PI) / 180);
    const strokes = extractStrokes(pts, minStep, minSplitLen, splitCos);

    // 1) 单段两笔：当前段内已含两笔清晰对角（连续画十字）
    if (strokes.length >= 2) {
      const sorted = [...strokes].sort((a, b) => b.len - a.len);
      const r = this.crossFromTwoStrokes(sorted[0], sorted[1], stageW);
      if (r) {
        // 圆弧等大净转向排除：十字的合并净转向应较小
        const t = turnStats(pts);
        if (Math.abs(t.netDeg) <= c.maxNetTurnDeg) return r;
      }
    }

    // 2) 跨段拼合：当前段主笔 + 窗口内最近历史段主笔（第一笔命中后段已封存）
    const cur = longestStroke(strokes);
    if (!cur) return null;
    for (let i = recentSegments.length - 1; i >= 0; i--) {
      const h = recentSegments[i];
      // 拼合窗口：以「当前段开始时刻」为参照（分类时刻晚于段开始，用 nowMs 会吃掉窗口）
      if (seg.points.length > 0 && seg.points[0].t - h.endT > c.crossWindowMs) continue;
      if (h.pathLen < c.minStrokePathRatio * stageW) continue;
      if (h.endT >= seg.last.t) continue; // 只拼合更早的段（历史段必须在当前段开始前结束）
      const hPts = dedupe(h.points, minStep);
      if (hPts.length < 4) continue;
      const hStrokes = extractStrokes(hPts, minStep, minSplitLen, splitCos);
      const hMain = longestStroke(hStrokes);
      if (!hMain) continue;
      const r = this.crossFromTwoStrokes(hMain, cur, stageW);
      if (r) return r;
    }
    return null;
  }

  /** 两笔是否构成十字：各笔对角、斜率相反、几何交叉于中部、交角足够 */
  private crossFromTwoStrokes(s1: Stroke, s2: Stroke, stageW: number): Recognized | null {
    const c = this.config.cross;
    if (s1.len < c.minStrokePathRatio * stageW || s2.len < c.minStrokePathRatio * stageW) {
      return null;
    }
    if (
      strokeStraightness(s1) < c.perStrokeStraightness ||
      strokeStraightness(s2) < c.perStrokeStraightness
    ) {
      return null;
    }
    const a1 = angleToHorizontalDeg(s1.bx - s1.ax, s1.by - s1.ay);
    const a2 = angleToHorizontalDeg(s2.bx - s2.ax, s2.by - s2.ay);
    if (
      a1 < c.angleToHorizontalMinDeg ||
      a1 > c.angleToHorizontalMaxDeg ||
      a2 < c.angleToHorizontalMinDeg ||
      a2 > c.angleToHorizontalMaxDeg
    ) {
      return null;
    }
    // 斜率符号必须相反（↘ 配 ↗）
    const slope1 = (s1.by - s1.ay) / (Math.abs(s1.bx - s1.ax) < 1e-6 ? 1e-6 : s1.bx - s1.ax);
    const slope2 = (s2.by - s2.ay) / (Math.abs(s2.bx - s2.ax) < 1e-6 ? 1e-6 : s2.bx - s2.ax);
    if (slope1 * slope2 >= 0) return null;

    const hit = segIntersect(s1, s2);
    if (!hit) return null;
    if (
      hit.t < c.centerParamMin ||
      hit.t > c.centerParamMax ||
      hit.u < c.centerParamMin ||
      hit.u > c.centerParamMax
    ) {
      return null;
    }

    // 交角：两方向向量夹角
    const d1x = s1.bx - s1.ax;
    const d1y = s1.by - s1.ay;
    const d2x = s2.bx - s2.ax;
    const d2y = s2.by - s2.ay;
    const cosA =
      Math.abs(d1x * d2x + d1y * d2y) /
      Math.max(1e-6, Math.hypot(d1x, d1y) * Math.hypot(d2x, d2y));
    const crossAngle = (Math.acos(Math.max(-1, Math.min(1, cosA))) * 180) / Math.PI;
    if (crossAngle < c.minCrossAngleDeg) return null;

    const centerT =
      1 - Math.max(Math.abs(hit.t - 0.5), Math.abs(hit.u - 0.5)) / 0.3;
    const straight =
      (strokeStraightness(s1) + strokeStraightness(s2)) / 2;
    const confidence = Math.max(
      0,
      Math.min(1, 0.4 * Math.max(0, centerT) + 0.35 * straight + 0.25 * (crossAngle / 90)),
    );
    if (confidence < c.minConfidence) return null;

    const shape = emptyShape('cross');
    shape.ax = s1.ax;
    shape.ay = s1.ay;
    shape.bx = s1.bx;
    shape.by = s1.by;
    shape.cx = s2.ax;
    shape.cy = s2.ay;
    shape.dx = s2.bx;
    shape.dy = s2.by;
    return { kind: 'CROSS', confidence, fxShape: shape };
  }

  // —— 回风式：受控弧形回转，终点回到起点附近 ——

  private tryReturnWind(pts: Pt[], stageW: number, minStep: number): Recognized | null {
    const c = this.config.returnWind;
    const m = metrics(pts);
    if (m.pathLen < c.minPathRatio * stageW) return null;
    if (m.straightDist > c.closeMaxPathRatio * m.pathLen) return null; // 不闭合
    if (m.straightDist > c.closeMaxAbsRatio * stageW) return null;
    if (m.extent < c.minExtentRatio * stageW) return null; // 极小圆/静止抖动排除

    const t = turnStats(pts);
    const absNet = Math.abs(t.netDeg);
    if (absNet < c.netTurnMinDeg || absNet > c.netTurnMaxDeg) return null;
    if (t.consistency < c.turnConsistencyMin) return null; // 无规律折返排除

    const rev = reversalStats(pts, minStep);
    if (rev.count > c.maxReversalSteps || rev.lenRatio > c.maxReversalLenRatio) return null;

    const closeT = 1 - m.straightDist / Math.max(1e-6, c.closeMaxPathRatio * m.pathLen);
    const turnT = Math.min(1, absNet / 270);
    const confidence = Math.max(
      0,
      Math.min(1, 0.35 * Math.max(0, closeT) + 0.35 * t.consistency + 0.3 * turnT),
    );
    if (confidence < c.minConfidence) return null;

    const shape = emptyShape('wind');
    shape.centerX = (m.minX + m.maxX) / 2;
    shape.centerY = (m.minY + m.maxY) / 2;
    let maxR = 1;
    for (const p of pts) {
      maxR = Math.max(maxR, Math.hypot(p.x - shape.centerX, p.y - shape.centerY));
    }
    shape.radius = maxR;
    shape.startAngle = Math.atan2(pts[0].y - shape.centerY, pts[0].x - shape.centerX);
    shape.sweep = (t.netDeg * Math.PI) / 180;
    return { kind: 'RETURN_WIND', confidence, fxShape: shape };
  }

  private markLearned(kind: ConcreteTechniqueKind): void {
    if (kind === 'DIAGONAL_SLASH') this.learned.diagonalSlash = true;
    else if (kind === 'CROSS') this.learned.cross = true;
    else this.learned.returnWind = true;
  }
}
