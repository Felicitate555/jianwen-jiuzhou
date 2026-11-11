/**
 * 第九阶段：剑道初相解析器（纯函数）。
 *
 * 职责边界：由程序依据固定阈值与 BattleSummary 从四类型白名单确定 swordArchetype。
 * - AI 绝不参与决定（无网络/无异步/无外部依赖）；
 * - 阈值写入 ARCHETYPE_RULES 配置，可测试可调整；
 * - 对边界与缺失字段稳定（缺省 → 守剑 steady）；
 * - 优先级（失控 > 灵巧 > 迅疾 > 坚守）：越靠前越优先，避免多条件同时满足时的摇摆。
 */
import type { BattleSummary } from '@/combat/combatEngine';

/** 剑道初相四类型（白名单；AI 不得增删改） */
export interface SwordArchetype {
  id: 'swift' | 'steady' | 'fierce' | 'nimble';
  title: string;
  /** 一句判定语（程序事实，非 AI 文案） */
  basis: string;
  /** 固定导演文案（AI 不可用时的 fallback 正文） */
  fallbackText: string;
}

export const SWORD_ARCHETYPES: readonly SwordArchetype[] = [
  {
    id: 'swift',
    title: '疾剑',
    basis: '出剑快而准，快而不乱',
    fallbackText:
      '你的剑比旁人快半寸。快不是急，是每一剑都先于险境半步落下。这条路讲究眼到手到，心无迟疑。',
  },
  {
    id: 'steady',
    title: '守剑',
    basis: '稳收稳放，格挡与根基为先',
    fallbackText:
      '你的剑不以快取胜。收得住，放得稳，山魈扑来时你只退半步。守不是怯，是知道自己每一寸剑身的分量。',
  },
  {
    id: 'fierce',
    title: '狂剑',
    basis: '剑势常越临界，以失控换锋芒',
    fallbackText:
      '你的剑常在失控边缘行走。旁人收力时你仍在加力，锋芒是够了，剑身也在替你受苦。这条路要用后半生学会刹车。',
  },
  {
    id: 'nimble',
    title: '灵剑',
    basis: '剑走巧处，破势斩弹，招式多变',
    fallbackText:
      '你的剑不与蛮力较劲。斩妖气弹于半空，破妖修蓄力于将成，三式剑招信手拈来。这条路讲究一个「巧」字。',
  },
];

/** 解析阈值（全部可配置、可测试） */
export interface ArchetypeRules {
  /** 疾剑：平均剑速下限（× 舞台宽/秒） */
  swiftSpeedThreshold: number;
  /** 疾剑：平均精准下限（0~100） */
  swiftAccuracyThreshold: number;
  /** 疾剑：超速次数上限（超过即归狂剑） */
  swiftMaxOverspeed: number;
  /** 狂剑：超速次数下限 */
  fierceOverspeedThreshold: number;
  /** 狂剑：气机耗尽次数下限（任一满足） */
  fierceQiDepletedThreshold: number;
  /** 守剑：格挡次数下限 */
  steadyBlocksThreshold: number;
  /** 守剑：稳定分下限 */
  steadyStabilityThreshold: number;
  /** 灵剑：弱点命中 + 斩弹 + 打断 总和下限 */
  nimbleCleverThreshold: number;
  /** 灵剑：三式总使用次数下限（与上一条任一满足） */
  nimbleTechniqueThreshold: number;
}

export const DEFAULT_ARCHETYPE_RULES: ArchetypeRules = {
  swiftSpeedThreshold: 2.0,
  swiftAccuracyThreshold: 75,
  swiftMaxOverspeed: 1,
  fierceOverspeedThreshold: 3,
  fierceQiDepletedThreshold: 2,
  steadyBlocksThreshold: 2,
  steadyStabilityThreshold: 78,
  nimbleCleverThreshold: 3,
  nimbleTechniqueThreshold: 3,
};

/** 解析输入（BattleSummary 的最小投影；缺失字段由调用方归一为 0） */
export interface ArchetypeSummaryInput {
  result: 'victory' | 'defeat';
  averageSpeed: number;
  overspeedCount: number;
  accuracyScore: number;
  stabilityScore: number;
  blocks: number;
  qiDepletedCount: number;
  weakPointHits: number;
  interrupts: number;
  projectilesCut: number;
  techniqueUsage: Partial<Record<'diagonalSlash' | 'cross' | 'returnWind', number>>;
}

/** 安全数字（NaN/负数/缺失 → 0） */
function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * 程序决定剑道初相（纯函数）。
 * 优先级：狂剑（失控主导）> 灵剑（巧劲主导）> 疾剑（快准主导）> 守剑（缺省稳定型）。
 * 边界规则：多条件同时满足时按优先级取前者；全零输入 → 守剑（稳定缺省）。
 */
export function resolveSwordArchetype(
  input: ArchetypeSummaryInput,
  rules: ArchetypeRules = DEFAULT_ARCHETYPE_RULES,
): SwordArchetype {
  const speed = num(input.averageSpeed);
  const overspeed = num(input.overspeedCount);
  const accuracy = num(input.accuracyScore);
  const stability = num(input.stabilityScore);
  const blocks = num(input.blocks);
  const qiDepleted = num(input.qiDepletedCount);
  const weakHits = num(input.weakPointHits);
  const interrupts = num(input.interrupts);
  const cut = num(input.projectilesCut);
  const tech = input.techniqueUsage ?? {};
  const techTotal =
    num(tech.diagonalSlash) + num(tech.cross) + num(tech.returnWind);
  const clever = weakHits + interrupts + cut;

  const find = (id: SwordArchetype['id']) =>
    SWORD_ARCHETYPES.find((a) => a.id === id)!;

  // 1) 狂剑：失控主导（超速或气机耗尽频发，压过速度优势）
  if (overspeed >= rules.fierceOverspeedThreshold || qiDepleted >= rules.fierceQiDepletedThreshold) {
    return find('fierce');
  }
  // 2) 灵剑：巧劲主导（破势/斩弹/弱点 或 三式组合丰富）
  if (clever >= rules.nimbleCleverThreshold || techTotal >= rules.nimbleTechniqueThreshold) {
    return find('nimble');
  }
  // 3) 疾剑：快而准（速度与精准双达标，且超速受控）
  if (
    speed >= rules.swiftSpeedThreshold &&
    accuracy >= rules.swiftAccuracyThreshold &&
    overspeed <= rules.swiftMaxOverspeed
  ) {
    return find('swift');
  }
  // 4) 守剑：稳收稳放或缺省（多挡多稳走守，全零也归守——根基优先）
  if (blocks >= rules.steadyBlocksThreshold || stability >= rules.steadyStabilityThreshold) {
    return find('steady');
  }
  return find('steady');
}

/** BattleSummary → 解析输入投影（缺失字段安全归 0；techniqueUsage 数组 → 计数表） */
export function summaryToArchetypeInput(summary: BattleSummary): ArchetypeSummaryInput {
  const usage: ArchetypeSummaryInput['techniqueUsage'] = {};
  for (const t of summary.techniqueUsage ?? []) {
    if (t && typeof t.kind === 'string' && typeof t.count === 'number') {
      usage[t.kind as 'diagonalSlash' | 'cross' | 'returnWind'] = t.count;
    }
  }
  return {
    result: summary.result === 'defeat' ? 'defeat' : 'victory',
    averageSpeed: num(summary.averageSpeed),
    overspeedCount: num(summary.overspeedCount),
    accuracyScore: num(summary.accuracyScore),
    stabilityScore: num(summary.stabilityScore),
    blocks: num(summary.blocks),
    qiDepletedCount: num(summary.qiDepletedCount),
    weakPointHits: num(summary.weakPointHits),
    interrupts: num(summary.interrupts),
    projectilesCut: num(summary.projectilesCut),
    techniqueUsage: usage,
  };
}

// =====================================================================
// AI 叙事请求（剑道初相正文）：类型已由程序确定，AI 只写文字
// =====================================================================

/** 剑道初相叙事事件的请求 payload（白名单字段） */
export interface ArchetypeNarrativeRequest {
  canonVersion: number;
  eventId: 'ch1:archetype';
  chapterIndex: number;
  replayCount: number;
  name: string;
  /** 程序确定的剑道初相（AI 不得修改/新增） */
  swordArchetypeId: string;
  swordArchetypeTitle: string;
  /** 两次选择真实 id */
  intentId: string;
  fateId: string;
  /** 同行者回应 */
  companionResponse: string | null;
  /** Boss 战摘要（轻量字段；不含任何运行时/隐私数据） */
  battleSummary: {
    battleId: string;
    duration: number;
    slashCount: number;
    averageSpeed: number;
    accuracyScore: number;
    stabilityScore: number;
    blocks: number;
    interrupts: number;
    projectilesCut: number;
  };
}

/** 组装请求（纯函数；供 App 调用 requestNarrative 前的 payload 构建） */
export function buildArchetypeNarrativeRequest(
  state: Pick<
    import('@/life/lifeTypes').LifeState,
    'seed' | 'replayCount' | 'profile' | 'chosen' | 'companionState' | 'swordArchetype' | 'flags'
  > & { swordArchetype: SwordArchetype },
  summary: Pick<
    BattleSummary,
    | 'battleId'
    | 'duration'
    | 'slashCount'
    | 'averageSpeed'
    | 'accuracyScore'
    | 'stabilityScore'
    | 'blocks'
    | 'interrupts'
    | 'projectilesCut'
  >,
): ArchetypeNarrativeRequest {
  return {
    canonVersion: 1,
    eventId: 'ch1:archetype',
    chapterIndex: 1,
    replayCount: state.replayCount,
    name: state.profile?.name ?? '无名剑客',
    swordArchetypeId: state.swordArchetype.id,
    swordArchetypeTitle: state.swordArchetype.title,
    intentId: state.chosen.intent ?? '',
    fateId: state.chosen.fate ?? '',
    companionResponse: state.companionState.skipped
      ? 'skip'
      : state.companionState.response ?? null,
    battleSummary: {
      battleId: summary.battleId,
      duration: Math.round(summary.duration),
      slashCount: summary.slashCount,
      averageSpeed: Math.round(summary.averageSpeed * 100) / 100,
      accuracyScore: Math.round(summary.accuracyScore),
      stabilityScore: Math.round(summary.stabilityScore),
      blocks: summary.blocks,
      interrupts: summary.interrupts,
      projectilesCut: summary.projectilesCut,
    },
  };
}

/** 剑道初相叙事的叙事状态（既有 CHOICE_COMMITTED → … → EVENT_FINALIZED 契约的最小投影） */
export type ArchetypeNarrativeState =
  | 'CHOICE_COMMITTED'
  | 'NARRATIVE_PENDING'
  | 'NARRATIVE_READY'
  | 'EVENT_FINALIZED';

/**
 * 迟到响应可接受性判定（纯函数）。
 * 满足以下全部才可写入，否则「已结算请求不可复活」：
 * - narrativeState 仍为 NARRATIVE_PENDING（READY/FINALIZED 后到达即拒绝）；
 * - requestId 一致（当前挂起请求）。
 */
export function isNarrativeAcceptable(
  narrativeState: ArchetypeNarrativeState,
  pending: { requestId: string },
  arriving: { requestId: string },
): boolean {
  if (narrativeState !== 'NARRATIVE_PENDING') return false;
  return pending.requestId === arriving.requestId;
}