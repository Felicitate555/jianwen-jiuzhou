import { describe, expect, it } from 'vitest';
import { isFistCandidate } from '@/engine/fistDetect';
import type { LandmarkLike } from '@/engine/mirror';

/** 生成 landmarks：手指张开时指尖远离掌心（tip 距掌 > pip 距掌），握拳时指尖靠近掌心 */
function makeHand(foldedFingers: number[]): LandmarkLike[] {
  const lms: LandmarkLike[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0 }));
  const palm = { x: 0.5, y: 0.5 };
  lms[9] = palm;
  const pairs: Array<[tip: number, pip: number]> = [
    [8, 6],
    [12, 10],
    [16, 14],
    [20, 18],
  ];
  pairs.forEach(([tip, pip], i) => {
    if (foldedFingers.includes(i)) {
      // 握拳：指尖靠近掌心，PIP 相对远离
      lms[tip] = { x: 0.5, y: 0.47 };
      lms[pip] = { x: 0.5, y: 0.35 };
    } else {
      // 张开：指尖远离掌心
      lms[tip] = { x: 0.5, y: 0.15 };
      lms[pip] = { x: 0.5, y: 0.32 };
    }
  });
  return lms;
}

describe('粗粒度握拳判断', () => {
  it('五指张开（0 根弯曲）不是握拳', () => {
    expect(isFistCandidate(makeHand([]))).toBe(false);
  });

  it('四指全部弯曲（食/中/无名/小指）是握拳', () => {
    expect(isFistCandidate(makeHand([0, 1, 2, 3]))).toBe(true);
  });

  it('恰好 3 根手指弯曲是握拳候选（阈值：至少 3 根）', () => {
    expect(isFistCandidate(makeHand([0, 1, 2]))).toBe(true);
  });

  it('仅 2 根手指弯曲不是握拳（避免误触收势）', () => {
    expect(isFistCandidate(makeHand([0, 1]))).toBe(false);
  });

  it('landmarks 不足 21 点时安全返回 false', () => {
    expect(isFistCandidate([{ x: 0, y: 0 }])).toBe(false);
    expect(isFistCandidate([])).toBe(false);
  });
});