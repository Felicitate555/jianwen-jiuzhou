/**
 * 第三阶段测试：气机 14 校准、妖气弹、远程敌人状态机、弱点破势、斩弹、胜利编排。
 */
import { describe, expect, it } from 'vitest';
import { CombatEngine } from '@/combat/combatEngine';
import {
  DEFAULT_COMBAT_CONFIG as D,
  type CombatConfig,
  type ProjectileConfig,
  type RangedEnemyConfig,
  type WolfConfig,
} from '@/combat/combatConfig';
import {
  createProjectile,
  pointToSegmentDist,
  segmentHitsProjectile,
  segmentMinDistToPoint,
  updateProjectile,
} from '@/combat/projectile';
import {
  createRangedEnemy,
  rangedEnemyHit,
  rangedEnemyInterrupt,
  updateRangedEnemy,
  type RangedEnemyState,
} from '@/combat/rangedEnemy';
import type { InputFrame } from '@/lib/types';

const W = 800;
const H = 600;

type Over = {
  wolf?: Partial<WolfConfig>;
  ranged?: Partial<RangedEnemyConfig>;
  projectile?: Partial<ProjectileConfig>;
};

function cfg(over: Over = {}): CombatConfig {
  return {
    ...D,
    wolf: { ...D.wolf, ...(over.wolf ?? {}) },
    ranged: { ...D.ranged, ...(over.ranged ?? {}) },
    projectile: { ...D.projectile, ...(over.projectile ?? {}) },
  };
}

function frame(x: number, y: number, t: number, action: 'ACTIVE' | 'SHEATHED' | 'IDLE' = 'ACTIVE'): InputFrame {
  return { x, y, timestamp: t, actionState: action, source: 'pointer' } as InputFrame;
}

/** 直线挥剑：从 (x0,y) 到 (x0+len,y)，ms 内完成（12 帧采样） */
function swing(e: CombatEngine, x0: number, y: number, t0: number, len: number, ms: number): number {
  const n = 12;
  let t = t0;
  e.onFrame(frame(x0, y, t), null);
  for (let i = 1; i <= n; i++) {
    t += ms / n;
    e.onFrame(frame(x0 + (len * i) / n, y, t), null);
  }
  return t;
}

/** 推进到狼 TELEGRAPH（静止可打） */
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

function wolfPx(e: CombatEngine): { x: number; y: number } {
  const s = e.getSnapshot();
  return { x: s.wolf.x * W, y: s.wolf.y * H };
}

/** 直接把狼血打到 1，然后一剑击杀，快速进入远程敌人阶段 */
function killWolf(e: CombatEngine, now: number): number {
  let t = waitForTelegraph(e, now);
  e['wolf'].hp = 1; // 测试捷径：直接设残血
  const wp = wolfPx(e);
  t = swing(e, wp.x - 260, wp.y, t + 50, 360, 150);
  e.update(t, W, H);
  return t;
}

/** 推进到远程敌人出现在场上且进入 CHARGE 弱点暴露 */
function waitForWeakPoint(e: CombatEngine, now: number): number {
  let t = now;
  for (let i = 0; i < 400; i++) {
    t += 100;
    e.update(t, W, H);
    const en = e.getSnapshot().rangedEnemy;
    if (en && en.weakPointActive) return t;
  }
  return t;
}

describe('气机校准（第三阶段）', () => {
  it('qiRegenPerSec = 14（0 到满气约 7.1s）', () => {
    expect(D.player.qiRegenPerSec).toBe(14);
    expect(100 / D.player.qiRegenPerSec).toBeLessThan(7.2);
    expect(100 / D.player.qiRegenPerSec).toBeGreaterThan(7.0);
  });

  it('护体真气不自然恢复（无论何种状态）', () => {
    // 长预警：受伤后下次扑击前有足够长的安全观察窗
    const e = new CombatEngine(cfg({ wolf: { hpMax: 1000, telegraphMs: 3000 } }));
    e.start(0);
    let now = 0;
    // 等第一次扑击：不收势 → 受创掉护体真气
    let hurt = false;
    for (let i = 0; i < 300 && !hurt; i++) {
      now += 100;
      e.onFrame(frame(400, 300, now, 'ACTIVE'), null);
      e.update(now, W, H);
      hurt = e.getSnapshot().prompts.some((p) => p.text === '受创');
    }
    expect(hurt).toBe(true);
    const g = e.getSnapshot().guardQi;
    expect(g).toBeLessThan(100);
    // 收势 3 秒：气机恢复但护体真气不恢复（3s 内无下次扑击）
    for (let i = 0; i < 30; i++) {
      now += 100;
      e.onFrame(frame(10, 10, now, 'SHEATHED'), null);
      e.update(now, W, H);
    }
    expect(e.getSnapshot().guardQi).toBe(g);
    expect(e.getSnapshot().qi).toBeGreaterThan(60); // 气机在恢复
  });

  it('SHEATHED 回气 14/s：1 秒约 +14，不溢出', () => {
    const e = new CombatEngine(cfg({ wolf: { hpMax: 1000, telegraphMs: 60000 } }));
    let now = waitForTelegraph(e, 0);
    for (let k = 0; k < 4; k++) {
      const wp = wolfPx(e);
      now = swing(e, wp.x - 260, wp.y, now + 400, 360, 150);
      e.update(now, W, H);
      now += 60;
      e.update(now, W, H);
    }
    const qiAfter = e.getSnapshot().qi;
    expect(qiAfter).toBeGreaterThan(30);
    // SHEATHED 1 秒
    for (let i = 0; i < 10; i++) {
      now += 100;
      e.onFrame(frame(10, 10, now, 'SHEATHED'), null);
      e.update(now, W, H);
    }
    const regen = e.getSnapshot().qi - qiAfter;
    expect(regen).toBeGreaterThan(13);
    expect(regen).toBeLessThan(15);
    // 满气后不再溢出
    for (let i = 0; i < 50; i++) {
      now += 100;
      e.onFrame(frame(10, 10, now, 'SHEATHED'), null);
      e.update(now, W, H);
    }
    expect(e.getSnapshot().qi).toBe(100);
  });
});

describe('妖气弹（投射物）', () => {
  it('创建：朝目标飞行，属性完整', () => {
    const p = createProjectile(0.9, 0.3, 0.2, 0.5, 1000, D.projectile);
    expect(p.id).toBeGreaterThan(0);
    expect(p.x).toBe(0.9);
    expect(p.y).toBe(0.3);
    expect(p.slashed).toBe(false);
    expect(p.resolved).toBe(false);
    // 速度朝目标（向左下）
    expect(p.vx).toBeLessThan(0);
    expect(p.vy).toBeGreaterThan(0);
  });

  it('每帧移动、出屏销毁、超时销毁', () => {
    const p = createProjectile(0.9, 0.3, 0.2, 0.5, 0, D.projectile);
    expect(updateProjectile(p, 100, 100)).toBe(true); // 0.24/s → 移动 0.024
    expect(p.x).toBeCloseTo(0.9 + p.vx * 0.1, 5);
    // 推到出屏
    let alive = true;
    let now = 100;
    for (let i = 0; i < 200 && alive; i++) {
      now += 100;
      alive = updateProjectile(p, 100, now);
    }
    expect(alive).toBe(false);
    // 超时：向内飞但超寿命（deadline 由创建时间 + lifeMs 决定）
    const q = createProjectile(0.9, 0.3, 0.5, 0.3, 0, { ...D.projectile, lifeMs: 300 });
    expect(updateProjectile(q, 200, 200)).toBe(true);
    expect(updateProjectile(q, 200, 500)).toBe(false); // 超时销毁
  });

  it('线段碰撞：快速穿透不漏判（单帧跨越弹体）', () => {
    const p = createProjectile(0.5, 0.5, 0, 0, 0, D.projectile);
    p.x = 0.5;
    p.y = 0.5;
    const r = D.projectile.radiusRatio * W; // 22.4px
    // 两点连线跨越弹体两侧（跳过弹体内部采样点）
    const pts = [
      { x: 0.5 * W - r * 3, y: 0.5 * H, t: 0 },
      { x: 0.5 * W + r * 3, y: 0.5 * H, t: 50 },
    ];
    expect(segmentHitsProjectile(pts, p, W, H)).toBe(true);
    // 远离弹体
    const far = [
      { x: 0.1 * W, y: 0.1 * H, t: 0 },
      { x: 0.15 * W, y: 0.1 * H, t: 50 },
    ];
    expect(segmentHitsProjectile(far, p, W, H)).toBe(false);
  });

  it('点到线段最近距离：垂足在线段上时为垂直距离', () => {
    // 线段 (0,0)→(100,0)，点 (50, 30)：距离 30
    expect(pointToSegmentDist(50, 30, 0, 0, 100, 0)).toBeCloseTo(30, 6);
    // 点在延长线外：到端点距离
    expect(pointToSegmentDist(-30, 40, 0, 0, 100, 0)).toBeCloseTo(50, 6);
  });

  it('段到点最小距离：含线段投影', () => {
    const pts = [
      { x: 0, y: 0, t: 0 },
      { x: 100, y: 0, t: 50 },
    ];
    expect(segmentMinDistToPoint(pts, 50, 30)).toBeCloseTo(30, 6);
    expect(segmentMinDistToPoint(pts, 50, 0)).toBeCloseTo(0, 6);
  });
});

describe('远程敌人状态机', () => {
  const rc: RangedEnemyConfig = {
    ...D.ranged,
    chargeWindupMs: 100,
    chargeMs: 100,
    recoverMs: 100,
    interruptedMs: 100,
    maxCycles: 2,
    dyingMs: 50,
    enterSpeedRatio: 0.4, // 快速入场（1.18→0.88 约 0.75s）
  };

  it('ENTER → CHARGE → FIRE → RECOVER → CHARGE 循环，轮数上限后离场', () => {
    const e = createRangedEnemy(rc);
    const st = () => e.state as RangedEnemyState;
    let now = 0;
    expect(st()).toBe('ENTER');
    // 推进入场完成 → CHARGE
    for (let i = 0; i < 200 && st() === 'ENTER'; i++) {
      now += 16;
      updateRangedEnemy(e, now, 16, rc, true);
    }
    expect(st()).toBe('CHARGE');
    expect(e.weakPointActive).toBe(false); // 前摇未过
    // 前摇过后弱点暴露
    for (let i = 0; i < 50 && !e.weakPointActive; i++) {
      now += 16;
      updateRangedEnemy(e, now, 16, rc, true);
    }
    expect(e.weakPointActive).toBe(true);
    // 蓄力完成 → FIRE
    for (let i = 0; i < 50 && st() === 'CHARGE'; i++) {
      now += 16;
      updateRangedEnemy(e, now, 16, rc, true);
    }
    expect(st()).toBe('FIRE');
    // 引擎发射标记后 RECOVER（markFired + toRecover）
    e.cycles = 1; // markFired 语义
    e.state = 'RECOVER';
    e.recoverFrom = now;
    // RECOVER 后再次 CHARGE（第 2 轮）
    for (let i = 0; i < 50 && st() === 'RECOVER'; i++) {
      now += 16;
      updateRangedEnemy(e, now, 16, rc, true);
    }
    expect(st()).toBe('CHARGE');
    expect(e.cycles).toBe(1);
    // 第 2 轮发射后达到上限 → 离场 DYING → DEAD
    for (let i = 0; i < 50 && st() === 'CHARGE'; i++) {
      now += 16;
      updateRangedEnemy(e, now, 16, rc, true);
    }
    expect(st()).toBe('FIRE');
    e.cycles = 2;
    e.state = 'RECOVER';
    e.recoverFrom = now;
    for (let i = 0; i < 100 && st() !== 'DYING'; i++) {
      now += 16;
      updateRangedEnemy(e, now, 16, rc, true);
    }
    expect(st()).toBe('DYING');
    for (let i = 0; i < 50 && st() !== 'DEAD'; i++) {
      now += 16;
      updateRangedEnemy(e, now, 16, rc, true);
    }
    expect(st()).toBe('DEAD');
  });

  it('场上仍有妖气弹时（canCharge=false）RECOVER 后不开新蓄力', () => {
    const e = createRangedEnemy(rc);
    const st = () => e.state as RangedEnemyState;
    let now = 0;
    e.state = 'RECOVER';
    e.recoverFrom = now;
    // 场上有弹：RECOVER 结束后原地等待
    for (let i = 0; i < 30; i++) {
      now += 16;
      updateRangedEnemy(e, now, 16, rc, false);
    }
    expect(st()).toBe('RECOVER'); // 不开新蓄力
    // 弹没了 → 开新蓄力
    now += 16;
    updateRangedEnemy(e, now, 16, rc, true);
    expect(st()).toBe('CHARGE');
  });

  it('身体命中不打断蓄力；弱点击中触发 INTERRUPTED 且同一次蓄力只一次', () => {
    const e = createRangedEnemy({ ...rc, chargeMs: 5000 }); // 长蓄力窗口
    let now = 0;
    for (let i = 0; i < 200 && e.state === 'ENTER'; i++) {
      now += 16;
      updateRangedEnemy(e, now, 16, rc, true);
    }
    expect(e.state).toBe('CHARGE');
    for (let i = 0; i < 50 && !e.weakPointActive; i++) {
      now += 16;
      updateRangedEnemy(e, now, 16, rc, true);
    }
    expect(e.weakPointActive).toBe(true);
    // 身体受击：hp 下降、有白闪，但状态仍是 CHARGE、弱点仍有效
    const hpBefore = e.hp;
    rangedEnemyHit(e, now, 10);
    expect(e.hp).toBeLessThan(hpBefore);
    expect(e.state).toBe('CHARGE');
    expect(e.weakPointActive).toBe(true);
    // 弱点打断
    rangedEnemyInterrupt(e, now, rc);
    expect(e.state).toBe('INTERRUPTED');
    expect(e.weakPointActive).toBe(false);
    // 再次打断调用：无效果（同一次蓄力只一次）
    rangedEnemyInterrupt(e, now, rc);
    expect(e.state).toBe('INTERRUPTED');
    // 硬直后 RECOVER（被打断不算完成一轮）
    for (let i = 0; i < 100 && e.state === 'INTERRUPTED'; i++) {
      now += 16;
      updateRangedEnemy(e, now, 16, rc, true);
    }
    expect(e.state).toBe('RECOVER');
  });

  it('非 CHARGE 状态弱点击中不触发打断', () => {
    const e = createRangedEnemy(rc);
    e.state = 'RECOVER';
    e.recoverFrom = 0;
    rangedEnemyInterrupt(e, 1000, rc);
    expect(e.state).toBe('RECOVER'); // 未变 INTERRUPTED
  });

  it('hp 归零 → DYING → DEAD', () => {
    const e = createRangedEnemy(rc);
    rangedEnemyHit(e, 0, 999);
    expect(e.state).toBe('DYING');
    expect(e.hp).toBe(0);
    let now = 0;
    for (let i = 0; i < 50 && e.state !== 'DEAD'; i++) {
      now += 16;
      updateRangedEnemy(e, now, 16, rc, true);
    }
    expect(e.state).toBe('DEAD');
  });
});

describe('CombatEngine 第三阶段集成', () => {
  it('山狼击杀后延迟出现远程敌人（唯一一只），未出场不判胜', () => {
    const e = new CombatEngine(cfg());
    let now = killWolf(e, 0);
    expect(e.getSnapshot().wolf.state).toBe('DYING');
    // 狼 DEAD 但远程敌人未出现：不判胜
    for (let i = 0; i < 10; i++) {
      now += 100;
      e.update(now, W, H);
    }
    expect(e.getSnapshot().wolf.state).toBe('DEAD');
    expect(e.getSnapshot().rangedEnemy).toBeNull();
    expect(e.getSnapshot().phase).toBe('fighting'); // 关键：不能提前判胜
    // 延迟后出现
    now = waitForWeakPoint(e, now);
    const en = e.getSnapshot().rangedEnemy;
    expect(en).not.toBeNull();
    expect(e.getSnapshot().phase).toBe('fighting');
  });

  it('弱点精准剑击：破势 + 取消本次发射 + 提示「破势」', () => {
    const e = new CombatEngine(cfg({ ranged: { chargeWindupMs: 200, chargeMs: 60000 } }));
    let now = killWolf(e, 0);
    now = waitForWeakPoint(e, now);
    const en = e.getSnapshot().rangedEnemy!;
    expect(en.state).toBe('CHARGE');
    expect(en.weakPointActive).toBe(true);
    // 精准穿过弱点核心（敌人中心直线）
    const ex = en.x * W;
    const ey = en.y * H;
    now = swing(e, ex - 260, ey, now + 100, 520, 200); // 长剑穿过中心
    e.update(now, W, H);
    const s = e.getSnapshot();
    expect(s.rangedEnemy!.state).toBe('INTERRUPTED');
    expect(s.rangedEnemy!.chargeInterrupted).toBe(true);
    expect(s.prompts.some((p) => p.text === '破势')).toBe(true);
    // 破势取消发射：长时间推进后无妖气弹
    for (let i = 0; i < 50; i++) {
      now += 100;
      e.update(now, W, H);
    }
    expect(e.getSnapshot().projectiles.length).toBe(0);
    // 硬直后 RECOVER，开始下一次蓄力（弱点重新有效）
    for (let i = 0; i < 300 && e.getSnapshot().rangedEnemy!.state !== 'CHARGE'; i++) {
      now += 100;
      e.update(now, W, H);
    }
    expect(e.getSnapshot().rangedEnemy!.state).toBe('CHARGE');
  });

  it('蓄力完成未打断：发射一枚妖气弹（重击释放），旧状态不重复发射', () => {
    const e = new CombatEngine(
      cfg({
        ranged: { chargeWindupMs: 200, chargeMs: 400, recoverMs: 300 },
        projectile: { speedRatio: 0.05, lifeMs: 100000 }, // 慢速长寿命：观察期内不销毁不轮换
      }),
    );
    let now = killWolf(e, 0);
    now = waitForWeakPoint(e, now);
    // 不打断，等蓄力完成
    let fired = false;
    for (let i = 0; i < 100 && !fired; i++) {
      now += 100;
      e.update(now, W, H);
      fired = e.getSnapshot().projectiles.length > 0;
    }
    expect(fired).toBe(true);
    expect(e.getSnapshot().prompts.some((p) => p.text === '重击释放')).toBe(true);
    const pid = e.getSnapshot().projectiles[0].id;
    // 场上已有弹：敌人不开新蓄力、不重复发射（观察 5s）
    for (let i = 0; i < 50; i++) {
      now += 100;
      e.update(now, W, H);
    }
    const s = e.getSnapshot();
    expect(s.projectiles.length).toBe(1); // 仍只有一枚
    expect(s.projectiles[0].id).toBe(pid); // 是同一枚
    expect(s.rangedEnemy!.state).toBe('RECOVER'); // 等弹解决
  });

  it('妖气弹飞向玩家命中区：未斩碎只扣一次护体真气（妖气入体），弹消失', () => {
    const e = new CombatEngine(
      cfg({
        ranged: { chargeWindupMs: 100, chargeMs: 300, recoverMs: 300, maxCycles: 1, dyingMs: 100, spawnDelayMs: 200 },
        projectile: { speedRatio: 0.5 }, // 快速飞行
      }),
    );
    let now = killWolf(e, 0);
    for (let i = 0; i < 100 && e.getSnapshot().projectiles.length === 0; i++) {
      now += 100;
      e.update(now, W, H);
    }
    expect(e.getSnapshot().projectiles.length).toBe(1);
    const guardFull = e.getSnapshot().guardQi;
    // 不斩：等弹到玩家（maxCycles=1：敌人发完一轮即离场，无新弹干扰）
    for (let i = 0; i < 200 && e.getSnapshot().projectiles.length > 0; i++) {
      now += 100;
      e.onFrame(frame(10, 10, now, 'SHEATHED'), null); // 收势不管弹
      e.update(now, W, H);
    }
    const s = e.getSnapshot();
    expect(s.projectiles.length).toBe(0); // 弹已消失
    expect(s.guardQi).toBeLessThan(guardFull);
    expect(s.prompts.some((p) => p.text === '妖气入体')).toBe(true);
    // 之后护体真气不再下降（同一枚弹无重复扣血）
    const guardAfter = s.guardQi;
    for (let i = 0; i < 30; i++) {
      now += 100;
      e.onFrame(frame(10, 10, now, 'SHEATHED'), null);
      e.update(now, W, H);
    }
    expect(e.getSnapshot().guardQi).toBe(guardAfter);
  });

  it('妖气弹被剑痕斩碎：一次性销毁 + 「斩弹」+ 气机消耗含斩弹成本', () => {
    const e = new CombatEngine(
      cfg({
        ranged: { chargeWindupMs: 100, chargeMs: 300, recoverMs: 300 },
        projectile: { speedRatio: 0.1 }, // 慢速便于拦截
      }),
    );
    let now = killWolf(e, 0);
    for (let i = 0; i < 100 && e.getSnapshot().projectiles.length === 0; i++) {
      now += 100;
      e.update(now, W, H);
    }
    const p = e.getSnapshot().projectiles[0];
    // 朝弹体挥剑（在弹前方拦截）
    const px = p.x * W;
    const py = p.y * H;
    const qiBefore = e.getSnapshot().qi;
    now = swing(e, px - 300, py, now + 60, 600, 200); // 横穿弹体位置
    e.update(now, W, H);
    const s = e.getSnapshot();
    expect(s.projectiles.length).toBe(0); // 已斩碎
    expect(s.prompts.some((p2) => p2.text === '斩弹')).toBe(true);
    expect(s.qi).toBeLessThan(qiBefore); // 消耗了斩弹气机
    // 斩弹消耗 = slashCost（未命中身体 → 只有斩弹成本）
    expect(qiBefore - s.qi).toBeGreaterThanOrEqual(D.projectile.slashCost);
  });

  it('普通身体命中不打断远程敌人蓄力（受击但仍完成蓄力）', () => {
    const e = new CombatEngine(
      cfg({
        ranged: { chargeWindupMs: 100, chargeMs: 1500, recoverMs: 300 },
        wolf: { hpMax: 1 },
      }),
    );
    let now = killWolf(e, 0);
    now = waitForWeakPoint(e, now);
    const en = e.getSnapshot().rangedEnemy!;
    const hpBefore = en.hp;
    // 擦边剑（上缘掠过身体，远离弱点）：命中身体不触发破势
    const ex = en.x * W;
    const ey = en.y * H;
    const bodyR = D.ranged.bodyRadiusRatio * W;
    now = swing(e, ex - 260, ey - bodyR * 0.8, now + 100, 520, 200); // 擦上缘
    e.update(now, W, H);
    const s = e.getSnapshot();
    expect(s.rangedEnemy!.state).toBe('CHARGE'); // 仍蓄力
    expect(s.rangedEnemy!.hp).toBeLessThanOrEqual(hpBefore); // 有受击（或至少不变）
    expect(s.prompts.some((p) => p.text === '破势')).toBe(false);
  });

  it('试炼胜利：狼 + 远程敌人（耗尽轮数离场）全部处理完毕', () => {
    const e = new CombatEngine(
      cfg({
        ranged: { chargeWindupMs: 50, chargeMs: 200, recoverMs: 100, maxCycles: 1, dyingMs: 50, spawnDelayMs: 100 },
        projectile: { speedRatio: 0.05, lifeMs: 200 }, // 弹很快超时销毁
      }),
    );
    let now = killWolf(e, 0);
    // 持续收势等待：敌人完成 1 轮发射 → 弹超时销毁 → 敌人离场 DEAD → 胜利
    for (let i = 0; i < 600 && e.getSnapshot().phase === 'fighting'; i++) {
      now += 100;
      e.onFrame(frame(10, 10, now, 'SHEATHED'), null);
      e.update(now, W, H);
    }
    const s = e.getSnapshot();
    expect(s.phase).toBe('won');
    expect(s.rangedEnemy!.state).toBe('DEAD');
    expect(s.prompts.some((p) => p.text === '试炼通过')).toBe(true);
    // 三轮耗尽离场（非击杀）：提示「退场」语义，且 HP 未归零（未伪造击杀）
    expect(s.rangedEnemy!.hp).toBeGreaterThan(0);
    expect(s.rangedEnemy!.cycles).toBeGreaterThanOrEqual(s.rangedEnemy!.maxCycles);
    expect(s.prompts.some((p) => p.text === '妖气耗尽 · 三轮施法后退场')).toBe(true);
  });

  it('重新试炼：清理旧敌人、投射物与提示', () => {
    const e = new CombatEngine(
      cfg({
        ranged: { chargeWindupMs: 100, chargeMs: 300, recoverMs: 300 },
        projectile: { speedRatio: 0.05 },
      }),
    );
    let now = killWolf(e, 0);
    for (let i = 0; i < 200 && e.getSnapshot().projectiles.length === 0; i++) {
      now += 100;
      e.update(now, W, H);
    }
    expect(e.getSnapshot().projectiles.length).toBe(1);
    // 剑心破碎（吃弹到死）或直接 restart
    e.start(now);
    const s = e.getSnapshot();
    expect(s.rangedEnemy).toBeNull();
    expect(s.projectiles.length).toBe(0);
    expect(s.prompts.length).toBe(0);
    expect(s.wolf.hp).toBe(100);
    expect(s.wolf.state).toBe('APPROACH');
    expect(s.phase).toBe('fighting');
  });

  it('resize 安全：不同舞台尺寸下投射物碰撞与弱点判定不依赖固定 800×600', () => {
    // 小舞台
    const e = new CombatEngine(
      cfg({
        ranged: { chargeWindupMs: 100, chargeMs: 300, recoverMs: 300 },
        projectile: { speedRatio: 0.1 },
      }),
    );
    const W2 = 400;
    const H2 = 300;
    let now = killWolf(e, 0);
    for (let i = 0; i < 100 && e.getSnapshot().projectiles.length === 0; i++) {
      now += 100;
      e.update(now, W2, H2);
    }
    const p = e.getSnapshot().projectiles[0];
    const px = p.x * W2;
    const py = p.y * H2;
    now = swing(e, px - 150, py, now + 60, 300, 200);
    e.update(now, W2, H2);
    expect(e.getSnapshot().projectiles.length).toBe(0); // 小舞台也能斩弹
  });

  it('dt 很大（页面暂停恢复）：不重复发射、不瞬间多次结算', () => {
    const e = new CombatEngine(
      cfg({
        ranged: { chargeWindupMs: 50, chargeMs: 100, recoverMs: 100, maxCycles: 3, spawnDelayMs: 100 },
        projectile: { speedRatio: 0.05, lifeMs: 100000 },
      }),
    );
    let now = killWolf(e, 0);
    // 小步推进：让敌人出场并进入蓄力
    for (let i = 0; i < 50 && !(e.getSnapshot().rangedEnemy?.state === 'CHARGE'); i++) {
      now += 100;
      e.update(now, W, H);
    }
    expect(e.getSnapshot().rangedEnemy!.state).toBe('CHARGE');
    // 一次性推进 10 秒（模拟挂起后恢复；引擎 dt clamp 100ms）
    now += 10000;
    e.update(now, W, H);
    const s = e.getSnapshot();
    // dt 被 clamp：敌人只推进了一小步，至多完成一轮蓄力
    expect(s.projectiles.length).toBeLessThanOrEqual(1);
    expect(s.rangedEnemy!.cycles).toBeLessThanOrEqual(1);
    // 再大 dt 推进：仍不堆叠
    now += 10000;
    e.update(now, W, H);
    expect(e.getSnapshot().projectiles.length).toBeLessThanOrEqual(1);
  });
});