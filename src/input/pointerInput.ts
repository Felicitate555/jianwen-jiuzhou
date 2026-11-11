/**
 * Pointer 输入：鼠标/触控拖动控制剑尖。
 * 按下并移动 = ACTIVE，松开 = SHEATHED，未交互 = IDLE（引擎初始态）。
 * 与 CameraHandInput 走同一个 InputManager 与 SwordEngine。
 */
import type { InputFrame } from '@/lib/types';
import type { InputAdapter } from './inputManager';

export class PointerInput implements InputAdapter {
  readonly source = 'pointer' as const;

  private element: HTMLElement | null = null;
  private pressed = false;
  private pointerId: number | null = null;

  constructor(
    private onFrame: (frame: InputFrame) => void,
    /** 剑试场容器（延迟解析，供 InputManager 无参 start() 使用） */
    private getElement: () => HTMLElement | null,
  ) {}

  /** 绑定交互元素（剑痕画布所在容器）；幂等 */
  start(): void {
    if (this.element) return;
    const el = this.getElement();
    if (!el) return;
    this.element = el;
    this.element.addEventListener('pointerdown', this.handleDown);
    this.element.addEventListener('pointermove', this.handleMove);
    this.element.addEventListener('pointerup', this.handleUp);
    this.element.addEventListener('pointercancel', this.handleUp);
    this.element.addEventListener('lostpointercapture', this.handleUp);
  }

  stop(): void {
    const el = this.element;
    const wasPressed = this.pressed;
    this.releaseCapture();
    if (el) {
      el.removeEventListener('pointerdown', this.handleDown);
      el.removeEventListener('pointermove', this.handleMove);
      el.removeEventListener('pointerup', this.handleUp);
      el.removeEventListener('pointercancel', this.handleUp);
      el.removeEventListener('lostpointercapture', this.handleUp);
    }
    this.element = null;
    this.pressed = false;
    if (wasPressed) this.onFrame({ x: -1, y: -1, timestamp: performance.now(), actionState: 'IDLE', source: 'pointer' });
  }

  private toLocal(e: PointerEvent): { x: number; y: number } {
    const el = this.element;
    if (!el) return { x: e.clientX, y: e.clientY };
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private handleDown = (e: PointerEvent): void => {
    const el = this.element;
    if (!el || this.pressed || e.isPrimary === false || (e.button !== undefined && e.button !== 0)) return;
    const target = e.target as Element | null;
    if (target?.closest?.('button,a,input,textarea,select,summary,[role],[contenteditable="true"],[data-ui-interactive],[data-overlay]')) return;
    this.pressed = true;
    this.pointerId = e.pointerId;
    try { el.setPointerCapture?.(e.pointerId); } catch { /* cancelled before capture */ }
    const { x, y } = this.toLocal(e);
    this.onFrame({ x, y, timestamp: performance.now(), actionState: 'ACTIVE', source: 'pointer' });
  };

  private handleMove = (e: PointerEvent): void => {
    if (!this.pressed || e.pointerId !== this.pointerId) return;
    const { x, y } = this.toLocal(e);
    this.onFrame({ x, y, timestamp: performance.now(), actionState: 'ACTIVE', source: 'pointer' });
  };

  private handleUp = (e: PointerEvent): void => {
    if (!this.pressed || e.pointerId !== this.pointerId) return;
    this.pressed = false;
    this.releaseCapture();
    const { x, y } = this.toLocal(e);
    this.onFrame({
      x,
      y,
      timestamp: performance.now(),
      actionState: 'SHEATHED',
      source: 'pointer',
    });
  };

  private releaseCapture(): void {
    const id = this.pointerId;
    this.pointerId = null;
    if (id === null) return;
    try {
      if (this.element?.hasPointerCapture?.(id)) this.element.releasePointerCapture(id);
    } catch { /* browser already released capture */ }
  }
}
