/**
 * 山狼状态机：APPROACH → TELEGRAPH → LUNGE → RECOVER → APPROACH（循环）→ DYING → DEAD。
 * 位置以舞台比例存储，速度按舞台宽度归一化，resize 安全。
 */
import type { WolfConfig } from './combatConfig';

export type WolfState =
  | 'APPROACH'
  | 'TELEGRAPH'
  | 'LUNGE'
  | 'RECOVER'
  | 'DYING'
  | 'DEAD';

export interface Wolf {
  state: WolfState;
  hp: number;
  hpMax: number;
  /** 舞台比例坐标 */
  x: number;
  y: number;
  telegraphUntil: number;
  lungeStart: number;
  lungeResolveAt: number;
  lungeFromX: number;
  lungeFromY: number;
  dyingAt: number;
  /** 受击白闪截止时间 */
  hitFlashUntil: number;
  /** 受击击退量（舞台比例，随时间衰减） */
  knockback: number;
  /** 本轮 LUNGE 是否已结算 */
  lungeResolved: boolean;
  /** 死亡反馈总时长（ms，渲染淡出用） */
  dyingDuration: number;
}

export function createWolf(cfg: WolfConfig): Wolf {
  return {
    state: 'APPROACH',
    hp: cfg.hpMax,
    hpMax: cfg.hpMax,
    x: cfg.spawnX,
    y: 0.5,
    telegraphUntil: 0,
    lungeStart: 0,
    lungeResolveAt: 0,
    lungeFromX: 0,
    lungeFromY: 0,
    dyingAt: 0,
    hitFlashUntil: 0,
    knockback: 0,
    lungeResolved: false,
    dyingDuration: cfg.dyingMs,
  };
}

/**
 * 推进山狼状态（原地更新）。
 * @param dtMs 距上次 update 的毫秒数（引擎已 clamp ≤100ms）
 */
export function updateWolf(
  w: Wolf,
  nowMs: number,
  dtMs: number,
  stageW: number,
  cfg: WolfConfig,
): void {
  // 击退量按时间衰减
  if (w.knockback > 0) {
    w.knockback = Math.max(0, w.knockback - (dtMs / 1000) * 0.12);
  }
  if (w.state === 'DEAD' || w.state === 'DYING') {
    if (w.state === 'DYING' && nowMs >= w.dyingAt) {
      w.state = 'DEAD';
    }
    return;
  }

  switch (w.state) {
    case 'APPROACH': {
      // 从右侧向危险区域逼近，同时缓慢靠向中线
      const speed = cfg.approachSpeedRatio * stageW; // px/s
      w.x -= (speed * dtMs) / 1000 / stageW;
      w.y += (0.5 - w.y) * Math.min(1, dtMs / 2000);
      if (w.x <= cfg.dangerX) {
        w.x = cfg.dangerX;
        w.state = 'TELEGRAPH';
        w.telegraphUntil = nowMs + cfg.telegraphMs;
      }
      break;
    }
    case 'TELEGRAPH': {
      if (nowMs >= w.telegraphUntil) {
        w.state = 'LUNGE';
        w.lungeStart = nowMs;
        w.lungeResolveAt = nowMs + cfg.lungeDurationMs;
        w.lungeFromX = w.x;
        w.lungeFromY = w.y;
        w.lungeResolved = false;
      }
      break;
    }
    case 'LUNGE': {
      const t = Math.min(1, Math.max(0, (nowMs - w.lungeStart) / cfg.lungeDurationMs));
      const k = 1 - Math.pow(1 - t, 2); // ease-out：前段加速冲向玩家
      w.x = w.lungeFromX + (cfg.lungeTargetX - w.lungeFromX) * k;
      w.y = w.lungeFromY + (cfg.lungeTargetY - w.lungeFromY) * k;
      break;
    }
    case 'RECOVER': {
      // 扑击后退回屏幕右侧，随后再次逼近
      const speed = cfg.recoverSpeedRatio * stageW;
      w.x += (speed * dtMs) / 1000 / stageW;
      w.y += (0.5 - w.y) * Math.min(1, dtMs / 1500);
      if (w.x >= cfg.spawnX) {
        w.x = cfg.spawnX;
        w.state = 'APPROACH';
      }
      break;
    }
  }
}

/** LUNGE 到达结算时刻（引擎在此刻做格挡/受创判定，随后转入 RECOVER） */
export function wolfLungeArrived(w: Wolf, nowMs: number): boolean {
  return w.state === 'LUNGE' && !w.lungeResolved && nowMs >= w.lungeResolveAt;
}

/** 山狼受击：白闪、击退与伤害（死亡由引擎判定） */
export function wolfHit(w: Wolf, nowMs: number, damage: number): void {
  w.hp = Math.max(0, w.hp - damage);
  w.hitFlashUntil = nowMs + 200;
  w.knockback = Math.min(0.05, w.knockback + 0.02);
}

/** 山狼进入死亡反馈 */
export function wolfDie(w: Wolf, nowMs: number, dyingMs: number): void {
  w.state = 'DYING';
  w.dyingAt = nowMs + dyingMs;
  w.hp = 0;
}

/** 渲染用的击退偏移（px，向右） */
export function wolfKnockbackPx(w: Wolf, stageW: number): number {
  return w.knockback * stageW;
}