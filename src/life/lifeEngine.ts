/**
 * 第五阶段 LifeEngine：人生开局与第一章的纯状态机。
 * 只做状态转移与旗标记账，不接触输入/渲染/战斗内部；
 * 所有事件与选项均来自固定世界配置（lifeConfig），经确定性导演分发。
 *
 * 第九阶段收口（事件契约）：
 * - 流程固定：性别 → 身份 → SENSING_GATE（剑意感应）→ TRIAL_GATE（基础御剑试炼）
 *   → 第一剑·择意 → 同行者 → 第二剑·定命 → TECHNIQUE_GATE（三式机缘逐一获得）
 *   → BOSS_GATE（赤瞳山魈）→ Boss Victory → BattleSummary → 程序剑道初相 + 练气一层
 *   → 剑道初相叙事 → CHAPTER_RESULT → JOURNEY_GATE。
 * - 选择事件状态机：NARRATIVE_PENDING（正文未落定：选项与确认剑全部锁定）
 *   → CHOICE_READY（落定后可选可确认）→ CHOICE_COMMITTED（确认剑落下，不可反悔）
 *   → EVENT_FINALIZED（事件关闭）。刷新恢复 COMMITTED 态，不重置已确认选择。
 * - Boss 胜利的确定性结果（摘要/剑道初相/练气一层/命簿）同帧完成、不等 AI；
 *   只有剑道初相正文等待 AI/固定导演，AI 成败均不回滚规则状态。
 */
import {
  CHOICE_CONFIRM_MIN_PATH_RATIO,
  COMPANION,
  INTENT_OPTIONS,
  FATE_OPTIONS,
  LIFE_CONSTITUTIONS,
  LIFE_ORIGINS,
  LIFE_SURNAMES,
  LIFE_MALE_NAMES,
  LIFE_FEMALE_NAMES,
  LIFE_SCHEMA_VERSION,
  TECHNIQUE_OPPORTUNITIES,
  deriveTechniqueOrder,
  defaultRequiredSuccesses,
  emptyPracticeCounts,
  emptyPracticeEventIds,
  emptyTechniqueStages,
} from './lifeConfig';
import type {
  ActiveLifeEvent,
  EventIdentity,
  Gender,
  LifeState,
  TechniqueKindId,
} from './lifeTypes';
import { resolveSwordArchetype, summaryToArchetypeInput, type SwordArchetype } from './swordArchetype';
import type { BattleSummary } from '@/combat/combatEngine';
import {
  appendChapterEntry,
  currentRunId,
  emptyLedger,
  type ChapterHistoryEntry,
} from './lifeLedger';

/** 确认剑判定：仅统一 ACTIVE 帧的足够位移可确认（SHEATHED/IDLE/短移绝不确认） */
export function isConfirmStroke(actionState: string, pathLen: number, stageW: number): boolean {
  if (actionState !== 'ACTIVE') return false;
  return pathLen >= CHOICE_CONFIRM_MIN_PATH_RATIO * stageW;
}

/** 内部熵源（仅用于新局 seed；同一局内生成完全由 seed 决定，可复现） */
function entropySeed(): number {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') {
    const buf = new Uint32Array(1);
    c.getRandomValues(buf);
    return buf[0] >>> 0;
  }
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

/** 稳定实例 id（熵源；不可预测但不依赖时间递增） */
function instanceId(prefix: string): string {
  return `${prefix}-${entropySeed().toString(36)}`;
}

/** 初始人生状态（所有字段稳定初始值；seed 带熵，同一局内不漂移） */
export function createInitialLifeState(nowMs = 0): LifeState {
  const seed = entropySeed();
  return {
    schemaVersion: LIFE_SCHEMA_VERSION,
    phase: 'PROFILE_GENDER',
    lifeId: instanceId('life'),
    chapterInstanceId: instanceId('ch'),
    activeEvent: null,
    pendingGender: null,
    profile: null,
    seed,
    chapterIndex: 0,
    eventIndex: 0,
    choiceStage: 'intent',
    pendingChoiceId: null,
    chosen: { intent: null, fate: null },
    flags: {},
    companionState: { met: false, response: null, flag: null, skipped: false },
    techniques: {
      order: [],
      learned: [],
      stages: emptyTechniqueStages(),
      successfulPracticeCount: emptyPracticeCounts(),
      requiredSuccesses: defaultRequiredSuccesses(),
      practiceEventIds: emptyPracticeEventIds(),
    },
    realm: '剑道初相',
    replayCount: 0,
    ledger: emptyLedger(seed, nowMs),
    swordArchetype: null,
    lastBattleSummary: null,
    updatedAt: nowMs,
  };
}

/** LCG：可复现伪随机（同一 seed 结果稳定） */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return s / 4294967296;
  };
}

/** 由 seed + 性别确定性生成本局身份 */
function generateProfile(seed: number, gender: Gender): NonNullable<LifeState['profile']> {
  const rnd = lcg(seed);
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length) % arr.length];
  const surname = pick(LIFE_SURNAMES);
  const given = pick(gender === 'male' ? LIFE_MALE_NAMES : LIFE_FEMALE_NAMES);
  const origin = pick(LIFE_ORIGINS);
  const constitution = pick(LIFE_CONSTITUTIONS);
  return {
    gender,
    name: `${surname}${given}`,
    originId: origin.id,
    constitutionId: constitution.id,
    bornSeed: seed,
  };
}

/** 体质查找 */
export function findConstitution(id: string | undefined): Constitutionish | undefined {
  return LIFE_CONSTITUTIONS.find((c) => c.id === id);
}
type Constitutionish = (typeof LIFE_CONSTITUTIONS)[number];

/** 事件状态机辅助：开启一个新事件实例（生成 eventInstanceId + requestId） */
function openEvent(
  state: LifeState,
  eventDefinitionId: string,
  phase: ActiveLifeEvent['phase'],
  nowMs: number,
): ActiveLifeEvent {
  const ev: ActiveLifeEvent = {
    eventDefinitionId,
    eventInstanceId: instanceId('ev'),
    requestId: instanceId('req'),
    phase,
    chosenOptionId: null,
    startedAt: nowMs,
  };
  state.activeEvent = ev;
  return ev;
}

/** 当前活动事件是否处于给定任一状态 */
function eventPhaseIn(state: LifeState, ...phases: ActiveLifeEvent['phase'][]): boolean {
  const ev = state.activeEvent;
  return ev !== null && phases.includes(ev.phase);
}

export class LifeEngine {
  private state: LifeState;
  private consumedPractice = new Set<string>();
  private practiceSession: { kind: TechniqueKindId; eventInstanceId: string; requestId: string; learningInstanceId: string; startedAt: number } | null = null;
  private activeBossBattle: string | null = null;
  private finalizedBattles = new Set<string>();

  getPracticeSession(nowMs: number) {
    const kind = this.currentTechniqueKind();
    const ev = this.state.activeEvent;
    if (this.state.phase !== 'TECHNIQUE_GATE' || !kind || !ev || ev.phase !== 'NARRATIVE_READY' || this.state.techniques.stages[kind] !== 'LEARNING') {
      this.practiceSession = null;
      return null;
    }
    if (this.practiceSession?.eventInstanceId !== ev.eventInstanceId || this.practiceSession.requestId !== ev.requestId) {
      this.practiceSession = { kind, eventInstanceId: ev.eventInstanceId, requestId: ev.requestId, learningInstanceId: instanceId('learning'), startedAt: nowMs };
    }
    return this.practiceSession;
  }

  registerBossBattle(battleId: string): boolean {
    if (this.state.phase !== 'BOSS_GATE' || !battleId || this.finalizedBattles.has(battleId)) return false;
    this.activeBossBattle = battleId;
    return true;
  }

  private acceptsBossSummary(summary: BattleSummary, result: 'victory' | 'defeat'): boolean {
    return this.state.phase === 'BOSS_GATE' && summary.encounterId === 'chapter1_red_eye_ape' &&
      summary.battleId === this.activeBossBattle && !this.finalizedBattles.has(summary.battleId) &&
      summary.lifeId === this.state.lifeId && summary.chapterInstanceId === this.state.chapterInstanceId && summary.result === result;
  }

  private clearRuntimeIdentity(): void {
    this.practiceSession = null;
    this.consumedPractice.clear();
    this.activeBossBattle = null;
    this.finalizedBattles.clear();
  }

  constructor(initial?: LifeState) {
    this.state = initial ?? createInitialLifeState();
  }

  getState(): LifeState {
    return this.state;
  }

  /** 外部注入 seed（恢复/新局/重生成入口；profileSeed 同步，此时命簿必为空） */
  loadSeed(seed: number): void {
    if (this.state.phase !== 'PROFILE_GENDER') return;
    this.state.seed = seed >>> 0;
    this.state.ledger = emptyLedger(this.state.seed, this.state.updatedAt);
    this.touch();
  }

  /** 第一步：选择性别（仅 PROFILE_GENDER 有效；生成顺序硬约束：性别先于身份） */
  selectGender(gender: Gender, nowMs: number): boolean {
    if (this.state.phase !== 'PROFILE_GENDER') return false;
    if (gender !== 'male' && gender !== 'female') return false;
    this.state.pendingGender = gender;
    this.state.phase = 'PROFILE_GENERATING';
    this.touch(nowMs);
    return true;
  }

  /**
   * 生成本局身份（性别之后才允许）。
   * seed 为 0（未注入）时由内部熵源生成一次并固定。
   */
  generateIdentity(nowMs: number): boolean {
    if (this.state.phase !== 'PROFILE_GENERATING' || !this.state.pendingGender) return false;
    if (!this.state.seed) {
      this.state.seed = entropySeed();
    }
    // seed 最终确定（外部注入或内部熵）：命簿 profileSeed 对齐（身份未确认前无历史）
    this.state.ledger = emptyLedger(this.state.seed, nowMs);
    const profile = generateProfile(this.state.seed, this.state.pendingGender);
    this.state.profile = profile;
    // 机缘顺序由 seed + 体质派生（身份确定即固定，存档稳定）
    this.state.techniques = {
      order: deriveTechniqueOrder(this.state.seed, profile.constitutionId),
      learned: [],
      stages: emptyTechniqueStages(),
      successfulPracticeCount: emptyPracticeCounts(),
      requiredSuccesses: defaultRequiredSuccesses(),
      practiceEventIds: emptyPracticeEventIds(),
    };
    this.state.pendingGender = null;
    this.state.phase = 'PROFILE_REVIEW';
    // 第十一章（v33）：身份卡是受控 pending 事件——AI 正文未落定前不可确认、
    // 不可提前进入下一场景；刷新后事件仍在（NARRATIVE_PENDING/READY 恢复）
    openEvent(this.state, 'profile:identity', 'NARRATIVE_PENDING', nowMs);
    this.touch(nowMs);
    return true;
  }

  /** 用户显式的「重新生成本局身份」：仅在 REVIEW 阶段、更换 seed */
  regenerateIdentity(nowMs: number): boolean {
    if (this.state.phase !== 'PROFILE_REVIEW') return false;
    const gender = this.state.profile?.gender;
    if (!gender) return false;
    // v33 AI-FIRST 门：身份正文落字中（NARRATIVE_PENDING）不可重复生成——
    // 打断会作废 requestId 造成「迟到响应无法归属」的边界
    const cur = this.state.activeEvent;
    if (cur && cur.eventDefinitionId === 'profile:identity' && cur.phase === 'NARRATIVE_PENDING') {
      return false;
    }
    this.state.seed = (this.state.seed * 31 + 0x9e3779b9 + entropySeed()) >>> 0;
    const profile = generateProfile(this.state.seed, gender);
    this.state.profile = profile;
    this.state.techniques = {
      order: deriveTechniqueOrder(this.state.seed, profile.constitutionId),
      learned: [],
      stages: emptyTechniqueStages(),
      successfulPracticeCount: emptyPracticeCounts(),
      requiredSuccesses: defaultRequiredSuccesses(),
      practiceEventIds: emptyPracticeEventIds(),
    };
    // 重新生成身份：命簿重置为新 seed（尚未确认，无历史可留）
    this.state.ledger = emptyLedger(this.state.seed, nowMs);
    // 新身份 → 新身份事件（旧 requestId 作废；迟到响应不可复活）
    openEvent(this.state, 'profile:identity', 'NARRATIVE_PENDING', nowMs);
    this.touch(nowMs);
    return true;
  }

  /**
   * 确认身份：进入剑意感应（真实 2 秒有效移动；Camera/Pointer 皆可）。
   * SENSING_GATE 是技术验证融入开局后的第一道门。
   */
  confirmProfile(nowMs: number): boolean {
    if (this.state.phase !== 'PROFILE_REVIEW' || !this.state.profile) return false;
    // v33 身份受控事件：正文未落定（NARRATIVE_PENDING）不可确认（AI-FIRST 门）
    if (!eventPhaseIn(this.state, 'NARRATIVE_READY')) return false;
    this.finalizeActiveEvent(); // 身份事件收口：不可反悔、不可复活
    this.state.phase = 'SENSING_GATE';
    this.state.chapterIndex = 1;
    this.state.eventIndex = 0;
    this.clearRuntimeIdentity();
    this.state.chapterInstanceId = instanceId('ch');
    this.touch(nowMs);
    return true;
  }

  /** 剑意感应完成（App 侧 SwordEngine success 回执）：进入基础御剑试炼 */
  completeSensing(nowMs: number): boolean {
    if (this.state.phase !== 'SENSING_GATE') return false;
    this.state.phase = 'TRIAL_GATE';
    this.state.flags['sensing-done'] = true;
    this.touch(nowMs);
    return true;
  }

  /** 第一章开场阅读完毕，进入第一剑选择（试炼通过后触发） */
  beginFirstChoice(nowMs: number): boolean {
    if (this.state.phase !== 'TRIAL_GATE') return false;
    this.state.phase = 'FATE_CHOICE_INTENT';
    this.state.choiceStage = 'intent';
    this.state.pendingChoiceId = null;
    // 事件状态机：正文未落定前选项与确认剑全部锁定（NARRATIVE_PENDING）
    openEvent(this.state, 'ch1:choice:intent', 'NARRATIVE_PENDING', nowMs);
    this.touch(nowMs);
    return true;
  }

  /**
   * 叙事正文落定（AI 成功或固定导演降级后由 App 调用）：
   * NARRATIVE_PENDING → CHOICE_READY（选择类）/ NARRATIVE_READY（叙事类）。
   * 幂等：非 PENDING 态调用无效（迟到响应不可复活、不可倒流）。
   */
  settleNarrative(requestId: string, nowMs: number): boolean {
    const ev = this.state.activeEvent;
    if (!ev || ev.requestId !== requestId) return false; // 请求身份不匹配：拒绝
    if (ev.phase === 'NARRATIVE_PENDING') {
      ev.phase = ev.eventDefinitionId.startsWith('ch1:choice:') && !ev.chosenOptionId
        ? 'CHOICE_READY'
        : 'NARRATIVE_READY';
      this.touch(nowMs);
      return true;
    }
    return false;
  }

  /**
   * 新请求注册（AI 调度前；迟到响应只有匹配当前 requestId 才有写入资格）。
   * 返回新 requestId；非活动事件或已 COMMITTED/FINALIZED 事件 → null。
   */
  registerNarrativeRequest(eventInstanceId: string, nowMs: number): string | null {
    const ev = this.state.activeEvent;
    if (!ev || ev.eventInstanceId !== eventInstanceId) return null;
    if (ev.phase !== 'NARRATIVE_PENDING') return null; // 已落定/已确认：不接受新请求
    ev.requestId = instanceId('req');
    this.touch(nowMs);
    return ev.requestId;
  }

  /** 当前事件的请求身份（AI 请求 payload 用；无活动事件 → null） */
  eventIdentity(): EventIdentity | null {
    const ev = this.state.activeEvent;
    if (!ev) return null;
    return {
      lifeId: this.state.lifeId,
      chapterInstanceId: this.state.chapterInstanceId,
      eventDefinitionId: ev.eventDefinitionId,
      eventInstanceId: ev.eventInstanceId,
      requestId: ev.requestId,
    };
  }

  /**
   * 选中候选：仅在事件 CHOICE_READY（正文已落定）且未 COMMITTED 时允许改选；
   * NARRATIVE_PENDING（剑意落字中）与 CHOICE_COMMITTED（已择其一）均拒绝。
   */
  selectOption(optionId: string, nowMs: number): boolean {
    const stage = this.state.phase;
    if (stage !== 'FATE_CHOICE_INTENT' && stage !== 'FATE_CHOICE_FATE') return false;
    if (!eventPhaseIn(this.state, 'CHOICE_READY')) return false; // 落字中/已确认：锁
    const pool = stage === 'FATE_CHOICE_INTENT' ? INTENT_OPTIONS : FATE_OPTIONS;
    if (!pool.some((o) => o.id === optionId)) return false;
    this.state.pendingChoiceId = optionId;
    this.touch(nowMs);
    return true;
  }

  /**
   * 确认剑：统一 InputFrame 的 ACTIVE 有效移动确认当前选择。
   * 仅 CHOICE_READY 且已择选项时可确认；确认后 CHOICE_COMMITTED，不可反悔。
   */
  confirmChoiceStroke(stageW: number, pathLen: number, actionState: string, nowMs: number): boolean {
    if (!this.state.pendingChoiceId) return false;
    if (!eventPhaseIn(this.state, 'CHOICE_READY')) return false;
    if (!isConfirmStroke(actionState, pathLen, stageW)) return false;
    if (this.state.phase === 'FATE_CHOICE_INTENT') {
      this.state.chosen.intent = this.state.pendingChoiceId;
      this.applyResultFlags(this.state.pendingChoiceId, INTENT_OPTIONS);
      this.commitChoice(this.state.pendingChoiceId, nowMs);
      this.state.pendingChoiceId = null;
      openEvent(this.state, 'ch1:choice:intent', 'NARRATIVE_PENDING', nowMs).chosenOptionId = this.state.chosen.intent;
      this.touch(nowMs);
      return true;
    }
    if (this.state.phase === 'FATE_CHOICE_FATE') {
      this.state.chosen.fate = this.state.pendingChoiceId;
      this.applyResultFlags(this.state.pendingChoiceId, FATE_OPTIONS);
      this.commitChoice(this.state.pendingChoiceId, nowMs);
      this.state.pendingChoiceId = null;
      openEvent(this.state, 'ch1:choice:fate', 'NARRATIVE_PENDING', nowMs).chosenOptionId = this.state.chosen.fate;
      this.touch(nowMs);
      return true;
    }
    return false;
  }

  /** 已提交的抉择：先读完本次后果，再原子进入下一个事件。 */
  continueChoiceNarrative(nowMs: number): boolean {
    const ev = this.state.activeEvent;
    if (!ev?.chosenOptionId || ev.phase !== 'NARRATIVE_READY') return false;
    const phase = this.state.phase;
    if (phase !== 'FATE_CHOICE_INTENT' && phase !== 'FATE_CHOICE_FATE') return false;
    this.finalizeActiveEvent();
    if (phase === 'FATE_CHOICE_INTENT') {
      this.state.phase = 'COMPANION_EVENT';
      this.state.companionState.met = true;
      openEvent(this.state, 'ch1:companion:meet', 'NARRATIVE_PENDING', nowMs);
    } else {
      this.state.phase = 'TECHNIQUE_GATE';
      this.startTechniqueOpportunity(nowMs);
    }
    this.touch(nowMs);
    return true;
  }

  /** 事件终态收口：当前活动事件 → EVENT_FINALIZED 并关闭（防跨阶段残留 CHOICE_COMMITTED） */
  private finalizeActiveEvent(): void {
    const ev = this.state.activeEvent;
    if (ev && ev.phase !== 'EVENT_FINALIZED') ev.phase = 'EVENT_FINALIZED';
    this.state.activeEvent = null;
  }

  /** 选择确认：事件 → CHOICE_COMMITTED（记录选项；刷新恢复此态，不重置） */
  private commitChoice(optionId: string, nowMs: number): void {
    const ev = this.state.activeEvent;
    if (ev) {
      ev.phase = 'CHOICE_COMMITTED';
      ev.chosenOptionId = optionId;
    }
    this.touch(nowMs);
  }

  /** 同行者回应后的第二剑事件开启（正文未落定前锁定） */
  beginFateChoice(nowMs: number): boolean {
    if (this.state.phase !== 'FATE_CHOICE_FATE') return false;
    this.state.pendingChoiceId = null;
    openEvent(this.state, 'ch1:choice:fate', 'NARRATIVE_PENDING', nowMs);
    this.touch(nowMs);
    return true;
  }

  // =====================================================================
  // 第九阶段收口：三式剑道机缘（TECHNIQUE_GATE）
  // =====================================================================

  /** 开启下一个未获得的机缘事件（按 order 顺序；全部获得 → false） */
  startTechniqueOpportunity(nowMs: number): boolean {
    if (this.state.phase !== 'TECHNIQUE_GATE') return false;
    const next = this.state.techniques.order.find(
      (k) => !this.state.techniques.learned.includes(k),
    );
    if (!next) return false;
    const def = TECHNIQUE_OPPORTUNITIES.find((t) => t.kind === next)!;
    openEvent(this.state, def.eventId, 'NARRATIVE_PENDING', nowMs);
    // v33：该式机缘事实开启（事件 NARRATIVE_PENDING；落定后玩家可看卷轴）
    this.state.techniques.stages[next] = 'OPPORTUNITY_AVAILABLE';
    this.state.techniques.practiceEventIds[next] = null;
    this.touch(nowMs);
    return true;
  }

  /** 当前机缘事件对应的剑招（无活动机缘事件 → null） */
  currentTechniqueKind(): TechniqueKindId | null {
    const ev = this.state.activeEvent;
    if (!ev || !ev.eventDefinitionId.startsWith('ch1:technique:')) return null;
    const kind = ev.eventDefinitionId.slice('ch1:technique:'.length) as TechniqueKindId;
    return TECHNIQUE_OPPORTUNITIES.some((t) => t.kind === kind) ? kind : null;
  }

  /**
   * v33 阶段状态机：玩家确认看到卷轴/教学 → MANUAL_RECEIVED（练习窗口开启的前提）。
   * 幂等：已 MANUAL_RECEIVED/LEARNING/MASTERED 时无操作。
   */
  acknowledgeTechniqueManual(kind: TechniqueKindId, nowMs: number): boolean {
    if (this.state.phase !== 'TECHNIQUE_GATE') return false;
    if (this.currentTechniqueKind() !== kind) return false;
    if (this.state.techniques.stages[kind] !== 'OPPORTUNITY_AVAILABLE') return false;
    if (!eventPhaseIn(this.state, 'NARRATIVE_READY')) return false; // 正文未落定：卷轴未开
    this.state.techniques.stages[kind] = 'MANUAL_RECEIVED';
    this.state.techniques.practiceEventIds[kind] = {
      eventInstanceId: this.state.activeEvent!.eventInstanceId,
      requestId: this.state.activeEvent!.requestId,
    };
    this.touch(nowMs);
    return true;
  }

  /**
   * v33 阶段状态机：开始练习（MANUAL_RECEIVED → LEARNING）。
   * 练习窗口内的有效几何计数通过 recordTechniquePracticeSuccess 累计。
   */
  beginTechniquePractice(kind: TechniqueKindId, nowMs: number): boolean {
    if (this.state.phase !== 'TECHNIQUE_GATE') return false;
    if (this.currentTechniqueKind() !== kind) return false;
    if (this.state.techniques.stages[kind] !== 'MANUAL_RECEIVED') return false;
    this.state.techniques.stages[kind] = 'LEARNING';
    this.touch(nowMs);
    return true;
  }

  /**
   * v33 阶段状态机：记录一次练习成功（LEARNING 期间完整有效几何 attempt）。
   * 达到 requiredSuccesses → MASTERED（写 learned + 事件 FINALIZED + 进入下一式/BOSS_GATE）。
   * 返回 'mastered' | 'counting' | null（null = 非法时机）。
   * 练习失败不调用（可无限重试，不污染普通战斗）。
   */
  recordTechniquePracticeSuccess(kind: TechniqueKindId, nowMs: number): 'mastered' | 'counting' | null {
    if (this.state.phase !== 'TECHNIQUE_GATE') return null;
    const ev = this.state.activeEvent;
    if (!ev || this.currentTechniqueKind() !== kind) return null;
    if (this.state.techniques.stages[kind] !== 'LEARNING') return null;
    const required = this.state.techniques.requiredSuccesses[kind] ?? 1;
    this.state.techniques.successfulPracticeCount[kind] += 1;
    if (this.state.techniques.successfulPracticeCount[kind] < required) {
      this.touch(nowMs);
      return 'counting';
    }
    // MASTERED：一次性写入 learned + 事件收口（与旧 completeTechniquePractice 语义一致）
    return this.completeTechniquePractice(kind, nowMs) ? 'mastered' : null;
  }

  acceptPracticeReceipt(receipt: {
    kind: TechniqueKindId; eventInstanceId: string; requestId: string;
    learningInstanceId: string; segmentId: number; createdAt: number; startedAt: number;
  }, nowMs: number): 'mastered' | 'counting' | null {
    const ev = this.state.activeEvent;
    if (this.state.phase !== 'TECHNIQUE_GATE' || !ev || ev.phase !== 'NARRATIVE_READY' ||
      this.currentTechniqueKind() !== receipt.kind || this.state.techniques.stages[receipt.kind] !== 'LEARNING' ||
      ev.eventInstanceId !== receipt.eventInstanceId || ev.requestId !== receipt.requestId ||
      !this.practiceSession || receipt.learningInstanceId !== this.practiceSession.learningInstanceId ||
      receipt.startedAt < this.practiceSession.startedAt || receipt.createdAt < receipt.startedAt || receipt.createdAt > nowMs || nowMs - receipt.createdAt > 1600) return null;
    const key = `${receipt.eventInstanceId}:${receipt.learningInstanceId}:${receipt.segmentId}`;
    if (this.consumedPractice.has(key)) return null;
    this.consumedPractice.add(key);
    return this.recordTechniquePracticeSuccess(receipt.kind, nowMs);
  }

  /**
   * 机缘练习成招回执（App 侧练习窗口内 TechniqueEngine 判定有效后调用）：
   * NARRATIVE_READY → 写入 learned（程序事实）→ 尝试开启下一式；
   * 三式全部获得 → 进入 BOSS_GATE。
   * 练习失败不调用此方法（可无限重试，不污染普通战斗）。
   */
  completeTechniquePractice(kind: TechniqueKindId, nowMs: number): boolean {
    if (this.state.phase !== 'TECHNIQUE_GATE') return false;
    const ev = this.state.activeEvent;
    if (!ev || this.currentTechniqueKind() !== kind) return false;
    if (!eventPhaseIn(this.state, 'NARRATIVE_READY')) return false; // 教学叙事未落定：不可成招
    // v33：仅 MANUAL_RECEIVED/LEARNING 可成招（卷轴未看 → 不存在成招入口）
    const stage = this.state.techniques.stages[kind];
    if (stage !== 'MANUAL_RECEIVED' && stage !== 'LEARNING') return false;
    this.state.techniques.stages[kind] = 'MASTERED';
    if (!this.state.techniques.learned.includes(kind)) {
      this.state.techniques.learned = [...this.state.techniques.learned, kind];
    }
    this.state.flags[`technique-${kind}`] = true;
    ev.phase = 'EVENT_FINALIZED';
    // 下一式（顺序固定，人人可学全三式；新式从 OPPORTUNITY_AVAILABLE 开始）
    const hasNext = this.startTechniqueOpportunity(nowMs);
    if (!hasNext) {
      // 三式齐备：关闭事件，进入赤瞳山魈终局
      this.state.activeEvent = null;
      this.state.phase = 'BOSS_GATE';
    } else {
      // 新机缘事件开启 → 其式进入 OPPORTUNITY_AVAILABLE
      const nextKind = this.currentTechniqueKind();
      if (nextKind) this.state.techniques.stages[nextKind] = 'OPPORTUNITY_AVAILABLE';
    }
    this.touch(nowMs);
    return true;
  }

  // =====================================================================
  // 第九阶段：赤瞳山魈 Boss 挂接（Life 只消费只读 BattleSummary）
  // =====================================================================

  /**
   * Boss 胜利结算（幂等；仅 BOSS_GATE 时的第一次有效 victory 推进）：
   * 同帧完成（不等 AI）：程序 SwordArchetypeResolver 定剑道初相 → 练气一层
   * → 命簿写入 → 开启剑道初相叙事事件（NARRATIVE_PENDING）→ CHAPTER_RESULT。
   * AI 成败/迟到均不回滚以上任何确定性结果。
   */
  reportBossVictory(summary: BattleSummary, nowMs: number): boolean {
    if (!this.acceptsBossSummary(summary, 'victory')) return false;
    this.finalizedBattles.add(summary.battleId);
    // 程序决定剑道初相（AI 无参与；缺字段稳定归守剑）
    const archetype: SwordArchetype = resolveSwordArchetype(summaryToArchetypeInput(summary));
    this.state.swordArchetype = { id: archetype.id, title: archetype.title };
    this.state.lastBattleSummary = projectSummary(summary);
    this.state.phase = 'CHAPTER_RESULT';
    this.state.realm = '练气一层';
    // 剑道初相叙事事件（正文等待 AI/固定导演；收束按钮在落定前锁定）
    openEvent(this.state, 'ch1:archetype', 'NARRATIVE_PENDING', nowMs);
    // 命簿写入（幂等：同 runId 只写一次；无 profile 不写）
    if (this.state.profile && this.state.chosen.intent) {
      const { ledger } = appendChapterEntry(this.state.ledger, {
        seed: this.state.seed,
        replayIndex: this.state.replayCount,
        finishedAt: nowMs,
        intentId: this.state.chosen.intent,
        fateId: this.state.chosen.fate ?? '',
        resultFlags: Object.keys(this.state.flags).filter((k) => this.state.flags[k] === true),
        companionResponse: this.state.companionState.skipped
          ? 'skip'
          : this.state.companionState.response ?? 'skip',
      });
      this.state.ledger = ledger;
    }
    this.touch(nowMs);
    return true;
  }

  /**
   * Boss 失败回执：只记录战斗摘要（历史/调试），不推进练气/章节/命簿。
   * 仍在 BOSS_GATE，可无限次重试（App 侧 startBoss 生成新 battleId）。
   */
  reportBossDefeat(summary: BattleSummary, nowMs: number): boolean {
    if (!this.acceptsBossSummary(summary, 'defeat')) return false;
    this.finalizedBattles.add(summary.battleId);
    this.state.lastBattleSummary = projectSummary(summary);
    this.touch(nowMs);
    return true;
  }

  /** Boss 战当前阶段是否可开战（App 渲染循环判定） */
  isBossGate(): boolean {
    return this.state.phase === 'BOSS_GATE';
  }

  /**
   * 同行者回应：warm/reserved 写固定旗标，skip 只标记跳过。
   * 仅当同行者事件（ch1:companion:meet）正文已落定（NARRATIVE_READY）时生效——
   * 落字中回应按钮锁定；回应后事件 EVENT_FINALIZED，再创建第二剑新事件。
   */
  respondCompanion(response: 'warm' | 'reserved' | 'skip', nowMs: number): boolean {
    if (this.state.phase !== 'COMPANION_EVENT') return false;
    const ev = this.state.activeEvent;
    if (!ev || ev.eventDefinitionId !== 'ch1:companion:meet') return false;
    if (ev.phase !== 'NARRATIVE_READY') return false; // 剑意落字中：锁定回应
    if (response !== 'skip' && !COMPANION.responses[response]) return false;
    if (response === 'skip') {
      this.state.companionState.skipped = true;
      this.state.companionState.response = null;
      this.state.companionState.flag = null;
    } else {
      const def = COMPANION.responses[response];
      this.state.companionState.response = response;
      this.state.companionState.flag = def.flag;
      this.state.flags[def.flag] = true;
    }
    // 同行者事件终态收口：ch1:companion:meet → EVENT_FINALIZED
    this.finalizeActiveEvent();
    this.state.phase = 'FATE_CHOICE_FATE';
    this.state.choiceStage = 'fate';
    // 第二剑事件开启（正文未落定前锁定选项）
    this.beginFateChoice(nowMs);
    this.touch(nowMs);
    return true;
  }

  /** 第一章结算阅读完毕：进入踏入九州边界（剑道初相正文须已落定） */
  enterJourney(nowMs: number): boolean {
    if (this.state.phase !== 'CHAPTER_RESULT') return false;
    if (!eventPhaseIn(this.state, 'NARRATIVE_READY')) return false; // 落字中：收束锁定
    this.state.activeEvent = null; // EVENT_FINALIZED 语义：事件关闭
    this.state.phase = 'JOURNEY_GATE';
    this.touch(nowMs);
    return true;
  }

  /** 试炼结果回写（Combat 只传胜负语义，不传内部数值） */
  reportTrialResult(won: boolean, nowMs: number): boolean {
    if (this.state.phase !== 'TRIAL_GATE') return false;
    if (won) {
      this.state.flags['trial-won'] = true;
    }
    this.touch(nowMs);
    return true;
    // 落败不推进：可反复试炼
  }

  /**
   * 第六阶段：重新历练本章（第一章可无限次重复）。
   * 语义边界：重历 ≠ 新开一局 ≠ 重新试炼——
   * - 保留已确认 profile / seed / 永久人生记录（旗标非本章前缀者）；
   * - 只清本章运行时（chosen/pending/companion 本章互动/eventIndex/choiceStage/机缘进度）与本章旗标；
   * - realm 回「剑道初相」，phase 回 SENSING_GATE（感应可重做，也可直接完成）；
   * - replayCount 递增（AI 叙事上下文），不影响战斗数值；
   * - 仅章回终点（CHAPTER_RESULT / JOURNEY_GATE / BOSS_GATE）允许，重复调用幂等返回 false。
   */
  replayChapter(nowMs: number): boolean {
    if (
      this.state.phase !== 'CHAPTER_RESULT' &&
      this.state.phase !== 'JOURNEY_GATE' &&
      this.state.phase !== 'BOSS_GATE'
    ) return false;
    if (!this.state.profile) return false;
    for (const k of Object.keys(this.state.flags)) {
      if (
        k.startsWith('intent-') ||
        k.startsWith('fate-') ||
        k.startsWith('companion-') ||
        k.startsWith('technique-') ||
        k === 'trial-won' ||
        k === 'sensing-done'
      ) {
        delete this.state.flags[k];
      }
    }
    this.state.phase = 'SENSING_GATE';
    this.state.chapterIndex = 1;
    this.state.eventIndex = 0;
    this.state.choiceStage = 'intent';
    this.state.pendingChoiceId = null;
    this.state.chosen = { intent: null, fate: null };
    this.state.companionState = { met: false, response: null, flag: null, skipped: false };
    // 机缘进度重置（顺序按 seed 派生保持；重历可重学；阶段机/计数同步清零）
    this.state.techniques = {
      order: this.state.techniques.order,
      learned: [],
      stages: emptyTechniqueStages(),
      successfulPracticeCount: emptyPracticeCounts(),
      requiredSuccesses: defaultRequiredSuccesses(),
      practiceEventIds: emptyPracticeEventIds(),
    };
    this.state.realm = '剑道初相';
    // 重历清剑道初相与上一场摘要（本章运行时）；命簿历史保留
    this.state.swordArchetype = null;
    this.state.lastBattleSummary = null;
    this.state.activeEvent = null;
    this.state.chapterInstanceId = instanceId('ch'); // 新章实例：AI 缓存键隔离
    this.state.replayCount += 1;
    this.touch(nowMs);
    return true;
  }

  /**
   * 第八阶段：AI 叙事来源注解（轻量元数据，只填 null→值，不覆盖、不改结构）。
   * 未知 runId / 条目不存在 → 拒绝（false）。AI 迟到结果不得污染命簿。
   */
  annotateLedgerNarrative(
    runId: string,
    source: 'ai' | 'deterministic',
    fallbackReason: string | null,
    nowMs?: number,
  ): boolean {
    const idx = this.state.ledger.history.findIndex((h) => h.runId === runId);
    if (idx < 0) return false;
    const entry = this.state.ledger.history[idx];
    if (entry.narrativeSource !== null) return false; // 已有值不覆盖
    const next: ChapterHistoryEntry = {
      ...entry,
      narrativeSource: source,
      narrativeFallbackReason: source === 'deterministic' ? fallbackReason : null,
    };
    const history = [...this.state.ledger.history];
    history[idx] = next;
    this.state.ledger = { ...this.state.ledger, history, updatedAt: nowMs ?? this.state.updatedAt };
    return true;
  }

  /** 当前 runId（AI 注解入口用；与 lifeLedger.currentRunId 一致） */
  ledgerRunId(): string {
    return currentRunId(this.state);
  }

  /** 恢复外部状态（持久化载入；结构校验与迁移在 lifeStorage） */
  restore(state: LifeState): void {
    this.clearRuntimeIdentity();
    this.state = state;
  }

  /** 清理人生存档（「新开一局」入口；与试炼 retry 无关） */
  resetLife(nowMs: number): void {
    this.clearRuntimeIdentity();
    this.state = createInitialLifeState(nowMs); // seed 已带新熵
  }

  private applyResultFlags(optionId: string, pool: readonly { id: string; resultFlags: string[] }[]): void {
    const opt = pool.find((o) => o.id === optionId);
    if (opt) for (const f of opt.resultFlags) this.state.flags[f] = true;
  }

  private touch(nowMs?: number): void {
    this.state.updatedAt = nowMs ?? this.state.updatedAt;
  }
}

/** BattleSummary → Life 持久化投影（只留事实字段；旧版本缺字段安全为 0） */
function projectSummary(s: BattleSummary): NonNullable<LifeState['lastBattleSummary']> {
  const n = (v: unknown): number =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
  return {
    battleId: typeof s.battleId === 'string' ? s.battleId : '',
    result: s.result === 'defeat' ? 'defeat' : 'victory',
    duration: n(s.duration),
    slashCount: n(s.slashCount),
    averageSpeed: n(s.averageSpeed),
    accuracyScore: n(s.accuracyScore),
    stabilityScore: n(s.stabilityScore),
    blocks: n(s.blocks),
    interrupts: n(s.interrupts),
    projectilesCut: n(s.projectilesCut),
    weakPointHits: n(s.weakPointHits),
    overspeedCount: n(s.overspeedCount),
    qiDepletedCount: n(s.qiDepletedCount),
  };
}
