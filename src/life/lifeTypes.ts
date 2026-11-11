/**
 * 第五阶段 Life 层类型：剑修人生开局与第一章。
 * 职责边界：Input→Sword→Combat→Technique→Life→AI。
 * Life 不接触摄像头、landmarks、Canvas 绘制细节、敌人 HP 或 CombatEngine 内部字段；
 * Combat 只通过试炼结果（TRIAL_GATE 语义）与 Life 交互，AI 导演只能输出事件文案与候选选项。
 * 第八阶段：LifeState 内嵌命簿（ledger）——长期人生档案，与 AI 叙事缓存完全隔离。
 * 第九阶段收口：事件状态机契约——
 *   CHOICE_READY → CHOICE_COMMITTED → NARRATIVE_PENDING → NARRATIVE_READY → EVENT_FINALIZED
 *   以 activeEvent.phase 表达；lifeId/chapterInstanceId/eventInstanceId/requestId 构成请求身份。
 * 阶段重排：感应（SENSING_GATE）→ 试炼（TRIAL_GATE）→ 身份（PROFILE）→ 两剑选择 →
 *   机缘三式（TECHNIQUE_GATE）→ 赤瞳山魈（BOSS_GATE）→ 结算（CHAPTER_RESULT）。
 */
import type { LifeLedgerData } from './lifeLedger';

/** 人生阶段 */
export type LifePhase =
  | 'PROFILE_GENDER' // 第一步：只选性别
  | 'PROFILE_GENERATING' // 已选性别，待生成本局身份
  | 'PROFILE_REVIEW' // 身份确认卡
  | 'SENSING_GATE' // 剑意感应：真实 2 秒有效移动（Camera/Pointer 皆可，失败不阻塞 Pointer）
  | 'TRIAL_GATE' // 基础御剑试炼（进入既有战斗）
  | 'CHAPTER_EVENT' // 章回开场（阅读；旧档兼容保留）
  | 'FATE_CHOICE_INTENT' // 第一剑·择意
  | 'COMPANION_EVENT' // 可跳过的同行者互动
  | 'FATE_CHOICE_FATE' // 第二剑·定命
  | 'TECHNIQUE_GATE' // 剑道机缘：固定三式（斜劈/十字剑/回风式）逐一获得
  | 'BOSS_GATE' // 第二剑定命后 · 赤瞳山魈综合终局（胜利才进结算）
  | 'CHAPTER_RESULT' // 第一章结算
  | 'JOURNEY_GATE'; // 踏入九州（本阶段边界）

/**
 * 事件状态（固定流转，可用字段组合表达，语义必须可测试）：
 * - 选择类事件（ch1:choice:*）：NARRATIVE_PENDING（正文未落定，选项与确认剑锁定）
 *   → CHOICE_READY（正文落定，可择可选可确认）→ CHOICE_COMMITTED（确认剑落下，不可反悔）
 *   → EVENT_FINALIZED（本章推进，事件关闭）。
 * - 叙事类事件（ch1:technique:* / ch1:archetype）：NARRATIVE_PENDING → NARRATIVE_READY
 *   → EVENT_FINALIZED（机缘确认 / 收束此章时关闭）。
 */
export type EventPhase =
  | 'NARRATIVE_PENDING'
  | 'CHOICE_READY'
  | 'CHOICE_COMMITTED'
  | 'NARRATIVE_READY'
  | 'EVENT_FINALIZED';

/** 当前活动事件（请求身份 + 状态；可序列化持久化） */
export interface ActiveLifeEvent {
  /** 固定世界事件定义 id（白名单：ch1:choice:intent|fate、ch1:technique:*、ch1:archetype） */
  eventDefinitionId: string;
  /** 本次事件实例 id（刷新稳定；AI 叙事缓存键组成部分） */
  eventInstanceId: string;
  /** 当前活动请求 id（迟到响应只有匹配它才有写入资格） */
  requestId: string;
  /** 事件状态（见 EventPhase 注释） */
  phase: EventPhase;
  /** 已确认的选项 id（CHOICE_COMMITTED 之后记录；此前为 null） */
  chosenOptionId: string | null;
  /** 事件开始时间戳（ms） */
  startedAt: number;
}

/** 三式固定剑招 id（与 TechniqueEngine 的 ConcreteTechniqueKind 一一映射） */
export type TechniqueKindId = 'diagonalSlash' | 'cross' | 'returnWind';

/** 机缘学习进度（程序事实；AI 只能为固定事实写短叙事） */
export interface TechniqueProgress {
  /** 本局学习顺序（由 seed + 体质倾向派生，稳定存档） */
  order: TechniqueKindId[];
  /** 已领悟（机缘 + 练习成招后写入；战斗中偶然画出轨迹不得自动领悟） */
  learned: TechniqueKindId[];
  /**
   * 第十一阶段（v33）：每式的获得→学习→领悟阶段状态（程序事实）。
   * - LOCKED：尚未轮到（顺序靠后）
   * - OPPORTUNITY_AVAILABLE：机缘事实已开启（事件 NARRATIVE_PENDING/READY）
   * - MANUAL_RECEIVED：卷轴/教学已展示（正文落定 + 玩家看到）
   * - LEARNING：练习窗口进行中（有限成功次数计数）
   * - MASTERED：成招（写入 learned + TechniqueEngine 权限门放开）
   * 旧档迁移：learned 含该式 → MASTERED；TECHNIQUE_GATE 首式 → OPPORTUNITY_AVAILABLE。
   */
  stages: Record<TechniqueKindId, TechniqueStage>;
  /** 每式练习成功计数（LEARNING 期间有效几何段累计；达标 → MASTERED） */
  successfulPracticeCount: Record<TechniqueKindId, number>;
  /** 每式成招所需成功次数（低负担配置：1 次完整有效几何即成招） */
  requiredSuccesses: Record<TechniqueKindId, number>;
  /** 每式机缘/练习事件身份（eventInstanceId/requestId；程序生成，AI 不可指定） */
  practiceEventIds: Record<TechniqueKindId, { eventInstanceId: string; requestId: string } | null>;
}

/** 三式阶段状态机的单式状态 */
export type TechniqueStage =
  | 'LOCKED'
  | 'OPPORTUNITY_AVAILABLE'
  | 'MANUAL_RECEIVED'
  | 'LEARNING'
  | 'MASTERED';

/** AI 叙事请求身份（客户端与 Edge Function 双端校验） */
export interface EventIdentity {
  lifeId: string;
  chapterInstanceId: string;
  eventDefinitionId: string;
  eventInstanceId: string;
  requestId: string;
}

export type Gender = 'male' | 'female';

/** 本局身份（性别 → 可复现 seed 生成） */
export interface LifeProfile {
  gender: Gender;
  name: string;
  originId: string;
  constitutionId: string;
  /** 生成时的 seed 快照（同一局内稳定） */
  bornSeed: number;
}

/** 同行者互动状态（可选关系，只写非数值旗标） */
export interface CompanionState {
  /** 是否遇见 */
  met: boolean;
  /** 玩家回应：warm/reserved/skip */
  response: 'warm' | 'reserved' | 'skip' | null;
  /** 回应对应的固定非数值旗标名 */
  flag: string | null;
  /** 是否跳过互动 */
  skipped: boolean;
}

/** 残缺体质：开局差异事实（可修补/可转化/流派倾向），非统一身世秘密 */
export interface Constitution {
  id: string;
  title: string;
  text: string;
  /** 可见标签（如「寒脉」「剑心有损」） */
  tags: string[];
  /** 后续机缘可修补 */
  repairable: boolean;
  /** 后续机缘可转化为流派根基 */
  transformable: boolean;
  /** 流派倾向标签（仅展示可能性） */
  pathTags: string[];
  /** 第一章开场文本倾向（体质差异的直接可断言体现） */
  chapterOpeningFlavor: string;
  /** 第一剑选项 flavor 前缀差异 */
  intentFlavor: string;
  /** 第二剑选项 flavor 前缀差异 */
  fateFlavor: string;
  /** 第一章结算中的体质影响描述 */
  chapterSummary: string;
}

/** 出身（有限配置库） */
export interface Origin {
  id: string;
  title: string;
  text: string;
}

/** 命运选择候选选项（固定世界数据，AI 不得创造） */
export interface FateOption {
  id: string;
  title: string;
  shortText: string;
  /** 落位旗标（非数值） */
  resultFlags: string[];
  /** 固定后果文案 */
  resultText: string;
  /** 体质相关的选项 flavor（由导演按当前体质拼接展示，不改后果） */
  flavor?: string;
}

/** 选择事件（导演输出，经 schema 校验） */
export interface ChoiceEvent {
  title: string;
  text: string;
  options: FateOption[];
}

/** 人生状态（可序列化持久化） */
export interface LifeState {
  schemaVersion: number;
  phase: LifePhase;
  /** 本局人生唯一 id（新局生成；旧档迁移补） */
  lifeId: string;
  /** 本章实例 id（confirmProfile / replayChapter 时更换） */
  chapterInstanceId: string;
  /** 当前活动事件（无事件时为 null；含请求身份与事件状态机） */
  activeEvent: ActiveLifeEvent | null;
  /** 待生成身份的性别（仅 PROFILE_GENERATING 前有效） */
  pendingGender: Gender | null;
  profile: LifeProfile | null;
  /** 当前身份 seed（重新生成才更换） */
  seed: number;
  chapterIndex: number;
  eventIndex: number;
  choiceStage: 'intent' | 'fate';
  pendingChoiceId: string | null;
  chosen: { intent: string | null; fate: string | null };
  flags: Record<string, boolean>;
  companionState: CompanionState;
  /** 机缘学习进度（固定三式；顺序由 seed + 体质派生） */
  techniques: TechniqueProgress;
  realm: string;
  /** 本章已重历次数（仅统计，不影响任何战斗数值；AI 叙事上下文用） */
  replayCount: number;
  /** 命簿：长期人生档案（第八阶段；旧档无此字段时由 lifeStorage 迁移补默认值） */
  ledger: LifeLedgerData;
  /** 第九阶段：程序确定的剑道初相（Boss 胜利结算时由 Resolver 写入；AI 不得修改） */
  swordArchetype: { id: string; title: string } | null;
  /** 第九阶段：最近一次 Boss 战摘要快照（BattleSummary 投影；旧档无此字段 → null） */
  lastBattleSummary: BossSummarySnapshot | null;
  updatedAt: number;
}

/** BattleSummary 在 Life 层的最小持久化投影（只读事实；缺字段安全为 0） */
export interface BossSummarySnapshot {
  battleId: string;
  result: 'victory' | 'defeat';
  duration: number;
  slashCount: number;
  averageSpeed: number;
  accuracyScore: number;
  stabilityScore: number;
  blocks: number;
  interrupts: number;
  projectilesCut: number;
  weakPointHits: number;
  overspeedCount: number;
  qiDepletedCount: number;
}

/** 事件导演适配器：未来可替换 AI 实现，默认 deterministic */
export interface LifeDirector {
  /** 数据源标识（deterministic / 未来 ai） */
  source: 'deterministic' | 'ai';
  /** 按当前人生状态返回当前选择事件（含体质 flavor） */
  getChoiceEvent(state: LifeState): ChoiceEvent;
  /** 第一章结算反馈（真实选择 + 体质影响 + 固定世界文案） */
  getChapterResult(state: LifeState): { title: string; lines: string[] };
}