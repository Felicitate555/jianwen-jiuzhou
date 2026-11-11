/**
 * 战斗渲染器：剑痕 + 山狼 + 战斗反馈，国风水墨克制风格。
 * 不绘制 HUD 文本/数字（HUD 由 React 层负责，避免满屏数字）。
 */
import type { CombatSnapshot } from './combatEngine';
import type { TechniqueFx } from '@/technique/techniqueEngine';
import { TRAIL_COLORS } from '@/render/trailRenderer';
import type { TrailPoint } from '@/lib/types';
import { getPortrait } from '@/combat/portraits';

/** 招式剑气淡出时长（与 techniqueConfig.fxDurationMs 保持一致） */
const TECHNIQUE_FX_MS = 800;

/** 招式剑气主色：比普通剑痕更亮的暖金（克制金，非页游金光） */
const TECHNIQUE_FX_COLOR = '#e6c07a';
/** 招式剑气辉光色（暗部，避免大面积饱和） */
const TECHNIQUE_FX_GLOW = '#d9a45b';

export interface CombatRenderInput {
  rawTrail: TrailPoint[];
  smoothedTrail: TrailPoint[];
  showRaw: boolean;
  showSmooth: boolean;
  /** 剑尖显示点（已应用显示 dead zone） */
  tip: { x: number; y: number } | null;
  /** 气机强度（0.35 = 气机不继，剑气视觉明显变弱） */
  qiIntensity: number;
  /** 出剑中才画攻击剑气；SHEATHED/IDLE 不产生攻击剑痕 */
  attacking: boolean;
  snapshot: CombatSnapshot;
  now: number;
  stageW: number;
  stageH: number;
}

/** 淡出曲线（时间衰减） */
function fade(t: number): number {
  return t * t;
}

export class CombatRenderer {
  private drawPortraitBody(
    ctx: CanvasRenderingContext2D,
    image: HTMLImageElement,
    cx: number,
    cy: number,
    bodyR: number,
    options: { bottomRatio: number; heightRatio: number; scaleX?: number; tilt?: number; wobble?: number; flashing?: boolean },
  ): void {
    const height = bodyR * options.heightRatio;
    const width = height * (image.naturalWidth / image.naturalHeight);
    ctx.save();
    ctx.translate(cx, cy + bodyR * options.bottomRatio + (options.wobble ?? 0));
    if (options.tilt) ctx.rotate(options.tilt);
    ctx.scale(options.scaleX ?? 1, 1);
    if (options.flashing) ctx.filter = 'brightness(2.15) saturate(.35)';
    ctx.drawImage(image, -width / 2, -height, width, height);
    ctx.restore();
  }

  render(ctx: CanvasRenderingContext2D, input: CombatRenderInput): void {
    const { snapshot, now, stageW, stageH } = input;
    ctx.clearRect(0, 0, stageW, stageH);

    // 第九阶段：赤瞳山魈（encounter 模式；普通战斗为 null 不绘制）
    this.drawBoss(ctx, snapshot, stageW, stageH, now);

    // 山狼
    this.drawWolf(ctx, snapshot, stageW, stageH, now);

    for (const add of snapshot.adds ?? []) this.drawWolf(ctx, { ...snapshot, boss: null, wolf: add, wolfX: add.x + add.knockback }, stageW, stageH, now);

    // 远程敌人（第三阶段）
    this.drawRangedEnemy(ctx, snapshot, stageW, stageH, now);

    // 妖气弹与结算反馈（第三阶段）
    this.drawProjectiles(ctx, snapshot, stageW, stageH, now);

    // 剑痕：SHEATHED 时不产生攻击剑痕
    if (input.attacking) {
      this.drawTrails(ctx, input);
    } else if (input.showSmooth) {
      // 收势时仅保留极淡的痕迹（防御姿态示意），不产生攻击剑痕
      this.drawTrails(ctx, input, 0.12);
    }

    // 招式剑气形态（第四阶段）：画在普通剑痕之上，暖金高亮可辨识
    // （斜劈细长剑痕 / 十字交叉双痕 / 回风弧光，700~900ms 淡出，不遮挡敌人预警）
    this.drawTechniqueFx(ctx, snapshot.techniqueFx, now, input.qiIntensity);
  }

  private drawTrails(ctx: CanvasRenderingContext2D, input: CombatRenderInput, mul = 1): void {
    const { smoothedTrail, rawTrail, now, qiIntensity, showRaw, showSmooth } = input;
    const ttl = 900;

    if (showSmooth) {
      ctx.save();
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = TRAIL_COLORS.smooth;
      ctx.globalAlpha = 0.9 * qiIntensity * mul;
      ctx.shadowColor = TRAIL_COLORS.smooth;
      ctx.shadowBlur = 10 * qiIntensity;
      this.strokeTrail(ctx, smoothedTrail, now, ttl);
      ctx.restore();
    }

    if (showRaw) {
      ctx.save();
      ctx.fillStyle = TRAIL_COLORS.raw;
      for (const p of rawTrail) {
        const age = (now - p.t) / ttl;
        if (age >= 1) continue;
        ctx.globalAlpha = Math.max(0, 0.55 * (1 - age) * qiIntensity * mul);
        ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
      }
      ctx.restore();
    }

    // 剑尖光点：气机不继时明显变弱
    if (input.tip && input.attacking) {
      ctx.save();
      ctx.globalAlpha = (0.85 * qiIntensity) * mul;
      ctx.fillStyle = TRAIL_COLORS.smooth;
      ctx.shadowColor = TRAIL_COLORS.smooth;
      ctx.shadowBlur = 18 * qiIntensity;
      ctx.beginPath();
      ctx.arc(input.tip.x, input.tip.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private strokeTrail(
    ctx: CanvasRenderingContext2D,
    trail: TrailPoint[],
    now: number,
    ttl: number,
  ): void {
    // 仅绘制连续 ACTIVE 段；断点 > 350ms 不连线
    ctx.beginPath();
    let prev: TrailPoint | null = null;
    for (const p of trail) {
      const age = (now - p.t) / ttl;
      if (age >= 1) {
        prev = null;
        continue;
      }
      if (prev === null || p.t - prev.t > 350 || p.a !== 'ACTIVE') {
        if (p.a === 'ACTIVE') ctx.moveTo(p.x, p.y);
        else prev = null;
      } else {
        ctx.lineTo(p.x, p.y);
      }
      prev = p;
    }
    ctx.stroke();
  }

  /**
   * 招式剑气形态（第四阶段）：
   * - 斜劈：斜向细长剑痕（沿识别起终点）；
   * - 十字剑：交叉双痕（两笔起终点）；
   * - 回风式：回转弧光（按轨迹包围盒中心与扫过角）。
   * 暖金高亮画在普通剑痕之上；预览（已识别·未命中）用更克制的虚线弱化形态。
   */
  private drawTechniqueFx(
    ctx: CanvasRenderingContext2D,
    fxList: TechniqueFx[],
    now: number,
    qiIntensity: number,
  ): void {
    for (const fx of fxList) {
      const s = fx.shape;
      const k = Math.max(0, Math.min(1, (fx.until - now) / TECHNIQUE_FX_MS));
      if (k <= 0) continue;
      ctx.save();
      if (fx.preview) {
        // 预览：克制的青白虚线（未命中，非成功命中，不使用暖金强调色）
        ctx.globalAlpha = 0.4 * k;
        ctx.strokeStyle = '#c8d8ce';
        ctx.lineWidth = 1.6;
        ctx.setLineDash([7, 7]);
        ctx.shadowColor = '#c8d8ce';
        ctx.shadowBlur = 6 * qiIntensity;
      } else {
        // 生效招式：暖金高亮，线宽与辉光均高于普通剑痕
        ctx.globalAlpha = 0.85 * k * Math.max(0.5, qiIntensity);
        ctx.strokeStyle = TECHNIQUE_FX_COLOR;
        ctx.lineWidth = fx.kind === 'RETURN_WIND' ? 3.4 : 3;
        ctx.shadowColor = TECHNIQUE_FX_GLOW;
        ctx.shadowBlur = 18 * qiIntensity;
      }
      ctx.lineCap = 'round';
      ctx.beginPath();
      if (s.type === 'diagonal') {
        // 斜劈：细长剑痕沿运动方向外扩一点
        const dx = s.bx - s.ax;
        const dy = s.by - s.ay;
        const len = Math.max(1e-6, Math.hypot(dx, dy));
        const ext = 12 * (1 - k * 0.5);
        ctx.moveTo(s.ax - (dx / len) * ext, s.ay - (dy / len) * ext);
        ctx.lineTo(s.bx + (dx / len) * ext, s.by + (dy / len) * ext);
        ctx.stroke();
      } else if (s.type === 'cross') {
        // 十字：两笔交叉双痕
        ctx.moveTo(s.ax, s.ay);
        ctx.lineTo(s.bx, s.by);
        ctx.moveTo(s.cx, s.cy);
        ctx.lineTo(s.dx, s.dy);
        ctx.stroke();
      } else {
        // 回风：回转弧光（顺/逆时针按 sweep 符号）
        const sweep = s.sweep;
        if (Math.abs(sweep) > 0.15 && s.radius > 4) {
          ctx.arc(s.centerX, s.centerY, s.radius, s.startAngle, s.startAngle + sweep, sweep < 0);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  /** 赤瞳山魈（第九阶段）：墨色巨影 + 朱红双目 + 阶段化轮廓。
   *  复用 Wolf 剪影质感；身体大一号，双眼赤瞳为唯一色彩强调；预警/破势/受击白闪同既有语义。 */
  private drawBoss(
    ctx: CanvasRenderingContext2D,
    s: CombatSnapshot,
    stageW: number,
    stageH: number,
    now: number,
  ): void {
    const b = s.boss;
    if (!b || b.state === 'DEAD') return;
    const cx = b.x * stageW;
    const cy = b.y * stageH;
    const bodyR = (s.bossGeometry?.bodyRadiusRatio ?? 0.115) * stageW; // 与 BossConfig.bodyRadiusRatio 同值（渲染快照无 config 引用）

    ctx.save();

    // 死亡反馈：淡出下坠
    if (b.state === 'DYING') {
      const k = Math.max(0, 1 - (now - (b.dyingAt - b.dyingDuration)) / b.dyingDuration);
      ctx.globalAlpha = 0.9 * k;
      ctx.translate(0, (1 - k) * bodyR * 0.9);
    }

    const flashing = now < b.hitFlashUntil;
    const melee = b.melee;

    // 近身预警：暖金描边脉冲（复用山狼视觉语义）
    if (melee.state === 'TELEGRAPH') {
      const t = (melee.telegraphUntil - now) / 900;
      const pulse = 0.35 + 0.3 * Math.sin(now / 90);
      ctx.save();
      ctx.strokeStyle = '#d9a45b';
      ctx.globalAlpha = pulse * Math.min(1, Math.max(0, t) + 0.2);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, bodyR * 1.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 扑击拉伸提示
    const scaleX = melee.state === 'LUNGE' ? 1.28 : 1;

    const bossPortrait = getPortrait('chitongshanxiao');
    if (bossPortrait) {
      this.drawPortraitBody(ctx, bossPortrait, cx, cy, bodyR, {
        bottomRatio: 1.1, heightRatio: 3.9, scaleX: melee.state === 'LUNGE' ? 1.2 : 1,
        tilt: melee.state === 'LUNGE' ? -0.06 : 0, wobble: Math.sin(now / 540) * bodyR * 0.08, flashing,
      });
    } else {
    // 身体：立绘尚未加载时保留原墨色剪影
    ctx.translate(cx, cy);
    ctx.scale(scaleX, 1);
    ctx.fillStyle = flashing ? 'rgba(240,244,240,0.92)' : '#141e1f';
    ctx.strokeStyle = flashing ? '#f0f4f0' : '#4a2f2c';
    ctx.lineWidth = 1.8;

    // 躯干
    ctx.beginPath();
    ctx.ellipse(0, 0, bodyR * 1.12, bodyR * 0.82, -0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 头部（朝左）
    ctx.beginPath();
    ctx.ellipse(-bodyR * 1.12, -bodyR * 0.3, bodyR * 0.5, bodyR * 0.4, -0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 上肢（垂立；破势阶段蓄力时抬起示意）
    const armRaise = b.ranged.state === 'CHARGE' ? -bodyR * 0.5 : 0;
    ctx.beginPath();
    ctx.ellipse(-bodyR * 0.55, bodyR * 0.12 + armRaise, bodyR * 0.18, bodyR * 0.52, 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(bodyR * 0.42, bodyR * 0.12 + armRaise, bodyR * 0.18, bodyR * 0.52, -0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 赤瞳双目（唯一色彩强调；乱战阶段更亮）
    const eyeAlpha = b.phase === 'CHAOS' ? 0.95 : 0.8;
    const eyeR = bodyR * (b.phase === 'CHAOS' ? 0.085 : 0.07);
    ctx.fillStyle = `rgba(192,90,74,${eyeAlpha})`;
    ctx.beginPath();
    ctx.arc(-bodyR * 1.22, -bodyR * 0.36, eyeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-bodyR * 0.98, -bodyR * 0.4, eyeR, 0, Math.PI * 2);
    ctx.fill();
    }

    ctx.restore();
    // Draw last so the opaque body never obscures the actual collision core.
    const weak = s.bossGeometry?.weakPoint;
    if (weak?.active) {
      ctx.save(); ctx.globalAlpha = 0.75; ctx.fillStyle = '#c07a5e';
      ctx.strokeStyle = '#cdefe8'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(weak.x * stageW, weak.y * stageH, weak.radiusRatio * stageW, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke(); ctx.restore();
    }
  }

  private drawWolf(
    ctx: CanvasRenderingContext2D,
    s: CombatSnapshot,
    stageW: number,
    stageH: number,
    now: number,
  ): void {
    const w = s.wolf;
    if (s.boss !== null) return; // encounter 模式：山魈内嵌近身形态由 drawBoss 绘制
    if (w.state === 'DEAD') return;
    const cx = s.wolfX * stageW;
    const cy = w.y * stageH;
    const bodyR = 0.085 * stageW;

    ctx.save();

    // 死亡反馈：淡出下坠（时长来自配置）
    if (w.state === 'DYING') {
      const k = Math.max(0, 1 - (now - (w.dyingAt - w.dyingDuration)) / w.dyingDuration);
      ctx.globalAlpha = 0.9 * k;
      ctx.translate(0, (1 - k) * bodyR * 0.8);
    }

    // 受击白闪
    const flashing = now < w.hitFlashUntil;

    // 预警：克制的暖金描边脉冲（不刺眼）
    if (w.state === 'TELEGRAPH') {
      const t = (w.telegraphUntil - now) / 900;
      const pulse = 0.35 + 0.3 * Math.sin(now / 90);
      ctx.save();
      ctx.strokeStyle = '#d9a45b';
      ctx.globalAlpha = pulse * Math.min(1, Math.max(0, t) + 0.2);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, bodyR * 1.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 扑击拉伸提示
    const scaleX = w.state === 'LUNGE' ? 1.25 : 1;

    const wolfPortrait = getPortrait('shanlang');
    if (wolfPortrait) {
      this.drawPortraitBody(ctx, wolfPortrait, cx, cy, bodyR, {
        bottomRatio: 1.15, heightRatio: 4.6, scaleX: w.state === 'LUNGE' ? 1.15 : 1,
        tilt: w.state === 'LUNGE' ? -0.05 : 0, wobble: Math.sin(now / 560) * bodyR * 0.07, flashing,
      });
    } else {
    // 山狼身体：立绘尚未加载时保留原墨色剪影
    ctx.translate(cx, cy);
    ctx.scale(scaleX, 1);
    ctx.fillStyle = flashing ? 'rgba(240,244,240,0.92)' : '#1d2a2b';
    ctx.strokeStyle = flashing ? '#f0f4f0' : '#3d4f4f';
    ctx.lineWidth = 1.5;

    // 躯干（椭圆）
    ctx.beginPath();
    ctx.ellipse(0, 0, bodyR * 1.05, bodyR * 0.72, -0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 头部（朝向左）
    ctx.beginPath();
    ctx.ellipse(-bodyR * 1.05, -bodyR * 0.28, bodyR * 0.42, bodyR * 0.34, -0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 耳朵
    ctx.beginPath();
    ctx.moveTo(-bodyR * 1.05, -bodyR * 0.5);
    ctx.lineTo(-bodyR * 1.3, -bodyR * 0.95);
    ctx.lineTo(-bodyR * 0.78, -bodyR * 0.62);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 尾巴
    ctx.beginPath();
    ctx.moveTo(bodyR * 0.95, -bodyR * 0.1);
    ctx.quadraticCurveTo(bodyR * 1.6, -bodyR * 0.55, bodyR * 1.45, bodyR * 0.25);
    ctx.stroke();

    // 腿（简单两笔）
    ctx.beginPath();
    ctx.moveTo(-bodyR * 0.45, bodyR * 0.6);
    ctx.lineTo(-bodyR * 0.5, bodyR * 1.0);
    ctx.moveTo(bodyR * 0.45, bodyR * 0.6);
    ctx.lineTo(bodyR * 0.5, bodyR * 1.0);
    ctx.stroke();

    // 眼（暖金一点，克制）
    if (!flashing) {
      ctx.fillStyle = '#d9a45b';
      ctx.beginPath();
      ctx.arc(-bodyR * 1.18, -bodyR * 0.34, bodyR * 0.07, 0, Math.PI * 2);
      ctx.fill();
    }
    }

    ctx.restore();

    // 死亡墨散效果
    if (w.state === 'DYING') {
      const k = Math.max(0, 1 - (now - (w.dyingAt - w.dyingDuration)) / w.dyingDuration);
      if (k > 0) {
        ctx.save();
        ctx.globalAlpha = 0.35 * fade(k);
        ctx.fillStyle = '#2c3a3a';
        ctx.beginPath();
        ctx.arc(cx, cy + bodyR * 0.5, bodyR * (1.4 + (1 - k) * 0.8), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  /** 远程敌人（妖修）：墨色剪影 + 青紫妖气 + 蓄力暖金环 + 朱红弱点核心 */
  private drawRangedEnemy(
    ctx: CanvasRenderingContext2D,
    s: CombatSnapshot,
    stageW: number,
    stageH: number,
    now: number,
  ): void {
    const e = s.rangedEnemy;
    if (s.boss !== null) return; // encounter 模式：山魈远程形态由 drawBoss 绘制
    if (!e || e.state === 'DEAD') return;
    const cx = e.x * stageW;
    const cy = e.y * stageH;
    const bodyR = 0.07 * stageW;

    ctx.save();

    // 死亡/离场：淡出上飘
    if (e.state === 'DYING') {
      const k = Math.max(0, 1 - (now - (e.dyingAt - e.dyingDuration)) / e.dyingDuration);
      ctx.globalAlpha = 0.85 * k;
      ctx.translate(0, -(1 - k) * bodyR * 1.2);
    }

    // 破势硬直：轻微震颤
    if (e.state === 'INTERRUPTED') {
      ctx.translate(Math.sin(now / 28) * bodyR * 0.08, 0);
    }

    // 受击白闪
    const flashing = now < e.hitFlashUntil;

    // 蓄力：暖金蓄力环脉冲（克制，不刺眼）
    if (e.state === 'CHARGE') {
      const t = Math.max(0, (e.chargeEndsAt - now) / (e.chargeEndsAt - e.chargeStartedAt));
      const pulse = 0.3 + 0.25 * Math.sin(now / 80);
      ctx.save();
      ctx.strokeStyle = '#d9a45b';
      ctx.globalAlpha = pulse * (0.4 + 0.6 * (1 - t));
      ctx.lineWidth = 2;
      ctx.setLineDash([bodyR * 0.5, bodyR * 0.35]);
      ctx.beginPath();
      ctx.arc(cx, cy, bodyR * 1.7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const bob = Math.sin(now / 700) * bodyR * 0.08; // 悬浮起伏
    const rangedPortrait = getPortrait('yaoxiu');
    if (rangedPortrait) {
      this.drawPortraitBody(ctx, rangedPortrait, cx, cy, bodyR, {
        bottomRatio: 1.35, heightRatio: 4.4, wobble: bob, flashing,
      });
    } else {
    // 妖修身体：立绘尚未加载时保留原斗篷剪影
    ctx.translate(cx, cy);
    ctx.translate(0, bob);
    ctx.fillStyle = flashing ? 'rgba(240,244,240,0.92)' : '#232430';
    ctx.strokeStyle = flashing ? '#f0f4f0' : '#45455c';
    ctx.lineWidth = 1.5;

    // 斗篷（下摆展开的钟形）
    ctx.beginPath();
    ctx.moveTo(-bodyR * 0.55, -bodyR * 0.5);
    ctx.quadraticCurveTo(-bodyR * 0.75, bodyR * 0.4, -bodyR * 0.35, bodyR * 1.05);
    ctx.quadraticCurveTo(0, bodyR * 1.25, bodyR * 0.35, bodyR * 1.05);
    ctx.quadraticCurveTo(bodyR * 0.75, bodyR * 0.4, bodyR * 0.55, -bodyR * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 头部（兜帽感）
    ctx.beginPath();
    ctx.ellipse(-bodyR * 0.05, -bodyR * 0.62, bodyR * 0.34, bodyR * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 眼：青紫妖光一点（克制）
    if (!flashing) {
      ctx.fillStyle = '#9d8ec9';
      ctx.beginPath();
      ctx.arc(-bodyR * 0.2, -bodyR * 0.62, bodyR * 0.06, 0, Math.PI * 2);
      ctx.fill();
    }
    }

    ctx.restore();

    // 弱点核心：仅蓄力且有效时，身体中央朱红小圆（可破势提示）
    if (e.weakPointActive) {
      const weakR = bodyR * 0.34;
      const glow = 0.75 + 0.25 * Math.sin(now / 110);
      ctx.save();
      ctx.globalAlpha = glow;
      ctx.fillStyle = '#c34540';
      ctx.shadowColor = '#c34540';
      ctx.shadowBlur = 10 * glow;
      ctx.beginPath();
      ctx.arc(cx, cy, weakR, 0, Math.PI * 2);
      ctx.fill();
      // 核心内一点亮斑
      ctx.globalAlpha = glow;
      ctx.fillStyle = 'rgba(255,224,210,0.85)';
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(cx - weakR * 0.25, cy - weakR * 0.25, weakR * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  /** 妖气弹：青紫妖气团 + 尾迹 + 斩碎/命中反馈 */
  private drawProjectiles(
    ctx: CanvasRenderingContext2D,
    s: CombatSnapshot,
    stageW: number,
    stageH: number,
    now: number,
  ): void {
    // 活跃弹体
    for (const p of s.projectiles) {
      const cx = p.x * stageW;
      const cy = p.y * stageH;
      const r = p.radiusRatio * stageW;
      const age = (now - p.createdAt) / 1000;
      ctx.save();
      // 尾迹：朝来路方向的渐隐短尾（非光束）
      const tailLen = Math.min(1, age * 2) * r * 3.2;
      const nx = -p.vx;
      const ny = -p.vy;
      const nl = Math.max(1e-6, Math.hypot(nx, ny));
      const grad = ctx.createLinearGradient(
        cx,
        cy,
        cx + (nx / nl) * tailLen,
        cy + (ny / nl) * tailLen,
      );
      grad.addColorStop(0, 'rgba(157,142,201,0.5)');
      grad.addColorStop(1, 'rgba(157,142,201,0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = r * 1.1;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + (nx / nl) * tailLen, cy + (ny / nl) * tailLen);
      ctx.stroke();

      // 弹体：青紫妖气团（径向渐变，中心偏朱红）
      const body = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
      body.addColorStop(0, '#d8b8a8');
      body.addColorStop(0.45, '#9d8ec9');
      body.addColorStop(1, 'rgba(80,70,120,0.25)');
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      // 妖气微颤（幅度克制）
      ctx.globalAlpha = 0.35 + 0.15 * Math.sin(now / 60 + p.id);
      ctx.strokeStyle = '#b7a8dd';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.25, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 结算反馈：斩碎 = 扩散碎裂环；命中 = 朱红入体扩散（300~600ms）
    for (const p of s.projectileFx) {
      const k = Math.max(0, 1 - (now - p.resolvedAt) / 600);
      if (k <= 0) continue;
      const cx = p.x * stageW;
      const cy = p.y * stageH;
      const r = p.radiusRatio * stageW;
      ctx.save();
      ctx.globalAlpha = k * 0.8;
      if (p.slashed) {
        // 斩弹碎裂：青白扩散环 + 数点墨散
        ctx.strokeStyle = '#cdefe8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r * (1 + (1 - k) * 2.2), 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(205,239,232,0.6)';
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 + p.id;
          const d = r * (0.6 + (1 - k) * 1.8);
          ctx.beginPath();
          ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // 妖气入体：朱红扩散
        ctx.strokeStyle = '#c34540';
        ctx.lineWidth = 2;
        ctx.globalAlpha = k * 0.6;
        ctx.beginPath();
        ctx.arc(cx, cy, r * (1 + (1 - k) * 2.6), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}
