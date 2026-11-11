import { registerBossSummary } from './helpers/registerBossSummary';
import { finishChoiceNarrative } from './helpers/finishChoiceNarrative';
/**
 * 第五阶段测试：Life 层纯逻辑（开局身份生成/第一章两选择/边界）。
 * 全部确定性数据断言，无随机假成功：
 * - 性别必须先于随机身份生成；同一 seed 生成结果稳定，身份来自有限配置库；
 * - 残缺体质制造开局差异（开场文本/选项 flavor），且不携带统一身世秘密、不触碰战斗数值；
 * - 两次选择状态转移、三选项结构、非法选项安全、确认剑只需统一 ACTIVE 有效移动；
 * - 同伴互动可跳过且只写旗标；第一章完成推进境界并停在「踏入九州」边界，不建地图。
 */
import { describe, expect, it } from 'vitest';
import {
  LifeEngine,
  isConfirmStroke,
  createInitialLifeState,
} from '@/life/lifeEngine';
import {
  LIFE_CONSTITUTIONS,
  LIFE_SURNAMES,
  LIFE_MALE_NAMES,
  LIFE_FEMALE_NAMES,
  LIFE_ORIGINS,
  INTENT_OPTIONS,
  FATE_OPTIONS,
} from '@/life/lifeConfig';
import { createDeterministicDirector } from '@/life/lifeDirector';
import type { LifeState } from '@/life/lifeTypes';


/** v33 身份受控事件：身份事件落定辅助（PROFILE_REVIEW AI-FIRST 门） */
function settleIdentity(e: LifeEngine, atMs: number): void {
  const ev = e.getState().activeEvent;
  if (ev && ev.eventDefinitionId === 'profile:identity') {
    e.settleNarrative(ev.requestId, atMs);
  }
}

const NOW = 1000;

function newEngine(): LifeEngine {
  return new LifeEngine();
}

/** 走完开局直到 PROFILE_REVIEW 的固定流程 */
function engineWithProfile(seed = 12345): { engine: LifeEngine; state: LifeState } {
  const engine = newEngine();
  engine.loadSeed(seed);
  engine.selectGender('male', NOW);
  engine.generateIdentity(NOW + 10);
  settleIdentity(engine, NOW + 10 + 0.1);
  return { engine, state: engine.getState() };
}


/** 第九阶段：Boss 胜利 Summary（最小事实） */
function makeVictorySummary() {
  return {
    encounterId: 'chapter1_red_eye_ape',
    battleId: 'battle-test-1',
    result: 'victory',
    duration: 75000,
    slashCount: 18,
    techniqueUsage: [{ kind: 'cross', count: 2 }],
    projectilesCut: 2,
    blocks: 3,
    interrupts: 1,
    breakStanceCount: 1,
    averageSpeed: 2.1,
    accuracyScore: 82,
    stabilityScore: 85,
    weakPointHits: 1,
    qiDepletedCount: 0,
    damageTaken: 12,
    overspeedCount: 0,
  } as import('../src/combat/combatEngine').BattleSummary;
}

describe('Life 开局顺序与身份生成', () => {
  it('初始状态字段完整、phase=PROFILE_GENDER、无 undefined', () => {
    const s = createInitialLifeState();
    expect(s.schemaVersion).toBe(2);
    expect(s.phase).toBe('PROFILE_GENDER');
    expect(s.pendingGender).toBeNull();
    expect(s.profile).toBeNull();
    expect(s.seed).toBeGreaterThan(0);
    expect(s.chapterIndex).toBe(0);
    expect(s.eventIndex).toBe(0);
    expect(s.choiceStage).toBe('intent');
    expect(s.pendingChoiceId).toBeNull();
    expect(s.chosen.intent).toBeNull();
    expect(s.chosen.fate).toBeNull();
    expect(s.realm).toBe('剑道初相');
    expect(typeof s.updatedAt).toBe('number');
    expect(s.companionState.met).toBe(false);
    expect(s.companionState.response).toBeNull();
  });

  it('性别必须先于身份生成：PROFILE_GENDER 下生成无效', () => {
    const e = newEngine();
    expect(e.generateIdentity(NOW)).toBe(false);
    expect(e.getState().phase).toBe('PROFILE_GENDER');
    expect(e.getState().profile).toBeNull();
  });

  it('选择性别后进入 PROFILE_GENERATING，再生成进入 PROFILE_REVIEW', () => {
    const e = newEngine();
    expect(e.selectGender('female', NOW)).toBe(true);
    expect(e.getState().phase).toBe('PROFILE_GENERATING');
    expect(e.generateIdentity(NOW + 1)).toBe(true);
    const s = e.getState();
    expect(s.phase).toBe('PROFILE_REVIEW');
    expect(s.profile).not.toBeNull();
    expect(s.profile!.gender).toBe('female');
  });

  it('同一 seed + 性别生成结果完全稳定；不同 seed 产生差异', () => {
    const a = new LifeEngine();
    a.loadSeed(777);
    a.selectGender('male', NOW);
    a.generateIdentity(NOW);
    settleIdentity(a, NOW + 0.1);
    const b = new LifeEngine();
    b.loadSeed(777);
    b.selectGender('male', NOW + 9999); // 时间不同，seed 相同
    b.generateIdentity(NOW + 5000);
    settleIdentity(b, NOW + 5000 + 0.1);
    expect(b.getState().profile).toEqual(a.getState().profile);

    // 不同 seed：有限库内采样，统计多个 seed 应覆盖至少两种不同身份
    const names = new Set<string>();
    for (let seed = 1; seed <= 24; seed++) {
      const e = new LifeEngine();
      e.loadSeed(seed);
      e.selectGender('male', NOW);
      e.generateIdentity(NOW);
      settleIdentity(e, NOW + 0.1);
      names.add(e.getState().profile!.name);
    }
    expect(names.size).toBeGreaterThanOrEqual(2);
  });

  it('姓名/出身/体质均来自有限配置库', () => {
    const maleNames = new Set(LIFE_MALE_NAMES);
    const femaleNames = new Set(LIFE_FEMALE_NAMES);
    const origins = new Set(LIFE_ORIGINS.map((o) => o.id));
    const cons = new Set(LIFE_CONSTITUTIONS.map((c) => c.id));
    for (let seed = 1; seed <= 40; seed++) {
      for (const gender of ['male', 'female'] as const) {
        const e = new LifeEngine();
        e.loadSeed(seed * 131 + (gender === 'female' ? 7 : 3));
        e.selectGender(gender, NOW);
        e.generateIdentity(NOW);
        settleIdentity(e, NOW + 0.1);
        const p = e.getState().profile!;
        const surname = p.name.slice(0, 1);
        const given = p.name.slice(1);
        expect(LIFE_SURNAMES).toContain(surname);
        if (gender === 'male') expect(maleNames.has(given)).toBe(true);
        else expect(femaleNames.has(given)).toBe(true);
        expect(origins.has(p.originId)).toBe(true);
        expect(cons.has(p.constitutionId)).toBe(true);
        // 性别只作生成输入，不决定数值（体质与性别无绑定）
      }
    }
  });

  it('重新生成是显式动作且更换 seed；无动作时身份不漂移', () => {
    const { engine, state } = engineWithProfile(4242);
    const before = engine.getState().profile;
    // 多次读取不换身份
    expect(engine.getState().profile).toEqual(before);
    expect(engine.getState().profile).toEqual(state.profile);
    // 未确认前的其它动作不触发重生成
    expect(engine.selectGender('female', NOW + 5)).toBe(false);
    expect(engine.getState().profile).toEqual(before);
    // 显式重生成：seed 更新，身份可变（有限库内允许偶发相同姓名，但 seed 必变）
    const seedBefore = engine.getState().seed;
    expect(engine.regenerateIdentity(NOW + 100)).toBe(true);
    expect(engine.getState().seed).not.toBe(seedBefore);
    expect(engine.getState().phase).toBe('PROFILE_REVIEW');
    // v33：重生成开新 identity 事件（PENDING）——未落定不可确认，仍留在 REVIEW
    expect(engine.getState().activeEvent?.eventDefinitionId).toBe('profile:identity');
    expect(engine.getState().activeEvent?.phase).toBe('NARRATIVE_PENDING');
    expect(engine.confirmProfile(NOW + 200)).toBe(false);
    expect(engine.getState().phase).toBe('PROFILE_REVIEW');
    // 落定新身份正文后才可确认；确认后进入 SENSING_GATE，非 REVIEW 不可再重生成
    settleIdentity(engine, NOW + 250);
    expect(engine.confirmProfile(NOW + 260)).toBe(true);
    expect(engine.getState().phase).toBe('SENSING_GATE');
    expect(engine.regenerateIdentity(NOW + 300)).toBe(false);
  });
});

describe('残缺体质：开局差异与边界', () => {
  it('体质字段完整：repairable/transformable/pathTags 存在且无越权键', () => {
    const allowed = new Set([
      'id',
      'title',
      'text',
      'tags',
      'repairable',
      'transformable',
      'pathTags',
      'chapterOpeningFlavor',
      'intentFlavor',
      'fateFlavor',
      'chapterSummary',
    ]);
    for (const c of LIFE_CONSTITUTIONS) {
      for (const key of Object.keys(c)) {
        expect(allowed.has(key)).toBe(true);
      }
      expect(typeof c.repairable).toBe('boolean');
      expect(typeof c.transformable).toBe('boolean');
      expect(Array.isArray(c.pathTags)).toBe(true);
      expect(c.pathTags.length).toBeGreaterThan(0);
      expect(typeof c.chapterOpeningFlavor).toBe('string');
    }
    // 至少存在可修补与可转化两种机缘事实
    expect(LIFE_CONSTITUTIONS.some((c) => c.repairable)).toBe(true);
    expect(LIFE_CONSTITUTIONS.some((c) => c.transformable)).toBe(true);
  });

  it('不同体质使第一章开场文本与选项 flavor 产生可断言差异', () => {
    const director = createDeterministicDirector();
    const flavors = new Set<string>();
    for (const c of LIFE_CONSTITUTIONS) {
      const e = new LifeEngine();
      e.loadSeed(2024);
      e.selectGender('male', NOW);
      e.generateIdentity(NOW);
      settleIdentity(e, NOW + 0.1);
      e.confirmProfile(NOW + 1);
e.completeSensing(NOW + 1 + 1);
      e.beginFirstChoice(NOW + 2);
e.settleNarrative(e.eventIdentity()!.requestId, NOW + 2 + 1);
      const st = e.getState();
      // 强制体质（生成结果可能重复采样，直接按体质逐一断言）
      const state = { ...st, profile: { ...st.profile!, constitutionId: c.id } };
      const event = director.getChoiceEvent(state);
      const flavorText = `${event.text}||${event.options.map((o) => o.shortText).join('//')}`;
      flavors.add(flavorText);
      expect(event.text).toContain(c.chapterOpeningFlavor);
    }
    // 每个体质的可读文本互不相同
    expect(flavors.size).toBe(LIFE_CONSTITUTIONS.length);
  });

  it('体质不产生统一身世秘密：开场 flavor 互不相同且无共享「真相」字段', () => {
    const texts = LIFE_CONSTITUTIONS.map((c) => c.chapterOpeningFlavor);
    expect(new Set(texts).size).toBe(LIFE_CONSTITUTIONS.length);
    for (const c of LIFE_CONSTITUTIONS) {
      expect(Object.keys(c)).not.toContain('secret');
      expect(Object.keys(c)).not.toContain('truth');
    }
  });
});


/** 第九阶段收口：走完 TECHNIQUE_GATE 三式机缘（教学叙事落定 + 练习成招 ×3）→ BOSS_GATE */
function completeAllTechniques(engine: import('../src/life/lifeEngine').LifeEngine, t: number): void {
  for (let i = 0; i < 3; i++) {
    const id = engine.eventIdentity();
    if (!id) return;
    engine.settleNarrative(id.requestId, t + i);
    const kind = engine.currentTechniqueKind()!;
    engine.acknowledgeTechniqueManual(kind, t + i + 0.5); // v33
    engine.beginTechniquePractice(kind, t + i + 0.5);
    expect(engine.completeTechniquePractice(kind, t + i + 0.5)).toBe(true);
  }
  expect(engine.getState().phase).toBe('BOSS_GATE');
}

describe('第一章两次命运选择：状态转移与确认剑', () => {
  it('确认后先入 SENSING_GATE（剑意感应），感应完成进入 TRIAL_GATE，开始第一剑进入 FATE_CHOICE_INTENT', () => {
    const { engine } = engineWithProfile();
    expect(engine.confirmProfile(NOW)).toBe(true);
    expect(engine.getState().phase).toBe('SENSING_GATE');
    expect(engine.completeSensing(NOW + 0.5)).toBe(true);
    expect(engine.getState().phase).toBe('TRIAL_GATE');
    expect(engine.beginFirstChoice(NOW + 1)).toBe(true);
    expect(engine.getState().phase).toBe('FATE_CHOICE_INTENT');
    expect(engine.getState().choiceStage).toBe('intent');
  });

  it('每个选择事件恰好三个选项，结构完整且 id 唯一', () => {
    const director = createDeterministicDirector();
    const { engine } = engineWithProfile();
    engine.confirmProfile(NOW);
engine.completeSensing(NOW + 1);
    engine.beginFirstChoice(NOW + 1);
engine.settleNarrative(engine.eventIdentity()!.requestId, NOW + 1 + 1);
    const ev1 = director.getChoiceEvent(engine.getState());
    expect(ev1.title).toBe('第一剑 · 择意');
    expect(ev1.options).toHaveLength(3);
    const ids = new Set(ev1.options.map((o) => o.id));
    expect(ids.size).toBe(3);
    for (const o of ev1.options) {
      expect(o.id).toBeTruthy();
      expect(o.title).toBeTruthy();
      expect(o.shortText.length).toBeGreaterThan(4);
      expect(Array.isArray(o.resultFlags)).toBe(true);
      expect(o.resultFlags.length).toBeGreaterThan(0);
      expect(o.resultText).toBeTruthy();
    }
    // 三选项语义互不相同（非同义按钮）
    const titles = new Set(ev1.options.map((o) => o.title));
    expect(titles.size).toBe(3);

    // 推进到第二剑
    engine.selectOption(ev1.options[0].id, NOW + 2);
    engine.confirmChoiceStroke(800, 80, 'ACTIVE', NOW + 3);
    finishChoiceNarrative(engine);
    engine.settleNarrative(engine.eventIdentity()!.requestId, engine.getState().updatedAt + 1);
    engine.respondCompanion('skip', NOW + 4);
    const ev2 = director.getChoiceEvent(engine.getState());
    expect(ev2.title).toBe('第二剑 · 定命');
    expect(ev2.options).toHaveLength(3);
    expect(new Set(ev2.options.map((o) => o.id)).size).toBe(3);
    expect(INTENT_OPTIONS.every((o) => !ev2.options.some((x) => x.id === o.id))).toBe(true);
  });

  it('选择不存在的 option id 安全：不推进、无副作用', () => {
    const { engine } = engineWithProfile();
    engine.confirmProfile(NOW);
engine.completeSensing(NOW + 1);
    engine.beginFirstChoice(NOW + 1);
engine.settleNarrative(engine.eventIdentity()!.requestId, NOW + 1 + 1);
    const before = engine.getState();
    expect(engine.selectOption('no-such-option', NOW + 2)).toBe(false);
    const after = engine.getState();
    expect(after.phase).toBe('FATE_CHOICE_INTENT');
    expect(after.pendingChoiceId).toBe(before.pendingChoiceId);
  });

  it('确认剑判定：ACTIVE 且移动足够才确认；SHEATHED/IDLE/距离不足不确认', () => {
    expect(isConfirmStroke('ACTIVE', 80, 800)).toBe(true);
    expect(isConfirmStroke('ACTIVE', 63, 800)).toBe(false); // < 0.08×800
    expect(isConfirmStroke('SHEATHED', 300, 800)).toBe(false);
    expect(isConfirmStroke('IDLE', 300, 800)).toBe(false);

    const { engine } = engineWithProfile();
    engine.confirmProfile(NOW);
engine.completeSensing(NOW + 1);
    engine.beginFirstChoice(NOW + 1);
engine.settleNarrative(engine.eventIdentity()!.requestId, NOW + 1 + 1);
    const ev = createDeterministicDirector().getChoiceEvent(engine.getState());
    engine.selectOption(ev.options[1].id, NOW + 2);
    // 收势/丢手/距离不足：均不确认
    expect(engine.confirmChoiceStroke(800, 300, 'SHEATHED', NOW + 3)).toBe(false);
    expect(engine.confirmChoiceStroke(800, 300, 'IDLE', NOW + 4)).toBe(false);
    expect(engine.confirmChoiceStroke(800, 30, 'ACTIVE', NOW + 5)).toBe(false);
    expect(engine.getState().phase).toBe('FATE_CHOICE_INTENT');
    expect(engine.getState().pendingChoiceId).toBe(ev.options[1].id);
    // 有效 ACTIVE 移动确认
    expect(engine.confirmChoiceStroke(800, 90, 'ACTIVE', NOW + 6)).toBe(true);
    finishChoiceNarrative(engine);
    const s = engine.getState();
    expect(s.pendingChoiceId).toBeNull();
    expect(s.chosen.intent).toBe(ev.options[1].id);
  });

  it('未选中选项时确认剑无效（须先择一再出剑）', () => {
    const { engine } = engineWithProfile();
    engine.confirmProfile(NOW);
engine.completeSensing(NOW + 1);
    engine.beginFirstChoice(NOW + 1);
engine.settleNarrative(engine.eventIdentity()!.requestId, NOW + 1 + 1);
    expect(engine.confirmChoiceStroke(800, 200, 'ACTIVE', NOW + 2)).toBe(false);
    expect(engine.getState().phase).toBe('FATE_CHOICE_INTENT');
  });

  it('确认期间重选候选：以最后一次为准', () => {
    const { engine } = engineWithProfile();
    engine.confirmProfile(NOW);
engine.completeSensing(NOW + 1);
    engine.beginFirstChoice(NOW + 1);
engine.settleNarrative(engine.eventIdentity()!.requestId, NOW + 1 + 1);
    const ev = createDeterministicDirector().getChoiceEvent(engine.getState());
    engine.selectOption(ev.options[0].id, NOW + 2);
    engine.selectOption(ev.options[2].id, NOW + 3);
    engine.confirmChoiceStroke(800, 100, 'ACTIVE', NOW + 4);
    finishChoiceNarrative(engine);
    expect(engine.getState().chosen.intent).toBe(ev.options[2].id);
  });
});

describe('同行者互动与第一章边界', () => {
  /** 走到 COMPANION_EVENT 的引擎 */
  function atCompanion(): { engine: LifeEngine; eventId: string } {
    const { engine } = engineWithProfile(31415);
    engine.confirmProfile(NOW);
engine.completeSensing(NOW + 1);
    engine.beginFirstChoice(NOW + 1);
engine.settleNarrative(engine.eventIdentity()!.requestId, NOW + 1 + 1);
    const ev = createDeterministicDirector().getChoiceEvent(engine.getState());
    engine.selectOption(ev.options[0].id, NOW + 2);
    engine.confirmChoiceStroke(800, 100, 'ACTIVE', NOW + 3);
    finishChoiceNarrative(engine);
    return { engine, eventId: ev.options[0].id };
  }

  it('第一剑确认后进入 COMPANION_EVENT，可跳过且只写旗标', () => {
    const { engine, eventId } = atCompanion();
    expect(engine.getState().phase).toBe('COMPANION_EVENT');
    const before = engine.getState();
    engine.settleNarrative(engine.eventIdentity()!.requestId, engine.getState().updatedAt + 1);
    expect(engine.respondCompanion('skip', NOW + 4)).toBe(true);
    const s = engine.getState();
    expect(s.phase).toBe('FATE_CHOICE_FATE');
    expect(s.companionState.skipped).toBe(true);
    expect(s.companionState.response).toBeNull();
    expect(s.companionState.flag).toBeNull();
    // 跳过不锁主线、不产生战斗数值：flags 无新增
    expect(Object.keys(s.flags).length).toBe(Object.keys(before.flags).length);
    expect(s.chosen.intent).toBe(eventId);
  });

  it('两种回应各写独立非数值旗标，不触碰战斗', () => {
    const { engine } = atCompanion();
    engine.settleNarrative(engine.eventIdentity()!.requestId, engine.getState().updatedAt + 1);
    engine.respondCompanion('warm', NOW + 4);
    const warm = engine.getState();
    expect(warm.companionState.response).toBe('warm');
    expect(typeof warm.companionState.flag).toBe('string');
    expect(warm.flags[warm.companionState.flag!]).toBe(true);
    // 旗标值为布尔，不夹带数值（JSON 序列化后无数字伤害语义）
    expect(warm.companionState.flag).not.toMatch(/qi|damage|hp/i);

    const { engine: e2 } = atCompanion();
    e2.settleNarrative(e2.eventIdentity()!.requestId, e2.getState().updatedAt + 1);
    e2.respondCompanion('reserved', NOW + 4);
    const reserved = e2.getState();
    expect(reserved.companionState.response).toBe('reserved');
    expect(reserved.companionState.flag).not.toBe(warm.companionState.flag);
    expect(reserved.phase).toBe('FATE_CHOICE_FATE');
  });

  it('COMPANION_EVENT 非法回应安全拒绝', () => {
    const { engine } = atCompanion();
    expect(engine.respondCompanion('gossip' as 'warm', NOW)).toBe(false);
    expect(engine.getState().phase).toBe('COMPANION_EVENT');
  });

  it('第二剑确认后 CHAPTER_RESULT：显示真实选择并推进境界到练气一层', () => {
    const { engine } = engineWithProfile(27182);
    engine.confirmProfile(NOW);
engine.completeSensing(NOW + 1);
    engine.beginFirstChoice(NOW + 1);
engine.settleNarrative(engine.eventIdentity()!.requestId, NOW + 1 + 1);
    const d = createDeterministicDirector();
    const ev1 = d.getChoiceEvent(engine.getState());
    engine.selectOption(ev1.options[2].id, NOW + 2);
    engine.confirmChoiceStroke(800, 120, 'ACTIVE', NOW + 3);
    finishChoiceNarrative(engine);
    engine.settleNarrative(engine.eventIdentity()!.requestId, engine.getState().updatedAt + 1);
    engine.respondCompanion('skip', NOW + 4);
engine.settleNarrative(engine.eventIdentity()!.requestId, NOW + 4 + 1);
    expect(engine.getState().phase).toBe('FATE_CHOICE_FATE');
    const ev2 = d.getChoiceEvent(engine.getState());
    engine.selectOption(ev2.options[1].id, NOW + 5);
    engine.confirmChoiceStroke(800, 120, 'ACTIVE', NOW + 6);
    finishChoiceNarrative(engine);
    // 第九阶段收口：第二剑定命后先入 TECHNIQUE_GATE（三式机缘），三式成招后才进 Boss 终局
    expect(engine.getState().phase).toBe('TECHNIQUE_GATE');
    completeAllTechniques(engine, NOW + 6.2);
    expect(engine.getState().phase).toBe('BOSS_GATE');
    expect(engine.reportBossVictory(registerBossSummary(engine, makeVictorySummary()), NOW + 6.5)).toBe(true);
    const s = engine.getState();
    expect(s.phase).toBe('CHAPTER_RESULT');
    expect(s.chosen.intent).toBe(ev1.options[2].id);
    expect(s.chosen.fate).toBe(ev2.options[1].id);
    expect(s.realm).toBe('练气一层');
    // 选项后果旗标落位
    for (const o of [...ev1.options, ...ev2.options]) {
      if (o.id === ev1.options[2].id || o.id === ev2.options[1].id) {
        for (const f of o.resultFlags) expect(s.flags[f]).toBe(true);
      }
    }
    // 未选选项的旗标不落位
    for (const o of ev1.options) {
      if (o.id !== ev1.options[2].id) {
        for (const f of o.resultFlags) expect(s.flags[f]).toBeUndefined();
      }
    }
  });

  it('CHAPTER_RESULT 进入 JOURNEY_GATE（踏入九州边界，无地图数据）', () => {
    const { engine } = engineWithProfile(60221);
    engine.confirmProfile(NOW);
engine.completeSensing(NOW + 1);
    engine.beginFirstChoice(NOW + 1);
engine.settleNarrative(engine.eventIdentity()!.requestId, NOW + 1 + 1);
    const d = createDeterministicDirector();
    const ev1 = d.getChoiceEvent(engine.getState());
    engine.selectOption(ev1.options[0].id, NOW + 2);
    engine.confirmChoiceStroke(800, 120, 'ACTIVE', NOW + 3);
    finishChoiceNarrative(engine);
    engine.settleNarrative(engine.eventIdentity()!.requestId, engine.getState().updatedAt + 1);
    engine.respondCompanion('skip', NOW + 4);
engine.settleNarrative(engine.eventIdentity()!.requestId, NOW + 4 + 1);
    const ev2 = d.getChoiceEvent(engine.getState());
    engine.selectOption(ev2.options[0].id, NOW + 5);
    engine.confirmChoiceStroke(800, 120, 'ACTIVE', NOW + 6);
    finishChoiceNarrative(engine);
    completeAllTechniques(engine, NOW + 6.2);
    engine.reportBossVictory(registerBossSummary(engine, makeVictorySummary()), NOW + 6.5);
    // 剑道初相正文落定后收束解锁
    engine.settleNarrative(engine.eventIdentity()!.requestId, NOW + 6.8);
    expect(engine.enterJourney(NOW + 7)).toBe(true);
    const s = engine.getState();
    expect(s.phase).toBe('JOURNEY_GATE');
    expect(s.realm).toBe('练气一层');
    // 边界为终态：后续动作均安全拒绝，不推进第二章
    expect(engine.enterJourney(NOW + 8)).toBe(false);
    expect(engine.beginFirstChoice(NOW + 9)).toBe(false);
    expect(engine.getState().phase).toBe('JOURNEY_GATE');
    // 状态序列化不含地图/探索字段
    const keys = Object.keys(s);
    expect(keys.some((k) => /map|world|explore/i.test(k))).toBe(false);
  });
});

describe('确定性导演与 AI 边界', () => {
  it('导演 source 固定为 deterministic；选项与配置表一致', () => {
    const d = createDeterministicDirector();
    expect(d.source).toBe('deterministic');
    expect(d.source).not.toBe('ai');
  });

  it('导演不产生配置表之外的选项 id', () => {
    const d = createDeterministicDirector();
    const { engine } = engineWithProfile(9);
    engine.confirmProfile(NOW);
engine.completeSensing(NOW + 1);
    engine.beginFirstChoice(NOW + 1);
engine.settleNarrative(engine.eventIdentity()!.requestId, NOW + 1 + 1);
    const ev = d.getChoiceEvent(engine.getState());
    for (const o of ev.options) {
      expect(INTENT_OPTIONS.some((x) => x.id === o.id)).toBe(true);
      expect(FATE_OPTIONS.some((x) => x.id === o.id)).toBe(false);
    }
  });
});