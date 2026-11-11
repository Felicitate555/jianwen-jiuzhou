import { describe, expect, it } from 'vitest';
import { CombatEngine } from '@/combat/combatEngine';
import {
  DEFAULT_COMBAT_CONFIG as D,
  type CombatConfig,
  type DamageConfig,
  type PlayerConfig,
  type SlashConfig,
  type SpeedConfig,
  type WolfConfig,
} from '@/combat/combatConfig';
import type { InputFrame } from '@/lib/types';

const W = 800;
const H = 600;


/** 深度部分合并的覆盖项（测试用） */
type Over = {
  wolf?: Partial<WolfConfig>;
  player?: Partial<PlayerConfig>;
  slash?: Partial<SlashConfig>;
  speed?: Partial<SpeedConfig>;
  damage?: Partial<DamageConfig>;
};

function cfg(over: Over = {}): CombatConfig {
  return {
    ...D,
    wolf: { ...D.wolf, ...(over.wolf ?? {}) },
    player: { ...D.player, ...(over.player ?? {}) },
    slash: { ...D.slash, ...(over.slash ?? {}) },
    speed: { ...D.speed, ...(over.speed ?? {}) },
    damage: { ...D.damage, ...(over.damage ?? {}) },
  };
}

/** 启动试炼并推进到狼停在 TELEGRAPH（危险区，静止可打） */
function waitForTelegraph(e: CombatEngine, startNow: number): number {
  e.start(startNow);
  let now = startNow;
  for (let i = 0; i < 80; i++) {
    now += 100;
    e.update(now, W, H);
    if (e.getSnapshot().wolf.state === 'TELEGRAPH') return now;
  }
  return now;
}

/**
 * 一次直线挥剑：从 (x0,y) 到 (x0+len,y)，ms 内完成。
 * 穿透式调用（覆盖狼身体且末端出体）：swing(e, wp.x-260, wp.y, t0, 360, 150)
 */
function swing(e: CombatEngine, x0: number, y: number, t0: number, len: number, ms: number): number {
  const n = 12;
  let t = t0;
  e.onFrame(
    { x: x0, y, timestamp: t, actionState: 'ACTIVE', source: 'pointer' } as InputFrame,
    null,
  );
  for (let i = 1; i <= n; i++) {
    t += ms / n;
    e.onFrame(
      { x: x0 + (len * i) / n, y, timestamp: t, actionState: 'ACTIVE', source: 'pointer' } as InputFrame,
      null,
    );
  }
  return t;
}

function wolfPx(e: CombatEngine): { x: number; y: number } {
  const s = e.getSnapshot();
  return { x: s.wolf.x * W, y: s.wolf.y * H };
}

describe('CombatEngine 一次穿越一次命中', () => {
  it('剑尖穿过敌人结算一次；停在身体内不持续掉血；离体后新段可再次命中', () => {
    const e = new CombatEngine(cfg());
    let now = waitForTelegraph(e, 0);
    const wp = wolfPx(e);

    // 第一剑：穿透后停在身体内（末端 +40）
    now = swing(e, wp.x - 260, wp.y, now + 50, 300, 150);
    e.update(now, W, H);
    const hit1 = e.getSnapshot().wolf.hp;
    expect(hit1).toBeLessThan(100);
    expect(e.getSnapshot().lastStrike).not.toBeNull();

    // 剑尖停在身体内：多帧 update 不持续掉血
    for (let i = 0; i < 8; i++) {
      now += 50;
      e.update(now, W, H);
    }
    expect(e.getSnapshot().wolf.hp).toBe(hit1);

    // 抽剑离体（单帧移出），hitLock 解锁
    now += 50;
    e.onFrame(
      { x: wp.x + 150, y: wp.y, timestamp: now, actionState: 'ACTIVE', source: 'pointer' } as InputFrame,
      null,
    );
    e.update(now, W, H);
    expect(e.getSnapshot().wolf.hp).toBe(hit1); // 仅离体不造成伤害

    // 第二剑：全新段穿透命中
    const wp2 = wolfPx(e);
    now = swing(e, wp2.x - 260, wp2.y, now + 100, 360, 150);
    e.update(now, W, H);
    expect(e.getSnapshot().wolf.hp).toBeLessThan(hit1);
  });

  it('剑尖不与敌人碰撞：不产生伤害与评分', () => {
    const e = new CombatEngine(cfg());
    let now = waitForTelegraph(e, 0);
    const wp = wolfPx(e);
    now = swing(e, wp.x + 200, wp.y, now + 50, 260, 150); // 狼右侧远处
    e.update(now, W, H);
    const s = e.getSnapshot();
    expect(s.wolf.hp).toBe(100);
    expect(s.lastStrike).toBeNull();
  });

  it('速度过慢（低于最低有效速度）：不结算', () => {
    const e = new CombatEngine(cfg());
    let now = waitForTelegraph(e, 0);
    const wp = wolfPx(e);
    now = swing(e, wp.x - 260, wp.y, now + 50, 360, 1500); // 240px/s < 400
    e.update(now, W, H);
    const s = e.getSnapshot();
    expect(s.wolf.hp).toBe(100);
    expect(s.lastStrike).toBeNull();
  });
});

describe('快准稳与失控', () => {
  it('失控斩击：显示「剑势失控」、额外气机消耗、伤害受限', () => {
    const e = new CombatEngine(cfg({ wolf: { hpMax: 1000, telegraphMs: 60000 } }));
    let now = waitForTelegraph(e, 0);
    const wp = wolfPx(e);
    // 480px / 60ms → vNorm = 10 > 3.2
    now = swing(e, wp.x - 420, wp.y, now + 50, 480, 60);
    e.update(now, W, H);
    const s = e.getSnapshot();
    expect(s.lastStrike).not.toBeNull();
    expect(s.lastStrike!.tier).toBe('OUT_OF_CONTROL');
    expect(s.lastStrike!.qiCost).toBeGreaterThanOrEqual(15);
    expect(s.prompts.some((p) => p.text === '剑势失控')).toBe(true);
    // 失控伤害不高于凝练好剑（同核心命中的凝练剑 ≈ 47）
    expect(s.lastStrike!.damage).toBeLessThan(47);
  });

  it('核心命中明显优于擦边命中', () => {
    const e1 = new CombatEngine(cfg({ wolf: { hpMax: 1000, telegraphMs: 60000 } }));
    let n1 = waitForTelegraph(e1, 0);
    const w1 = wolfPx(e1);
    n1 = swing(e1, w1.x - 260, w1.y, n1 + 50, 360, 150); // 穿过中心
    e1.update(n1, W, H);
    const core = e1.getSnapshot().lastStrike!;

    const e2 = new CombatEngine(cfg({ wolf: { hpMax: 1000, telegraphMs: 60000 } }));
    let n2 = waitForTelegraph(e2, 0);
    const w2 = wolfPx(e2);
    const bodyR = D.wolf.bodyRadiusRatio * W;
    n2 = swing(e2, w2.x - 260, w2.y - bodyR * 0.95, n2 + 50, 360, 150); // 擦上缘
    e2.update(n2, W, H);
    const edge = e2.getSnapshot().lastStrike!;

    expect(core.accuracyScore).toBeGreaterThan(edge.accuracyScore);
    expect(core.damage).toBeGreaterThan(edge.damage);
  });

  it('稳定直斩优于抖动斩', () => {
    const e1 = new CombatEngine(cfg({ wolf: { hpMax: 1000, telegraphMs: 60000 } }));
    let n1 = waitForTelegraph(e1, 0);
    const w1 = wolfPx(e1);
    n1 = swing(e1, w1.x - 260, w1.y, n1 + 50, 360, 150);
    e1.update(n1, W, H);
    const straight = e1.getSnapshot().lastStrike!;

    // 抖动：之字形前进
    const e2 = new CombatEngine(cfg({ wolf: { hpMax: 1000, telegraphMs: 60000 } }));
    const n2 = waitForTelegraph(e2, 0);
    const w2 = wolfPx(e2);
    let t = n2 + 50;
    e2.onFrame(
      { x: w2.x - 260, y: w2.y, timestamp: t, actionState: 'ACTIVE', source: 'pointer' } as InputFrame,
      null,
    );
    for (let i = 1; i <= 26; i++) {
      t += 5.8;
      e2.onFrame(
        {
          x: w2.x - 260 + 14 * i,
          y: w2.y + (i % 2 === 0 ? 14 : -14),
          timestamp: t,
          actionState: 'ACTIVE',
          source: 'pointer',
        } as InputFrame,
        null,
      );
    }
    e2.update(t, W, H);
    const jitter = e2.getSnapshot().lastStrike!;

    expect(straight.stabilityScore).toBeGreaterThan(jitter.stabilityScore);
    expect(straight.damage).toBeGreaterThan(jitter.damage);
  });
});

describe('气机系统', () => {
  it('有效斩击消耗约 5~10 点气机', () => {
    const e = new CombatEngine(cfg({ wolf: { hpMax: 1000, telegraphMs: 60000 } }));
    let now = waitForTelegraph(e, 0);
    const wp = wolfPx(e);
    now = swing(e, wp.x - 260, wp.y, now + 50, 360, 150);
    e.update(now, W, H);
    const cost = 100 - e.getSnapshot().qi;
    expect(cost).toBeGreaterThanOrEqual(4);
    expect(cost).toBeLessThanOrEqual(12);
  });

  it('乱挥消耗气机至气机不继：伤害大幅降低并提示「气机不继」，且不冻结输入', () => {
    const e = new CombatEngine(cfg({ wolf: { hpMax: 1000, telegraphMs: 60000 } }));
    let now = waitForTelegraph(e, 0);
    let exhausted = false;
    for (let i = 0; i < 8 && !exhausted; i++) {
      const wp = wolfPx(e);
      now = swing(e, wp.x - 420, wp.y, now + 400, 520, 60); // 失控剑乱挥（耗气最快）
      e.update(now, W, H);
      now += 60;
      e.update(now, W, H);
      const s = e.getSnapshot();
      if (s.lastStrike?.exhausted) {
        exhausted = true;
        expect(s.lastStrike.exhausted).toBe(true);
        expect(s.lastStrike.damage).toBeLessThanOrEqual(18);
        expect(s.prompts.some((p) => p.text === '气机不继')).toBe(true);
      }
    }
    expect(exhausted).toBe(true);
    // 气机不继不冻结输入：仍可继续挥剑并结算（伤害受限）
    const wpN = wolfPx(e);
    const qiBefore = e.getSnapshot().qi;
    now = swing(e, wpN.x - 420, wpN.y, now + 400, 520, 60);
    e.update(now, W, H);
    const s2 = e.getSnapshot();
    const strike2 = s2.lastStrike!;
    expect(strike2).not.toBeNull();
    expect(strike2.exhausted).toBe(true);
    expect(s2.qi).toBeLessThanOrEqual(qiBefore);
  });

  it('SHEATHED 持续回气，ACTIVE 不回气', () => {
    const e = new CombatEngine(cfg({ wolf: { hpMax: 1000, telegraphMs: 60000 } }));
    let now = waitForTelegraph(e, 0);
    // 四剑把气机降到 ~62（远离上限，避免回气被 clamp）
    for (let k = 0; k < 4; k++) {
      const wp = wolfPx(e);
      now = swing(e, wp.x - 260, wp.y, now + 400, 360, 150);
      e.update(now, W, H);
      now += 60;
      e.update(now, W, H);
    }
    const qiAfter = e.getSnapshot().qi;
    expect(qiAfter).toBeGreaterThan(30);
    expect(qiAfter).toBeLessThan(90);

    // ACTIVE 静止：不回气
    for (let i = 0; i < 10; i++) {
      now += 100;
      e.onFrame(
        { x: 10, y: 10, timestamp: now, actionState: 'ACTIVE', source: 'pointer' } as InputFrame,
        null,
      );
      e.update(now, W, H);
    }
    expect(e.getSnapshot().qi).toBe(qiAfter);

    // SHEATHED 回气 14/s（1 秒 ≈ +14；第三阶段校准）
    for (let i = 0; i < 10; i++) {
      now += 100;
      e.onFrame(
        { x: 10, y: 10, timestamp: now, actionState: 'SHEATHED', source: 'pointer' } as InputFrame,
        null,
      );
      e.update(now, W, H);
    }
    const regen = e.getSnapshot().qi - qiAfter;
    expect(regen).toBeGreaterThan(13);
    expect(regen).toBeLessThan(15);
  });
});

describe('山狼状态迁移与扑击', () => {
  it('APPROACH → TELEGRAPH（0.7~1s）→ LUNGE → RECOVER → APPROACH', () => {
    const e = new CombatEngine(cfg());
    let now = 0;
    e.start(now);
    expect(e.getSnapshot().wolf.state).toBe('APPROACH');

    now = waitForTelegraph(e, now);
    const s = e.getSnapshot();
    expect(s.wolf.state).toBe('TELEGRAPH');
    const tgDur = s.wolf.telegraphUntil - now;
    expect(tgDur).toBeGreaterThanOrEqual(700);
    expect(tgDur).toBeLessThanOrEqual(1000);

    now += tgDur + 10;
    e.update(now, W, H);
    expect(e.getSnapshot().wolf.state).toBe('LUNGE');

    now += D.wolf.lungeDurationMs + 10;
    e.onFrame(
      { x: 10, y: 10, timestamp: now, actionState: 'SHEATHED', source: 'pointer' } as InputFrame,
      null,
    );
    e.update(now, W, H);
    expect(e.getSnapshot().wolf.state).toBe('RECOVER');

    for (let i = 0; i < 60; i++) {
      now += 100;
      e.update(now, W, H);
      if (e.getSnapshot().wolf.state === 'APPROACH') break;
    }
    expect(e.getSnapshot().wolf.state).toBe('APPROACH');
  });

  it('收势护剑：消耗气机，护体真气不损失', () => {
    const e = new CombatEngine(cfg());
    let now = 0;
    e.start(now);
    let guard0 = e.getSnapshot().guardQi;
    let resolved = false;
    for (let i = 0; i < 150 && !resolved; i++) {
      now += 100;
      e.onFrame(
        { x: 10, y: 10, timestamp: now, actionState: 'SHEATHED', source: 'pointer' } as InputFrame,
        null,
      );
      e.update(now, W, H);
      const s = e.getSnapshot();
      if (s.prompts.some((p) => p.text === '护剑')) {
        resolved = true;
        expect(s.guardQi).toBe(guard0); // 护体真气不损失
        expect(s.qi).toBeLessThan(100); // 消耗气机
      }
      guard0 = s.guardQi;
    }
    expect(resolved).toBe(true);
  });

  it('未收势受创：护体真气下降', () => {
    const e = new CombatEngine(cfg());
    let now = 0;
    e.start(now);
    let hurt = false;
    for (let i = 0; i < 150 && !hurt; i++) {
      now += 100;
      e.onFrame(
        { x: 400, y: 300, timestamp: now, actionState: 'ACTIVE', source: 'pointer' } as InputFrame,
        null,
      );
      e.update(now, W, H);
      if (e.getSnapshot().guardQi < 100) hurt = true;
    }
    expect(hurt).toBe(true);
    expect(e.getSnapshot().guardQi).toBe(100 - D.wolf.lungeDamage);
  });

  it('气机不足时护剑被破：损失部分护体真气', () => {
    // 气机上限低于护剑消耗（15）→ start 后即处于气机不足
    const e = new CombatEngine(cfg({ player: { qiMax: 12 } }));
    let now = 0;
    e.start(now);
    expect(e.getSnapshot().qi).toBe(12);
    let broken = false;
    for (let i = 0; i < 200 && !broken; i++) {
      now += 100;
      e.onFrame(
        { x: 10, y: 10, timestamp: now, actionState: 'SHEATHED', source: 'pointer' } as InputFrame,
        null,
      );
      e.update(now, W, H);
      if (e.getSnapshot().prompts.some((p) => p.text === '护剑被破')) broken = true;
    }
    expect(broken).toBe(true);
    expect(e.getSnapshot().guardQi).toBeLessThan(100);
  });
});

describe('胜负与重试', () => {
  it('数次有效斩击击杀山狼：DYING → DEAD（第三阶段：胜利需再除妖修，另测）', () => {
    const e = new CombatEngine(cfg());
    let now = 0;
    e.start(now);
    let strikes = 0;
    for (let round = 0; round < 12 && e.getSnapshot().wolf.state !== 'DEAD'; round++) {
      // 狼扑击/退场期间收势等待（避免无谓受创），回到可攻击状态再出剑
      let guard = 0;
      while (['RECOVER', 'LUNGE'].includes(e.getSnapshot().wolf.state) && guard < 200) {
        now += 100;
        e.onFrame(
          { x: 10, y: 10, timestamp: now, actionState: 'SHEATHED', source: 'pointer' } as InputFrame,
          null,
        );
        e.update(now, W, H);
        guard++;
      }
      const wp = wolfPx(e);
      now = swing(e, wp.x - 260, wp.y, now + 100, 360, 150); // 凝练+核心
      e.update(now, W, H);
      strikes++;
      now += 60;
      e.update(now, W, H);
    }
    expect(e.getSnapshot().wolf.state).toBe('DEAD');
    expect(strikes).toBeLessThanOrEqual(6); // 不做几十刀磨血
  });

  it('护体真气归零：剑心破碎 + 重新试炼恢复全部状态', () => {
    const e = new CombatEngine(cfg());
    let now = 0;
    e.start(now);
    while (e.getSnapshot().phase === 'fighting') {
      now += 100;
      e.onFrame(
        { x: 400, y: 300, timestamp: now, actionState: 'ACTIVE', source: 'pointer' } as InputFrame,
        null,
      );
      e.update(now, W, H);
    }
    const s = e.getSnapshot();
    expect(s.phase).toBe('lost');
    expect(s.guardQi).toBe(0);
    expect(s.prompts.some((p) => p.text === '剑心破碎')).toBe(true);

    e.start(now);
    const s2 = e.getSnapshot();
    expect(s2.phase).toBe('fighting');
    expect(s2.guardQi).toBe(100);
    expect(s2.qi).toBe(100);
    expect(s2.wolf.hp).toBe(100);
    expect(s2.wolf.state).toBe('APPROACH');
  });
});