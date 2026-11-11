/**
 * 粗粒度二值握拳判断（本轮唯一手势，非秘籍系统）。
 *
 * 忽略拇指。比较食指/中指/无名指/小指的指尖（8/12/16/20）与对应 PIP（6/10/14/18）
 * 相对掌心参考点 9 的距离：指尖更靠近掌心则认为该手指弯曲。
 * 至少 3 根手指弯曲即判为握拳候选。
 *
 * 仅用于 SHEATHED/ACTIVE 判定，不参与剑尖坐标与任何游戏规则。
 */
import type { LandmarkLike } from './mirror';

const FINGER_PAIRS: Array<[tip: number, pip: number]> = [
  [8, 6],
  [12, 10],
  [16, 14],
  [20, 18],
];

const PALM_REF = 9;

export function dist(a: LandmarkLike, b: LandmarkLike): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function isFistCandidate(landmarks: LandmarkLike[]): boolean {
  if (landmarks.length < 21) return false;
  const palm = landmarks[PALM_REF];
  let folded = 0;
  for (const [tip, pip] of FINGER_PAIRS) {
    const tipDist = dist(landmarks[tip], palm);
    const pipDist = dist(landmarks[pip], palm);
    if (tipDist < pipDist) folded++;
  }
  return folded >= 3;
}