import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DetectionLoop } from '@/engine/detectionLoop';

beforeEach(() => {
  vi.useFakeTimers();
  // fake timers 伪造 Date/setTimeout 但默认不伪造 performance：
  // 统一挂到伪造后的 Date.now，保证调度锚点与定时器在同一时钟域
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('DetectionLoop 生命周期', () => {
  it('按固定间隔调度 tick，stop 后不再 tick', async () => {
    const tick = vi.fn();
    const loop = new DetectionLoop(10, tick);
    loop.start();
    await vi.advanceTimersByTimeAsync(35);
    expect(tick.mock.calls.length).toBeGreaterThanOrEqual(3);
    loop.stop();
    const count = tick.mock.calls.length;
    await vi.advanceTimersByTimeAsync(100);
    expect(tick.mock.calls.length).toBe(count);
  });

  it('重复 start 不产生并行循环（tick 不翻倍）', async () => {
    const tick = vi.fn();
    const loop = new DetectionLoop(10, tick);
    loop.start();
    loop.start();
    loop.start();
    await vi.advanceTimersByTimeAsync(100);
    const count = tick.mock.calls.length;
    expect(count).toBeGreaterThanOrEqual(8);
    expect(count).toBeLessThanOrEqual(12); // 若并行会达到 ~30
    loop.stop();
  });

  it('stop 后重新 start 可恢复，且旧代际无法复活', async () => {
    const tick = vi.fn();
    const loop = new DetectionLoop(10, tick);
    loop.start();
    loop.stop();
    await vi.advanceTimersByTimeAsync(50);
    expect(tick).not.toHaveBeenCalled();
    loop.start();
    await vi.advanceTimersByTimeAsync(25);
    expect(tick.mock.calls.length).toBeGreaterThanOrEqual(2);
    loop.stop();
  });

  it('tick 抛异常不中断后续调度', async () => {
    let calls = 0;
    const loop = new DetectionLoop(5, () => {
      calls++;
      if (calls === 1) throw new Error('boom');
    });
    loop.start();
    await vi.advanceTimersByTimeAsync(20);
    expect(calls).toBeGreaterThanOrEqual(2);
    loop.stop();
  });
});

describe('检测调度：开始到开始约 40ms', () => {
  it('推理耗时（8ms）计入周期内，周期约 40ms 不漂移', async () => {
    const times: number[] = [];
    const loop = new DetectionLoop(40, () => {
      times.push(performance.now()); // 检测开始时刻
      vi.setSystemTime(Date.now() + 8); // 模拟单次推理耗时 8ms（时钟流逝）
    });
    loop.start();
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(10);
    }
    loop.stop();

    expect(times.length).toBeGreaterThanOrEqual(4); // 至少 4 次检测
    const periods = times.slice(1).map((t, i) => t - times[i]);
    // 旧实现（等40→推理→再等40）周期约 48ms；新实现应稳定在 40±2ms
    for (const p of periods) {
      expect(p).toBeGreaterThanOrEqual(38);
      expect(p).toBeLessThanOrEqual(42);
    }
  });

  it('推理耗时不稳定（6ms/12ms 交替）时仍按绝对锚点校准，周期不累积漂移', async () => {
    const times: number[] = [];
    let n = 0;
    const loop = new DetectionLoop(40, () => {
      times.push(performance.now());
      vi.setSystemTime(Date.now() + (n % 2 === 0 ? 6 : 12));
      n++;
    });
    loop.start();
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(10);
    }
    loop.stop();

    expect(times.length).toBeGreaterThanOrEqual(4);
    const periods = times.slice(1).map((t, i) => t - times[i]);
    for (const p of periods) {
      expect(p).toBeGreaterThanOrEqual(38);
      expect(p).toBeLessThanOrEqual(42);
    }
  });

  it('无推理耗时时周期同样为约 40ms（纯调度开销不放大周期）', async () => {
    const times: number[] = [];
    const loop = new DetectionLoop(40, () => {
      times.push(performance.now());
    });
    loop.start();
    for (let i = 0; i < 12; i++) {
      await vi.advanceTimersByTimeAsync(10);
    }
    loop.stop();
    expect(times.length).toBeGreaterThanOrEqual(3);
    const periods = times.slice(1).map((t, i) => t - times[i]);
    for (const p of periods) {
      expect(p).toBeGreaterThanOrEqual(38);
      expect(p).toBeLessThanOrEqual(42);
    }
  });
});