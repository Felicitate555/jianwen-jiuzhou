/**
 * 统一输入管理器：CameraHandInput 与 PointerInput 的唯一编排出口。
 * 各适配器在构造时持有同一 onFrame 回调（输出统一 InputFrame），
 * SwordEngine 只消费统一输入帧；本管理器只负责启动/停止/切换编排。
 */
import type { InputSource } from '@/lib/types';

export interface InputAdapter {
  readonly source: InputSource;
  /** 启动输入源（摄像头为异步：权限 + MediaPipe 初始化） */
  start(): Promise<void> | void;
  /** 停止并释放全部资源；必须幂等 */
  stop(): void;
}

export class InputManager {
  private current: InputAdapter | null = null;

  get activeSource(): InputSource | null {
    return this.current?.source ?? null;
  }

  /** 切换输入源：先完整停止旧源（释放摄像头资源），再启动新源 */
  async switchTo(adapter: InputAdapter): Promise<void> {
    const prev = this.current;
    if (prev === adapter) return;
    this.current = adapter;
    if (prev) {
      await Promise.resolve(prev.stop());
    }
    if (this.current !== adapter) return;
    try {
      await adapter.start();
    } catch (err) {
      if (this.current === adapter) this.current = null;
      throw err;
    }
  }

  /** 停止全部输入（页面卸载时调用） */
  stopAll(): void {
    if (this.current) {
      this.current.stop();
      this.current = null;
    }
  }
}
