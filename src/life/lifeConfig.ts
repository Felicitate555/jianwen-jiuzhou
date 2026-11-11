/**
 * 第五阶段固定世界配置：姓名/出身/残缺体质/第一章两次选择/同行者。
 * 全部为有限配置库——AI 导演只能引用，不得创造数值、技能、敌人或地图。
 * 第九阶段收口：SCHEMA_VERSION=2（lifeId/chapterInstanceId/activeEvent/techniques）；
 * 三式机缘固定文案与体质倾向派生顺序（先后可不同，不能永久锁死任何一式）。
 */
import type {
  ChoiceEvent,
  Constitution,
  FateOption,
  Origin,
  TechniqueKindId,
  TechniqueStage,
} from './lifeTypes';

export const LIFE_SCHEMA_VERSION = 2;

/** 姓氏库（国风克制） */
export const LIFE_SURNAMES = ['沈', '顾', '叶', '陆', '苏', '白', '温', '崔'];

/** 男名库（双字） */
export const LIFE_MALE_NAMES = [
  '沉舟',
  '照野',
  '孤鸿',
  '承影',
  '既白',
  '怀霜',
  '临渊',
  '望舒',
  '听澜',
  '行止',
];

/** 女名库（双字） */
export const LIFE_FEMALE_NAMES = [
  '疏影',
  '听雪',
  '青梧',
  '未晞',
  '扶摇',
  '绾秋',
  '栖迟',
  '枕流',
  '澹月',
  '拂霜',
];

/** 出身库 */
export const LIFE_ORIGINS: Origin[] = [
  {
    id: 'river-town',
    title: '渡口船家',
    text: '生于大江渡口的船家，惯看千帆，识得水性，也识得人心冷暖。',
  },
  {
    id: 'mountain-temple',
    title: '深山寺观杂役',
    text: '在山间寺观扫地挑水十年，听惯钟磬，未得真传，却磨出一份静气。',
  },
  {
    id: 'border-scribe',
    title: '戍边书吏之子',
    text: '边镇书吏家中长大，抄过军报，见过烽火，笔下有山河。',
  },
  {
    id: 'fog-village',
    title: '云雾山村猎户',
    text: '雾岭猎户的孩子，认得兽径与药草，早学会了在沉默里等待。',
  },
  {
    id: 'street-orphan',
    title: '市井剑摊学徒',
    text: '在街边剑摊替人磨剑为生，摸过百种废铁，知道每把剑都有自己的脾气。',
  },
  {
    id: 'well-guard',
    title: '古井守夜人',
    text: '替人守过一口说不清来历的古井，长夜独坐，与影子作伴。',
  },
];

/**
 * 残缺体质库：开局差异事实。
 * 每一体质都有可修补/可转化/流派倾向的事实字段——本阶段只展示可能性，
 * 不实现修补系统，不偷偷改 Combat 数值，更不是人人共享的身世真相。
 */
export const LIFE_CONSTITUTIONS: Constitution[] = [
  {
    id: 'chill-meridian',
    title: '寒脉',
    text: '经脉偏寒，运剑迟滞半分，冬日尤甚。有人视之为缺憾，也有人说过，寒脉之人最耐得剑上霜气。',
    tags: ['寒脉', '运剑迟滞'],
    repairable: true,
    transformable: true,
    pathTags: ['霜杀', '守拙'],
    chapterOpeningFlavor: '山道霜重，你的指尖又先一步冷了——寒脉之人，剑未出鞘，霜气已至。',
    intentFlavor: '寒脉让你更懂「慢」的价值',
    fateFlavor: '寒脉之人的命数，往往在静处生变',
    chapterSummary: '寒脉未愈，但你已学会与霜气同坐——它不再只是迟滞，也是一种沉静。',
  },
  {
    id: 'thin-sword-heart',
    title: '剑心有损',
    text: '幼时一场高热伤了剑心，情绪起伏时剑意易散。老师傅说，损处若补得好，反能开出一条险路。',
    tags: ['剑心有损', '意易散'],
    repairable: true,
    transformable: true,
    pathTags: ['存神', '破妄'],
    chapterOpeningFlavor: '远山狼嚎隐隐，你的心口那处旧损随之发烫——剑心有损之人，最先听见的从来不是声音。',
    intentFlavor: '剑心有损者，须先择一个稳得住的意',
    fateFlavor: '剑心之损，是枷锁，也可能是门',
    chapterSummary: '剑心之损仍在，但两次抉择后，它安静了许多——像是终于承认了你的意。',
  },
  {
    id: 'slow-blood',
    title: '血行迟缓',
    text: '气血先天偏缓，爆发不如常人，却也比常人更耐得住长夜与长路。',
    tags: ['血行迟缓', '耐久'],
    repairable: false,
    transformable: true,
    pathTags: ['绵长', '守势'],
    chapterOpeningFlavor: '晨雾未散，你的血也醒得比旁人慢——血行迟缓之人，天亮之前总要多等一刻。',
    intentFlavor: '血行迟缓，快剑非你所长',
    fateFlavor: '缓血之人的命，常在长路上见分晓',
    chapterSummary: '血行依旧迟缓，但你走完第一章的路，比谁都不喘——绵长，也是一种天赋。',
  },
  {
    id: 'keen-senses',
    title: '识感过盛',
    text: '五识过于敏锐，闹市如雷贯耳，夜里难以安枕。有人说这是天生剑感，只是还没学会收。',
    tags: ['识感过盛', '易受惊扰'],
    repairable: true,
    transformable: true,
    pathTags: ['听风', '察微'],
    chapterOpeningFlavor: '你先于所有人察觉山道尽头的杀意——识感过盛之人，世界总是先一步抵达你。',
    intentFlavor: '识感过盛，让你先看清再落剑',
    fateFlavor: '过盛的识感，正在替你打听命数',
    chapterSummary: '识感仍盛，但两次抉择之后，你开始学着把耳朵借给剑，而不是借给恐惧。',
  },
  {
    id: 'frail-bone',
    title: '骨相清瘦',
    text: '骨相单薄，力量先天不足，持重剑稍久便酸。可清瘦之骨，往往藏着别人没有的轻。',
    tags: ['骨相清瘦', '力弱'],
    repairable: false,
    transformable: true,
    pathTags: ['轻灵', '游走'],
    chapterOpeningFlavor: '晨风掠过，你下意识按了按发酸的手腕——骨相清瘦之人，连风都重三分。',
    intentFlavor: '骨相清瘦，剑意宜轻不宜重',
    fateFlavor: '轻骨之人的命数，常在别人的重压下改写',
    chapterSummary: '骨相未变，但第一章的两次抉择，都没让你用过一分蛮力——轻，也是答案。',
  },
  {
    id: 'stray-fire',
    title: '火性驳杂',
    text: '体内混着一缕说不清来路的火气，焦躁时窜起，压制它的过程反而磨出了耐心。',
    tags: ['火性驳杂', '易燥'],
    repairable: true,
    transformable: true,
    pathTags: ['淬火', '雷行'],
    chapterOpeningFlavor: '不知名的火气又从丹田窜上喉头——火性驳杂之人，怒意总比理智快半步。',
    intentFlavor: '驳杂火性，先择一个能压得住的意',
    fateFlavor: '火性驳杂者的命，常在怒与忍之间改道',
    chapterSummary: '那缕火气还在，但第一章走完，你已能在它窜起的瞬间按住——淬火，自今日始。',
  },
];

/** 第一剑·择意：三个语义互异的方向（守拙 / 疾进 / 留白） */
export const INTENT_OPTIONS: FateOption[] = [
  {
    id: 'intent-steady',
    title: '守拙',
    shortText: '先求一剑稳：见狼扑至，收势护身，再寻空档还击。',
    resultFlags: ['intent-steady'],
    resultText: '你择了「守拙」之意。此后每逢险境，你总先问一句：何处可守。',
  },
  {
    id: 'intent-swift',
    title: '疾进',
    shortText: '先求一剑快：狼未近身，剑已出鞘，以攻代守。',
    resultFlags: ['intent-swift'],
    resultText: '你择了「疾进」之意。此后剑总是先于人至，快意与险处同生。',
  },
  {
    id: 'intent-void',
    title: '留白',
    shortText: '不求快慢：观其来势，后发而动，剑走空处。',
    resultFlags: ['intent-void'],
    resultText: '你择了「留白」之意。此后你的剑总在将发未发之间，等一个最好的空。',
  },
];

/** 第二剑·定命：三个语义互异的方向（入宗门 / 散修 / 携剑访友） */
export const FATE_OPTIONS: FateOption[] = [
  {
    id: 'fate-sect',
    title: '投宗门',
    shortText: '往北去青云剑宗山门，以残缺之身求一场正式的入门试。',
    resultFlags: ['fate-sect'],
    resultText: '你定了「投宗门」之命。残缺体质不是拒绝的理由，山门前的石阶会作证。',
  },
  {
    id: 'fate-wander',
    title: '做散修',
    shortText: '不入山门，独身携剑入江湖，风餐露宿，命由己出。',
    resultFlags: ['fate-wander'],
    resultText: '你定了「做散修」之命。九州很大，一个背着剑的人，走到哪里都算路。',
  },
  {
    id: 'fate-companion',
    title: '携友同行',
    shortText: '答应同行者之邀，二人一剑往东南，同行路上互相磨剑。',
    resultFlags: ['fate-companion'],
    resultText: '你定了「携友同行」之命。这条剑路上，你不再只有自己的影子。',
  },
];

/** 同行者：固定名字、立场，两种回应 + 可跳过 */
export const COMPANION = {
  id: 'companion-yan',
  name: '燕迟',
  stance: '同路的散修，剑囊上挂着七枚空酒杯，说话总慢半拍。',
  encounterText:
    '第一剑落定，山道旁的枯树下走出一个人：青衫旧了，剑却擦得干净。「方才那一剑，」他拱了拱手，「在下燕迟。往东南去的路，正好同一段——可要同行？」',
  responses: {
    warm: {
      label: '拱手应下',
      text: '「好。」你把剑归鞘，与他并肩往山道走去。',
      flag: 'companion-warm',
    },
    reserved: {
      label: '颔首不语',
      text: '你没有应声，只朝东南方向抬了抬下巴。燕迟笑了笑，落后半步跟着。',
      flag: 'companion-reserved',
    },
  },
  skip: {
    label: '独自赶路',
    text: '你摇了摇头，独自上路。身后那人也不恼，只在你走远后轻声说了句「保重」。',
  },
} as const;

/** 第一章开场（固定世界事件文本骨架） */
export const CHAPTER_ONE_OPENING =
  '晨钟三响，你离开那座待了十六年的小院。山道尽头的狼嚎越来越近，剑在背后，路在脚下——第一剑，落向何处？';

/** 章回与选择的固定标题 */
export const CHAPTER_ONE_TITLE = '第一章 · 雾岭第一剑';
export const INTENT_TITLE = '第一剑 · 择意';
export const FATE_TITLE = '第二剑 · 定命';
export const COMPANION_TITLE = '同行者 · 燕迟';
export const CHAPTER_RESULT_TITLE = '第一章 · 尘埃落定';
export const JOURNEY_GATE_TITLE = '踏入九州';

/** 选择确认剑的最小位移门槛（占舞台宽比例，复用斜劈 minPathRatio 语义） */
export const CHOICE_CONFIRM_MIN_PATH_RATIO = 0.08;

/** 境界阶梯（本阶段只到练气一层） */
export const REALM_LADDER = ['剑道初相', '练气一层'] as const;

/** 由体质拼接第一剑事件（导演使用；不改选项后果） */
export function buildIntentEvent(constitution: Constitution | undefined): ChoiceEvent {
  return {
    title: INTENT_TITLE,
    text: `${constitution?.chapterOpeningFlavor ?? ''}\n${CHAPTER_ONE_OPENING}`,
    options: INTENT_OPTIONS.map((o) => ({
      ...o,
      flavor: constitution?.intentFlavor,
    })),
  };
}

/** 由体质拼接第二剑事件 */
export function buildFateEvent(constitution: Constitution | undefined): ChoiceEvent {
  return {
    title: FATE_TITLE,
    text: '狼血未冷，妖修退去。山道在此分岔：北面是青云剑宗的山门，东南是漫无边际的江湖。第二剑，定你此行的命数。',
    options: FATE_OPTIONS.map((o) => ({
      ...o,
      flavor: constitution?.fateFlavor,
    })),
  };
}

// =====================================================================
// 第九阶段收口：三式剑道机缘（固定白名单，AI 只润色文字）
// =====================================================================

/** 三式固定机缘事实（招式本身来自 TechniqueEngine；此处只有叙事与教学文案） */
export interface TechniqueOpportunityDef {
  kind: TechniqueKindId;
  name: string;
  /** 事件定义 id（AI 叙事 eventId；白名单） */
  eventId: string;
  /** 机缘来源（固定世界事实；先后顺序可因体质/seed 不同，但人人可学全部三式） */
  source: string;
  /** 教学文本（卷轴/传承展示；固定导演文案） */
  teachingText: string;
  /** 练习引导（练习窗口内显示） */
  practiceHint: string;
  /** 轨迹提示（与 TechniqueEngine 几何一致，复用 TrialHud hint） */
  hint: string;
  /** AI 失败/超时的固定导演 fallback */
  fallbackText: string;
}

export const TECHNIQUE_OPPORTUNITIES: readonly TechniqueOpportunityDef[] = [
  {
    kind: 'diagonalSlash',
    name: '斜劈',
    eventId: 'ch1:technique:diagonalSlash',
    source: '老猎户的桦皮剑谱 · 第一页',
    teachingText:
      '剑谱第一页只有半幅画：一笔自上而下、斜中带正。燕迟借你看了半晌：「雾岭的狼，最怕这一笔。」',
    practiceHint: '在下方舞台画一笔对角斜线（左上→右下，或右上→左下）',
    hint: '一笔对角 · 左上右下皆可',
    fallbackText: '桦皮剑谱第一页，一笔斜劈。你的手腕记住了那道斜线的走向。',
  },
  {
    kind: 'cross',
    name: '十字剑',
    eventId: 'ch1:technique:cross',
    source: '老猎户的桦皮剑谱 · 第二页',
    teachingText:
      '第二页是两道交叉的刻痕。燕迟以指代剑，在空中先划一斜、再划一斜：「两笔同落，交叉而过，剑势便立起来了。」',
    practiceHint: '在下方舞台连续画两笔对角线，使其交叉成十字',
    hint: '两笔对角 · 交叉而过',
    fallbackText: '两道刻痕，两笔斜线。十字立处，剑势自成。',
  },
  {
    kind: 'returnWind',
    name: '回风式',
    eventId: 'ch1:technique:returnWind',
    source: '燕迟的半句点拨',
    teachingText:
      '山风打着旋掠过火堆。燕迟忽然道：「看那风——剑也可以这样回来。」他把手腕一翻，剑走了一圈，又稳稳归鞘。',
    practiceHint: '在下方舞台画一个受控的弧形回转，让剑尖回到起点附近',
    hint: '弧形回转 · 剑归原位',
    fallbackText: '剑随风走一圈，又回到原处。回风式，成于归鞘的那一瞬。',
  },
];

export function findTechniqueOpportunity(kind: TechniqueKindId): TechniqueOpportunityDef {
  return TECHNIQUE_OPPORTUNITIES.find((t) => t.kind === kind)!;
}

/** 体质 → 三式学习顺序倾向（只影响先后，不影响能否学全） */
const CONSTITUTION_TECHNIQUE_ORDER: Record<string, TechniqueKindId[]> = {
  'chill-meridian': ['cross', 'diagonalSlash', 'returnWind'],
  'thin-sword-heart': ['diagonalSlash', 'cross', 'returnWind'],
  'slow-blood': ['returnWind', 'cross', 'diagonalSlash'],
  'keen-senses': ['diagonalSlash', 'returnWind', 'cross'],
  'frail-bone': ['returnWind', 'diagonalSlash', 'cross'],
  'stray-fire': ['cross', 'returnWind', 'diagonalSlash'],
};

/**
 * 派生本局三式学习顺序（纯函数，seed + 体质倾向）：
 * - 同 seed 同体质 → 同顺序（存档稳定）；
 * - 若 seed 指向的体质倾向顺序与默认相同，则做一次确定性轮转（体现机缘先后之别）；
 * - 返回值恒为三式全排列，任何体质都不锁死任何一式。
 */
/** 三式阶段记录的空结构（全部 LOCKED；requiredSuccesses 默认 1 次有效几何） */
export function emptyTechniqueStages(): Record<TechniqueKindId, TechniqueStage> {
  return { diagonalSlash: 'LOCKED', cross: 'LOCKED', returnWind: 'LOCKED' };
}
export function emptyPracticeCounts(): Record<TechniqueKindId, number> {
  return { diagonalSlash: 0, cross: 0, returnWind: 0 };
}
export function defaultRequiredSuccesses(): Record<TechniqueKindId, number> {
  return { diagonalSlash: 1, cross: 1, returnWind: 1 };
}
export function emptyPracticeEventIds(): Record<TechniqueKindId, { eventInstanceId: string; requestId: string } | null> {
  return { diagonalSlash: null, cross: null, returnWind: null };
}

export function deriveTechniqueOrder(seed: number, constitutionId: string): TechniqueKindId[] {
  const base = CONSTITUTION_TECHNIQUE_ORDER[constitutionId] ?? [
    'diagonalSlash',
    'cross',
    'returnWind',
  ];
  const r = (seed >>> 0) % 3;
  if (r === 0) return [...base];
  // 确定性轮转：r=1 左移一位，r=2 右移一位
  if (r === 1) return [base[1], base[2], base[0]];
  return [base[2], base[0], base[1]];
}

/** 剑道机缘阶段的固定提示语 */
export const TECHNIQUE_GATE_TITLE = '剑道机缘 · 三式传承';