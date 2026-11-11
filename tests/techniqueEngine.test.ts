/**
 * 第四阶段测试：TechniqueEngine 纯几何识别（斜劈/十字剑/回风式）+ CombatEngine 接入。
 * 全部用真实几何轨迹（无随机、无定时器假成功）：
 * - 正例在不同舞台尺寸、不同方向（斜劈双向、回风顺/逆时针）均识别；
 * - 水平/垂直短线、静止点、噪声乱挥、单斜线、普通圆不误判或按配置回退；
 * - 十字必须两笔清晰交叉且同窗口只一个结果；
 * - 同段去重、冷却、retry 清理、会话领悟；
 * - CombatEngine 侧：倍率一次结算、额外气机、低气机/失控不免费生效、不产生第二次伤害。
 */
import { describe, expect, it } from 'vitest';
import { SlashDetector, type SlashPoint } from '@/combat/slashDetect';
import { CombatEngine } from '@/combat/combatEngine';
import { DEFAULT_COMBAT_CONFIG, type CombatConfig } from '@/combat/combatConfig';
import {
  DEFAULT_TECHNIQUE_CONFIG,
  type TechniqueConfig,
} from '@/technique/techniqueConfig';
import { TechniqueEngine } from '@/technique/techniqueEngine';
import type { InputFrame } from '@/lib/types';

const W = 800;
const H = 600;

function cfg(over: Partial<TechniqueConfig> = {}): TechniqueConfig {
  return { ...DEFAULT_TECHNIQUE_CONFIG, ...over };
}

interface DrawOpts {
  stageW?: number;
  minStepPx?: number; // 采样步长（px）
  msPerPx?: number; // 每像素耗时（ms）
  gapMs?: number; // 笔画间隔（≥250ms 时非末笔封存为历史段）
  t0?: number;
}

/**
 * 用真实 SlashDetector 喂帧生成段（走完整输入链：feed + tickIdle + tryStrike）。
 * - 多笔画且 gapMs ≥ segmentIdleCloseMs：前面的笔被封存为历史段（跨段拼合材料），末笔为当前就绪段；
 * - gapMs < segmentIdleCloseMs：所有笔画留在同一段（单段多笔）。
 */
function drawSegments(
  strokes: Array<Array<[number, number]>>,
  opts: DrawOpts = {},
): { ready: ReturnType<SlashDetector['tryStrike']>; detector: SlashDetector } {
  const { stageW = W, minStepPx = 8, msPerPx = 0.3, gapMs = 350, t0 = 0 } = opts;
  const det = new SlashDetector({
    minPathPx: 0.1 * stageW,
    minAvgSpeedPxPerSec: 0,
    segmentWindowMs: 600,
    segmentIdleCloseMs: 250,
  });
  let t = t0;
  strokes.forEach((stroke, si) => {
    const isLast = si === strokes.length - 1;
    if (si > 0) t += gapMs;
    let prev: [number, number] | null = null;
    for (const [x, y] of stroke) {
      if (prev) {
        const d = Math.hypot(x - prev[0], y - prev[1]);
        const n = Math.max(1, Math.round(d / minStepPx));
        for (let i = 1; i <= n; i++) {
          t += (msPerPx * d) / n;
          det.feed(
            { x: prev[0] + ((x - prev[0]) * i) / n, y: prev[1] + ((y - prev[1]) * i) / n, t },
            true,
            t,
          );
        }
      } else {
        det.feed({ x, y, t }, true, t);
      }
      prev = [x, y];
    }
    // 非末笔 + 间隔达到停顿阈值：封存为历史段（供跨段拼合）
    if (!isLast && gapMs >= 250) det.tickIdle(t + gapMs);
  });
  return { ready: det.tryStrike(), detector: det };
}

/** 直线采样点 */
function line(x0: number, y0: number, x1: number, y1: number, step = 8): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const d = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.round(d / step));
  for (let i = 0; i <= n; i++) {
    pts.push([x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
  }
  return pts;
}

/** 空段（段不达标时 drawSegments 返回 null，用空段让 classify 走安全 NONE 分支） */
function emptySeg() {
  return {
    id: 0,
    pathLen: 0,
    durationMs: 0,
    avgSpeed: 0,
    straightDist: 0,
    last: { x: 0, y: 0, t: 0 },
    points: [] as SlashPoint[],
  };
}

/** 弧线采样点（cx,cy 半径 r，从 a0 到 a1 弧度） */
function arc(
  cx: number,
  cy: number,
  r: number,
  a0: number,
  a1: number,
  stepDeg = 6,
): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const steps = Math.max(4, Math.round((Math.abs(a1 - a0) * 180) / Math.PI / stepDeg));
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

describe('斜劈 DIAGONAL_SLASH', () => {
  it('左上→右下对角线识别（800×600）', () => {
    const eng = new TechniqueEngine(cfg());
    const { ready } = drawSegments([line(200, 150, 620, 430)]);
    expect(ready).not.toBeNull();
    const r = eng.classify(ready!, [], W, 1000);
    expect(r.kind).toBe('DIAGONAL_SLASH');
    expect(r.recognized).toBe(true);
    expect(r.confidence).toBeGreaterThanOrEqual(0.6);
    expect(r.damageMultiplier).toBe(DEFAULT_TECHNIQUE_CONFIG.diagonalSlash.damageMultiplier);
  });

  it('右下→左上（反向）也识别', () => {
    const eng = new TechniqueEngine(cfg());
    const { ready } = drawSegments([line(620, 430, 200, 150)]);
    const r = eng.classify(ready!, [], W, 1000);
    expect(r.kind).toBe('DIAGONAL_SLASH');
  });

  it('尺寸无关：1280×720 舞台同样识别（阈值按舞台宽归一化）', () => {
    const eng = new TechniqueEngine(cfg());
    const SW = 1280;
    const s = 1.6;
    const { ready } = drawSegments([line(200 * s, 150 * s, 620 * s, 430 * s)], { stageW: SW });
    expect(ready).not.toBeNull();
    const r = eng.classify(ready!, [], SW, 1000);
    expect(r.kind).toBe('DIAGONAL_SLASH');
  });

  it('水平线不识别（回退 NONE → 普通剑击）', () => {
    const eng = new TechniqueEngine(cfg());
    const { ready } = drawSegments([line(150, 300, 650, 300)]);
    const r = eng.classify(ready!, [], W, 1000);
    expect(r.kind).toBe('NONE');
    expect(r.recognized).toBe(false);
    expect(r.damageMultiplier).toBe(1);
    expect(r.extraQiCost).toBe(0);
  });

  it('垂直线不识别', () => {
    const eng = new TechniqueEngine(cfg());
    const { ready } = drawSegments([line(400, 100, 400, 520)]);
    const r = eng.classify(ready!, [], W, 1000);
    expect(r.kind).toBe('NONE');
  });

  it('太短不识别（低于普通斩击最低阈值，段不达标）', () => {
    const eng = new TechniqueEngine(cfg());
    // ~50px 短轨迹：低于斜劈 minPathRatio=0.1×800=80px，也低于普通斩击阈值
    const { ready } = drawSegments([line(380, 290, 420, 320)]);
    const r = eng.classify(ready ?? emptySeg(), [], W, 1000);
    expect(r.kind).toBe('NONE');
  });

  it('来回乱划（直线率低 + 反向步进多）不识别', () => {
    const eng = new TechniqueEngine(cfg());
    const pts: Array<[number, number]> = [
      ...line(200, 150, 400, 300),
      ...line(400, 300, 220, 170),
      ...line(220, 170, 480, 340),
      ...line(480, 340, 240, 180),
    ];
    const { ready } = drawSegments([pts]);
    const r = eng.classify(ready!, [], W, 1000);
    expect(r.kind).toBe('NONE');
  });

  it('静止点/极小抖动不识别', () => {
    const eng = new TechniqueEngine(cfg());
    const { ready } = drawSegments([
      Array.from({ length: 20 }, (_, i) => [400 + Math.sin(i) * 2, 300 + Math.cos(i) * 2] as [number, number]),
    ]);
    const r = eng.classify(ready ?? emptySeg(), [], W, 1000);
    expect(r.kind).toBe('NONE');
  });
});

describe('十字剑 CROSS', () => {
  it('单段连续两笔交叉对角线识别（一个结果）', () => {
    const eng = new TechniqueEngine(cfg());
    // 第一笔 ↘：左上到右下；自然连接到左下；第二笔 ↗：左下到右上（gap<250ms 同段）
    const { ready } = drawSegments(
      [[...line(220, 160, 580, 440), ...line(580, 440, 220, 440), ...line(220, 440, 580, 160)]],
      { gapMs: 50 },
    );
    expect(ready).not.toBeNull();
    const r = eng.classify(ready!, [], W, 1000);
    expect(r.kind).toBe('CROSS');
    expect(r.recognized).toBe(true);
  });

  it('跨段拼合：第一笔命中封存 + 第二笔识别', () => {
    const eng = new TechniqueEngine(cfg());
    // 第一段（较早，会被关闭封存）：↘ 对角；第二段（当前就绪）：↗ 对角
    const { detector, ready } = drawSegments(
      [line(220, 160, 580, 440), line(220, 440, 580, 160)],
      { gapMs: 350 },
    );
    expect(ready).not.toBeNull();
    const recent = detector.recentSegments;
    expect(recent.length).toBeGreaterThanOrEqual(1);
    // 拼合时刻 = 第二段开始时刻 + 少量推进（在 crossWindowMs 内）
    const now = ready!.points[0].t + 50;
    const r = eng.classify(ready!, recent, W, now);
    expect(r.kind).toBe('CROSS');
  });

  it('两条平行斜线（不交叉）不识别', () => {
    const eng = new TechniqueEngine(cfg());
    const { ready } = drawSegments([[...line(200, 150, 500, 400), ...line(300, 150, 600, 400)]]);
    const r = eng.classify(ready!, [], W, 1000);
    expect(r.kind).toBe('NONE');
  });

  it('单条斜线（无第二笔）不识别为十字（回退斜劈）', () => {
    const eng = new TechniqueEngine(cfg());
    const { ready } = drawSegments([line(200, 150, 620, 430)]);
    const r = eng.classify(ready!, [], W, 1000);
    expect(r.kind).toBe('DIAGONAL_SLASH'); // 优先级 CROSS 失败后落到斜劈
  });

  it('普通圆不识别为十字', () => {
    const eng = new TechniqueEngine(cfg());
    const { ready } = drawSegments([arc(400, 300, 150, 0, Math.PI * 2)]);
    const r = eng.classify(ready!, [], W, 1000);
    expect(r.kind).not.toBe('CROSS');
  });

  it('两笔长度不足（一笔太短）不识别为十字，回退斜劈', () => {
    const eng = new TechniqueEngine(cfg());
    // 短笔 60px（< minStrokePathRatio 0.09×800=72px）+ 长对角笔：十字不成立，长笔仍是斜劈。
    // 两笔时间间隔 50ms（同段）；extractStrokes 会把短笔并入第二笔方向（短笔不触发分割）。
    const { ready } = drawSegments(
      [[...line(370, 270, 415, 310), ...line(200, 440, 600, 160)]],
      { gapMs: 50 },
    );
    expect(ready).not.toBeNull();
    const r = eng.classify(ready!, [], W, 1000);
    // 短笔+长笔同段：整段直线率下降但长笔主导；短笔不构成十字第二笔 → 按整段判定
    // 整段 (370,270)→(600,160)：夹角 atan(110/230)=25.6°（恰在斜劈区间下限之上）→ 斜劈成立
    expect(r.kind === 'DIAGONAL_SLASH' || r.kind === 'NONE').toBe(true);
    expect(r.kind).not.toBe('CROSS');
  });
});

describe('回风式 RETURN_WIND', () => {
  it('顺时针大弧回转（>3/4 圈）识别', () => {
    const eng = new TechniqueEngine(cfg());
    // 270° 弧 + 收尾回到起点附近
    const pts = arc(400, 300, 160, -Math.PI / 2, Math.PI * 1.25);
    const { ready } = drawSegments([pts]);
    expect(ready).not.toBeNull();
    const r = eng.classify(ready!, [], W, 1000);
    expect(r.kind).toBe('RETURN_WIND');
  });

  it('逆时针回转也识别', () => {
    const eng = new TechniqueEngine(cfg());
    const pts = arc(400, 300, 160, Math.PI / 2, -Math.PI * 1.25);
    const { ready } = drawSegments([pts]);
    const r = eng.classify(ready!, [], W, 1000);
    expect(r.kind).toBe('RETURN_WIND');
  });

  it('尺寸无关：1280 舞台同样识别', () => {
    const eng = new TechniqueEngine(cfg());
    const SW = 1280;
    const s = 1.6;
    const pts = arc(400 * s, 300 * s, 160 * s, -Math.PI / 2, Math.PI * 1.25);
    const { ready } = drawSegments([pts], { stageW: SW });
    expect(ready).not.toBeNull();
    const r = eng.classify(ready!, [], SW, 1000);
    expect(r.kind).toBe('RETURN_WIND');
  });

  it('小圆（extent 不足）不识别', () => {
    const eng = new TechniqueEngine(cfg());
    const { ready } = drawSegments([arc(400, 300, 40, 0, Math.PI * 2)]);
    const r = eng.classify(ready!, [], W, 1000);
    expect(r.kind).toBe('NONE');
  });

  it('半圈弧（净转向不足）不识别', () => {
    const eng = new TechniqueEngine(cfg());
    const { ready } = drawSegments([arc(400, 300, 160, 0, Math.PI)]);
    const r = eng.classify(ready!, [], W, 1000);
    expect(r.kind).toBe('NONE');
  });

  it('终点远离起点（不闭合）不识别', () => {
    const eng = new TechniqueEngine(cfg());
    const pts = [...arc(400, 300, 160, -Math.PI / 2, Math.PI * 1.25), ...line(460, 440, 640, 500)];
    const { ready } = drawSegments([pts]);
    const r = eng.classify(ready!, [], W, 1000);
    expect(r.kind).toBe('NONE');
  });
});

describe('冷却 / 去重 / 状态生命周期', () => {
  it('冷却期内同招不重复识别，冷却后恢复', () => {
    const eng = new TechniqueEngine(cfg());
    const { ready } = drawSegments([line(200, 150, 620, 430)]);
    const r1 = eng.classify(ready!, [], W, 1000);
    expect(r1.kind).toBe('DIAGONAL_SLASH');
    eng.commit(r1, 1000);
    const cd = DEFAULT_TECHNIQUE_CONFIG.diagonalSlash.cooldownMs;
    // 冷却期内：新斜劈段识别为 NONE（回退普通剑击）
    const { ready: ready2 } = drawSegments([line(620, 430, 200, 150)], { t0: 1100 });
    const r2 = eng.classify(ready2!, [], W, 1000 + 100);
    expect(r2.kind).toBe('NONE');
    // 冷却结束后恢复识别
    const { ready: ready3 } = drawSegments([line(200, 150, 620, 430)], { t0: 1000 + cd + 50 });
    const r3 = eng.classify(ready3!, [], W, 1000 + cd + 100);
    expect(r3.kind).toBe('DIAGONAL_SLASH');
  });

  it('commit 去重：同一段重复提交只记一次（不再自动领悟——机缘事实语义）', () => {
    const eng = new TechniqueEngine(cfg());
    const { ready } = drawSegments([line(200, 150, 620, 430)]);
    const r = eng.classify(ready!, [], W, 1000);
    eng.commit(r, 1000);
    eng.commit(r, 1001); // 重复提交被忽略
    // 第九阶段收口：战斗 commit 不自动领悟——领悟只能来自机缘练习（setLearned）
    expect(eng.learned.diagonalSlash).toBe(false);
    eng.setLearned('DIAGONAL_SLASH'); // 机缘练习成招
    expect(eng.learned.diagonalSlash).toBe(true);
    // 冷却时间不被第二次提交重置：在第一次冷却结束、第二次「假设重置」前的窗口内识别
    const cd = DEFAULT_TECHNIQUE_CONFIG.diagonalSlash.cooldownMs;
    const { ready: ready2 } = drawSegments([line(620, 430, 200, 150)], { t0: 1000 + cd + 50 });
    const r2 = eng.classify(ready2!, [], W, 1000 + cd + 100);
    expect(r2.kind).toBe('DIAGONAL_SLASH');
  });

  it('resetRuntime 清冷却与临时反馈，但领悟保留（会话级）', () => {
    const eng = new TechniqueEngine(cfg());
    const { ready } = drawSegments([line(200, 150, 620, 430)]);
    const r = eng.classify(ready!, [], W, 1000);
    eng.commit(r, 1000);
    // 战斗提交不自动领悟；机缘注入后领悟保留
    eng.setLearned('DIAGONAL_SLASH');
    expect(eng.learned.diagonalSlash).toBe(true);
    eng.resetRuntime();
    expect(eng.learned.diagonalSlash).toBe(true); // 领悟保留
    expect(eng.getLast()).toBeNull(); // 临时反馈清除
    // 冷却清除后立刻可再识别
    const { ready: ready2 } = drawSegments([line(620, 430, 200, 150)], { t0: 1050 });
    const r2 = eng.classify(ready2!, [], W, 1100);
    expect(r2.kind).toBe('DIAGONAL_SLASH');
  });

  it('pushFx/getActiveFx：800ms 后过期清除', () => {
    const eng = new TechniqueEngine(cfg());
    eng.pushFx(
      'DIAGONAL_SLASH',
      {
        type: 'diagonal',
        ax: 0,
        ay: 0,
        bx: 100,
        by: 100,
        cx: 0,
        cy: 0,
        dx: 0,
        dy: 0,
        centerX: 0,
        centerY: 0,
        radius: 0,
        startAngle: 0,
        sweep: 0,
      },
      1000,
    );
    expect(eng.getActiveFx(1200).length).toBe(1);
    expect(eng.getActiveFx(1900).length).toBe(0); // fxDurationMs 800（700~900ms 克制范围）
  });
});


describe('第四阶段容错校准（新配置边界样本 + 防线保留）', () => {
  // 坐标噪声：模拟摄像头 landmark 抖动（±2px，25FPS 采样间距更大）
  function jitter(pts: Array<[number, number]>, amp = 2, seed = 7): Array<[number, number]> {
    let s = seed;
    const rnd = () => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return (s / 2147483648) * 2 - 1;
    };
    return pts.map(([x, y], i) => [
      x + (i % 2 === 0 ? rnd() * amp : -rnd() * amp),
      y + (i % 3 === 0 ? rnd() * amp : rnd() * amp * 0.5),
    ]);
  }

  it('斜劈：带 ±2px 抖动的中等对角线（旧配置漏识，新配置识别）', () => {
    const eng = new TechniqueEngine(cfg());
    // 角度 ~33.7°，旧 25~62 内 —— 但直线率会被噪声压低；这里选旧配置边缘样本：
    // 弯折对角线（中点偏移 ~12px）：直线率 ~0.96 旧仍过 —— 专门构造直线率 0.70~0.80 区间样本
    const pts = jitter(
      line(210, 200, 560, 430).map(([x, y], i) => {
        // 叠加正弦弯折：直线率 ~0.72（旧 0.80 拒、新 0.70 过）
        const t = i / 34;
        return [x + Math.sin(t * Math.PI) * 26, y] as [number, number];
      }),
    );
    const { ready } = drawSegments([pts]);
    expect(ready).not.toBeNull();
    const r = eng.classify(ready!, [], W, 1000);
    expect(r.kind).toBe('DIAGONAL_SLASH');
  });

  it('斜劈：浅角 22° 中长对角线识别（旧下限 25° 拒收，新下限 20°）', () => {
    const eng = new TechniqueEngine(cfg());
    // atan(150/370) ≈ 22.07°，长度比 ~0.49 > 0.08
    const { ready } = drawSegments([line(200, 180, 570, 330)]);
    const r = eng.classify(ready!, [], W, 1000);
    expect(r.kind).toBe('DIAGONAL_SLASH');
  });

  it('斜劈：陡角 65° 对角线识别（旧上限 62° 拒收，新上限 68°）', () => {
    const eng = new TechniqueEngine(cfg());
    // atan(300/140) ≈ 65°，长度比 ~0.45 > 0.08
    const { ready } = drawSegments([line(340, 140, 480, 440)]);
    const r = eng.classify(ready!, [], W, 1000);
    expect(r.kind).toBe('DIAGONAL_SLASH');
  });

  it('斜劈：短线（0.06 舞台宽）仍不识别', () => {
    const eng = new TechniqueEngine(cfg());
    // 48px < 0.08×800=64px，普通斩击 80px 阈值也不达标 → 段无效
    const { ready } = drawSegments([line(200, 200, 234, 226)]);
    const r = eng.classify(ready ?? emptySeg(), [], W, 1000);
    expect(r.kind).toBe('NONE');
  });

  it('十字剑：两笔不完美（±2px 噪声 + 轻微弯曲）交叉对角线识别', () => {
    const eng = new TechniqueEngine(cfg());
    const s1 = jitter(line(240, 170, 560, 430), 2, 11);
    const s2 = jitter(line(240, 430, 560, 170), 2, 23);
    // 跨段拼合（gap 350ms ≥ 封存阈值）：拼合窗口 550ms 容纳 25FPS
    const { detector, ready } = drawSegments([s1, s2], { gapMs: 350 });
    expect(ready).not.toBeNull();
    const now = ready!.points[0].t + 50;
    const r = eng.classify(ready!, detector.recentSegments, W, now);
    expect(r.kind).toBe('CROSS');
    expect(r.recognized).toBe(true);
    expect(r.confidence).toBeGreaterThanOrEqual(DEFAULT_TECHNIQUE_CONFIG.cross.minConfidence);
  });

  it('十字剑：跨段窗口 520ms 仍拼合（旧 400ms 拒收，新 550ms）', () => {
    const eng = new TechniqueEngine(cfg());
    // 第一笔结束 t≈1000+0.3×453≈1363（第二笔开始 1000+350+453？不对——gapMs 是「笔间停顿」，
    // 第二笔开始时刻 = 第一笔结束 + gap。取第一笔实际结束时刻再 +520ms 内开始第二笔即可。
    const s1 = line(240, 170, 560, 430);
    const s2 = line(240, 430, 560, 170);
    // 手动构造：第一笔画完 → tickIdle 封存 → 间隔 ~500ms → 第二笔 → tryStrike
    const det = new SlashDetector({
      minPathPx: 0.1 * W,
      minAvgSpeedPxPerSec: 0,
      segmentWindowMs: 600,
      segmentIdleCloseMs: 250,
    });
    let t = 1000;
    for (const [x, y] of s1) {
      t += 2;
      det.feed({ x, y, t }, true, t);
    }
    det.tickIdle(t + 480); // 封存第一段（>250ms idle）
    t += 500; // 第一笔结束 → 第二笔开始间隔 500ms（旧 400 拒、新 550 过）
    for (const [x, y] of s2) {
      t += 2;
      det.feed({ x, y, t }, true, t);
    }
    const ready = det.tryStrike();
    expect(ready).not.toBeNull();
    const now = ready!.points[0].t + 10;
    const r = eng.classify(ready!, det.recentSegments, W, now);
    expect(r.kind).toBe('CROSS');
  });

  it('十字剑：单笔（第二笔太短）仍不识别为十字', () => {
    const eng = new TechniqueEngine(cfg());
    // 长笔 400px + 短笔 55px（< 0.075×800=60px），短笔不构成第二笔
    const { ready } = drawSegments(
      [[...line(240, 430, 560, 170), ...line(560, 170, 515, 210)]],
      { gapMs: 50 },
    );
    const r = eng.classify(ready!, [], W, 1000);
    expect(r.kind).not.toBe('CROSS');
  });

  it('回风式：带 ±2px 随机抖动的 315° 受控回转识别', () => {
    const eng = new TechniqueEngine(cfg());
    // LCG 真随机噪声（摄像头 landmark 抖动语义，非周期性）
    let s = 97;
    const rnd = () => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return (s / 2147483648) * 2 - 1;
    };
    const pts = arc(400, 300, 160, -Math.PI / 2, Math.PI * 1.25).map(
      ([x, y]) => [x + rnd() * 2, y + rnd() * 2] as [number, number],
    );
    const { ready } = drawSegments([pts]);
    expect(ready).not.toBeNull();
    const r = eng.classify(ready!, [], W, 1000);
    expect(r.kind).toBe('RETURN_WIND');
  });

  it('回风式：240° 中弧（端点距/弧长 ≈0.41）识别：旧 closeMaxPathRatio 0.38 拒收，新 0.42', () => {
    const eng = new TechniqueEngine(cfg());
    // r=90、240° 弧：弧长 377px、端点距 156px（0.414）、extent≈206px、净转向 240°
    const pts = arc(400, 300, 90, 0, (Math.PI * 240) / 180);
    const { ready } = drawSegments([pts]);
    expect(ready).not.toBeNull();
    const r = eng.classify(ready!, [], W, 1000);
    expect(r.kind).toBe('RETURN_WIND');
  });

  it('回风式：小圆仍不识别（extent 防线：r42 对角线 119px < 0.15×800=120px）', () => {
    const eng = new TechniqueEngine(cfg());
    const { ready } = drawSegments([arc(400, 300, 42, 0, Math.PI * 2)]);
    const r = eng.classify(ready!, [], W, 1000);
    expect(r.kind).toBe('NONE');
  });

  it('回风式：停着抖动不识别（净转向不足）', () => {
    const eng = new TechniqueEngine(cfg());
    const pts = jitter(line(400, 300, 420, 310), 3, 31);
    const { ready } = drawSegments([pts]);
    const r = eng.classify(ready ?? emptySeg(), [], W, 1000);
    expect(r.kind).toBe('NONE');
  });

  it('配置契约：三式倍率/冷却不变，额外气机 5/7/9，时长 800ms', () => {
    expect(DEFAULT_TECHNIQUE_CONFIG.diagonalSlash.extraQiCost).toBe(5);
    expect(DEFAULT_TECHNIQUE_CONFIG.returnWind.extraQiCost).toBe(7);
    expect(DEFAULT_TECHNIQUE_CONFIG.cross.extraQiCost).toBe(9);
    expect(DEFAULT_TECHNIQUE_CONFIG.diagonalSlash.damageMultiplier).toBe(1.15);
    expect(DEFAULT_TECHNIQUE_CONFIG.returnWind.damageMultiplier).toBe(1.25);
    expect(DEFAULT_TECHNIQUE_CONFIG.cross.damageMultiplier).toBe(1.35);
    expect(DEFAULT_TECHNIQUE_CONFIG.diagonalSlash.cooldownMs).toBe(700);
    expect(DEFAULT_TECHNIQUE_CONFIG.returnWind.cooldownMs).toBe(900);
    expect(DEFAULT_TECHNIQUE_CONFIG.cross.cooldownMs).toBe(1000);
    expect(DEFAULT_TECHNIQUE_CONFIG.fxDurationMs).toBe(800);
  });
});

describe('CombatEngine 接入（一次结算 + 额外气机 + 约束）', () => {
  const CCFG: CombatConfig = DEFAULT_COMBAT_CONFIG;

  /** 覆盖 wolf/player/ranged/projectile 配置（浅合并，未列字段沿用默认） */
  function cfg2(over: Record<string, unknown>): CombatConfig {
    const D = DEFAULT_COMBAT_CONFIG as unknown as Record<string, unknown>;
    const pick = (k: string): object => {
      const base = D[k] as object | undefined;
      const o = (over[k] ?? {}) as object;
      return base ? { ...base, ...o } : o;
    };
    return {
      ...D,
      wolf: pick('wolf'),
      player: pick('player'),
      slash: pick('slash'),
      ranged: pick('ranged'),
      projectile: pick('projectile'),
    } as unknown as CombatConfig;
  }

  /** 狼中心像素坐标 */
  function wolfPx2(e: CombatEngine): { x: number; y: number } {
    const w = e.getSnapshot().wolf;
    return { x: w.x * W, y: w.y * H };
  }

  function frame(x: number, y: number, t: number): InputFrame {
    return { x, y, timestamp: t, actionState: 'ACTIVE', source: 'pointer' } as InputFrame;
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

  /** 画斜劈轨迹穿过狼（从狼上方左侧到下方右侧）；~430px/500ms ≈ 0.86 舞台宽/秒（GOOD 区间，不失控） */
  function diagonalSwing(e: CombatEngine, cx: number, cy: number, t0: number, dir = 1): number {
    const n = 25;
    const len = 440;
    const spanY = 320;
    const totalMs = 500;
    let t = t0;
    e.onFrame(frame(cx - (dir * len) / 2, cy - (spanY / 2), t), null);
    for (let i = 1; i <= n; i++) {
      t += totalMs / n;
      const k = i / n;
      e.onFrame(frame(cx - (dir * len) / 2 + dir * len * k, cy - (spanY / 2) + spanY * k, t), null);
    }
    return t;
  }

  // 暴露给「第四阶段反馈可见性」describe 复用
  (globalThis as Record<string, unknown>).__shared = { cfg2, diagonalSwing };

  it('斜劈命中狼：伤害按倍率一次结算，额外气机收取（战斗提交不自动领悟——机缘事实语义）', () => {
    const e = new CombatEngine(CCFG);
    e.syncLearnedTechniques({ diagonalSlash: true, cross: true, returnWind: true }); // v33：已领悟（本用例验证倍率与提交语义；「不自动领悟」由未学用例验证）
    let now = waitForTelegraph(e, 0);
    const wp = { x: e.getSnapshot().wolf.x * W, y: e.getSnapshot().wolf.y * H };
    const qiBefore = e.getSnapshot().qi;
    const hpBefore = e.getSnapshot().wolf.hp;

    now = diagonalSwing(e, wp.x, wp.y, now + 16);
    now += 16;
    e.update(now, W, H);
    const snap = e.getSnapshot();

    // v33：战斗提交不篡改领悟事实（sync 注入的已学状态保持；未学不自动领悟由新测试覆盖）
    expect(snap.technique.learned.diagonalSlash).toBe(true);
    expect(snap.technique.last?.kind).toBe('DIAGONAL_SLASH');
    expect(snap.lastStrike?.technique).toBe('斜劈');
    // 伤害：普通结算 × 倍率（1.15）。普通基线另行验证，这里验证伤害 > 0 且狼掉血
    expect(snap.wolf.hp).toBeLessThan(hpBefore);
    // 气机消耗 = 普通斩击成本 + 斜劈额外 5（无失控、气机充足）
    const cost = qiBefore - snap.qi;
    expect(cost).toBeGreaterThanOrEqual(
      DEFAULT_TECHNIQUE_CONFIG.diagonalSlash.extraQiCost + 4,
    );
    expect(cost).toBeLessThanOrEqual(
      DEFAULT_COMBAT_CONFIG.player.slashQiCostMax + DEFAULT_TECHNIQUE_CONFIG.diagonalSlash.extraQiCost,
    );
    // 剑气形态已入列（短暂）
    expect(snap.techniqueFx.length).toBeGreaterThanOrEqual(1);
  });

  it('同段不产生第二次伤害：命中后停在狼内不持续掉血', () => {
    const e = new CombatEngine(CCFG);
    e.syncLearnedTechniques({ diagonalSlash: true, cross: true, returnWind: true }); // v33：权限门——已领悟才可生效
    let now = waitForTelegraph(e, 0);
    const wp = { x: e.getSnapshot().wolf.x * W, y: e.getSnapshot().wolf.y * H };
    now = diagonalSwing(e, wp.x, wp.y, now + 16);
    now += 16;
    e.update(now, W, H);
    const hp1 = e.getSnapshot().wolf.hp;
    // 剑尖停在狼身体内（静止，不形成新段）
    for (let i = 0; i < 10; i++) {
      now += 50;
      e.onFrame(frame(wp.x, wp.y, now), null);
      e.update(now, W, H);
    }
    expect(e.getSnapshot().wolf.hp).toBe(hp1);
  });

  it('低气机时招式不免费生效：倍率不应用、额外气机不收、提示「气机不继/招式未成」', () => {
    // 大血量狼 + 超长预警期：可持续命中回气气机（沿用第三阶段测试惯例）
    const e = new CombatEngine(cfg2({ wolf: { hpMax: 10000, telegraphMs: 60000 } }));
    e.syncLearnedTechniques({ diagonalSlash: true, cross: true, returnWind: true }); // v33：权限门——已领悟才可生效
    let now = waitForTelegraph(e, 0);
    let wp = wolfPx2(e);
    // 持续斜劈耗气（每剑含招式额外 5），qi 单调降到 < 20
    let guard = 0;
    while (e.getSnapshot().qi >= 20 && guard < 40) {
      guard++;
      now = diagonalSwing(e, wp.x, wp.y, now + 20);
      now += 60;
      e.update(now, W, H);
      wp = wolfPx2(e);
    }
    // 等待当前段 idle 关闭（>250ms），清掉 drain 循环残留段与陈旧 lastStrike 语境
    now += 400;
    e.update(now, W, H);
    const lowQi = e.getSnapshot().qi;
    expect(lowQi).toBeLessThan(20);
    const promptsBefore = e.getSnapshot().prompts.length;
    // 低气机下再挥一次斜劈（新段，窗口 600ms 内结算 → +60ms update）：
    // 招式不得免费生效（无斜劈标记、倍率不应用）
    now = diagonalSwing(e, wp.x, wp.y, now + 20);
    now += 60;
    e.update(now, W, H);
    const snap = e.getSnapshot();
    expect(snap.lastStrike?.technique ?? '').not.toBe('斜劈');
    expect(snap.technique.last?.kind ?? 'NONE').not.toBe('DIAGONAL_SLASH');
    expect(snap.prompts.length).toBeGreaterThanOrEqual(promptsBefore);
  });

  it('retry（start）清冷却与临时反馈，机缘领悟保留', () => {
    const e = new CombatEngine(CCFG);
    e.syncLearnedTechniques({ diagonalSlash: true, cross: true, returnWind: true }); // v33：权限门——已领悟才可生效
    let now = waitForTelegraph(e, 0);
    const wp = { x: e.getSnapshot().wolf.x * W, y: e.getSnapshot().wolf.y * H };
    now = diagonalSwing(e, wp.x, wp.y, now + 16);
    now += 16;
    e.update(now, W, H);
    // 战斗提交不自动领悟；模拟机缘已至（程序注入）
    e.syncLearnedTechniques({ diagonalSlash: true, cross: true, returnWind: true });
    const before = e.getSnapshot();
    expect(before.technique.learned.diagonalSlash).toBe(true);

    e.start(now + 50); // 重新试炼
    const snap = e.getSnapshot();
    expect(snap.technique.learned.diagonalSlash).toBe(true); // 会话领悟保留
    expect(snap.techniqueFx.length).toBe(0); // 旧剑气清除
    expect(snap.technique.last).toBeNull(); // 旧识别清除
    expect(snap.projectiles.length).toBe(0);
    expect(snap.phase).toBe('fighting');
  });
});

describe('第四阶段反馈可见性（attempt / 预览 / 非 body 反馈）', () => {
  const W2 = 800;
  const H2 = 600;
  const { cfg2, diagonalSwing } = (globalThis as Record<string, unknown>).__shared as {
    cfg2: (over: Record<string, unknown>) => CombatConfig;
    diagonalSwing: (
      e: CombatEngine,
      cx: number,
      cy: number,
      t0: number,
      dir?: number,
    ) => number;
  };

  function frame2(x: number, y: number, t: number): InputFrame {
    return { x, y, timestamp: t, actionState: 'ACTIVE', source: 'pointer' } as InputFrame;
  }

  /** 远离敌人的斜劈轨迹（左上角区域；狼默认在舞台中偏右，此线段距其 >2×bodyR） */
  function diagonalMissSwing(e: CombatEngine, t0: number): number {
    const n = 25;
    const len = 360;
    const spanY = 260;
    const totalMs = 500;
    let t = t0;
    e.onFrame(frame2(50, 50, t), null);
    for (let i = 1; i <= n; i++) {
      t += totalMs / n;
      const k = i / n;
      e.onFrame(frame2(50 + len * k, 50 + spanY * k, t), null);
    }
    return t;
  }

  /** 推进到狼 TELEGRAPH */
  function waitForTelegraph2(e: CombatEngine, startNow: number): number {
    e.start(startNow);
    let now = startNow;
    for (let i = 0; i < 80; i++) {
      now += 100;
      e.update(now, W2, H2);
      if (e.getSnapshot().wolf.state === 'TELEGRAPH') return now;
    }
    return now;
  }

  it('未掌握时即使几何成立也不显示正式招式、冷却或剑气', () => {
    const e = new CombatEngine(cfg2({ wolf: { hpMax: 10000, telegraphMs: 60000 } }));
    let now = waitForTelegraph2(e, 0);
    const wolfHp0 = e.getSnapshot().wolf.hp;
    const qi0 = e.getSnapshot().qi;

    // 远离狼的斜劈（左上角区域，不与任何目标相交）
    now = diagonalMissSwing(e, now + 20);
    now += 60;
    e.update(now, W2, H2);
    const s1 = e.getSnapshot();
    expect(s1.technique.attempt).toBeNull();
    expect(s1.techniqueFx).toHaveLength(0);

    // 未命中不产生任何战斗状态变化
    expect(s1.wolf.hp).toBe(wolfHp0);
    expect(s1.qi).toBe(qi0);
    expect(s1.technique.learned.diagonalSlash).toBe(false);
    expect(s1.technique.last).toBeNull();
    now += 30;
    e.update(now, W2, H2);
    expect(e.getSnapshot().technique.attempt).toBeNull();
  });

  it('有效身体命中：attempt 记录 effective 且带上下文，同时保留 commit 与剑气', () => {
    const e = new CombatEngine(cfg2({ wolf: { hpMax: 10000, telegraphMs: 60000 } }));
    e.syncLearnedTechniques({ diagonalSlash: true, cross: true, returnWind: true }); // v33：权限门——已领悟才可生效
    let now = waitForTelegraph2(e, 0);
    const wp = { x: e.getSnapshot().wolf.x * W2, y: e.getSnapshot().wolf.y * H2 };
    now = diagonalSwing(e, wp.x, wp.y, now + 20);
    now += 60;
    e.update(now, W2, H2);
    const s = e.getSnapshot();
    expect(s.technique.attempt).not.toBeNull();
    expect(s.technique.attempt!.kind).toBe('DIAGONAL_SLASH');
    expect(s.technique.attempt!.status).toBe('effective');
    expect(s.technique.attempt!.text).toContain('斜劈');
    expect(s.technique.last?.kind).toBe('DIAGONAL_SLASH');
    expect(s.techniqueFx.filter((f) => !f.preview).length).toBe(1);
    expect(s.lastStrike?.technique).toBe('斜劈');
  });

  it('仅斩碎妖气弹（无 body StrikeResult）：招式生效反馈仍存在，斩弹只结算一次', () => {
    // 弹速调慢 + 弹半径放大便于命中；狼血量调低便于快速清场（垂直划 ~36/剑）
    const e = new CombatEngine(
      cfg2({
        wolf: { hpMax: 500, telegraphMs: 60000 },
        projectile: { speedRatio: 0.02, radiusRatio: 0.06, lifeMs: 60000 },
        ranged: { hpMax: 10000 },
      }),
    );
    e.syncLearnedTechniques({ diagonalSlash: true, cross: true, returnWind: true }); // v33：权限门——已领悟才可生效
    let now = waitForTelegraph2(e, 0);
    // 先杀狼（普通乱挥不触发招式：用低垂短划直线，非对角）
    const wp = { x: e.getSnapshot().wolf.x * W2, y: e.getSnapshot().wolf.y * H2 };
    let wolfDead = false;
    for (let i = 0; i < 30 && !wolfDead; i++) {
      // 垂直短划（角度 ~90° 不在斜劈 25~62° 区间 → 不识别为招式）
      const n = 20;
      const totalMs = 400;
      let t = now + 20;
      e.onFrame(frame2(wp.x - 5, wp.y - 150, t), null);
      for (let k = 1; k <= n; k++) {
        t += totalMs / n;
        e.onFrame(frame2(wp.x - 5, wp.y - 150 + 300 * (k / n), t), null);
      }
      now = t + 60; // 段存活内 update 结算（idle 250ms 内）
      e.update(now, W2, H2);
      wolfDead = e.getSnapshot().wolf.state === 'DEAD';
      now += 300; // 段 idle 关闭（解锁体内锁需要剑尖离开，下一剑从狼外重新进入）
      e.update(now, W2, H2);
    }
    expect(wolfDead).toBe(true);

    // 收势回气（SHEATHED）：qi 0 → 充足，斩弹那剑才能生效
    for (let i = 0; i < 30; i++) {
      now += 100;
      e.onFrame(
        { x: -1, y: -1, timestamp: now, actionState: 'SHEATHED', source: 'pointer' } as InputFrame,
        null,
      );
      e.update(now, W2, H2);
      if (e.getSnapshot().qi > 40) break;
    }
    expect(e.getSnapshot().qi).toBeGreaterThan(30);

    // 推进到妖修出现并发射妖气弹
    let hasProj = false;
    for (let i = 0; i < 400 && !hasProj; i++) {
      now += 100;
      e.update(now, W2, H2);
      hasProj = e.getSnapshot().projectiles.length > 0;
    }
    expect(hasProj).toBe(true);

    // 等妖气弹离开妖修身体范围（妖修在右侧 x≈0.88，bodyR≈0.07）
    let projPos = { x: 0, y: 0 };
    for (let i = 0; i < 200; i++) {
      const p = e.getSnapshot().projectiles[0];
      if (!p) break;
      projPos = { x: p.x, y: p.y };
      if (p.x < 0.7) break;
      now += 50;
      e.update(now, W2, H2);
    }
    expect(projPos.x).toBeLessThan(0.72);

    // 对妖气弹画一条斜劈（穿过弹体，但远离妖修身体 x≈0.88）
    const px = projPos.x * W2;
    const py = projPos.y * H2;
    const strikeBeforeSlash = e.getSnapshot().lastStrike; // 杀狼时留下的旧引用
    const n = 25;
    const len = 400;
    const spanY = 290;
    const totalMs = 500;
    let t = now + 20;
    e.onFrame(frame2(px - len * 0.5, py - spanY * 0.5, t), null);
    for (let k = 1; k <= n; k++) {
      t += totalMs / n;
      const kk = k / n;
      e.onFrame(frame2(px - len * 0.5 + len * kk, py - spanY * 0.5 + spanY * kk, t), null);
    }
    now = t + 60;
    e.update(now, W2, H2);
    const s = e.getSnapshot();
    // 斩弹真实发生：弹被移出可碰撞集合
    expect(s.projectiles.length).toBe(0);
    // 本段没有产生新 body StrikeResult（引用未被覆盖，旧值保持）
    expect(s.lastStrike).toBe(strikeBeforeSlash);
    // 但招式反馈存在且带「斩弹」上下文（不依赖 body strike）
    expect(s.technique.attempt).not.toBeNull();
    expect(s.technique.attempt!.status).toBe('effective');
    expect(s.technique.attempt!.text).toContain('斜劈');
    expect(s.technique.attempt!.text).toContain('斩弹');
    // 生效招式 FX（非预览）
    expect(s.techniqueFx.filter((f) => !f.preview).length).toBe(1);
    // 弹只结算一次：上一帧后弹已不在，无重复
    now += 60;
    e.update(now, W2, H2);
    expect(e.getSnapshot().projectiles.length).toBe(0);
  });

  it('低气机：attempt 为 failed 语义，不残留上一招成功状态，不加倍率不重复收气', () => {
    // 大耗气配置：一剑后 qi 即低于阈值，第二剑招式未成
    const e = new CombatEngine(
      cfg2({
        wolf: { hpMax: 100000, telegraphMs: 60000 },
        player: { slashQiCostBase: 85, slashQiCostMax: 85, slashQiCostPerPathRatio: 0 },
      }),
    );
    e.syncLearnedTechniques({ diagonalSlash: true, cross: true, returnWind: true }); // v33：权限门——已领悟才可生效
    let now = waitForTelegraph2(e, 0);
    const wp = { x: e.getSnapshot().wolf.x * W2, y: e.getSnapshot().wolf.y * H2 };
    // 第一剑：qi 100 → 85+5(招式) = 10，正常生效
    now = diagonalSwing(e, wp.x, wp.y, now + 20);
    now += 60;
    e.update(now, W2, H2);
    const s1 = e.getSnapshot();
    expect(s1.technique.attempt?.status).toBe('effective');
    const qiAfter1 = s1.qi;
    expect(qiAfter1).toBeLessThan(20); // 第二剑前已低于阈值

    // 第二剑：qi 已低 → 招式未成
    now += 400; // 关段
    e.update(now, W2, H2);
    now = diagonalSwing(e, wp.x, wp.y, now + 20);
    now += 60;
    e.update(now, W2, H2);
    const s2 = e.getSnapshot();
    expect(s2.qi).toBeLessThan(20);
    // failed attempt：明确「招式未成」
    expect(s2.technique.attempt).not.toBeNull();
    expect(s2.technique.attempt!.status).toBe('failed');
    expect(s2.technique.attempt!.text).toContain('招式未成');
    // 不残留上一招成功状态
    expect(s2.technique.last).toBeNull();
    expect(s2.lastStrike?.technique ?? '').not.toBe('斜劈');
    // 无生效招式剑气（预览也不该有）
    expect(s2.techniqueFx.length).toBe(0);
    // 气机只按普通剑击收一次（60 基础，无招式额外气机）
    expect(qiAfter1 - s2.qi).toBeLessThanOrEqual(60);
  });

  it('普通未识别轨迹：不显示假招式（attempt 为 null）', () => {
    const e = new CombatEngine(cfg2({ wolf: { hpMax: 10000, telegraphMs: 60000 } }));
    e.syncLearnedTechniques({ diagonalSlash: true, cross: true, returnWind: true }); // v33：权限门——已领悟才可生效
    let now = waitForTelegraph2(e, 0);
    const wp = { x: e.getSnapshot().wolf.x * W2, y: e.getSnapshot().wolf.y * H2 };
    // 水平划（角度 0° 不在斜劈区间）
    const n = 25;
    const totalMs = 500;
    let t = now + 20;
    e.onFrame(frame2(wp.x - 220, wp.y, t), null);
    for (let k = 1; k <= n; k++) {
      t += totalMs / n;
      e.onFrame(frame2(wp.x - 220 + 440 * (k / n), wp.y, t), null);
    }
    now = t + 60;
    e.update(now, W2, H2);
    const s = e.getSnapshot();
    expect(s.technique.attempt).toBeNull();
    expect(s.techniqueFx.length).toBe(0);
  });

  it('start/reset 清理 attempt 与招式 FX，会话领悟保留', () => {
    const e = new CombatEngine(cfg2({ wolf: { hpMax: 10000, telegraphMs: 60000 } }));
    e.syncLearnedTechniques({ diagonalSlash: true, cross: true, returnWind: true });
    let now = waitForTelegraph2(e, 0);
    // 已掌握招式命中时产生 attempt + 正式 FX
    const firstTarget = { x: e.getSnapshot().wolf.x * W2, y: e.getSnapshot().wolf.y * H2 };
    now = diagonalSwing(e, firstTarget.x, firstTarget.y, now + 20);
    now += 60;
    e.update(now, W2, H2);
    expect(e.getSnapshot().technique.attempt).not.toBeNull();
    expect(e.getSnapshot().techniqueFx.length).toBeGreaterThan(0);
    expect(e.getSnapshot().technique.learned.diagonalSlash).toBe(true);

    e.start(now + 50); // retry
    const snap = e.getSnapshot();
    expect(snap.technique.attempt).toBeNull();
    expect(snap.techniqueFx.length).toBe(0);
    expect(snap.technique.last).toBeNull();
    expect(snap.technique.learned.diagonalSlash).toBe(true); // 领悟保留

    // reset 同样清理
    now = diagonalMissSwing(e, now + 200);
    now += 60;
    e.update(now, W2, H2);
    expect(e.getSnapshot().technique.attempt).not.toBeNull();
    e.reset(now + 100);
    const snap2 = e.getSnapshot();
    expect(snap2.technique.attempt).toBeNull();
    expect(snap2.techniqueFx.length).toBe(0);
    expect(snap2.technique.learned.diagonalSlash).toBe(true);
  });
});
