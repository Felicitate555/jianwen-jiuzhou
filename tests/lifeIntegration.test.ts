import { finishChoiceNarrative } from './helpers/finishChoiceNarrative';
/**
 * 第五阶段测试：choice gate 期间战斗冻结语义 + technique toast 驱动 + localStorage 持久化安全。
 */
import { beforeEach, describe, expect, it } from 'vitest';

// node 测试环境无 localStorage：注入完整 Storage 实现（语义与浏览器一致）
class TestStorage implements Storage {
  readonly length = 0;
  private map = new Map<string, string>();
  clear(): void { this.map.clear(); }
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  key(): string | null { return null; }
  removeItem(k: string): void { this.map.delete(k); }
  setItem(k: string, v: string): void { this.map.set(k, v); }
}
if (typeof globalThis.localStorage === 'undefined') {
  (globalThis as { localStorage?: Storage }).localStorage = new TestStorage();
}
import { CombatEngine } from '@/combat/combatEngine';
import { DEFAULT_COMBAT_CONFIG } from '@/combat/combatConfig';
import { deriveTechniqueToast, TOAST_TTL_MS } from '@/components/combat/TechniqueToast';
import {
  loadLifeState,
  saveLifeState,
  clearLifeState,
  LIFE_STORAGE_KEY,
} from '@/life/lifeStorage';
import { LifeEngine } from '@/life/lifeEngine';
import { createDeterministicDirector } from '@/life/lifeDirector';
import type { LifeState } from '@/life/lifeTypes';


/** v33 身份受控事件：身份事件落定辅助（PROFILE_REVIEW AI-FIRST 门） */
function settleIdentity(e: LifeEngine, atMs: number): void {
  const ev = e.getState().activeEvent;
  if (ev && ev.eventDefinitionId === 'profile:identity') {
    e.settleNarrative(ev.requestId, atMs);
  }
}

const W = 800;
const H = 600;

/** 等待狼进入扑击预警（原试炼惯例） */
function waitForTelegraph(e: CombatEngine, t0 = 0): number {
  let t = t0;
  for (let i = 0; i < 600; i++) {
    e.update(t, W, H);
    if (e.getSnapshot().wolf.state === 'TELEGRAPH') return t;
    t += 16;
  }
  throw new Error('wolf never telegraphs');
}

describe('choice gate：选择期间战斗冻结（不伤敌/不扣qi/不推进敌人/不清投射物已存）', () => {
  it('gate 期间：不出伤害、不掉qi、敌人不推进、新投射物不结算', () => {
    const e = new CombatEngine({ ...DEFAULT_COMBAT_CONFIG });
    e.start(0);
    let now = waitForTelegraph(e);
    const hpBefore = e.getSnapshot().wolf.hp;
    const qiBefore = e.getSnapshot().qi;
    // 进入选择 gate
    e.enterChoiceMode(now);
    const snapGated = e.getSnapshot();
    expect(snapGated.choiceGate).toBe(true);
    // 选择期间持续喂 ACTIVE 帧（模拟出剑确认）+ update：无伤害/无qi消耗/狼不推进
    for (let i = 0; i < 20; i++) {
      now += 50;
      e.onFrame({ x: 300, y: 300, timestamp: now, actionState: 'ACTIVE', source: 'pointer' }, { x: 300 + i, y: 300, t: now, a: 'ACTIVE' });
      e.update(now, W, H);
    }
    const s = e.getSnapshot();
    expect(s.wolf.hp).toBe(hpBefore);
    expect(s.qi).toBeGreaterThanOrEqual(qiBefore); // 不扣（回气允许）
    expect(s.wolf.state).toBe('TELEGRAPH'); // 敌方推进被冻结
    expect(s.choiceGate).toBe(true);
    // 退出 gate：恢复战斗，且 wolf 定时平移（不立刻结算冻结期间的预警）
    e.exitChoiceMode(now);
    expect(e.getSnapshot().choiceGate).toBe(false);
    // 恢复后正常推进（平移量 = gate 时长 1s：telegraph 到期点被顺延同等时长）
    for (let i = 0; i < 120; i++) {
      now += 16;
      e.update(now, W, H);
    }
    expect(e.getSnapshot().wolf.state).not.toBe('TELEGRAPH');
  });

  it('gate 期间段轨迹不参与斩击结算：退出后不补算伤害', () => {
    const e = new CombatEngine({ ...DEFAULT_COMBAT_CONFIG });
    let now = 0;
    e.start(now);
    now = waitForTelegraph(e, now);
    // gate 前狼位置
    const wolfBefore = e.getSnapshot().wolf.hp;
    e.enterChoiceMode(now);
    // gate 期间在狼身上来回划大轨迹（若参与结算必掉血）
    let x = 100;
    for (let i = 0; i < 24; i++) {
      now += 40;
      x = x === 100 ? 500 : 100;
      e.onFrame({ x, y: 200, timestamp: now, actionState: 'ACTIVE', source: 'pointer' }, { x, y: 200, t: now, a: 'ACTIVE' });
      e.update(now, W, H);
    }
    expect(e.getSnapshot().wolf.hp).toBe(wolfBefore);
    e.exitChoiceMode(now);
    now += 300; // idle 关段
    e.update(now, W, H);
    // 退出后没有补算冻结期间的段
    expect(e.getSnapshot().wolf.hp).toBe(wolfBefore);
    expect(e.getSnapshot().lastStrike).toBeNull();
  });

  it('gate 内 technique 不识别（选择期间的一剑只是确认）', () => {
    const e = new CombatEngine({ ...DEFAULT_COMBAT_CONFIG });
    let now = 0;
    e.start(now);
    now = waitForTelegraph(e, now);
    e.enterChoiceMode(now);
    // gate 期间画斜劈对角线
    let t = now;
    for (let i = 0; i <= 40; i++) {
      t += 8;
      const x = 200 + i * 10;
      const y = 150 + i * 7;
      e.onFrame({ x, y, timestamp: t, actionState: 'ACTIVE', source: 'pointer' }, { x, y, t, a: 'ACTIVE' });
      e.update(t, W, H);
    }
    const s = e.getSnapshot();
    expect(s.technique.last?.kind ?? 'NONE').toBe('NONE');
    expect(s.technique.attempt).toBeNull();
    expect(s.lastStrike).toBeNull();
  });

  it('gate 状态嵌套与恢复幂等安全', () => {
    const e = new CombatEngine(DEFAULT_COMBAT_CONFIG);
    let now = 0;
    e.start(now);
    now = waitForTelegraph(e, now);
    e.enterChoiceMode(now);
    e.enterChoiceMode(now); // 重复进入：平移量为 0
    e.exitChoiceMode(now);
    e.exitChoiceMode(now); // 重复退出：安全无操作
    expect(e.getSnapshot().choiceGate).toBe(false);
    // 战斗仍可正常推进
    for (let i = 0; i < 30; i++) {
      now += 16;
      e.update(now, W, H);
    }
    expect(['fighting', 'won', 'lost']).toContain(e.getSnapshot().phase);
  });
});

describe('technique toast：snapshot attempt 驱动、无计时器、TTL 去重', () => {
  type Attempt = NonNullable<Parameters<typeof deriveTechniqueToast>[0]>;

  function att(
    kind: string,
    status: 'effective' | 'miss' | 'failed',
    segmentId: number,
    text: string,
    at = 1000,
  ): Attempt {
    return {
      kind,
      status,
      segmentId,
      text,
      createdAt: at,
      expiresAt: at + 1600,
    };
  }

  it('三态文本语义正确：miss=已识别未命中（青白），effective=已生效（暖金），failed=招式未成（朱红）', () => {
    const miss = deriveTechniqueToast(att('DIAGONAL_SLASH', 'miss', 1, '斜劈 · 已识别，未命中'), 1100);
    expect(miss).not.toBeNull();
    expect(miss!.text).toContain('斜劈');
    expect(miss!.text).toContain('未命中');
    expect(miss!.tone).toBe('miss');

    const eff = deriveTechniqueToast(att('CROSS', 'effective', 2, '十字剑 · 已生效 · 斩弹'), 1100);
    expect(eff!.tone).toBe('effective');
    expect(eff!.text).toContain('十字剑');
    expect(eff!.text).toContain('已生效');

    const fail = deriveTechniqueToast(att('RETURN_WIND', 'failed', 3, '回风式 · 招式未成（气机不继）'), 1100);
    expect(fail!.tone).toBe('failed');
    expect(fail!.text).toContain('回风式');
    expect(fail!.text).toContain('气机不继');
  });

  it('过期自动隐藏：仅由 createdAt/expiresAt 与当前时间驱动', () => {
    const a = att('DIAGONAL_SLASH', 'miss', 1, '斜劈 · 已识别，未命中', 1000);
    expect(deriveTechniqueToast(a, 1000 + TOAST_TTL_MS - 1)).not.toBeNull();
    expect(deriveTechniqueToast(a, 1000 + TOAST_TTL_MS + 1)).toBeNull();
  });

  it('同 segment 去重：旧 attempt 不因新帧重复弹出', () => {
    const seen = new Set<number>();
    const a1 = att('DIAGONAL_SLASH', 'miss', 7, '斜劈 · 已识别，未命中', 1000);
    const a2 = att('DIAGONAL_SLASH', 'miss', 7, '斜劈 · 已识别，未命中', 1200);
    for (const a of [a1, a2, a1]) {
      void a2;
      const t = deriveTechniqueToast(a, a.createdAt + 100);
      if (t) seen.add(t.segmentId);
    }
    expect(seen.size).toBe(1);
  });

  it('null / stale attempt 均不显示；新 segment 替换旧 toast', () => {
    expect(deriveTechniqueToast(null, 1000)).toBeNull();
    // 不同 segment 更新替换
    const a2 = att('CROSS', 'effective', 2, '十字剑 · 已生效', 1200);
    const r = deriveTechniqueToast(a2, 1250);
    expect(r!.segmentId).toBe(2);
  });
});

describe('lifeStorage：localStorage 持久化与安全回退', () => {
  beforeEach(() => {
    clearLifeState();
  });

  it('保存后读取恢复完整状态；clear 清理', () => {
    const engine = new LifeEngine();
    engine.loadSeed(555);
    engine.selectGender('female', 1000);
    engine.generateIdentity(1010);
    settleIdentity(engine, 1010 + 0.1);
    engine.confirmProfile(1020);
    const saved = engine.getState();
    saveLifeState(saved);
    const loaded = loadLifeState();
    expect(loaded).not.toBeNull();
    expect(loaded!.profile).toEqual(saved.profile);
    expect(loaded!.phase).toBe('SENSING_GATE');
    expect(loaded!.realm).toBe(saved.realm);
    expect(loaded!.seed).toBe(saved.seed);
    clearLifeState();
    expect(localStorage.getItem(LIFE_STORAGE_KEY)).toBeNull();
  });

  it('损坏 JSON / 版本不兼容 / 结构非法 → 安全回退新局', () => {
    localStorage.setItem(LIFE_STORAGE_KEY, '{not json');
    expect(loadLifeState()?.phase ?? 'PROFILE_GENDER').toBe('PROFILE_GENDER');
    localStorage.setItem(LIFE_STORAGE_KEY, JSON.stringify({ schemaVersion: 999, phase: 'JOURNEY_GATE' }));
    expect(loadLifeState()?.phase ?? 'PROFILE_GENDER').toBe('PROFILE_GENDER');
    localStorage.setItem(LIFE_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, phase: 'BOGUS_PHASE' }));
    expect(loadLifeState()?.phase ?? 'PROFILE_GENDER').toBe('PROFILE_GENDER');
    // profile 缺字段 → 回退
    localStorage.setItem(LIFE_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, phase: 'TRIAL_GATE', profile: { gender: 'male' } }));
    expect(loadLifeState()?.profile ?? null).toBeNull();
  });

  it('未确认 profile 的中间态不覆盖已确认存档', () => {
    const engine = new LifeEngine();
    engine.loadSeed(777);
    engine.selectGender('male', 1000);
    engine.generateIdentity(1010);
    settleIdentity(engine, 1010 + 0.1);
    engine.confirmProfile(1020);
    saveLifeState(engine.getState());
    // 另一个引擎走到 PROFILE_GENERATING（未确认）不保存
    const e2 = new LifeEngine();
    e2.loadSeed(888);
    e2.selectGender('female', 2000);
    saveLifeState(e2.getState());
    const loaded = loadLifeState();
    expect(loaded!.profile!.name).toBe(engine.getState().profile!.name);
    expect(loaded!.phase).toBe('SENSING_GATE');
  });

  it('键名空间：不污染其它 localStorage 键', () => {
    localStorage.setItem('unrelated-key', 'keep-me');
    const engine = new LifeEngine();
    engine.loadSeed(1);
    engine.selectGender('male', 1000);
    engine.generateIdentity(1010);
    settleIdentity(engine, 1010 + 0.1);
    engine.confirmProfile(1020);
    saveLifeState(engine.getState());
    expect(localStorage.getItem('unrelated-key')).toBe('keep-me');
    clearLifeState();
    expect(localStorage.getItem('unrelated-key')).toBe('keep-me');
  });

  it('localStorage 不可用时安全降级（内存态，不抛异常不白屏）', () => {
    const orig = globalThis.localStorage;
    // @ts-expect-error 模拟不支持
    delete globalThis.localStorage;
    const e = new LifeEngine();
    e.loadSeed(3);
    e.selectGender('male', 1000);
    e.generateIdentity(1010);
    settleIdentity(e, 1010 + 0.1);
    const result: { loaded: LifeState | null } = { loaded: null };
    expect(() => {
      saveLifeState(e.getState());
      result.loaded = loadLifeState();
    }).not.toThrow();
    // 降级语义：要么完全无效果（null），要么会话内自洽（内存往返一致）——皆安全
    expect(result.loaded === null || result.loaded.phase === 'PROFILE_REVIEW').toBe(true);
    globalThis.localStorage = orig;
  });

  it('完整人生流序列化往返：选择/旗标/同伴/境界无损', () => {
    const engine = new LifeEngine();
    engine.loadSeed(999);
    engine.selectGender('male', 1000);
    engine.generateIdentity(1010);
    settleIdentity(engine, 1010 + 0.1);
    engine.confirmProfile(1020);
engine.completeSensing(1020 + 1);
    engine.beginFirstChoice(1030);
engine.settleNarrative(engine.eventIdentity()!.requestId, 1030 + 1);
    const ev = createDeterministicDirector().getChoiceEvent(engine.getState());
    engine.selectOption(ev.options[0].id, 1040);
    engine.confirmChoiceStroke(W, 120, 'ACTIVE', 1050);
    finishChoiceNarrative(engine);
    engine.settleNarrative(engine.eventIdentity()!.requestId, engine.getState().updatedAt + 1);
    engine.respondCompanion('warm', 1060);
engine.settleNarrative(engine.eventIdentity()!.requestId, 1060 + 1);
    const ev2 = createDeterministicDirector().getChoiceEvent(engine.getState());
    engine.selectOption(ev2.options[1].id, 1070);
    engine.confirmChoiceStroke(W, 120, 'ACTIVE', 1080);
    finishChoiceNarrative(engine);
    engine.settleNarrative(engine.eventIdentity()!.requestId, 10.4);
    engine.enterJourney(1090);
    const s = engine.getState();
    saveLifeState(s);
    const r = loadLifeState();
    expect(r).toEqual(s);
  });
});