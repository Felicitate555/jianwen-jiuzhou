/**
 * 第五阶段人生存档：localStorage 命名空间 + schemaVersion + 安全解析。
 * 读取失败/JSON 损坏/版本不兼容/结构非法 → 安全回退新局，不白屏。
 * 宿主无 localStorage 时降级为内存存储（本会话内有效，不抛异常）。
 * 注意：save 只在 profile 确认后的稳定阶段调用，中间态不覆盖已确认存档。
 * 第九阶段收口：v1 → v2 迁移——
 *   - v1 无 lifeId/chapterInstanceId/activeEvent/techniques → 补默认值；
 *   - v1 的 TRIAL_GATE 直接保留（感应可补做）；旧 TECHNIQUE_GATE 缺失按空机缘推进补齐；
 *   - 已 COMMITTED 的选择（chosen 有值且阶段已过）不得恢复成可重选；
 *   - schemaVersion 不同的旧档先迁移再校验，迁移不可判定的损坏 → 回退新局。
 */
import {
  defaultRequiredSuccesses,
  emptyPracticeCounts,
  emptyPracticeEventIds,
  emptyTechniqueStages,
  LIFE_SCHEMA_VERSION,
  LIFE_CONSTITUTIONS,
  LIFE_ORIGINS,
  INTENT_OPTIONS,
  FATE_OPTIONS,
  TECHNIQUE_OPPORTUNITIES,
  deriveTechniqueOrder,
} from './lifeConfig';
import { createInitialLifeState } from './lifeEngine';
import { emptyLedger, validateLedger } from './lifeLedger';
import type {
  TechniqueStage, ActiveLifeEvent, Gender, LifePhase, LifeState, TechniqueKindId } from './lifeTypes';

export const LIFE_STORAGE_KEY = 'jianwen-jiuzhou:life:v1';

const VALID_PHASES: readonly LifePhase[] = [
  'PROFILE_GENDER',
  'PROFILE_GENERATING',
  'PROFILE_REVIEW',
  'SENSING_GATE',
  'TRIAL_GATE',
  'CHAPTER_EVENT',
  'FATE_CHOICE_INTENT',
  'COMPANION_EVENT',
  'FATE_CHOICE_FATE',
  'TECHNIQUE_GATE',
  'BOSS_GATE',
  'CHAPTER_RESULT',
  'JOURNEY_GATE',
];

const VALID_EVENT_PHASES: readonly ActiveLifeEvent['phase'][] = [
  'NARRATIVE_PENDING',
  'CHOICE_READY',
  'CHOICE_COMMITTED',
  'NARRATIVE_READY',
  'EVENT_FINALIZED',
];

const VALID_EVENT_DEF_IDS: readonly string[] = [
  'profile:identity',
  'ch1:choice:intent',
  'ch1:choice:fate',
  'ch1:companion:meet',
  ...TECHNIQUE_OPPORTUNITIES.map((t) => t.eventId),
  'ch1:archetype',
];

/** 内存降级存储：宿主无 localStorage（SSR/受限环境/单测 node）时使用，行为等价 */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

let memoryFallback: MemoryStorage | null = null;

function safeStorage(): Storage | null {
  try {
    const s = globalThis.localStorage;
    if (s) {
      // 探测可用性（隐私模式等场景会抛异常）
      const probe = '__jianwen_probe__';
      s.setItem(probe, '1');
      s.removeItem(probe);
      return s;
    }
  } catch {
    // 真实 localStorage 存在但被禁用：走内存降级
  }
  memoryFallback ??= new MemoryStorage();
  return memoryFallback;
}

function isValidProfile(p: unknown): p is LifeState['profile'] {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  if (o.gender !== 'male' && o.gender !== 'female') return false;
  if (typeof o.name !== 'string' || o.name.length < 2) return false;
  if (!LIFE_ORIGINS.some((x) => x.id === o.originId)) return false;
  if (!LIFE_CONSTITUTIONS.some((x) => x.id === o.constitutionId)) return false;
  return typeof o.bornSeed === 'number';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 剑道初相白名单（第九阶段；存档只能存这四个，AI/篡改不得新增） */
const VALID_ARCHETYPE_IDS: readonly string[] = ['swift', 'steady', 'fierce', 'nimble'];

function isValidArchetype(v: unknown): boolean {
  if (!isRecord(v)) return false;
  return (
    typeof v.id === 'string' &&
    VALID_ARCHETYPE_IDS.includes(v.id) &&
    typeof v.title === 'string' &&
    v.title.length <= 8
  );
}

/** BattleSummary 快照清洗：旧版本缺字段安全为 0；数值非法归 0；result 只认 victory/defeat */
function sanitizeBattleSummary(raw: Record<string, unknown>): LifeState['lastBattleSummary'] {
  const numz = (v: unknown): number =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
  return {
    battleId: typeof raw.battleId === 'string' ? raw.battleId.slice(0, 128) : '',
    result: raw.result === 'victory' ? 'victory' : 'defeat',
    duration: numz(raw.duration),
    slashCount: Math.floor(numz(raw.slashCount)),
    averageSpeed: numz(raw.averageSpeed),
    accuracyScore: Math.floor(numz(raw.accuracyScore)),
    stabilityScore: Math.floor(numz(raw.stabilityScore)),
    blocks: Math.floor(numz(raw.blocks)),
    interrupts: Math.floor(numz(raw.interrupts)),
    projectilesCut: Math.floor(numz(raw.projectilesCut)),
    weakPointHits: Math.floor(numz(raw.weakPointHits)),
    overspeedCount: Math.floor(numz(raw.overspeedCount)),
    qiDepletedCount: Math.floor(numz(raw.qiDepletedCount)),
  };
}

/** 活动事件清洗：eventDefinitionId/phase 白名单；缺字段 → null（事件可安全重开） */
function sanitizeActiveEvent(raw: unknown): ActiveLifeEvent | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.eventDefinitionId !== 'string') return null;
  if (!VALID_EVENT_DEF_IDS.includes(raw.eventDefinitionId)) return null;
  if (typeof raw.phase !== 'string' || !VALID_EVENT_PHASES.includes(raw.phase as ActiveLifeEvent['phase'])) {
    return null;
  }
  const str = (v: unknown, maxLen = 96): string | null =>
    typeof v === 'string' && v.length > 0 && v.length <= maxLen ? v : null;
  const eventInstanceId = str(raw.eventInstanceId);
  const requestId = str(raw.requestId);
  if (!eventInstanceId || !requestId) return null;
  return {
    eventDefinitionId: raw.eventDefinitionId,
    eventInstanceId,
    requestId,
    phase: raw.phase as ActiveLifeEvent['phase'],
    chosenOptionId: typeof raw.chosenOptionId === 'string' ? raw.chosenOptionId : null,
    startedAt: typeof raw.startedAt === 'number' ? raw.startedAt : 0,
  };
}

/** 机缘进度清洗：order 必须是三式的全排列；learned 是 order 子集 */
function sanitizeTechniques(
  rawUnknown: unknown,
  seed: number,
  constitutionId: string,
  rawActiveEvent: unknown,
): LifeState['techniques'] {
  const raw: Record<string, unknown> = isRecord(rawUnknown) ? rawUnknown : {};
  const all: TechniqueKindId[] = ['diagonalSlash', 'cross', 'returnWind'];
  // v33 迁移规则：
  // - learned 含该式 → MASTERED（旧档成招事实保留）
  // - 阶段字段缺失/损坏 → 按 learned 推导（不含 LOCKED；首式在 TECHNIQUE_GATE 且未学 → OPPORTUNITY_AVAILABLE）
  // - 计数字段缺失 → 0（learned 式不管；required 默认 1）
  const fallbackLearned: TechniqueKindId[] = [];
  if (Array.isArray(raw.learned)) {
    fallbackLearned.push(
      ...raw.learned.filter((k): k is TechniqueKindId => all.includes(k as TechniqueKindId)),
    );
  }
  const fallbackOrder = deriveTechniqueOrder(seed, constitutionId);
  const fallback = {
    order: fallbackOrder,
    learned: [...new Set(fallbackLearned)],
    stages: downgradeOrphanStages(
      rebuildTechniqueStages(fallbackOrder, [...new Set(fallbackLearned)], 'TECHNIQUE_GATE', raw),
      [...new Set(fallbackLearned)],
      rawActiveEvent,
    ),
    successfulPracticeCount: sanitizePracticeCounts(raw),
    requiredSuccesses: defaultRequiredSuccesses(),
    practiceEventIds: sanitizePracticeEventIds(raw),
  };
  const order = Array.isArray(raw.order) ? raw.order.filter((k): k is TechniqueKindId => all.includes(k as TechniqueKindId)) : [];
  if (order.length !== 3 || new Set(order).size !== 3) return fallback;
  const learned = Array.isArray(raw.learned)
    ? raw.learned.filter((k): k is TechniqueKindId => order.includes(k as TechniqueKindId))
    : [];
  const uniqLearned = [...new Set(learned)];
  return {
    order,
    learned: uniqLearned,
    stages: downgradeOrphanStages(
      rebuildTechniqueStages(order, uniqLearned, 'TECHNIQUE_GATE', raw),
      uniqLearned,
      rawActiveEvent,
    ),
    successfulPracticeCount: sanitizePracticeCounts(raw),
    requiredSuccesses: defaultRequiredSuccesses(),
    practiceEventIds: sanitizePracticeEventIds(raw),
  };
}

/**
 * v33 防卡死降级：MANUAL_RECEIVED/LEARNING 但没有匹配的机缘事件（activeEvent 缺失或非本式）
 * → 回退 OPPORTUNITY_AVAILABLE（TECHNIQUE_GATE 内可重开卷轴；非门内 → LOCKED，重开由引擎门控）。
 * 练习中刷新保存的 activeEvent 正常指向本式事件，不受影响。
 */
function downgradeOrphanStages(
  stages: Record<TechniqueKindId, TechniqueStage>,
  learned: TechniqueKindId[],
  rawActiveEvent: unknown,
): Record<TechniqueKindId, TechniqueStage> {
  const ev = isRecord(rawActiveEvent) ? rawActiveEvent : null;
  const evDef = ev && typeof ev.eventDefinitionId === 'string' ? ev.eventDefinitionId : null;
  const evInstanceId = ev && typeof ev.eventInstanceId === 'string' ? ev.eventInstanceId : null;
  const out = { ...stages };
  for (const k of ['diagonalSlash', 'cross', 'returnWind'] as const) {
    if (learned.includes(k)) continue; // 已学事实优先
    const st = out[k];
    if (st === 'MANUAL_RECEIVED' || st === 'LEARNING') {
      const pei = practiceEventDefId(k);
      const hasMatch = evDef === pei && evInstanceId !== null;
      if (!hasMatch) out[k] = 'OPPORTUNITY_AVAILABLE';
    }
  }
  return out;
}

/** 与 lifeConfig TECHNIQUE_OPPORTUNITIES 的事件 id 约定一致（ch1:technique:*） */
function practiceEventDefId(kind: TechniqueKindId): string {
  return `ch1:technique:${kind}`;
}

/** v33：练习机缘身份往返保留（结构完整才保留；脏值丢弃为 null——阶段字段已足够保证不重复领悟） */
function sanitizePracticeEventIds(raw: Record<string, unknown>): LifeState['techniques']['practiceEventIds'] {
  const out = emptyPracticeEventIds();
  const src = raw.practiceEventIds;
  if (!isRecord(src)) return out;
  for (const k of ['diagonalSlash', 'cross', 'returnWind'] as const) {
    const v = src[k];
    if (isRecord(v) && typeof v.eventInstanceId === 'string' && typeof v.requestId === 'string' && v.eventInstanceId && v.requestId) {
      out[k] = { eventInstanceId: v.eventInstanceId, requestId: v.requestId };
    }
  }
  return out;
}

/** 阶段重建：learned → MASTERED；其后未学 → LOCKED；首未学在 TECHNIQUE_GATE → OPPORTUNITY_AVAILABLE */
function rebuildTechniqueStages(
  order: TechniqueKindId[],
  learned: TechniqueKindId[],
  _phase: string,
  rawUnknown: unknown,
): Record<TechniqueKindId, TechniqueStage> {
  const raw: Record<string, unknown> = isRecord(rawUnknown) ? rawUnknown : {};
  const stages = emptyTechniqueStages();
  if (isRecord(raw.stages)) {
    for (const k of ['diagonalSlash', 'cross', 'returnWind'] as const) {
      const v = (raw.stages as Record<string, unknown>)[k];
      if (
        v === 'LOCKED' || v === 'OPPORTUNITY_AVAILABLE' || v === 'MANUAL_RECEIVED' ||
        v === 'LEARNING' || v === 'MASTERED'
      ) {
        stages[k] = v;
      }
    }
  }
  // learned 事实优先：已学必为 MASTERED
  for (const k of learned) stages[k] = 'MASTERED';
  // 未学但阶段机里是 MASTERED（脏数据）：按 learned 推导
  for (const k of order) {
    if (!learned.includes(k) && stages[k] === 'MASTERED') {
      stages[k] = 'LOCKED';
    }
  }
  return stages;
}

function sanitizePracticeCounts(raw: Record<string, unknown>): Record<TechniqueKindId, number> {
  const counts = emptyPracticeCounts();
  if (isRecord(raw.successfulPracticeCount)) {
    for (const k of ['diagonalSlash', 'cross', 'returnWind'] as const) {
      const v = (raw.successfulPracticeCount as Record<string, unknown>)[k];
      if (typeof v === 'number' && v >= 0 && Number.isFinite(v)) counts[k] = Math.floor(v);
    }
  }
  return counts;
}

function safeStrId(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 && v.length <= 96 ? v : fallback;
}

let recoverySequence = 0;

/** 每次补建使用独立身份；正常存档的已有身份保持不变。 */
function recoveryId(prefix: string): string {
  const entropy = globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${(++recoverySequence).toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${entropy}`;
}

function recoveredEvent(state: LifeState, definition: string, chosenOptionId: string | null = null): ActiveLifeEvent {
  return {
    eventDefinitionId: definition,
    eventInstanceId: recoveryId('ev'),
    requestId: recoveryId('req'),
    phase: 'NARRATIVE_PENDING',
    chosenOptionId,
    startedAt: state.updatedAt,
  };
}

/** 校验与迁移最终都走这里：恢复的是可执行入口，已发生的选择和成招事实优先。 */
function recoverExecutableState(state: LifeState): LifeState {
  if (state.phase === 'CHAPTER_EVENT') {
    state.phase = state.flags['sensing-done'] || state.flags['trial-won'] ? 'TRIAL_GATE' : 'SENSING_GATE';
  }
  const p = state.phase;
  const next = state.techniques.order.find((kind) => !state.techniques.learned.includes(kind));
  if (p === 'TECHNIQUE_GATE' && !next) {
    state.phase = 'BOSS_GATE';
    state.activeEvent = null;
    return state;
  }
  const definition = p === 'PROFILE_REVIEW' ? 'profile:identity'
    : p === 'FATE_CHOICE_INTENT' ? 'ch1:choice:intent'
    : p === 'FATE_CHOICE_FATE' ? 'ch1:choice:fate'
    : p === 'COMPANION_EVENT' ? 'ch1:companion:meet'
    : p === 'TECHNIQUE_GATE' && next ? practiceEventDefId(next)
    : p === 'CHAPTER_RESULT' ? 'ch1:archetype' : null;
  if (!definition) {
    state.activeEvent = null;
    return state;
  }
  if (state.activeEvent?.eventDefinitionId !== definition) {
    state.activeEvent = null;
    state.pendingChoiceId = null;
  }
  const choiceStage = p === 'FATE_CHOICE_INTENT' ? 'intent' : p === 'FATE_CHOICE_FATE' ? 'fate' : null;
  if (choiceStage) {
    state.choiceStage = choiceStage;
    const pool = choiceStage === 'intent' ? INTENT_OPTIONS : FATE_OPTIONS;
    const oldEvent = state.activeEvent;
    const committed = state.chosen[choiceStage] ??
      pool.find((option) => option.id === oldEvent?.chosenOptionId)?.id ?? null;
    if (committed) {
      state.chosen[choiceStage] = committed;
      for (const flag of pool.find((option) => option.id === committed)!.resultFlags) state.flags[flag] = true;
      state.pendingChoiceId = null;
      // COMMITTED/FINALIZED 或旧选择正文不能充当选择后果正文，换请求重新落定。
      if (!oldEvent || oldEvent.chosenOptionId !== committed ||
          (oldEvent.phase !== 'NARRATIVE_PENDING' && oldEvent.phase !== 'NARRATIVE_READY')) {
        state.activeEvent = recoveredEvent(state, definition, committed);
      }
    } else if (oldEvent && oldEvent.phase !== 'NARRATIVE_PENDING' && oldEvent.phase !== 'CHOICE_READY') {
      state.activeEvent = null;
    }
  } else if (state.activeEvent && state.activeEvent.phase !== 'NARRATIVE_PENDING' && state.activeEvent.phase !== 'NARRATIVE_READY') {
    state.activeEvent = null;
  }
  state.activeEvent ??= recoveredEvent(state, definition);
  if (state.activeEvent.phase === 'NARRATIVE_PENDING') state.pendingChoiceId = null;
  if (p === 'TECHNIQUE_GATE' && next) {
    const stage = state.techniques.stages[next];
    // 练习状态只在当前卷轴已落定时有效，否则重开机缘；累计练习与已学事实不丢失。
    if (stage === 'LOCKED' || state.activeEvent.phase !== 'NARRATIVE_READY') {
      state.techniques.stages[next] = 'OPPORTUNITY_AVAILABLE';
      state.techniques.practiceEventIds[next] = null;
    }
  }
  return state;
}

/**
 * v1 → v2 迁移（旧档缺字段安全补齐；语义边界：
 * - v1 的 TRIAL_GATE：感应门可补做 → 保留 TRIAL_GATE；
 * - v1 已过第二剑（BOSS_GATE）但无 techniques：三式视为已学全（Boss 语义优先，不把玩家踢回机缘）；
 * - 已 COMMITTED 的选择：chosen 有值即事实，恢复后阶段已推进，不存在可重选窗口。
 */
function migrateV1toV2(raw: Record<string, unknown>): LifeState | null {
  // 借用 v2 校验器读取 v1 共有字段（不含 v2 新字段），失败 → null 回退新局
  const phase = raw.phase;
  if (typeof phase !== 'string' || !VALID_PHASES.includes(phase as LifePhase)) return null;
  const profile = isValidProfile(raw.profile) ? raw.profile : null;
  if (phase !== 'PROFILE_GENDER' && phase !== 'PROFILE_GENERATING' && !profile) return null;
  const seed = typeof raw.seed === 'number' ? raw.seed : 0;
  const gender: Gender | null =
    raw.pendingGender === 'male' || raw.pendingGender === 'female' ? raw.pendingGender : null;
  if (!isRecord(raw.chosen) || !isRecord(raw.companionState) || !isRecord(raw.flags)) return null;
  const chosen = raw.chosen as Record<string, unknown>;
  const validOpt = (v: unknown, pool: ReadonlyArray<{ id: string }>) =>
    v === null || (typeof v === 'string' && pool.some((o) => o.id === v));
  if (!validOpt(chosen.intent, INTENT_OPTIONS) || !validOpt(chosen.fate, FATE_OPTIONS)) return null;
  const cs = raw.companionState as Record<string, unknown>;
  if (typeof cs.met !== 'boolean' || typeof cs.skipped !== 'boolean') return null;
  const ledger =
    raw.ledger === undefined
      ? emptyLedger(seed, typeof raw.updatedAt === 'number' ? raw.updatedAt : 0)
      : validateLedger(raw.ledger, seed);
  if (ledger === null) return null;
  // 机缘：Boss 之后（BOSS_GATE/CHAPTER_RESULT/JOURNEY_GATE）视为三式已学全
  const pastFate =
    phase === 'BOSS_GATE' || phase === 'CHAPTER_RESULT' || phase === 'JOURNEY_GATE';
  const v1Learned = pastFate && profile
    ? (['diagonalSlash', 'cross', 'returnWind'] as TechniqueKindId[])
    : ([] as TechniqueKindId[]);
  const techniques = profile && isRecord(raw.techniques)
    ? sanitizeTechniques(raw.techniques, seed, profile.constitutionId, sanitizeActiveEvent(raw.activeEvent))
    : profile
    ? {
        order: deriveTechniqueOrder(seed, profile.constitutionId),
        learned: v1Learned,
        stages: rebuildTechniqueStages(deriveTechniqueOrder(seed, profile.constitutionId), v1Learned, phase, {}),
        successfulPracticeCount: emptyPracticeCounts(),
        requiredSuccesses: defaultRequiredSuccesses(),
        practiceEventIds: emptyPracticeEventIds(),
      }
    : {
        order: [] as TechniqueKindId[],
        learned: [] as TechniqueKindId[],
        stages: emptyTechniqueStages(),
        successfulPracticeCount: emptyPracticeCounts(),
        requiredSuccesses: defaultRequiredSuccesses(),
        practiceEventIds: emptyPracticeEventIds(),
      };
  return {
    schemaVersion: LIFE_SCHEMA_VERSION,
    phase: phase as LifePhase,
    lifeId: safeStrId(raw.lifeId, recoveryId('life')),
    chapterInstanceId: safeStrId(raw.chapterInstanceId, recoveryId('ch')),
    activeEvent: sanitizeActiveEvent(raw.activeEvent),
    pendingGender: gender,
    profile,
    seed,
    chapterIndex: typeof raw.chapterIndex === 'number' ? raw.chapterIndex : 0,
    eventIndex: typeof raw.eventIndex === 'number' ? raw.eventIndex : 0,
    choiceStage: raw.choiceStage === 'fate' ? 'fate' : 'intent',
    pendingChoiceId: typeof raw.pendingChoiceId === 'string' ? raw.pendingChoiceId : null,
    chosen: { intent: (chosen.intent as string | null) ?? null, fate: (chosen.fate as string | null) ?? null },
    flags: Object.fromEntries(
      Object.entries(raw.flags).filter(([, v]) => typeof v === 'boolean'),
    ) as Record<string, boolean>,
    companionState: {
      met: cs.met as boolean,
      response: (cs.response as 'warm' | 'reserved' | 'skip' | null) ?? null,
      flag: typeof cs.flag === 'string' ? cs.flag : null,
      skipped: cs.skipped as boolean,
    },
    techniques,
    realm: typeof raw.realm === 'string' ? raw.realm : '剑道初相',
    replayCount:
      typeof raw.replayCount === 'number' && raw.replayCount >= 0
        ? Math.floor(raw.replayCount)
        : 0,
    ledger,
    swordArchetype:
      raw.swordArchetype === undefined || raw.swordArchetype === null
        ? null
        : isValidArchetype(raw.swordArchetype)
          ? (raw.swordArchetype as { id: string; title: string })
          : null,
    lastBattleSummary:
      raw.lastBattleSummary === undefined || raw.lastBattleSummary === null
        ? null
        : sanitizeBattleSummary(raw.lastBattleSummary as Record<string, unknown>),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
  };
}

/** 严格结构校验：任何字段不合法 → null（调用方回退新局） */
function validateState(raw: unknown): LifeState | null {
  if (!isRecord(raw)) return null;
  // v1 旧档：先迁移再校验（迁移自身不可判定的损坏 → null 回退新局）
  if (raw.schemaVersion === 1) {
    const migrated = migrateV1toV2(raw);
    return migrated ? validateState(migrated) : null;
  }
  if (raw.schemaVersion !== LIFE_SCHEMA_VERSION) return null;
  if (!VALID_PHASES.includes(raw.phase as LifePhase)) return null;
  const gender: Gender | null =
    raw.pendingGender === 'male' || raw.pendingGender === 'female' ? raw.pendingGender : null;
  const profile = isValidProfile(raw.profile) ? raw.profile : null;
  // 已过 PROFILE 阶段的状态必须有合法 profile
  const phase = raw.phase as LifePhase;
  if (phase !== 'PROFILE_GENDER' && phase !== 'PROFILE_GENERATING' && !profile) return null;
  if (!isRecord(raw.chosen)) return null;
  const chosen = raw.chosen as Record<string, unknown>;
  const validOpt = (v: unknown, pool: ReadonlyArray<{ id: string }>) =>
    v === null || (typeof v === 'string' && pool.some((o) => o.id === v));
  if (!validOpt(chosen.intent, INTENT_OPTIONS) || !validOpt(chosen.fate, FATE_OPTIONS)) return null;
  if (!isRecord(raw.companionState)) return null;
  const cs = raw.companionState as Record<string, unknown>;
  if (typeof cs.met !== 'boolean' || typeof cs.skipped !== 'boolean') return null;
  if (cs.response !== null && !['warm', 'reserved', 'skip'].includes(String(cs.response))) return null;
  if (!isRecord(raw.flags)) return null;
  const partial: Omit<LifeState, 'ledger'> & { ledger: LifeState['ledger'] | null } = {
    schemaVersion: LIFE_SCHEMA_VERSION,
    phase,
    lifeId: safeStrId(raw.lifeId, 'life-unknown'),
    chapterInstanceId: safeStrId(raw.chapterInstanceId, 'ch-unknown'),
    activeEvent: sanitizeActiveEvent(raw.activeEvent),
    pendingGender: gender,
    profile,
    seed: typeof raw.seed === 'number' ? raw.seed : 0,
    chapterIndex: typeof raw.chapterIndex === 'number' ? raw.chapterIndex : 0,
    eventIndex: typeof raw.eventIndex === 'number' ? raw.eventIndex : 0,
    choiceStage: raw.choiceStage === 'fate' ? 'fate' : 'intent',
    pendingChoiceId: typeof raw.pendingChoiceId === 'string' ? raw.pendingChoiceId : null,
    chosen: { intent: chosen.intent as string | null, fate: chosen.fate as string | null },
    flags: Object.fromEntries(
      Object.entries(raw.flags).filter(([, v]) => typeof v === 'boolean'),
    ) as Record<string, boolean>,
    companionState: {
      met: cs.met as boolean,
      response: (cs.response as 'warm' | 'reserved' | 'skip' | null) ?? null,
      flag: typeof cs.flag === 'string' ? cs.flag : null,
      skipped: cs.skipped as boolean,
    },
    techniques: profile
      ? sanitizeTechniques(
          raw.techniques,
          typeof raw.seed === 'number' ? raw.seed : 0,
          profile.constitutionId,
          sanitizeActiveEvent(raw.activeEvent),
        )
      : {
          order: [],
          learned: [],
          stages: emptyTechniqueStages(),
          successfulPracticeCount: emptyPracticeCounts(),
          requiredSuccesses: defaultRequiredSuccesses(),
          practiceEventIds: emptyPracticeEventIds(),
        },
    realm: typeof raw.realm === 'string' ? raw.realm : '剑道初相',
    replayCount:
      typeof raw.replayCount === 'number' && raw.replayCount >= 0
        ? Math.floor(raw.replayCount)
        : 0,
    // 第八阶段：旧 v1 档无 ledger → 迁移补稳定空结构；有 ledger → 严格校验（坏 → 整档回退 null）
    ledger: raw.ledger === undefined
      ? emptyLedger(typeof raw.seed === 'number' ? raw.seed : 0, typeof raw.updatedAt === 'number' ? raw.updatedAt : 0)
      : validateLedger(raw.ledger, typeof raw.seed === 'number' ? raw.seed : 0),
    // 第九阶段：旧档无 swordArchetype/lastBattleSummary → 补 null；有 → 白名单校验（坏 → null 不拒整档）
    swordArchetype:
      raw.swordArchetype === undefined || raw.swordArchetype === null
        ? null
        : isValidArchetype(raw.swordArchetype)
          ? (raw.swordArchetype as { id: string; title: string })
          : null,
    lastBattleSummary:
      raw.lastBattleSummary === undefined || raw.lastBattleSummary === null
        ? null
        : sanitizeBattleSummary(raw.lastBattleSummary as Record<string, unknown>),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
  };
  if (partial.ledger === null) return null; // ledger 损坏：整档安全回退
  const state: LifeState = { ...partial, ledger: partial.ledger };
  // 事件契约一致性：选择阶段的 COMMITTED 事件必须有 chosenOptionId；
  // PENDING 阶段的 pendingChoiceId 恢复为 null（落字前不允许残留预选）
  const ev = state.activeEvent;
  if (ev) {
    if (ev.phase === 'CHOICE_COMMITTED' && !ev.chosenOptionId) state.activeEvent = null;
    if (ev.phase === 'NARRATIVE_PENDING') state.pendingChoiceId = null;
  }
  // 阶段与事件定义一致性：旧档/篡改档可能出现 phase 与 activeEvent 明显不一致——
  // 清空失效 activeEvent（安全降级：该阶段事件可由引擎按需重开，不白屏、不伪造完成）。
  const p = state.phase;
  if (state.activeEvent) {
    const defId = state.activeEvent.eventDefinitionId;
    const ok =
      (p === 'PROFILE_REVIEW' && defId === 'profile:identity') ||
      (p === 'FATE_CHOICE_INTENT' && defId === 'ch1:choice:intent') ||
      (p === 'FATE_CHOICE_FATE' && defId === 'ch1:choice:fate') ||
      (p === 'COMPANION_EVENT' && defId === 'ch1:companion:meet') ||
      (p === 'TECHNIQUE_GATE' && defId.startsWith('ch1:technique:')) ||
      (p === 'CHAPTER_RESULT' && defId === 'ch1:archetype');
    if (!ok) {
      state.activeEvent = null;
      // 恢复到无事件态的语义：选择阶段清残留预选（需重开事件）；机缘/初相同理可重开
      if (p === 'FATE_CHOICE_INTENT' || p === 'FATE_CHOICE_FATE' || p === 'COMPANION_EVENT') {
        state.pendingChoiceId = null;
      }
    }
  }
  // 阶段要求必有活动事件但存档缺失（清空失效事件或旧版 v2 档无 companion 事件）：
  // 按当前阶段生成安全的待处理事件（NARRATIVE_PENDING，AI/固定导演落定后解锁）
  if (
    !state.activeEvent &&
    (p === 'FATE_CHOICE_INTENT' || p === 'FATE_CHOICE_FATE' || p === 'COMPANION_EVENT')
  ) {
    state.activeEvent = {
      eventDefinitionId:
        p === 'FATE_CHOICE_INTENT'
          ? 'ch1:choice:intent'
          : p === 'FATE_CHOICE_FATE'
            ? 'ch1:choice:fate'
            : 'ch1:companion:meet',
      eventInstanceId: recoveryId('ev'),
      requestId: recoveryId('req'),
      phase: 'NARRATIVE_PENDING',
      chosenOptionId: null,
      startedAt: state.updatedAt,
    };
    state.pendingChoiceId = null;
  }
  return recoverExecutableState(state);
}

/** 保存：仅 profile 已确认（SENSING_GATE 及之后）的稳定状态才落盘 */
export function saveLifeState(state: LifeState): boolean {
  const s = safeStorage();
  if (!s) return false;
  if (!state.profile) return false; // 中间态不覆盖已确认存档
  try {
    s.setItem(LIFE_STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/** 读取：损坏/版本不兼容/结构非法 → null（新局） */
export function loadLifeState(): LifeState | null {
  const s = safeStorage();
  if (!s) return null;
  try {
    const raw = s.getItem(LIFE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return validateState(parsed);
  } catch {
    return null;
  }
}

/** 清理本局人生存档（新开一局） */
export function clearLifeState(): void {
  const s = safeStorage();
  if (!s) return;
  try {
    s.removeItem(LIFE_STORAGE_KEY);
  } catch {
    // 忽略：清理失败不阻塞新局
  }
}

/** 新局初始状态（带外部熵 seed） */
export function freshLifeState(nowMs = 0): LifeState {
  const state = createInitialLifeState(nowMs);
  return state;
}
