import { describe, expect, it } from 'vitest';
import {
  computeDamage,
  judgeAccuracy,
  judgeSpeed,
  judgeStability,
} from '@/combat/scoring';
import { DEFAULT_COMBAT_CONFIG as cfg } from '@/combat/combatConfig';

describe('速度四区间（相对舞台宽归一化）', () => {
  it('太慢区间：分数低、系数低', () => {
    const j = judgeSpeed(0.3, cfg.speed);
    expect(j.tier).toBe('SLOW');
    expect(j.speedScore).toBeLessThan(55);
    expect(j.speedFactor).toBeLessThan(0.75);
  });

  it('太慢→合格边界', () => {
    expect(judgeSpeed(0.89, cfg.speed).tier).toBe('SLOW');
    expect(judgeSpeed(0.9, cfg.speed).tier).toBe('GOOD');
  });

  it('合格区间：正常伤害系数', () => {
    const j = judgeSpeed(1.2, cfg.speed);
    expect(j.tier).toBe('GOOD');
    expect(j.speedFactor).toBeGreaterThanOrEqual(0.85);
    expect(j.speedFactor).toBeLessThanOrEqual(1.0);
  });

  it('合格→凝练边界', () => {
    expect(judgeSpeed(1.79, cfg.speed).tier).toBe('GOOD');
    expect(judgeSpeed(1.8, cfg.speed).tier).toBe('REFINED');
  });

  it('凝练区间：较高伤害系数', () => {
    const j = judgeSpeed(2.4, cfg.speed);
    expect(j.tier).toBe('REFINED');
    expect(j.speedFactor).toBeGreaterThan(1.0);
    expect(j.speedFactor).toBeLessThanOrEqual(1.15);
  });

  it('失控：超过最大可控剑速，系数回落且不增伤', () => {
    const j = judgeSpeed(3.21, cfg.speed);
    expect(j.tier).toBe('OUT_OF_CONTROL');
    expect(j.speedFactor).toBe(0.8);
    // 失控不比凝练更强
    expect(j.speedFactor).toBeLessThan(judgeSpeed(2.4, cfg.speed).speedFactor);
    // 更快也不更強（失控封顶）
    expect(judgeSpeed(10, cfg.speed).speedFactor).toBe(0.8);
  });

  it('边界：恰等于最大可控剑速仍为凝练', () => {
    expect(judgeSpeed(3.2, cfg.speed).tier).toBe('REFINED');
  });
});

describe('准确度：山狼身体区域', () => {
  const bodyR = 0.085 * 800; // 68px
  const coreR = bodyR * cfg.wolf.coreRadiusRatio;

  it('核心命中：高分高系数', () => {
    const j = judgeAccuracy(coreR * 0.3, bodyR, cfg);
    expect(j.accuracyScore).toBeGreaterThanOrEqual(90);
    expect(j.accuracyFactor).toBeGreaterThan(1.1);
  });

  it('身体命中：中等分', () => {
    const j = judgeAccuracy((coreR + bodyR) / 2, bodyR, cfg);
    expect(j.accuracyScore).toBeGreaterThanOrEqual(60);
    expect(j.accuracyScore).toBeLessThan(90);
  });

  it('擦边（碰撞边缘）：低分', () => {
    const j = judgeAccuracy(bodyR * 1.03, bodyR, cfg);
    expect(j.accuracyScore).toBeLessThan(60);
  });

  it('分数与系数范围有效', () => {
    for (const d of [0, coreR * 0.5, coreR, bodyR * 0.8, bodyR * 1.04]) {
      const j = judgeAccuracy(d, bodyR, cfg);
      expect(j.accuracyScore).toBeGreaterThanOrEqual(25);
      expect(j.accuracyScore).toBeLessThanOrEqual(100);
      expect(j.accuracyFactor).toBeGreaterThanOrEqual(cfg.damage.accuracyFactorMin);
      expect(j.accuracyFactor).toBeLessThanOrEqual(cfg.damage.accuracyFactorMax);
    }
  });
});

describe('稳定度：直线率', () => {
  it('直斩（ratio≈1）：接近满分', () => {
    const j = judgeStability(0.98, cfg);
    expect(j.stabilityScore).toBeGreaterThanOrEqual(95);
    expect(j.stabilityFactor).toBeGreaterThan(1.0);
  });

  it('抖动绕动（ratio 低）：低分低系数', () => {
    const j = judgeStability(0.4, cfg);
    expect(j.stabilityScore).toBeLessThan(55);
    expect(j.stabilityFactor).toBeLessThan(0.9);
  });

  it('失控惩罚倍率降低稳定表现', () => {
    const a = judgeStability(0.9, cfg, 1);
    const b = judgeStability(0.9, cfg, 0.75);
    expect(b.stabilityScore).toBeLessThan(a.stabilityScore);
    expect(b.stabilityFactor).toBeLessThan(a.stabilityFactor);
  });
});

describe('伤害公式：基础 × 剑速 × 精准 × 稳定', () => {
  it('好的一剑明显强于乱划', () => {
    const good = computeDamage(1.1, 1.15, 1.08, cfg); // 凝练+核心+直斩
    const bad = computeDamage(0.5, 0.68, 0.78, cfg); // 偏慢+擦边+抖动
    expect(good).toBeGreaterThan(bad * 3);
  });

  it('擦边弱于核心', () => {
    const core = computeDamage(1.0, 1.15, 1.0, cfg);
    const edge = computeDamage(1.0, 0.7, 1.0, cfg);
    expect(core).toBeGreaterThan(edge * 1.5);
  });

  it('太慢伤害低', () => {
    const slow = computeDamage(0.45, 1.0, 1.0, cfg);
    const good = computeDamage(1.0, 1.0, 1.0, cfg);
    expect(slow).toBeLessThan(good * 0.6);
  });

  it('超速失控不能成为最优策略（失控伤害 ≤ 凝练）', () => {
    const ooc = computeDamage(0.8, 1.15, 0.8, cfg); // 失控：速度0.8 + 稳定惩罚
    const refined = computeDamage(1.1, 1.15, 1.05, cfg);
    expect(ooc).toBeLessThan(refined);
  });

  it('气机不继伤害大幅降低', () => {
    const full = computeDamage(1.0, 1.0, 1.0, cfg);
    const exhausted = computeDamage(1.0, 1.0, 1.0, cfg, true);
    expect(exhausted).toBeLessThanOrEqual(full * cfg.player.exhaustedDamageMul + 1);
  });

  it('数剑正常质量可击杀山狼（不做几十刀磨血）', () => {
    let hp = cfg.wolf.hpMax; // 100
    let hits = 0;
    while (hp > 0 && hits < 12) {
      hp -= computeDamage(1.0, 1.0, 1.0, cfg); // 合格+身体+合格稳定
      hits++;
    }
    expect(hp).toBeLessThanOrEqual(0);
    expect(hits).toBeLessThanOrEqual(6); // 正常质量 3~5 剑
  });
});