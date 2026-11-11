import { describe, expect, it } from 'vitest';
import { ActionStateDebouncer } from '@/engine/actionStateDebouncer';

/** 从 IDLE 起步并让首状态稳定（IDLE→ACTIVE 也需防抖），返回稳定后的时间点 */
function stabActive(d: ActionStateDebouncer, t0 = 0, t1 = 160): number {
  d.update('ACTIVE', t0);
  d.update('ACTIVE', t1);
  return t1;
}

describe('握拳/张手状态防抖（150ms）', () => {
  it('候选状态未稳定 150ms 前不提交（保持原状态）', () => {
    const d = new ActionStateDebouncer(150);
    const t = stabActive(d);
    expect(d.update('SHEATHED', t + 100)).toBe('ACTIVE'); // 仅 100ms，未达阈值
    expect(d.update('SHEATHED', t + 149)).toBe('ACTIVE');
  });

  it('候选连续稳定达到 150ms 后提交切换', () => {
    const d = new ActionStateDebouncer(150);
    const t = stabActive(d);
    expect(d.state).toBe('ACTIVE');
    expect(d.update('SHEATHED', t + 160)).toBe('ACTIVE'); // 候选引入，未满 150ms
    expect(d.update('SHEATHED', t + 330)).toBe('SHEATHED'); // 稳定 170ms ≥ 150ms
  });

  it('防抖期内候选抖动（张↔握）则重新计时，不闪烁', () => {
    const d = new ActionStateDebouncer(150);
    const t = stabActive(d); // ACTIVE 稳定于 t
    expect(d.update('SHEATHED', t + 100)).toBe('ACTIVE');
    expect(d.update('ACTIVE', t + 120)).toBe('ACTIVE');
    expect(d.update('SHEATHED', t + 200)).toBe('ACTIVE'); // 距新候选仅 80ms
    expect(d.update('SHEATHED', t + 400)).toBe('SHEATHED'); // 稳定 200ms
  });

  it('丢失手（IDLE）立即生效，不参与防抖', () => {
    const d = new ActionStateDebouncer(150);
    stabActive(d);
    expect(d.update('IDLE', 161)).toBe('IDLE');
  });

  it('IDLE 后恢复张手需重新稳定 150ms 才 ACTIVE', () => {
    const d = new ActionStateDebouncer(150);
    stabActive(d);
    d.update('IDLE', 170);
    expect(d.update('ACTIVE', 250)).toBe('IDLE'); // 仅 80ms
    expect(d.update('ACTIVE', 450)).toBe('ACTIVE'); // 稳定 200ms
  });

  it('防抖范围可配置在 100~200ms 内', () => {
    const d100 = new ActionStateDebouncer(100);
    d100.update('ACTIVE', 0);
    d100.update('ACTIVE', 120); // 稳定 120ms ≥ 100ms → 提交
    expect(d100.state).toBe('ACTIVE');
    expect(d100.update('SHEATHED', 200)).toBe('ACTIVE'); // 候选仅 80ms < 100ms
    expect(d100.update('SHEATHED', 330)).toBe('SHEATHED'); // 稳定 130ms ≥ 100ms

    const d200 = new ActionStateDebouncer(200);
    d200.update('ACTIVE', 0);
    d200.update('ACTIVE', 220); // 稳定 220ms ≥ 200ms → 提交
    expect(d200.state).toBe('ACTIVE');
    expect(d200.update('SHEATHED', 400)).toBe('ACTIVE'); // 候选仅 180ms < 200ms
    expect(d200.update('SHEATHED', 610)).toBe('SHEATHED'); // 稳定 210ms ≥ 200ms
  });

  it('reset 回到 IDLE 初始态', () => {
    const d = new ActionStateDebouncer(150);
    stabActive(d);
    d.reset();
    expect(d.state).toBe('IDLE');
  });
});