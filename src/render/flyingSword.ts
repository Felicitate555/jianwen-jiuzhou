/**
 * 食指飞剑（表现层）：剑指的视觉延伸——小而灵动的青白飞剑。
 * 只读显示层剑尖，不回写输入、轨迹或战斗数据。
 */
const SWORD_LEN = 26;
const SWORD_HALF_W = 1.6;
const FOLLOW = 0.32;
const ANGLE_LERP = 0.22;
const IDLE_ANGLE = -Math.PI / 2;
const STILL_SPEED = 0.045;

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class FlyingSword {
  private x = 0;
  private y = 0;
  private angle = IDLE_ANGLE;
  private alpha = 0;
  private hasPos = false;
  private lastX = 0;
  private lastY = 0;
  private lastT = 0;
  private stillFor = 0;

  update(tip: { x: number; y: number } | null, now: number, dtMs: number): number {
    if (!tip) {
      this.alpha = Math.max(0, this.alpha - dtMs / 300);
      this.stillFor += dtMs;
      return this.alpha;
    }
    if (!this.hasPos) {
      this.x = tip.x;
      this.y = tip.y;
      this.hasPos = true;
      this.lastX = tip.x;
      this.lastY = tip.y;
      this.lastT = now;
    }
    this.x += (tip.x - this.x) * FOLLOW;
    this.y += (tip.y - this.y) * FOLLOW;

    const dt = Math.max(1, now - this.lastT);
    const vx = (this.x - this.lastX) / dt;
    const vy = (this.y - this.lastY) / dt;
    const speed = Math.hypot(vx, vy);
    if (speed >= STILL_SPEED) {
      this.angle = lerpAngle(this.angle, Math.atan2(vy, vx), ANGLE_LERP);
      this.stillFor = 0;
    } else {
      this.angle = lerpAngle(this.angle, IDLE_ANGLE, 0.06);
      this.stillFor += dtMs;
    }
    this.lastX = this.x;
    this.lastY = this.y;
    this.lastT = now;
    this.alpha = Math.min(1, this.alpha + dtMs / 160);
    return this.alpha;
  }

  draw(ctx: CanvasRenderingContext2D, now: number, qiIntensity: number): void {
    if (this.alpha <= 0.01 || !this.hasPos) return;
    const bobT = Math.sin(now / 640);
    const bob = this.stillFor > 260 ? bobT * 2.1 : bobT * 0.6;
    const angle = this.angle + (this.stillFor > 260 ? bobT * 0.035 : 0);

    ctx.save();
    ctx.globalAlpha = this.alpha * (0.55 + 0.45 * Math.max(0.35, qiIntensity));
    ctx.translate(this.x, this.y + bob);
    ctx.rotate(angle);

    const blade = ctx.createLinearGradient(-8, 0, SWORD_LEN, 0);
    blade.addColorStop(0, 'rgba(140,168,160,0.35)');
    blade.addColorStop(0.45, 'rgba(205,239,232,0.8)');
    blade.addColorStop(0.85, 'rgba(235,255,250,0.95)');
    blade.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.fillStyle = blade;
    ctx.beginPath();
    ctx.moveTo(-8, -SWORD_HALF_W * 0.7);
    ctx.lineTo(SWORD_LEN - 5, -SWORD_HALF_W);
    ctx.lineTo(SWORD_LEN, 0);
    ctx.lineTo(SWORD_LEN - 5, SWORD_HALF_W);
    ctx.lineTo(-8, SWORD_HALF_W * 0.7);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = this.alpha * 0.28 * qiIntensity;
    ctx.strokeStyle = 'rgba(205,239,232,0.8)';
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(-2, 0);
    ctx.lineTo(SWORD_LEN - 3, 0);
    ctx.stroke();

    ctx.globalAlpha = this.alpha * 0.95;
    ctx.strokeStyle = '#9ab4a8';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-2, -4.4);
    ctx.lineTo(-2, 4.4);
    ctx.stroke();

    ctx.strokeStyle = '#3c4a44';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-8, 0);
    ctx.lineTo(-2, 0);
    ctx.stroke();

    const sway = Math.sin(now / 420) * 3;
    ctx.globalAlpha = this.alpha * 0.7;
    ctx.strokeStyle = 'rgba(217,164,91,0.65)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-8, 0);
    ctx.quadraticCurveTo(-12, 3 + sway * 0.4, -14, 6 + sway);
    ctx.moveTo(-8, 0);
    ctx.quadraticCurveTo(-11, 2 - sway * 0.3, -13, 4 - sway * 0.8);
    ctx.stroke();
    ctx.restore();
  }
}
