/**
 * 握拳/张手状态切换防抖（约 150ms，可配置 100~200ms）。
 * 候选状态需连续稳定达到 holdMs 才提交，避免 ACTIVE/SHEATHED 闪烁。
 * IDLE（丢失手）立即生效，不参与防抖。
 */
import type { ActionState } from '@/lib/types';

export const DEFAULT_DEBOUNCE_MS = 150;

export class ActionStateDebouncer {
  private committed: ActionState = 'IDLE';
  private candidate: ActionState = 'IDLE';
  private candidateSince = 0;

  constructor(private holdMs: number = DEFAULT_DEBOUNCE_MS) {}

  /** 输入原始候选状态与时间戳，返回当前提交状态 */
  update(rawState: ActionState, now: number): ActionState {
    if (rawState === 'IDLE') {
      this.committed = 'IDLE';
      this.candidate = 'IDLE';
      this.candidateSince = now;
      return this.committed;
    }
    if (rawState !== this.candidate) {
      this.candidate = rawState;
      this.candidateSince = now;
    }
    if (this.candidate !== this.committed && now - this.candidateSince >= this.holdMs) {
      this.committed = this.candidate;
    }
    return this.committed;
  }

  get state(): ActionState {
    return this.committed;
  }

  reset(): void {
    this.committed = 'IDLE';
    this.candidate = 'IDLE';
    this.candidateSince = 0;
  }
}