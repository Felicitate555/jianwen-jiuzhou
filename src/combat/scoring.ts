/**
 * 快、准、稳评分与伤害系数（全部 0～100 分，系数无量纲）。
 *
 * 速度按「相对舞台宽度」归一化（每秒穿越舞台宽度的比例），不受屏幕尺寸影响；
 * 「快」不是越快越强：超过最大可控剑速即失控，伤害系数回落、稳定表现受罚。
 */
import type { CombatConfig, SpeedConfig } from './combatConfig';

export type SpeedTier = 'SLOW' | 'GOOD' | 'REFINED' | 'OUT_OF_CONTROL';

export interface SpeedJudgement {
  tier: SpeedTier;
  speedScore: number;
  speedFactor: number;
}

/** 速度四区间判定：太慢 / 合格 / 凝练 / 失控 */
export function judgeSpeed(vNorm: number, cfg: SpeedConfig): SpeedJudgement {
  const { slowRatio, goodRatio, maxControllableRatio } = cfg;
  if (vNorm > maxControllableRatio) {
    // 失控：分数回落、系数固定（不因超速增伤）
    return { tier: 'OUT_OF_CONTROL', speedScore: 65, speedFactor: 0.8 };
  }
  if (vNorm >= goodRatio) {
    const t = (vNorm - goodRatio) / (maxControllableRatio - goodRatio);
    return {
      tier: 'REFINED',
      speedScore: 80 + 20 * t,
      speedFactor: 1.0 + 0.15 * t,
    };
  }
  if (vNorm >= slowRatio) {
    const t = (vNorm - slowRatio) / (goodRatio - slowRatio);
    return {
      tier: 'GOOD',
      speedScore: 55 + 25 * t,
      speedFactor: 0.85 + 0.15 * t,
    };
  }
  const t = Math.max(0, vNorm) / slowRatio;
  return {
    tier: 'SLOW',
    speedScore: 10 + 45 * t,
    speedFactor: 0.4 + 0.35 * t,
  };
}

export interface AccuracyJudgement {
  accuracyScore: number;
  accuracyFactor: number;
}

/**
 * 准确度：按山狼身体区域。核心（中央较小区域）高、身体正常、擦边低，不细分头腿。
 * @param dist 命中点到狼中心距离（px）
 * @param bodyR 身体碰撞半径（px）
 */
export function judgeAccuracy(dist: number, bodyR: number, cfg: CombatConfig): AccuracyJudgement {
  const coreR = bodyR * cfg.wolf.coreRadiusRatio;
  let score: number;
  if (dist <= coreR) {
    score = 90 + 10 * (1 - dist / coreR);
  } else if (dist <= bodyR) {
    score = 60 + 30 * (1 - (dist - coreR) / (bodyR - coreR));
  } else {
    // 擦边（碰撞判定半径略大于身体）
    const edge = bodyR * 0.05;
    score = Math.max(25, 60 - 35 * ((dist - bodyR) / edge));
  }
  const accuracyScore = Math.round(Math.max(25, Math.min(100, score)));
  const { accuracyFactorMin, accuracyFactorMax } = cfg.damage;
  const accuracyFactor =
    accuracyFactorMin + (accuracyFactorMax - accuracyFactorMin) * (accuracyScore / 100);
  return { accuracyScore, accuracyFactor };
}

export interface StabilityJudgement {
  stabilityScore: number;
  stabilityFactor: number;
}

/**
 * 稳定度：起终点直线距离 / 实际轨迹长度。直斩接近 1，抖动与绕动降低。
 * @param ratio 轨迹段直线率（0~1）
 * @param penaltyMul 失控等惩罚倍率（如 0.75）
 */
export function judgeStability(
  ratio: number,
  cfg: CombatConfig,
  penaltyMul = 1,
): StabilityJudgement {
  const raw = Math.max(5, Math.min(100, ratio * 110));
  const stabilityScore = Math.round(raw * penaltyMul);
  const { stabilityFactorMin, stabilityFactorMax } = cfg.damage;
  const stabilityFactor =
    stabilityFactorMin + (stabilityFactorMax - stabilityFactorMin) * (stabilityScore / 100);
  return { stabilityScore, stabilityFactor };
}

/** 有效斩击的最终伤害：基础伤害 × 剑速系数 × 精准系数 × 稳定系数（× 气机不继倍率） */
export function computeDamage(
  speedFactor: number,
  accuracyFactor: number,
  stabilityFactor: number,
  cfg: CombatConfig,
  exhausted = false,
): number {
  const dmg =
    cfg.damage.base *
    speedFactor *
    accuracyFactor *
    stabilityFactor *
    (exhausted ? cfg.player.exhaustedDamageMul : 1);
  return Math.max(1, Math.round(dmg));
}