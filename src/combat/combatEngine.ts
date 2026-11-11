/**
 * CombatEngine：战斗核心（第二、三轮）。
 *
 * 职责：有效斩击识别与结算、山狼/远程敌人/妖气弹统一调度、快准稳评分、伤害、
 * 气机、护体真气、防御格挡、战斗阶段编排。只消费统一 InputFrame 与 SwordEngine
 * 的平滑末点，战斗规则不进入摄像头组件；SwordEngine 继续负责剑尖、轨迹与输入表现。
 *
 * 第三阶段新增：
 * - 远程敌人（妖修）在山狼死后延迟出现，ENTER→CHARGE→FIRE→RECOVER 循环；
 * - 妖气弹为真实 gameplay 投射物：飞行、出屏销毁、轨迹线段碰撞、一次性斩碎/命中；
 * - 弱点破势：CHARGE 期间弱点核心 + 准确度阈值 → INTERRUPTED；
 * - 胜利条件扩展：狼与远程敌人威胁全部处理完毕且场上无妖气弹。
 */
import { DEFAULT_COMBAT_CONFIG, type CombatConfig } from './combatConfig';
import { TechniqueInputWindow } from '@/technique/techniqueInputWindow';
import { SlashDetector } from './slashDetect';
import {
  computeDamage,
  judgeAccuracy,
  judgeSpeed,
  judgeStability,
  type SpeedTier,
} from './scoring';
import {
  createWolf,
  updateWolf,
  wolfDie,
  wolfHit,
  wolfKnockbackPx,
  wolfLungeArrived,
  type Wolf,
} from './wolf';
import {
  createRangedEnemy,
  markFired,
  rangedEnemyHit,
  rangedEnemyInterrupt,
  toRecover,
  updateRangedEnemy,
  type RangedEnemy,
} from './rangedEnemy';
import {
  createProjectile,
  projectileReachedPlayer,
  resolveProjectileHit,
  segmentHitsProjectile,
  segmentMinDistToPoint,
  slashProjectile,
  updateProjectile,
  type Projectile,
} from './projectile';
import {
  BOSS_ENCOUNTER_ID,
  bossDie,
  bossHit,
  bossPhaseForHp,
  bossRangedConfig,
  bossWolfConfig,
  createBoss,
  newBattleId,
  updateBossDying,
  type Boss,
} from './bossEncounter';
import type { ActionState, InputFrame, TrailPoint } from '@/lib/types';
import { TechniqueEngine, type ConcreteTechniqueKind, type TechniqueFx, type TechniqueResult } from '@/technique/techniqueEngine';
import type { TechniqueConfig } from '@/technique/techniqueConfig';
import {
  applyHpFloor,
  applyTimeFloor,
  canEnterBreakStance,
  canEnterChaos,
  emptyBossRhythmState,
  type BossRhythmState,
} from './bossRhythmGate';

export type CombatPhase = 'idle' | 'fighting' | 'won' | 'lost';

export interface StrikeResult {
  tier: SpeedTier;
  speedScore: number;
  accuracyScore: number;
  stabilityScore: number;
  damage: number;
  exhausted: boolean;
  qiCost: number;
  /** 第四阶段：本剑招式名（空串 = 普通剑击） */
  technique: string;
}

export interface CombatPrompt {
  id: number;
  text: string;
  kind: 'info' | 'warn' | 'good';
  until: number;
}

/** Boss 战技术招式使用计数 */
export interface TechniqueUsageEntry {
  kind: 'diagonalSlash' | 'cross' | 'returnWind';
  count: number;
}

/**
 * 第九阶段：Boss 战结算摘要（只读快照，由本场真实统计汇总）。
 * 只在 encounter 结束时定格；失败 Summary 只留战斗历史，不推进任何人生状态。
 */
export interface PracticeContext {
  kind: ConcreteTechniqueKind; eventInstanceId: string; requestId: string; learningInstanceId: string; startedAt: number;
}
export interface PracticeReceipt extends PracticeContext { segmentId: number; createdAt: number; }
export interface BattleContext { lifeId: string; chapterInstanceId: string; }

export interface BattleSummary {
  lifeId?: string;
  chapterInstanceId?: string;
  encounterId: string;
  battleId: string;
  result: 'victory' | 'defeat';
  /** 战斗时长（ms，从 startBoss 到定格） */
  duration: number;
  /** 有效斩击次数（命中身体的段数） */
  slashCount: number;
  techniqueUsage: TechniqueUsageEntry[];
  projectilesCut: number;
  blocks: number;
  interrupts: number;
  breakStanceCount: number;
  /** 平均剑速（× 舞台宽/秒，命中段的归一化速度均值——真实快准稳口径） */
  averageSpeed: number;
  accuracyScore: number;
  stabilityScore: number;
  weakPointHits: number;
  qiDepletedCount: number;
  damageTaken: number;
  overspeedCount: number;
}

export interface CombatSnapshot {
  phase: CombatPhase;
  qi: number;
  qiMax: number;
  guardQi: number;
  guardQiMax: number;
  wolf: Wolf;
  wolfX: number; // 含击退的渲染 x 比例
  lastStrike: StrikeResult | null;
  prompts: CombatPrompt[];
  exhausted: boolean;
  sheathed: boolean;
  /** 第三阶段：远程敌人（未出场为 null） */
  rangedEnemy: RangedEnemy | null;
  /** 活跃妖气弹（可碰撞集合） */
  projectiles: Projectile[];
  /** 已结算妖气弹的短暂视觉反馈（碎裂/命中，600ms 后清除） */
  projectileFx: Projectile[];
  /** 第四阶段：会话内招式领悟状态与最近识别 */
  technique: {
    learned: { diagonalSlash: boolean; cross: boolean; returnWind: boolean };
    last: { kind: string; feedback: string; recognizedAt: number } | null;
    /** 最近一次招式尝试反馈（已识别未命中/已生效/招式未成；TTL 过期为 null） */
    attempt: {
      kind: string;
      status: 'miss' | 'effective' | 'failed';
      text: string;
      segmentId: number;
      createdAt: number;
      expiresAt: number;
    } | null;
    /** v33：练习通道尝试（几何有效但未领悟；仅 TECHNIQUE_GATE LEARNING 计数用，无战斗副作用） */
    practiceAttempt: {
      kind: string;
      status: 'miss' | 'effective' | 'failed';
      text: string;
      segmentId: number;
      createdAt: number;
      expiresAt: number;
    } | null;
  };
  /** 活跃招式剑气形态（短暂，过期自动清除） */
  techniqueFx: TechniqueFx[];
  /** 第五阶段：命运选择 gate（选择期间冻结战斗结算，剑尖照常渲染） */
  choiceGate: boolean;
  /** 第九阶段：赤瞳山魈（encounter 模式；非 Boss 战为 null） */
  boss: Boss | null;
  bossGeometry: { bodyRadiusRatio: number; weakPoint: { x: number; y: number; radiusRatio: number; active: boolean } } | null;
  adds: Wolf[];
  practice: PracticeContext | null;
  /** 本场 Boss encounter 标识（非 Boss 战为 null） */
  encounter: { encounterId: string; battleId: string } | null;
}

const MAX_PROMPTS = 4;
/** 妖气弹碎裂/命中反馈保留时长（ms） */
const PROJECTILE_FX_MS = 600;

export class CombatEngine {
  private config: CombatConfig;
  private phase: CombatPhase = 'idle';
  private qi = 100;
  private guardQi = 100;
  private wolf: Wolf;
  private detector: SlashDetector;
  private lastActionState: ActionState = 'IDLE';
  /** 狼命中锁：剑尖在狼体内时狼不可被再次结算（第二轮语义） */
  private wolfHitLock = false;
  /** 远程敌人体内锁：同语义，剑尖离开身体才解锁 */
  private enemyHitLock = false;
  private lastUpdateMs: number | null = null;
  private prompts: CombatPrompt[] = [];
  private promptSeq = 0;
  private lastStrike: StrikeResult | null = null;
  /** 最近输入源（切换时结束当前段与跨段招式窗口） */
  private lastSource: InputFrame['source'] | null = null;

  /** 远程敌人（第三阶段；未出场为 null） */
  private ranged: RangedEnemy | null = null;
  /** 狼死亡时刻（用于延迟刷新远程敌人） */
  private wolfDeadAt: number | null = null;
  /** 活跃妖气弹 */
  private projectiles: Projectile[] = [];
  /** 已结算妖气弹的视觉反馈 */
  private projectileFx: Projectile[] = [];
  /** 第四阶段：招式识别引擎（组合；气机/胜负仍由本引擎唯一裁决） */
  private technique: TechniqueEngine;
  private readonly techniqueWindow = new TechniqueInputWindow();
  /** Ordinary collision may consume a projectile/weak point before the independent
   * technique window recognizes the same gesture. Keep only the overlapping
   * interaction as evidence; damage/statistics remain single-consumption. */
  private recentOrdinaryInteraction: {
    startT: number;
    endT: number;
    projectilesCut: number;
    interrupted: number;
  } | null = null;
  private practiceContext: PracticeContext | null = null;
  private practiceReceipt: PracticeReceipt | null = null;
  private battleContext: BattleContext | null = null;
  private adds: Wolf[] = [];
  private addHitIds = new Map<Wolf, number>();
  /** 第五阶段：命运选择 gate（true 时冻结全部战斗推进，恢复时平移敌方绝对时间戳） */
  private choiceGate = false;
  /** gate 进入时刻（用于冻结期间冻结敌方定时） */
  private choiceGateSince: number | null = null;
  /** per-target 段命中锁：同一段轨迹对同一目标只结算一次 */

  // —— 第九阶段：赤瞳山魈 encounter 模式 ——
  /** encounter 模式：本引擎实例当前进行的是 Boss 战（复用既有积木，无第二战斗循环） */
  private boss: Boss | null = null;
  private battleId: string | null = null;
  private bossStartedAt = 0;
  private bossSummary: BattleSummary | null = null;
  /** Boss 身体命中锁（体内锁语义同狼/远程敌人） */
  private bossHitLock = false;
  /** 已定格的胜负回调（防重复判定；Boss 死亡后所有攻击/投射物停止） */
  private bossResolved = false;
  /** Boss 节奏门统计（第九阶段收口：每 encounter 重置；机制事件真实递增） */
  private bossRhythm: BossRhythmState = emptyBossRhythmState();
  /** Boss 战统计（真实口径：命中段的快准稳与事件计数） */
  private bossStats = {
    slashCount: 0,
    projectilesCut: 0,
    blocks: 0,
    interrupts: 0,
    breakStanceCount: 0,
    weakPointHits: 0,
    qiDepletedCount: 0,
    damageTaken: 0,
    overspeedCount: 0,
    speedSum: 0,
    accuracySum: 0,
    stabilitySum: 0,
    strikeCount: 0,
  };
  /** 三式使用计数（TechniqueEngine commit 时累计） */
  private bossTechniqueUsage: Record<string, number> = {
    diagonalSlash: 0,
    cross: 0,
    returnWind: 0,
  };

  constructor(config: CombatConfig = DEFAULT_COMBAT_CONFIG, techniqueConfig?: TechniqueConfig) {
    this.config = config;
    this.wolf = createWolf(config.wolf);
    this.technique = new TechniqueEngine(techniqueConfig);
    this.detector = new SlashDetector({
      minPathPx: 0, // 以舞台宽比例在 update 时动态设定
      minAvgSpeedPxPerSec: 0,
      segmentWindowMs: config.slash.segmentWindowMs,
      segmentIdleCloseMs: config.slash.segmentIdleCloseMs,
    });
  }

  /** 开始/重新开始试炼：重置全部战斗状态（剑心破碎后的「重新试炼」同此入口） */
  start(nowMs: number, options?: { pressure?: boolean }): void {
    this.adds = options?.pressure ? [this.createAdd(0.77, 0.65)] : [];
    this.addHitIds.clear();
    this.setPracticeContext(null);
    this.techniqueWindow.reset();
    this.recentOrdinaryInteraction = null;
    this.phase = 'fighting';
    this.qi = this.config.player.qiMax;
    this.guardQi = this.config.player.guardQiMax;
    this.wolf = createWolf(this.config.wolf);
    this.detector.reset();
    this.wolfHitLock = false;
    this.enemyHitLock = false;
    this.lastActionState = 'IDLE';
    this.lastStrike = null;
    this.prompts = [];
    this.ranged = null;
    this.wolfDeadAt = null;
    this.projectiles = [];
    this.projectileFx = [];
    this.technique.resetRuntime(); // 清识别窗口/冷却/临时反馈（领悟保留）
    this.lastUpdateMs = nowMs;
    this.choiceGate = false;
    this.choiceGateSince = null;
    this.clearBossRuntime();
  }

  /** 进入命运选择：冻结战斗（不结算/不推进/不扣气），剑尖照常渲染 */
  enterChoiceMode(nowMs: number): void {
    if (this.choiceGate) return; // 幂等：重复进入安全
    this.choiceGate = true;
    this.choiceGateSince = nowMs;
    // 立即丢弃当前进行中的段（选择的一剑只用于确认，不参与斩击/招式识别）
    this.detector.reset();
    this.techniqueWindow.reset();
  }

  /** 退出命运选择：恢复战斗；冻结期间敌方绝对时间戳平移（不瞬间结算积压事件） */
  exitChoiceMode(nowMs: number): void {
    if (!this.choiceGate) return; // 幂等：重复退出安全
    const frozenMs = this.choiceGateSince === null ? 0 : Math.max(0, nowMs - this.choiceGateSince);
    this.choiceGate = false;
    this.choiceGateSince = null;
    if (frozenMs > 0) this.shiftEnemyTimers(frozenMs);
  }

  /** 平移敌方/投射物/提示的绝对时间戳（gate 冻结量） */
  private shiftEnemyTimers(dt: number): void {
    if (this.wolfDeadAt !== null) this.wolfDeadAt += dt;
    this.wolf.telegraphUntil += dt;
    this.wolf.lungeStart += dt;
    this.wolf.lungeResolveAt += dt;
    this.wolf.hitFlashUntil += dt;
    if (this.ranged) {
      this.ranged.chargeStartedAt += dt;
      this.ranged.chargeEndsAt += dt;
      this.ranged.windupUntil += dt;
      this.ranged.lastFireAt += dt;
      this.ranged.dyingAt += dt;
    }
    for (const p of this.projectiles) {
      p.createdAt += dt;
      p.deadline += dt;
      if (p.resolvedAt > 0) p.resolvedAt += dt;
    }
    if (this.boss) {
      const b = this.boss;
      b.phaseSince += dt;
      b.dyingAt += dt;
      b.hitFlashUntil += dt;
      b.lastChaosLungeAt += dt;
      b.melee.telegraphUntil += dt;
      b.melee.lungeStart += dt;
      b.melee.lungeResolveAt += dt;
      b.melee.hitFlashUntil += dt;
      b.melee.dyingAt += dt;
      b.ranged.chargeStartedAt += dt;
      b.ranged.chargeEndsAt += dt;
      b.ranged.windupUntil += dt;
      b.ranged.interruptedUntil += dt;
      b.ranged.lastFireAt += dt;
      b.ranged.dyingAt += dt;
      b.ranged.hitFlashUntil += dt;
      b.ranged.recoverFrom += dt;
      if (this.bossStartedAt > 0) this.bossStartedAt += dt;
    }
    for (const pr of this.prompts) pr.until += dt;
  }

  /** 输入帧接入（与 SwordEngine 同源） */
  onFrame(frame: InputFrame, smoothedPoint: TrailPoint | null): void {
    this.lastActionState = frame.actionState;
    if (this.practiceContext || !this.choiceGate) this.techniqueWindow.feed(frame, smoothedPoint);
    if (this.practiceContext || this.choiceGate) return;
    if (frame.source !== this.lastSource) {
      // 输入源切换：立即结束当前段与跨段招式窗口（旧窗口不得污染下一剑）
      this.detector.closeSegment();
      this.detector.clearRecent();
      this.lastSource = frame.source;
    }
    // Pointer coordinates are already stable and should stay responsive enough to cut a moving
    // projectile. Camera input keeps the SwordEngine EMA point to suppress landmark jitter.
    const p = frame.source === 'pointer' && frame.x >= 0
      ? { x: frame.x, y: frame.y, t: frame.timestamp }
      : smoothedPoint ?? (frame.x >= 0 ? { x: frame.x, y: frame.y, t: frame.timestamp } : null);
    if (p) {
      this.detector.feed(
        { x: p.x, y: p.y, t: p.t },
        frame.actionState === 'ACTIVE',
        p.t,
      );
    } else {
      this.detector.closeSegment();
    }
  }

  /** 每渲染帧推进：回气、山狼、远程敌人、妖气弹、斩击命中、阶段编排 */
  update(nowMs: number, stageW: number, stageH: number): void {
    const dtMs = this.lastUpdateMs === null ? 0 : Math.min(100, nowMs - this.lastUpdateMs);
    this.lastUpdateMs = nowMs;
    this.prunePrompts(nowMs);
    this.pruneProjectileFx(nowMs);
    if (this.practiceContext) {
      const ctx = this.practiceContext;
      const result = this.techniqueWindow.sample(this.technique, stageW, nowMs, ctx.kind);
      if (result && this.techniqueWindow.startedAt >= ctx.startedAt) {
        this.practiceReceipt = { ...ctx, startedAt: this.techniqueWindow.startedAt, segmentId: result.segmentId, createdAt: nowMs };
        this.technique.recordPracticeAttempt(result, `${result.feedback} · 练习有效`, nowMs);
      }
      return;
    }
    if (this.phase !== 'fighting') return;

    // —— 第五阶段 choice gate：命运选择期间冻结全部战斗推进 ——
    // 不结算斩击/伤害/投射物/敌方状态机；剑尖与轨迹照常由渲染层绘制。
    // 时间照常流动（qi 回气仍按 SHEATHED 恢复），恢复时将敌方绝对时间戳整体平移，
    // 使预警/蓄力/飞行从冻结处继续，而不是瞬间结算冻结期间积压的事件。
    if (this.choiceGate) {
      this.detector.reset(); // 冻结期间的段轨迹不参与结算（退出后不补算）
      return;
    }

    // —— 第九阶段：Boss encounter 模式（独立编排，复用同一引擎与输入链路）——
    if (this.boss !== null) {
      this.updateBoss(nowMs, dtMs, stageW, stageH);
      return;
    }

    // 按舞台宽刷新斩击阈值（比例 → px），不受屏幕尺寸影响
    const { slash } = this.config;
    this.detector.setThresholds(
      slash.minPathRatio * stageW,
      slash.minAvgSpeedRatio * stageW,
    );

    // 收势回气：仅 SHEATHED 恢复（qiRegenPerSec=14，0→满约 7.1s）
    if (this.lastActionState === 'SHEATHED') {
      this.qi = Math.min(this.config.player.qiMax, this.qi + (this.config.player.qiRegenPerSec * dtMs) / 1000);
    }

    this.updateAdds(nowMs, dtMs, stageW);
    if (this.phase !== 'fighting') return;
    const { wolf, config } = this;
    updateWolf(wolf, nowMs, dtMs, stageW, config.wolf);

    // 扑击结算：护剑 / 破防 / 受创
    if (wolfLungeArrived(wolf, nowMs)) {
      this.resolveLunge(nowMs);
      if (this.phase !== 'fighting') return; // 剑心破碎：停止后续结算
    }

    // 狼死亡推进
    if (wolf.hp <= 0 && wolf.state !== 'DYING' && wolf.state !== 'DEAD') {
      wolfDie(wolf, nowMs, config.wolf.dyingMs);
    }
    if (wolf.state === 'DEAD' && this.wolfDeadAt === null) {
      this.wolfDeadAt = nowMs;
    }

    // —— 阶段编排：狼死后延迟出现远程敌人（唯一一只）——
    if (
      this.ranged === null &&
      this.wolfDeadAt !== null &&
      nowMs >= this.wolfDeadAt + config.ranged.spawnDelayMs
    ) {
      this.ranged = createRangedEnemy(config.ranged);
      this.pushPrompt(nowMs + 1600, '妖修现身', 'warn');
    }

    // —— 远程敌人状态机（场上无妖气弹才允许开始新蓄力）——
    if (this.ranged) {
      const prevState = this.ranged.state;
      updateRangedEnemy(this.ranged, nowMs, dtMs, config.ranged, this.projectiles.length === 0);
      // 三轮施法耗尽离场：区别于玩家击杀，明确「退场」语义（非被斩杀）
      if (
        this.ranged.state === 'DYING' &&
        prevState === 'RECOVER' &&
        this.ranged.cycles >= config.ranged.maxCycles &&
        this.ranged.hp > 0
      ) {
        this.pushPrompt(nowMs + 2400, '妖气耗尽 · 三轮施法后退场', 'info');
      }
      // FIRE 结算：生成一枚妖气弹（只一次；场上已有弹时防御性跳过生成）
      const e = this.ranged;
      if (e.state === 'FIRE' && !e.chargeFired) {
        markFired(e, nowMs);
        if (this.projectiles.length === 0) {
          this.projectiles.push(
            createProjectile(
              e.x,
              e.y,
              config.wolf.lungeTargetX,
              config.wolf.lungeTargetY,
              nowMs,
              config.projectile,
            ),
          );
          this.pushPrompt(nowMs + 1400, '重击释放', 'warn');
        }
        toRecover(e, nowMs);
      }
    }

    // —— 妖气弹推进：飞行、出屏/超时销毁、命中玩家一次性结算 ——
    this.projectiles = this.projectiles.filter((p) => {
      const alive = updateProjectile(p, dtMs, nowMs);
      if (!alive) {
        return false; // 出屏/超时：直接销毁，无视觉反馈
      }
      if (
        projectileReachedPlayer(
          p,
          config.wolf.lungeTargetX,
          config.wolf.lungeTargetY,
          config.projectile.playerHitRadiusRatio,
        )
      ) {
        resolveProjectileHit(p, nowMs);
        this.projectileFx.push(p);
        this.guardQi = Math.max(0, this.guardQi - p.damage);
        this.pushPrompt(nowMs + 1500, '妖气入体', 'warn');
        if (this.guardQi <= 0) {
          this.phase = 'lost';
          this.projectiles = [];
          this.pushPrompt(nowMs + 4000, '剑心破碎', 'warn');
        }
        return false;
      }
      return true;
    });

    // 斩击段停顿检查（剑尖停住 → 段关闭作废）
    this.detector.tickIdle(nowMs);

    // 有效斩击命中（任一目标活跃时）
    const wolfAlive = wolf.state !== 'DEAD' && wolf.state !== 'DYING';
    const enemyAlive =
      this.ranged !== null && this.ranged.state !== 'DEAD' && this.ranged.state !== 'DYING';
    if (wolfAlive || enemyAlive || this.adds.some((a) => a.state !== 'DEAD' && a.state !== 'DYING') || this.projectiles.length > 0) {
      const techniqueQi = this.qi;
      this.tryResolveStrike(nowMs, stageW, stageH);
      if (this.phase === 'fighting') this.resolveIndependentTechnique(nowMs, stageW, stageH, techniqueQi);
    }

    // —— 胜利判定：狼与远程敌人威胁全部处理完毕，且场上无妖气弹 ——
    // 远程敌人尚未出场（null）或仍在威胁（非 DEAD）时不得判胜：
    // 第三阶段试炼必须在山狼之后处理完远程敌人（击杀或耗尽其轮数）才能通过。
    const rangedDone = this.ranged !== null && this.ranged.state === 'DEAD';
    if (
      wolf.state === 'DEAD' &&
      rangedDone &&
      this.adds.every((a) => a.state === 'DEAD') &&
      this.projectiles.length === 0 &&
      this.phase === 'fighting'
    ) {
      this.phase = 'won';
      this.pushPrompt(nowMs + 2500, '试炼通过', 'good');
    }
  }

  private resolveLunge(nowMs: number): void {
    const { player, wolf } = this.config;
    this.wolf.lungeResolved = true;
    if (this.lastActionState === 'SHEATHED') {
      if (this.qi >= player.blockQiCost) {
        // 护剑成功：消耗气机，护体真气不损失或仅少量损失
        this.qi -= player.blockQiCost;
        this.guardQi = Math.max(0, this.guardQi - player.blockChipDamage);
        this.pushPrompt(nowMs + 1200, '护剑', 'good');
      } else {
        // 气机不足，护剑被破
        this.qi = 0;
        this.guardQi = Math.max(0, this.guardQi - this.config.wolf.blockBreakDamage);
        this.pushPrompt(nowMs + 1500, '护剑被破', 'warn');
      }
    } else {
      // 未收势：护体真气下降
      this.guardQi = Math.max(0, this.guardQi - wolf.lungeDamage);
      this.pushPrompt(nowMs + 1200, '受创', 'warn');
    }
    if (this.guardQi <= 0) {
      this.phase = 'lost';
      this.pushPrompt(nowMs + 4000, '剑心破碎', 'warn');
    } else {
      this.wolf.state = 'RECOVER';
    }
  }

  private tryResolveStrike(nowMs: number, stageW: number, stageH: number): void {
    const { player, wolf: wolfCfg, ranged: rangedCfg, projectile: projCfg } = this.config;
    const tip = this.detector.lastPoint;
    if (!tip) return;

    const wolfAlive = this.wolf.state !== 'DEAD' && this.wolf.state !== 'DYING';
    const enemy = this.ranged;
    const enemyAlive = enemy !== null && enemy.state !== 'DEAD' && enemy.state !== 'DYING';

    // —— 体内锁（第二轮语义，第三阶段扩展到远程敌人）——
    // 剑尖仍在目标身体内 → 该目标不可被再次结算；离开身体时解锁并强制关闭当前段，
    // 确保下一次命中必须来自离开身体后重新形成的有效移动轨迹。
    // 解锁不 return：妖气弹始终可被斩（保命优先）。
    if (this.wolfHitLock) {
      if (!wolfAlive) {
        this.wolfHitLock = false;
      } else {
        const wolfPx = this.wolf.x * stageW + wolfKnockbackPx(this.wolf, stageW);
        const wolfPy = this.wolf.y * stageH;
        const bodyR = wolfCfg.bodyRadiusRatio * stageW;
        if (Math.hypot(tip.x - wolfPx, tip.y - wolfPy) > bodyR * 1.18) {
          this.wolfHitLock = false;
          this.detector.closeSegment();
        }
      }
    }
    if (this.enemyHitLock) {
      if (!enemyAlive || !enemy) {
        this.enemyHitLock = false;
      } else {
        const ecx = enemy.x * stageW;
        const ecy = enemy.y * stageH;
        const bodyR = rangedCfg.bodyRadiusRatio * stageW;
        if (Math.hypot(tip.x - ecx, tip.y - ecy) > bodyR * 1.18) {
          this.enemyHitLock = false;
          this.detector.closeSegment();
        }
      }
    }

    const seg = this.detector.tryStrike();
    if (!seg) return;
    const now = nowMs; // 本段结算时刻（与段生成同帧）

    // 统一剑速判定（无论命中什么目标，剑的质量相同）
    const vNorm = (seg.avgSpeed * 1000) / stageW; // 每秒穿越舞台宽度的比例
    const pathRatio = seg.pathLen / stageW;
    const speed = judgeSpeed(vNorm, this.config.speed);
    // 低气机（结算前）：招式不免费生效，沿用「气机不继、剑气变弱」语义
    const qiLow = this.qi < player.qiExhaustedThreshold;
    // 第四阶段契约顺序：段 → TechniqueEngine 分类（纯几何无副作用）→ 碰撞与快准稳 → 一次性应用。
    // 分类结果只在段实际命中并消费后才 commit（冷却/领悟/最近识别）
    const tech = ({ kind: 'NONE', recognized: false, segmentId: seg.id, recognizedAt: 0, confidence: 0, extraQiCost: 0, damageMultiplier: 1, feedback: '', fxShape: null } as TechniqueResult);
    // 招式是否实际生效：命中身体 + 未失控 + 气机充足 + 已领悟（v33 权限门：
    // 未 MASTERED 的几何只按普通斩击结算——无倍率、无招式气机、无冷却、无剑气 fx、无招式 toast）
    const techEffective =
      tech.recognized &&
      speed.tier !== 'OUT_OF_CONTROL' &&
      !qiLow &&
      this.technique.isLearned(tech.kind as ConcreteTechniqueKind);
    const techMul = techEffective ? tech.damageMultiplier : 1;

    let hitAnything = false;
    let hitBody = false; // 任意敌人身体（狼或远程）：收取完整斩击气机
    let slashedCount = 0;
    let interrupted = false;
    let strike: StrikeResult | null = null;
    for (const add of this.adds) {
      if (add.state === 'DEAD' || add.state === 'DYING' || this.addHitIds.get(add) === seg.id) continue;
      if (segmentMinDistToPoint(seg.points, (add.x + add.knockback) * stageW, add.y * stageH) <= this.config.wolf.bodyRadiusRatio * stageW) {
        this.addHitIds.set(add, seg.id);
        wolfHit(add, nowMs, Math.round(computeDamage(speed.speedFactor, 1, 1, this.config, qiLow)));
        if (add.hp <= 0) wolfDie(add, nowMs, this.config.wolf.dyingMs);
        hitAnything = true; hitBody = true;
      }
    }

    // —— 1) 妖气弹：整段轨迹线段碰撞，斩碎即移出可碰撞集合（一次性） ——
    if (this.projectiles.length > 0) {
      const remaining: Projectile[] = [];
      for (const p of this.projectiles) {
        if (segmentHitsProjectile(seg.points, p, stageW, stageH)) {
          slashProjectile(p, nowMs);
          this.projectileFx.push(p);
          slashedCount++;
          hitAnything = true;
        } else {
          remaining.push(p);
        }
      }
      this.projectiles = remaining;
    }

    // —— 2) 远程敌人：弱点破势（仅蓄力期）→ 身体命中（不打断蓄力） ——
    if (enemyAlive && enemy) {
      const ecx = enemy.x * stageW;
      const ecy = enemy.y * stageH;
      const bodyR = rangedCfg.bodyRadiusRatio * stageW;
      const weakR = bodyR * rangedCfg.weakPointRadiusRatio;
      const minDist = segmentMinDistToPoint(seg.points, ecx, ecy);

      // 弱点：仅 CHARGE + 弱点有效 + 几何相交 + 准确度达标（同一次蓄力只触发一次）
      if (
        enemy.state === 'CHARGE' &&
        enemy.weakPointActive &&
        !enemy.chargeInterrupted &&
        minDist <= weakR
      ) {
        // 弱点准确度：中心 100，弱点边缘 40 —— 必须精准穿过核心才达标，擦边不判
        const weakScore = Math.round(Math.max(0, 100 - 60 * (minDist / weakR)));
        if (weakScore >= rangedCfg.weakPointAccuracyThreshold) {
          rangedEnemyInterrupt(enemy, nowMs, rangedCfg);
          interrupted = true;
          hitAnything = true;
        }
      }

      // 身体命中：普通伤害 + 受击反馈；不打断蓄力、不触发 INTERRUPTED
      if (!this.enemyHitLock && minDist <= bodyR * 1.05) {
        this.enemyHitLock = true;
        hitBody = true;
        hitAnything = true;
        const accuracy = judgeAccuracy(minDist, bodyR, this.config);
        const stability = judgeStability(
          seg.straightDist / Math.max(1, seg.pathLen),
          this.config,
          speed.tier === 'OUT_OF_CONTROL' ? 0.75 : 1,
        );
        const exhausted = qiLow;
        // 招式倍率只作用于本段这一次身体结算（不产生第二次伤害）
        const damage = Math.round(
          computeDamage(
            speed.speedFactor,
            accuracy.accuracyFactor,
            stability.stabilityFactor,
            this.config,
            exhausted,
          ) * techMul,
        );
        rangedEnemyHit(enemy, nowMs, damage);
        strike = {
          tier: speed.tier,
          speedScore: Math.round(speed.speedScore),
          accuracyScore: accuracy.accuracyScore,
          stabilityScore: stability.stabilityScore,
          damage,
          exhausted,
          qiCost: 0, // 下方统一计算后回填
          technique: '', // 下方招式提交后回填
        };
      }
    }

    // —— 3) 狼（第二轮行为保留）：体内锁 + 线段最近距离碰撞 ——
    if (wolfAlive && !this.wolfHitLock) {
      const wolfPx = this.wolf.x * stageW + wolfKnockbackPx(this.wolf, stageW);
      const wolfPy = this.wolf.y * stageH;
      const bodyR = wolfCfg.bodyRadiusRatio * stageW;
      // 线段最近距离：剑尖快速穿透（单帧跨越身体）也必命中
      const minDist = segmentMinDistToPoint(seg.points, wolfPx, wolfPy);
      if (minDist <= bodyR * 1.05) {
        this.wolfHitLock = true;
        hitBody = true;
        hitAnything = true;
        const accuracy = judgeAccuracy(minDist, bodyR, this.config);
        const stability = judgeStability(
          seg.straightDist / Math.max(1, seg.pathLen),
          this.config,
          speed.tier === 'OUT_OF_CONTROL' ? 0.75 : 1,
        );
        const exhausted = qiLow;
        // 招式倍率只作用于本段这一次身体结算（不产生第二次伤害）
        const damage = Math.round(
          computeDamage(
            speed.speedFactor,
            accuracy.accuracyFactor,
            stability.stabilityFactor,
            this.config,
            exhausted,
          ) * techMul,
        );
        wolfHit(this.wolf, nowMs, damage);
        strike = {
          tier: speed.tier,
          speedScore: Math.round(speed.speedScore),
          accuracyScore: accuracy.accuracyScore,
          stabilityScore: stability.stabilityScore,
          damage,
          exhausted,
          qiCost: 0, // 下方统一计算后回填
          technique: '', // 下方招式提交后回填
        };
        if (this.wolf.hp <= 0) {
          wolfDie(this.wolf, nowMs, this.config.wolf.dyingMs);
        }
      }
    }

    if (!hitAnything) {
      // 未命中任何目标：段保留，不消耗气机，招式不提交。
      // 但几何已识别时记录一次「已识别·未命中」反馈（真实分类，无任何战斗副作用），
      // 让玩家能区分「没识别」与「识别了但没打中」。
      // 注意：未命中段不会被 markConsumed，下一帧仍会回到这里 → 提示必须随 attempt 去重
      if (tech.recognized) {
        const first = this.technique.recordAttempt(
          tech,
          'miss',
          `${tech.feedback} · 已识别，未命中`,
          now,
        );
        if (first) {
          if (tech.fxShape) {
            this.technique.pushFx(
              tech.kind as ConcreteTechniqueKind,
              tech.fxShape,
              now,
              true, // 预览形态：克制虚线，非成功命中
            );
          }
          this.pushPrompt(nowMs + 1500, `${tech.feedback} · 未命中`, 'info');
        }
      }
      return;
    }

    // 一次穿越一次命中：本段已对至少一个目标结算，关闭本段后续结算资格；
    // 同段内多目标（斩弹+破势+身体）已在上方同一次遍历中全部结算完毕
    this.detector.markConsumed();

    // —— 气机消耗（统一结算）——
    let qiCost = 0;
    if (hitBody) {
      qiCost += Math.min(
        player.slashQiCostMax,
        player.slashQiCostBase + pathRatio * player.slashQiCostPerPathRatio,
      );
      if (speed.tier === 'OUT_OF_CONTROL') {
        qiCost += player.outOfControlExtraQiCost;
        this.pushPrompt(nowMs + 1400, '剑势失控', 'warn');
      }
    }
    if (slashedCount > 0) qiCost += projCfg.slashCost * slashedCount;
    if (interrupted) qiCost += projCfg.interruptCost;

    if (slashedCount > 0 || interrupted) {
      this.recentOrdinaryInteraction = {
        startT: seg.points[0]?.t ?? nowMs,
        endT: seg.points.at(-1)?.t ?? nowMs,
        projectilesCut: slashedCount,
        interrupted: interrupted ? 1 : 0,
      };
    }

    // —— 第四阶段：招式提交（仅命中消费的段；生效才收额外气机并展示剑气）——
    if (tech.recognized) {
      // v33 练习通道：几何识别 + 快准稳通过（未失控/气足）但尚未领悟 →
      // 记一次「练习有效」尝试（供 TECHNIQUE_GATE LEARNING 计数；无倍率/冷却/剑气/toast）
      const techGeomOk = speed.tier !== 'OUT_OF_CONTROL' && !qiLow;
      if (!techEffective && techGeomOk) {
        this.technique.recordPracticeAttempt(
          tech,
          `${tech.feedback} · 练习有效（尚未领悟，按普通斩击结算）`,
          now,
        );
      }
      if (techEffective) {
        this.technique.commit(tech, now);
        if (tech.fxShape) {
          this.technique.pushFx(tech.kind as ConcreteTechniqueKind, tech.fxShape, now);
        }
        qiCost += tech.extraQiCost;
        if (strike) strike.technique = tech.feedback;
        // 反馈独立于 StrikeResult：即使只斩弹/破势（无身体 strike）也能看到真实招式与上下文
        const ctxParts: string[] = [];
        if (slashedCount > 0) ctxParts.push('斩弹');
        if (interrupted) ctxParts.push('破势');
        if (hitBody) ctxParts.push('已生效');
        const ctxText = ctxParts.length > 0 ? ctxParts.join(' · ') : '已生效';
        this.technique.recordAttempt(tech, 'effective', `${tech.feedback} · ${ctxText}`, now);
        this.pushPrompt(nowMs + 1600, tech.feedback, 'good');
      } else {
        // 招式未成：失控或气机不继，回退普通剑击语义（不收额外气机、不加倍率）。
        // 同时清除上一剑的「最近识别」陈旧引用，避免 HUD 误报旧招式
        this.technique.clearLast();
        this.technique.recordAttempt(
          tech,
          'failed',
          `${tech.feedback} · 招式未成（${
            speed.tier === 'OUT_OF_CONTROL' ? '剑势失控' : '气机不继'
          }）`,
          now,
        );
        this.pushPrompt(
          nowMs + 1400,
          speed.tier === 'OUT_OF_CONTROL' ? '剑势失控 · 招式未成' : '气机不继 · 招式未成',
          'warn',
        );
      }
    }

    this.qi = Math.max(0, this.qi - qiCost);
    if (strike) {
      strike.qiCost = Math.round(qiCost);
      this.lastStrike = strike;
    }

    // 提示（克制：关键字优先，快准稳仅在身体命中时短暂显示）
    if (slashedCount > 0) this.pushPrompt(nowMs + 1200, '斩弹', 'good');
    if (interrupted) this.pushPrompt(nowMs + 1400, '破势', 'good');
    if (hitBody) {
      if (this.qi < player.qiExhaustedThreshold) {
        this.pushPrompt(nowMs + 1600, '气机不继', 'warn');
      }
      if (strike) {
        this.pushPrompt(
          nowMs + 1800,
          `速 ${strike.speedScore} · 准 ${strike.accuracyScore} · 稳 ${strike.stabilityScore}`,
          'info',
        );
      }
    }
  }

  /** Identity changes invalidate all geometry and receipts; repeating one context is harmless. */
  setPracticeContext(context: PracticeContext | null): void {
    if (JSON.stringify(context) === JSON.stringify(this.practiceContext)) return;
    this.practiceContext = context ? { ...context } : null;
    this.practiceReceipt = null;
    this.techniqueWindow.reset();
    this.detector.reset();
    this.technique.resetRuntime();
  }

  getPracticeReceipt(): PracticeReceipt | null {
    return this.practiceReceipt ? { ...this.practiceReceipt } : null;
  }

  get activeBattleId(): string | null { return this.battleId; }

  private techniqueKey(kind: ConcreteTechniqueKind): 'diagonalSlash' | 'cross' | 'returnWind' {
    return kind === 'DIAGONAL_SLASH' ? 'diagonalSlash' : kind === 'CROSS' ? 'cross' : 'returnWind';
  }

  private bossGeometry(): CombatSnapshot['bossGeometry'] {
    if (!this.boss) return null;
    const b = this.boss;
    const radius = this.config.boss.bodyRadiusRatio;
    return { bodyRadiusRatio: radius, weakPoint: {
      x: b.x, y: b.y,
      radiusRatio: radius * this.config.boss.weakPointRadiusRatio,
      active: b.state === 'ALIVE' && b.phase !== 'TRIAL_SWORD' && b.ranged.state === 'CHARGE'
        && b.ranged.weakPointActive && !b.ranged.chargeInterrupted
        && !(b.phase === 'CHAOS' && b.melee.state !== 'DEAD'),
    } };
  }

  private createAdd(x: number, y: number): Wolf {
    const add = createWolf({ ...this.config.wolf, hpMax: 50 });
    add.x = x; add.y = y;
    return add;
  }

  private updateAdds(now: number, dt: number, width: number): void {
    for (const add of this.adds) {
      updateWolf(add, now, dt, width, this.config.wolf);
      if (!wolfLungeArrived(add, now)) continue;
      add.lungeResolved = true; add.state = 'RECOVER';
      const before = this.guardQi;
      if (this.lastActionState === 'SHEATHED' && this.qi >= this.config.player.blockQiCost) {
        this.qi -= this.config.player.blockQiCost;
        this.pushPrompt(now + 1200, '护剑 · 挡住山狼', 'good');
        if (this.boss) this.bossStats.blocks += 1;
      } else this.guardQi = Math.max(0, this.guardQi - 12);
      if (this.boss) this.bossStats.damageTaken += before - this.guardQi;
      if (this.guardQi <= 0) {
        this.phase = 'lost'; this.projectiles = [];
        if (this.boss) { this.finalizeBossSummary('defeat', now); this.boss.state = 'DEAD'; }
        this.pushPrompt(now + 4000, '剑心破碎', 'warn');
        return;
      }
    }
  }

  /** Skill geometry has its own window, so a consumed body strike cannot erase a cross/arc. */
  private resolveIndependentTechnique(now: number, width: number, height: number, eligibilityQi = this.qi): void {
    const result = this.techniqueWindow.sample(this.technique, width, now);
    const seg = this.techniqueWindow.currentSegment;
    if (!result || !seg || result.kind === 'NONE') return;
    const kind = result.kind;
    const speed = judgeSpeed(seg.avgSpeed * 1000 / width, this.config.speed);
    if (!this.technique.isLearned(kind)) return;
    if (speed.tier === 'OUT_OF_CONTROL' || eligibilityQi < Math.max(this.config.player.qiExhaustedThreshold, result.extraQiCost)) {
      this.technique.clearLast();
      this.technique.recordAttempt(result, 'failed', `${result.feedback} · 招式未成（${speed.tier === 'OUT_OF_CONTROL' ? '剑势失控' : '气机不继'}）`, now);
      return;
    }
    const wind = kind === 'RETURN_WIND';
    const shape = result.fxShape!;
    const windRadius = Math.min(width * 0.22, Math.max(width * 0.09, shape.radius * 1.1));
    const touches = (x: number, y: number, radius: number) => wind
      ? Math.hypot(x - shape.centerX, y - shape.centerY) <= windRadius + radius
      : segmentMinDistToPoint(seg.points, x, y) <= radius;
    const startT = seg.points[0]?.t ?? now;
    const endT = seg.points.at(-1)?.t ?? now;
    const linked = this.recentOrdinaryInteraction &&
      startT <= this.recentOrdinaryInteraction.endT + 80 &&
      endT + 80 >= this.recentOrdinaryInteraction.startT
      ? this.recentOrdinaryInteraction : null;
    let hits = 0;
    let cuts = linked?.projectilesCut ?? 0;
    let interrupts = linked?.interrupted ?? 0;
    let newlyCut = 0;
    let newlyInterrupted = 0;
    const bonus = kind === 'CROSS' ? 44 : wind ? 28 : 24;
    const hitEnemy = (enemy: RangedEnemy, radius: number, isBoss: boolean) => {
      if (!touches(enemy.x * width, enemy.y * height, radius * width)) return false;
      // Cross breaks a charging body; diagonal opens armor through a larger weak-point corridor.
      const weakRadius = radius * (isBoss ? this.config.boss.weakPointRadiusRatio : this.config.ranged.weakPointRadiusRatio) * width;
      if (enemy.state === 'CHARGE' && !enemy.chargeInterrupted && (kind === 'CROSS' ||
          (kind === 'DIAGONAL_SLASH' && enemy.weakPointActive && touches(enemy.x * width, enemy.y * height, weakRadius * 1.7)))) {
        rangedEnemyInterrupt(enemy, now, isBoss ? bossRangedConfig(this.config.boss, this.config.ranged) : this.config.ranged);
        interrupts++; newlyInterrupted++;
        if (isBoss) {
          this.bossStats.weakPointHits += kind === 'DIAGONAL_SLASH' ? 1 : 0;
          if (this.boss!.phase === 'BREAK_STANCE') this.bossRhythm.chargesPhase2++;
          if (this.boss!.phase === 'CHAOS') this.bossRhythm.chaosEvents++;
        }
      }
      return true;
    };
    if (this.boss?.state === 'ALIVE' && touches(this.boss.x * width, this.boss.y * height, this.config.boss.bodyRadiusRatio * width)) {
      const b = this.boss;
      if (this.bossGeometry()!.weakPoint.active || kind === 'CROSS') hitEnemy(b.ranged, this.config.boss.bodyRadiusRatio, true);
      const armoredBonus = kind === 'DIAGONAL_SLASH' ? bonus * 1.6 : bonus;
      const floor = applyHpFloor(Math.max(b.phase === 'TRIAL_SWORD' ? b.hpMax * this.config.boss.phase2HpPct : b.phase === 'BREAK_STANCE' ? b.hpMax * this.config.boss.phase3HpPct : 0, b.hp - armoredBonus), b.hpMax, b.phase === 'TRIAL_SWORD' ? 1 : b.phase === 'BREAK_STANCE' ? 2 : 3, this.bossRhythm, this.config.rhythm);
      bossHit(b, Math.max(0, b.hp - applyTimeFloor(floor, now - this.bossStartedAt, this.config.rhythm)), now);
      hits++;
    } else if (!this.boss) {
      if (this.ranged && !['DEAD', 'DYING'].includes(this.ranged.state) && hitEnemy(this.ranged, this.config.ranged.bodyRadiusRatio, false)) {
        rangedEnemyHit(this.ranged, now, kind === 'DIAGONAL_SLASH' ? bonus * 1.6 : bonus); hits++;
      }
      if (!['DEAD', 'DYING'].includes(this.wolf.state) && touches((this.wolf.x + this.wolf.knockback) * width, this.wolf.y * height, this.config.wolf.bodyRadiusRatio * width)) {
        wolfHit(this.wolf, now, bonus); hits++;
        if (this.wolf.hp <= 0) wolfDie(this.wolf, now, this.config.wolf.dyingMs);
      }
    }
    // Finite small-area sweep: at most three enemy bodies, never global damage.
    for (const add of this.adds) {
      if (hits >= 3 || ['DEAD', 'DYING'].includes(add.state) || !touches((add.x + add.knockback) * width, add.y * height, this.config.wolf.bodyRadiusRatio * width)) continue;
      wolfHit(add, now, bonus); hits++;
      if (add.hp <= 0) wolfDie(add, now, this.config.wolf.dyingMs);
    }
    if (wind) this.projectiles = this.projectiles.filter((p) => {
      if (cuts >= 3 || !touches(p.x * width, p.y * height, this.config.projectile.radiusRatio * width)) return true;
      slashProjectile(p, now); this.projectileFx.push(p); cuts++; newlyCut++; return false;
    });
    if (!hits && !cuts && !interrupts) {
      this.technique.recordAttempt(result, 'miss', `${result.feedback} · 已识别，未命中`, now);
      this.techniqueWindow.retrySample(kind);
      return;
    }
    this.technique.commit(result, now);
    this.technique.pushFx(kind, shape, now);
    this.qi = Math.max(0, this.qi - result.extraQiCost);
    const effect = wind ? `回风式 · 扫中${hits}敌 · 斩弹${cuts}` : kind === 'CROSS' ? `十字剑 · ${interrupts ? '打断蓄力' : '双笔爆发'}${cuts ? ` · 斩弹${cuts}` : ''}` : `斜劈 · ${interrupts ? '弱点破势' : cuts ? '斩弹' : '破甲增伤'}`;
    this.technique.recordAttempt(result, 'effective', effect, now);
    this.pushPrompt(now + 1800, effect, 'good');
    if (this.lastStrike) this.lastStrike.technique = result.feedback;
    if (this.boss) {
      this.bossTechniqueUsage[this.techniqueKey(kind)]++;
      this.bossStats.projectilesCut += newlyCut;
      this.bossStats.interrupts += newlyInterrupted;
      this.bossStats.breakStanceCount += newlyInterrupted;
      if (this.boss.phase === 'CHAOS') {
        this.bossRhythm.chaosTechniqueHits += hits + cuts > 0 ? 1 : 0;
        if (newlyCut) { this.bossRhythm.chaosEvents++; this.bossRhythm.chaosProjectilesFired += newlyCut; }
      }
      if (this.boss.hp <= 0) { bossDie(this.boss, now); this.projectiles = []; this.adds = []; }
    }
  }

  private pushPrompt(until: number, text: string, kind: CombatPrompt['kind']): void {
    this.prompts.push({ id: ++this.promptSeq, text, kind, until });
    if (this.prompts.length > MAX_PROMPTS) this.prompts.shift();
  }

  private prunePrompts(nowMs: number): void {
    this.prompts = this.prompts.filter((p) => p.until > nowMs);
  }

  private pruneProjectileFx(nowMs: number): void {
    this.projectileFx = this.projectileFx.filter((p) => nowMs - p.resolvedAt < PROJECTILE_FX_MS);
  }

  getSnapshot(): CombatSnapshot {
    return {
      phase: this.phase,
      qi: this.qi,
      qiMax: this.config.player.qiMax,
      guardQi: this.guardQi,
      guardQiMax: this.config.player.guardQiMax,
      wolf: this.wolf,
      wolfX: this.wolf.x + this.wolf.knockback,
      lastStrike: this.lastStrike,
      prompts: [...this.prompts],
      exhausted: this.qi < this.config.player.qiExhaustedThreshold,
      sheathed: this.lastActionState === 'SHEATHED',
      rangedEnemy: this.ranged,
      projectiles: [...this.projectiles],
      projectileFx: [...this.projectileFx],
      technique: {
        learned: { ...this.technique.learned },
        last: this.technique.getLast(),
        attempt: this.technique.getAttempt(this.lastUpdateMs ?? 0),
        practiceAttempt: this.technique.getPracticeAttempt(this.lastUpdateMs ?? 0),
      },
      techniqueFx: [...this.technique.getActiveFx(this.lastUpdateMs ?? 0)],
      choiceGate: this.choiceGate,
      boss: this.boss,
      bossGeometry: this.bossGeometry(),
      adds: [...this.adds],
      practice: this.practiceContext ? { ...this.practiceContext } : null,
      encounter:
        this.boss !== null && this.battleId !== null
          ? { encounterId: BOSS_ENCOUNTER_ID, battleId: this.battleId }
          : null,
    };
  }

  /** 诊断：剑气视觉强度（气机不继时明显变弱） */
  get qiIntensity(): number {
    return this.qi < this.config.player.qiExhaustedThreshold ? 0.35 : 1;
  }

  /** 当前战斗阶段（App 渲染循环判定是否推进 update） */
  get currentPhase(): CombatPhase {
    return this.phase;
  }

  /** choice gate 是否激活（App 输入帧路由用：选择期间的帧不进 detector） */
  get choiceGateActive(): boolean {
    return this.choiceGate;
  }

  /** 供测试与舞台渲染读取当前狼 px 坐标（不用于逻辑判定） */
  wolfScreenPos(stageW: number, stageH: number): { x: number; y: number } {
    return {
      x: this.wolf.x * stageW + wolfKnockbackPx(this.wolf, stageW),
      y: this.wolf.y * stageH,
    };
  }

  reset(nowMs: number): void {
    this.adds = [];
    this.addHitIds.clear();
    this.setPracticeContext(null);
    this.techniqueWindow.reset();
    this.choiceGate = false;
    this.choiceGateSince = null;
    this.phase = 'idle';
    this.qi = this.config.player.qiMax;
    this.guardQi = this.config.player.guardQiMax;
    this.wolf = createWolf(this.config.wolf);
    this.detector.reset();
    this.wolfHitLock = false;
    this.enemyHitLock = false;
    this.lastStrike = null;
    this.prompts = [];
    this.ranged = null;
    this.wolfDeadAt = null;
    this.projectiles = [];
    this.projectileFx = [];
    this.technique.resetRuntime();
    this.lastUpdateMs = nowMs;
    this.clearBossRuntime();
  }

  // =====================================================================
  // 第九阶段：赤瞳山魈 encounter（第一章综合终局 Boss）
  // =====================================================================

  /** 清 Boss encounter 运行时（start/reset/新一场 startBoss 共用；不动人生状态） */
  private clearBossRuntime(): void {
    this.boss = null;
    this.battleId = null;
    this.bossSummary = null;
    this.bossHitLock = false;
    this.bossResolved = false;
    this.bossRhythm = emptyBossRhythmState();
    this.bossStartedAt = 0;
    this.bossStats = {
      slashCount: 0,
      projectilesCut: 0,
      blocks: 0,
      interrupts: 0,
      breakStanceCount: 0,
      weakPointHits: 0,
      qiDepletedCount: 0,
      damageTaken: 0,
      overspeedCount: 0,
      speedSum: 0,
      accuracySum: 0,
      stabilitySum: 0,
      strikeCount: 0,
    };
    this.bossTechniqueUsage = { diagonalSlash: 0, cross: 0, returnWind: 0 };
  }

  /**
   * 开始/重新挑战赤瞳山魈（每次挑战唯一 battleId；只重置本 encounter 的战斗运行时，
   * 不重置人生/身份/选择/命簿）。三阶段：试剑（近身扑击）→ 破势（蓄力弱点+妖气弹）→ 乱战（组合）。
   */
  startBoss(nowMs: number, context?: BattleContext): void {
    this.setPracticeContext(null);
    this.techniqueWindow.reset();
    this.adds = [];
    this.addHitIds.clear();
    this.battleContext = context ? { ...context } : null;
    const cfg = this.config.boss;
    this.clearBossRuntime();
    this.phase = 'fighting';
    this.qi = this.config.player.qiMax;
    this.guardQi = this.config.player.guardQiMax;
    this.boss = createBoss(cfg, this.config.ranged, nowMs);
    this.battleId = newBattleId();
    this.bossStartedAt = nowMs;
    this.detector.reset();
    this.lastActionState = 'IDLE';
    this.lastStrike = null;
    this.prompts = [];
    this.ranged = null;
    this.wolfDeadAt = null;
    this.projectiles = [];
    this.projectileFx = [];
    this.technique.resetRuntime();
    this.lastUpdateMs = nowMs;
    this.choiceGate = false;
    this.choiceGateSince = null;
    this.pushPrompt(nowMs + 2200, '赤瞳山魈 · 试剑', 'warn');
  }

  /** 当前是否处于 Boss encounter 模式（App 判定胜负回调与 HUD 渲染用） */
  get bossActive(): boolean {
    return this.boss !== null && this.phase === 'fighting';
  }

  /** 机缘练习成招（App 在练习窗口验证成功后调用；战斗提交不自动领悟） */
  setLearnedTechnique(kind: ConcreteTechniqueKind): void {
    this.technique.setLearned(kind);
  }

  /** 批量同步领悟状态（恢复存档/切局；只增不减） */
  syncLearnedTechniques(learned: { diagonalSlash?: boolean; cross?: boolean; returnWind?: boolean }): void {
    this.technique.syncLearned(learned);
  }

  replaceLearnedTechniques(learned: { diagonalSlash: boolean; cross: boolean; returnWind: boolean }): void {
    this.technique.replaceLearned(learned);
  }

  /** 已定格的 BattleSummary（未定格返回 null；定格后统计冻结，不随 update 变化） */
  getBattleSummary(): BattleSummary | null {
    return this.bossSummary;
  }

  /** 定格 BattleSummary（胜负唯一一次） */
  private finalizeBossSummary(result: 'victory' | 'defeat', nowMs: number): void {
    if (this.bossResolved || !this.boss || !this.battleId) return;
    this.bossResolved = true;
    const n = Math.max(1, this.bossStats.strikeCount);
    this.bossSummary = {
      ...this.battleContext,
      encounterId: BOSS_ENCOUNTER_ID,
      battleId: this.battleId,
      result,
      duration: Math.max(0, nowMs - this.bossStartedAt),
      slashCount: this.bossStats.slashCount,
      techniqueUsage: (['diagonalSlash', 'cross', 'returnWind'] as const)
        .filter((k) => this.bossTechniqueUsage[k] > 0)
        .map((k) => ({ kind: k, count: this.bossTechniqueUsage[k] })),
      projectilesCut: this.bossStats.projectilesCut,
      blocks: this.bossStats.blocks,
      interrupts: this.bossStats.interrupts,
      breakStanceCount: this.bossStats.breakStanceCount,
      averageSpeed: Math.round((this.bossStats.speedSum / n) * 100) / 100,
      accuracyScore: Math.round(this.bossStats.accuracySum / n),
      stabilityScore: Math.round(this.bossStats.stabilitySum / n),
      weakPointHits: this.bossStats.weakPointHits,
      qiDepletedCount: this.bossStats.qiDepletedCount,
      damageTaken: this.bossStats.damageTaken,
      overspeedCount: this.bossStats.overspeedCount,
    };
    this.bossSummary.techniqueUsage.forEach(Object.freeze);
    Object.freeze(this.bossSummary.techniqueUsage);
    Object.freeze(this.bossSummary);
  }

  /** Boss 战内扑击结算（复用 resolveLunge 的格挡/破防语义，伤害走 Boss 配置） */
  private resolveBossLunge(nowMs: number): void {
    const { player } = this.config;
    const cfg = this.config.boss;
    const b = this.boss!;
    b.melee.lungeResolved = true;
    const guardBefore = this.guardQi;
    // 节奏门：扑击真实到达玩家近旁（含格挡语义）才计数——一次完整扑击窗口
    if (this.lastActionState === 'SHEATHED') {
      if (this.qi >= player.blockQiCost) {
        this.qi -= player.blockQiCost;
        this.guardQi = Math.max(0, this.guardQi - player.blockChipDamage);
        this.bossStats.blocks += 1;
        if (b.phase === 'TRIAL_SWORD') this.bossRhythm.lungesPhase1 += 1;
        if (b.phase === 'CHAOS') this.bossRhythm.chaosEvents += 1;
        this.pushPrompt(nowMs + 1200, '护剑', 'good');
      } else {
        this.qi = 0;
        this.guardQi = Math.max(0, this.guardQi - cfg.blockBreakDamage);

        this.pushPrompt(nowMs + 1500, '护剑被破', 'warn');
      }
    } else {
      this.guardQi = Math.max(0, this.guardQi - cfg.lungeDamage);

      this.pushPrompt(nowMs + 1200, '受创', 'warn');
    }
    this.bossStats.damageTaken += guardBefore - this.guardQi;
    if (this.guardQi <= 0) {
      this.phase = 'lost';
      this.projectiles = [];
      this.pushPrompt(nowMs + 4000, '剑心破碎', 'warn');
      this.finalizeBossSummary('defeat', nowMs);
      if (b.state !== 'DEAD') {
        // 玩家败：山魈收势（不再攻击），等待「重新试炼」
        b.state = 'DEAD';
        b.melee.state = 'DEAD';
        b.ranged.state = 'DEAD';
      }
    } else {
      b.melee.state = 'RECOVER';
    }
  }

  /** encounter 模式主推进（update 内分发；Boss 死亡后停止全部攻击/投射物/循环） */
  private updateBoss(nowMs: number, dtMs: number, stageW: number, stageH: number): void {
    const cfg = this.config.boss;
    const b = this.boss!;
    if (this.phase !== 'fighting') return;

    // 死亡反馈推进（DYING → DEAD；定格胜利 Summary 一次）
    const st: Boss['state'] = b.state; // 局部快照：updateBossDying 原地推进，TS 不感知
    if (st === 'DEAD') return; // 防御：DEAD 后不再推进任何 Boss 逻辑
    if (st === 'DYING') {
      updateBossDying(b, nowMs);
      if (b.state === 'DEAD') {
        this.projectiles = []; // 死亡清弹：不残留攻击
        this.phase = 'won';
        this.pushPrompt(nowMs + 2500, '山魈伏诛 · 试炼通过', 'good');
        this.finalizeBossSummary('victory', nowMs);
      }
      return;
    }

    this.updateAdds(nowMs, dtMs, stageW);
    if (this.phase !== 'fighting') return;

    // 收势回气（同普通战斗语义）
    if (this.lastActionState === 'SHEATHED') {
      this.qi = Math.min(
        this.config.player.qiMax,
        this.qi + (this.config.player.qiRegenPerSec * dtMs) / 1000,
      );
    }

    // —— 阶段驱动（HP 百分比阈值 + 节奏门；只前进不后退）——
    // 第九阶段收口：节奏门未满足时 HP 不会降到下一阶段阈值以下（applyHpFloor），
    // 因此 bossPhaseForHp 与布尔门在这里天然一致；此处再显式加布尔门防御。
    const nextPhase = bossPhaseForHp(b.hp, b.hpMax, cfg);
    if (nextPhase !== b.phase) {
      const gateOk =
        nextPhase === 'BREAK_STANCE'
          ? canEnterBreakStance(this.bossRhythm, this.config.rhythm)
          : nextPhase === 'CHAOS'
            ? canEnterChaos(this.bossRhythm, this.config.rhythm)
            : true;
      if (gateOk) {
        b.phase = nextPhase;
        b.phaseSince = nowMs;
        if (nextPhase === 'BREAK_STANCE') {
          // 破势：拉开距离，进入蓄力循环
          b.melee.state = 'RECOVER';
          b.ranged.state = 'ENTER';
          b.ranged.chargeInterrupted = false;
          b.ranged.chargeFired = false;
          this.pushPrompt(nowMs + 2000, '山魈退开蓄力 · 破其势', 'warn');
        } else if (nextPhase === 'CHAOS') {
          // 乱战：扑击 + 妖气弹交替（有限上限）
          b.melee.state = 'DEAD';
          this.adds = [this.createAdd(0.68, 0.60), this.createAdd(0.82, 0.73)];
          b.ranged.state = 'RECOVER';
          b.ranged.recoverFrom = nowMs;
          b.lastChaosLungeAt = nowMs;
          this.pushPrompt(nowMs + 2000, '妖气乱走 · 三式剑招正其时', 'warn');
        }
      }
      // 节奏门未满足：维持当前阶段（HP 已被 applyHpFloor 托在阈值之上）
    }

    // —— 试剑阶段：复用 wolf 近身状态机 ——
    if (b.phase === 'TRIAL_SWORD') {
      const meleeCfg = bossWolfConfig(cfg);
      updateWolf(b.melee, nowMs, dtMs, stageW, meleeCfg);
      b.x = b.melee.x;
      b.y = b.melee.y;
      if (wolfLungeArrived(b.melee, nowMs)) {
        this.resolveBossLunge(nowMs);
        if (this.phase !== 'fighting') return;
      }
    } else {
      // —— 破势/乱战阶段：复用 ranged 蓄力状态机（位置同步）——
      const rangedCfg = bossRangedConfig(cfg, this.config.ranged);
      const canCharge = b.phase === 'BREAK_STANCE'
        ? this.projectiles.length === 0
        : this.projectiles.length < cfg.chaosProjectileCap;
      // 破势阶段固定远侧；乱战阶段允许游走（持位 + 轻微上下漂移由 ranged 自身 y 保持）
      const meleeBusy = b.phase === 'CHAOS' && b.melee.state !== 'DEAD';
      if (!meleeBusy) updateRangedEnemy(b.ranged, nowMs, dtMs, rangedCfg, canCharge);
      b.ranged.x = b.phase === 'BREAK_STANCE' ? cfg.rangeHoldX : Math.min(cfg.rangeHoldX, b.ranged.x);
      b.x = b.ranged.x;
      b.y = b.ranged.y;
      b.weakPointActive = b.ranged.weakPointActive;

      // FIRE：发射妖气弹（只一次；乱战阶段受上限约束）
      const e = b.ranged;
      if (e.state === 'FIRE' && !e.chargeFired) {
        markFired(e, nowMs);
        // 节奏门：一次完整蓄力循环（无论发射或被破势都算「破势阶段被看见」）

        if (this.projectiles.length < (b.phase === 'CHAOS' ? cfg.chaosProjectileCap : 1)) {
          this.projectiles.push(
            createProjectile(
              e.x,
              e.y,
              this.config.wolf.lungeTargetX,
              this.config.wolf.lungeTargetY,
              nowMs,
              this.config.projectile,
            ),
          );
          this.pushPrompt(nowMs + 1400, '重击释放', 'warn');
        }
        toRecover(e, nowMs);
      }

      // —— 乱战阶段：扑击循环（间隔可调；不与蓄力同时进行）——
      if (
        b.phase === 'CHAOS' &&
        b.ranged.state === 'RECOVER' && b.melee.state === 'DEAD' &&
        nowMs >= b.lastChaosLungeAt + cfg.chaosLungeGapMs
      ) {
        b.lastChaosLungeAt = nowMs;
        b.melee.state = 'APPROACH';
        b.melee.x = b.x;
        b.melee.y = b.y;
        b.melee.lungeResolved = false;
      }
      if (b.phase === 'CHAOS' && b.melee.state !== 'DEAD') {
        const meleeCfg = bossWolfConfig(cfg);
        updateWolf(b.melee, nowMs, dtMs, stageW, meleeCfg);
        b.x = b.melee.x; b.y = b.melee.y;
        b.ranged.x = b.x; b.ranged.y = b.y;
        b.weakPointActive = false;
        if (b.melee.state === 'APPROACH' && b.melee.x >= cfg.spawnX - 0.02) b.melee.state = 'DEAD';
        if (wolfLungeArrived(b.melee, nowMs)) {
          this.resolveBossLunge(nowMs);
          if (this.phase !== 'fighting') return;
          // 扑击完成退回右侧等待下一轮
          b.melee.state = 'RECOVER';
        }
      }
    }

    // —— 妖气弹推进（同普通战斗；命中玩家扣护体真气）——
    this.projectiles = this.projectiles.filter((p) => {
      const alive = updateProjectile(p, dtMs, nowMs);
      if (!alive) return false;
      if (
        projectileReachedPlayer(
          p,
          this.config.wolf.lungeTargetX,
          this.config.wolf.lungeTargetY,
          this.config.projectile.playerHitRadiusRatio,
        )
      ) {
        resolveProjectileHit(p, nowMs);
        this.projectileFx.push(p);
        const guardBefore = this.guardQi;
        this.guardQi = Math.max(0, this.guardQi - (p.damage * cfg.projectileDamage) / this.config.projectile.damage);
        this.bossStats.damageTaken += guardBefore - this.guardQi;
        this.pushPrompt(nowMs + 1500, '妖气入体', 'warn');
        if (this.guardQi <= 0) {
          this.phase = 'lost';
          this.projectiles = [];
          this.pushPrompt(nowMs + 4000, '剑心破碎', 'warn');
          this.finalizeBossSummary('defeat', nowMs);
          if (b.state !== 'DEAD') {
            b.state = 'DEAD';
            b.melee.state = 'DEAD';
            b.ranged.state = 'DEAD';
          }
        }
        return false;
      }
      return true;
    });
    if (this.phase !== 'fighting') { this.projectiles = []; return; }

    // 段停顿检查 + 斩击结算
    this.detector.tickIdle(nowMs);
    if (b.state === 'ALIVE') {
      const techniqueQi = this.qi;
      this.tryResolveBossStrike(nowMs, stageW, stageH);
      if (b.state === 'ALIVE') this.resolveIndependentTechnique(nowMs, stageW, stageH, techniqueQi);
    }
  }

  /** encounter 模式斩击结算（体内锁/斩弹/弱点破势/身体命中，语义与普通战斗一致） */
  private tryResolveBossStrike(nowMs: number, stageW: number, stageH: number): void {
    const { player, ranged: rangedCfg, projectile: projCfg } = this.config;
    const cfg = this.config.boss;
    const b = this.boss!;
    const tip = this.detector.lastPoint;
    if (!tip) return;

    const bossAlive = b.state === 'ALIVE';
    // 体内锁（同狼/远程敌人语义）
    if (this.bossHitLock) {
      if (!bossAlive) {
        this.bossHitLock = false;
      } else {
        const bx = b.x * stageW;
        const by = b.y * stageH;
        const bodyR = cfg.bodyRadiusRatio * stageW;
        if (Math.hypot(tip.x - bx, tip.y - by) > bodyR * 1.18) {
          this.bossHitLock = false;
          this.detector.closeSegment();
        }
      }
    }

    const seg = this.detector.tryStrike();
    if (!seg) return;
    const now = nowMs;

    const vNorm = (seg.avgSpeed * 1000) / stageW;
    const pathRatio = seg.pathLen / stageW;
    const speed = judgeSpeed(vNorm, this.config.speed);
    const qiLow = this.qi < player.qiExhaustedThreshold;
    const tech = ({ kind: 'NONE', recognized: false, segmentId: seg.id, recognizedAt: 0, confidence: 0, extraQiCost: 0, damageMultiplier: 1, feedback: '', fxShape: null } as TechniqueResult);
    const techEffective =
      tech.recognized &&
      speed.tier !== 'OUT_OF_CONTROL' &&
      !qiLow &&
      this.technique.isLearned(tech.kind as ConcreteTechniqueKind);
    const techMul = techEffective ? tech.damageMultiplier : 1;

    let hitAnything = false;
    let hitBody = false;
    let slashedCount = 0;
    let interrupted = false;
    let strike: StrikeResult | null = null;
    for (const add of this.adds) {
      if (add.state === 'DEAD' || add.state === 'DYING' || this.addHitIds.get(add) === seg.id) continue;
      if (segmentMinDistToPoint(seg.points, (add.x + add.knockback) * stageW, add.y * stageH) <= this.config.wolf.bodyRadiusRatio * stageW) {
        this.addHitIds.set(add, seg.id);
        wolfHit(add, nowMs, Math.round(computeDamage(speed.speedFactor, 1, 1, this.config, qiLow)));
        if (add.hp <= 0) wolfDie(add, nowMs, this.config.wolf.dyingMs);
        hitAnything = true; hitBody = true;
      }
    }

    // —— 1) 妖气弹：整段轨迹碰撞，斩碎一次性移出（Boss 死亡后 projectiles 已清）——
    if (this.projectiles.length > 0) {
      const remaining: Projectile[] = [];
      for (const p of this.projectiles) {
        if (segmentHitsProjectile(seg.points, p, stageW, stageH)) {
          slashProjectile(p, nowMs);
          this.projectileFx.push(p);
          slashedCount++;
          hitAnything = true;
        } else {
          remaining.push(p);
        }
      }
      this.projectiles = remaining;
    }

    // —— 2) 弱点破势（破势/乱战蓄力期）：精准命中核心 → INTERRUPTED + 短硬直 ——
    const rangedView = b.ranged;
    const weakActive =
      (b.phase === 'BREAK_STANCE' || b.phase === 'CHAOS') &&
      rangedView.state === 'CHARGE' &&
      this.bossGeometry()!.weakPoint.active &&
      !rangedView.chargeInterrupted;
    if (weakActive) {
      const weak = this.bossGeometry()!.weakPoint;
      const ecx = weak.x * stageW;
      const ecy = weak.y * stageH;
      const weakR = weak.radiusRatio * stageW;
      const minDist = segmentMinDistToPoint(seg.points, ecx, ecy);
      if (minDist <= weakR) {
        const weakScore = Math.round(Math.max(0, 100 - 60 * (minDist / weakR)));
        if (weakScore >= cfg.weakPointAccuracyThreshold) {
          rangedEnemyInterrupt(rangedView, nowMs, bossRangedConfig(cfg, rangedCfg));
          interrupted = true;
          hitAnything = true;
          this.bossStats.weakPointHits += 1;
          // 节奏门：弱点打断也算一次「蓄力被看见」（玩家选择承担风险换取更优解）
          this.bossRhythm.chargesPhase2 += 1;
          if (b.phase === 'CHAOS') this.bossRhythm.chaosEvents += 1;
        }
      }
    }

    // —— 3) Boss 身体命中（普通伤害；不打断蓄力——身体攻击不能直接取消蓄力）——
    if (bossAlive && !this.bossHitLock) {
      const bx = b.x * stageW;
      const by = b.y * stageH;
      const bodyR = cfg.bodyRadiusRatio * stageW;
      const minDist = segmentMinDistToPoint(seg.points, bx, by);
      if (minDist <= bodyR * 1.05) {
        this.bossHitLock = true;
        hitBody = true;
        hitAnything = true;
        const accuracy = judgeAccuracy(minDist, bodyR, this.config);
        const stability = judgeStability(
          seg.straightDist / Math.max(1, seg.pathLen),
          this.config,
          speed.tier === 'OUT_OF_CONTROL' ? 0.75 : 1,
        );
        const exhausted = qiLow;
        const damage = Math.round(
          computeDamage(
            speed.speedFactor,
            accuracy.accuracyFactor,
            stability.stabilityFactor,
            this.config,
            exhausted,
          ) * techMul,
        );
        // 节奏门：HP 地板（机制未满足时吸收速攻伤害）+ 时长下限（不磨血，只挡速杀）
        const phaseNum: 1 | 2 | 3 =
          b.phase === 'TRIAL_SWORD' ? 1 : b.phase === 'BREAK_STANCE' ? 2 : 3;
        const flooredHp = applyHpFloor(
          Math.max(b.phase === 'TRIAL_SWORD' ? b.hpMax * cfg.phase2HpPct : b.phase === 'BREAK_STANCE' ? b.hpMax * cfg.phase3HpPct : 0, b.hp - damage),
          b.hpMax,
          phaseNum,
          this.bossRhythm,
          this.config.rhythm,
        );
        const finalHp = applyTimeFloor(flooredHp, nowMs - this.bossStartedAt, this.config.rhythm);
        bossHit(b, Math.max(0, b.hp - finalHp), nowMs);
        strike = {
          tier: speed.tier,
          speedScore: Math.round(speed.speedScore),
          accuracyScore: accuracy.accuracyScore,
          stabilityScore: stability.stabilityScore,
          damage,
          exhausted,
          qiCost: 0,
          technique: '',
        };
        // 真实统计汇总（快准稳口径与普通战斗完全一致）
        this.bossStats.slashCount += 1;
        this.bossStats.speedSum += vNorm;
        this.bossStats.accuracySum += accuracy.accuracyScore;
        this.bossStats.stabilitySum += stability.stabilityScore;
        this.bossStats.strikeCount += 1;
        if (speed.tier === 'OUT_OF_CONTROL') this.bossStats.overspeedCount += 1;
        // 死亡：定格 + 停止全部攻击（弱点击中恰好致死也走这里）
        if (b.hp <= 0) {
          bossDie(b, nowMs);
          this.projectiles = []; this.adds = [];
        }
      }
    }

    if (!hitAnything) {
      if (tech.recognized) {
        const first = this.technique.recordAttempt(
          tech,
          'miss',
          `${tech.feedback} · 已识别，未命中`,
          now,
        );
        if (first) {
          if (tech.fxShape) {
            this.technique.pushFx(tech.kind as ConcreteTechniqueKind, tech.fxShape, now, true);
          }
          this.pushPrompt(nowMs + 1500, `${tech.feedback} · 未命中`, 'info');
        }
      }
      return;
    }

    this.detector.markConsumed();

    // —— 气机消耗（同普通战斗口径）——
    let qiCost = 0;
    if (hitBody) {
      qiCost += Math.min(
        player.slashQiCostMax,
        player.slashQiCostBase + pathRatio * player.slashQiCostPerPathRatio,
      );
      if (speed.tier === 'OUT_OF_CONTROL') {
        qiCost += player.outOfControlExtraQiCost;
        this.pushPrompt(nowMs + 1400, '剑势失控', 'warn');
      }
      if (qiLow) this.bossStats.qiDepletedCount += 1;
    }
    if (slashedCount > 0) qiCost += projCfg.slashCost * slashedCount;
    if (interrupted) qiCost += projCfg.interruptCost;

    if (slashedCount > 0 || interrupted) {
      this.recentOrdinaryInteraction = {
        startT: seg.points[0]?.t ?? nowMs,
        endT: seg.points.at(-1)?.t ?? nowMs,
        projectilesCut: slashedCount,
        interrupted: interrupted ? 1 : 0,
      };
    }

    // —— 招式提交（生效才计数：techniqueUsage 只记真实生效的招式）——
    if (tech.recognized) {
      if (techEffective) {
        this.technique.commit(tech, now);
        this.bossTechniqueUsage[this.techniqueKey(tech.kind as ConcreteTechniqueKind)] += 1;
        if (tech.fxShape) {
          this.technique.pushFx(tech.kind as ConcreteTechniqueKind, tech.fxShape, now);
        }
        qiCost += tech.extraQiCost;
        if (strike) strike.technique = tech.feedback;
        const ctxParts: string[] = [];
        if (slashedCount > 0) ctxParts.push('斩弹');
        if (interrupted) ctxParts.push('破势');
        if (hitBody) ctxParts.push('已生效');
        const ctxText = ctxParts.length > 0 ? ctxParts.join(' · ') : '已生效';
        this.technique.recordAttempt(tech, 'effective', `${tech.feedback} · ${ctxText}`, now);
        this.pushPrompt(nowMs + 1600, tech.feedback, 'good');
        if (interrupted) this.bossStats.breakStanceCount += 1;
      } else {
        this.technique.clearLast();
        this.technique.recordAttempt(
          tech,
          'failed',
          `${tech.feedback} · 招式未成（${
            speed.tier === 'OUT_OF_CONTROL' ? '剑势失控' : '气机不继'
          }）`,
          now,
        );
        this.pushPrompt(
          nowMs + 1400,
          speed.tier === 'OUT_OF_CONTROL' ? '剑势失控 · 招式未成' : '气机不继 · 招式未成',
          'warn',
        );
      }
    }

    if (interrupted) this.bossStats.interrupts += 1;
    if (slashedCount > 0) {
      this.bossStats.projectilesCut += slashedCount;
      if (b.phase === 'CHAOS') { this.bossRhythm.chaosEvents += 1; this.bossRhythm.chaosProjectilesFired += slashedCount; }
    }

    this.qi = Math.max(0, this.qi - qiCost);
    if (strike) {
      strike.qiCost = Math.round(qiCost);
      this.lastStrike = strike;
    }

    if (slashedCount > 0) this.pushPrompt(nowMs + 1200, '斩弹', 'good');
    if (interrupted) this.pushPrompt(nowMs + 1400, '破势', 'good');
    if (hitBody) {
      if (this.qi < player.qiExhaustedThreshold) {
        this.pushPrompt(nowMs + 1600, '气机不继', 'warn');
      }
      if (strike) {
        this.pushPrompt(
          nowMs + 1800,
          `速 ${strike.speedScore} · 准 ${strike.accuracyScore} · 稳 ${strike.stabilityScore}`,
          'info',
        );
      }
    }
  }
}
