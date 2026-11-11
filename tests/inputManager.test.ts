import { describe, expect, it, vi } from 'vitest';
import { InputManager, type InputAdapter } from '@/input/inputManager';
import type { InputFrame } from '@/lib/types';

function makeAdapter(
  source: 'camera' | 'pointer',
  onEvent: (name: string) => void,
  failStart = false,
): InputAdapter {
  return {
    source,
    start: async () => {
      onEvent(`${source}:start`);
      if (failStart) throw new Error(`${source} 启动失败`);
    },
    stop: () => onEvent(`${source}:stop`),
  };
}

describe('InputManager 统一协议', () => {
  it('switchTo 启动输入源并登记来源；无输入时不产生帧', async () => {
    const manager = new InputManager();
    const a = makeAdapter('camera', () => undefined);
    await manager.switchTo(a);
    expect(manager.activeSource).toBe('camera');
  });

  it('switchTo 先完整停止旧输入源再启动新源', async () => {
    const events: string[] = [];
    const manager = new InputManager();
    const camera = makeAdapter('camera', (n) => events.push(n));
    const pointer = makeAdapter('pointer', (n) => events.push(n));
    await manager.switchTo(camera);
    await manager.switchTo(pointer);
    expect(events).toEqual(['camera:start', 'camera:stop', 'pointer:start']);
    expect(manager.activeSource).toBe('pointer');
  });

  it('新源启动失败时置空 current 且旧源已停止（不残留双输入）', async () => {
    const events: string[] = [];
    const manager = new InputManager();
    const ok = makeAdapter('camera', (n) => events.push(n));
    const bad = makeAdapter('pointer', (n) => events.push(n), true);
    await manager.switchTo(ok);
    await expect(manager.switchTo(bad)).rejects.toThrow('pointer 启动失败');
    expect(manager.activeSource).toBeNull();
    expect(events).toEqual(['camera:start', 'camera:stop', 'pointer:start']);
  });

  it('stopAll 幂等且重复切换同一适配器不重复 start', async () => {
    const events: string[] = [];
    const manager = new InputManager();
    const a = makeAdapter('camera', (n) => events.push(n));
    await manager.switchTo(a);
    await manager.switchTo(a);
    manager.stopAll();
    manager.stopAll();
    expect(events).toEqual(['camera:start', 'camera:stop']);
  });
});

describe('PointerInput 事件输出（统一 InputFrame 协议）', () => {
  it('按下移动为 ACTIVE，松开为 SHEATHED，坐标为元素本地坐标', async () => {
    const { PointerInput } = await import('@/input/pointerInput');
    const frames: InputFrame[] = [];
    const el = {
      listeners: {} as Record<string, (e: unknown) => void>,
      addEventListener(t: string, f: (e: unknown) => void) {
        this.listeners[t] = f;
      },
      removeEventListener(t: string) {
        delete this.listeners[t];
      },
      getBoundingClientRect: () => ({ left: 100, top: 50, width: 800, height: 600 }),
      setPointerCapture: vi.fn(),
    };
    const input = new PointerInput((f) => frames.push(f), () => el as unknown as HTMLElement);
    input.start();
    const mk = (x: number, y: number) => ({ clientX: x, clientY: y, pointerId: 1 });
    el.listeners['pointerdown'](mk(120, 70));
    el.listeners['pointermove'](mk(220, 170));
    el.listeners['pointerup'](mk(320, 270));
    expect(frames.map((f) => [f.x, f.y, f.actionState, f.source])).toEqual([
      [20, 20, 'ACTIVE', 'pointer'],
      [120, 120, 'ACTIVE', 'pointer'],
      [220, 220, 'SHEATHED', 'pointer'],
    ]);
    // 统一协议字段完整
    expect(frames[0]).toHaveProperty('timestamp');
    expect(typeof frames[0].timestamp).toBe('number');
    input.stop();
  });

  it('stop 后解绑事件，不再响应 pointerdown', async () => {
    const { PointerInput } = await import('@/input/pointerInput');
    const frames: InputFrame[] = [];
    const el = {
      listeners: {} as Record<string, (e: unknown) => void>,
      addEventListener(t: string, f: (e: unknown) => void) {
        this.listeners[t] = f;
      },
      removeEventListener(t: string) {
        delete this.listeners[t];
      },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      setPointerCapture: vi.fn(),
    };
    const input = new PointerInput((f) => frames.push(f), () => el as unknown as HTMLElement);
    input.start();
    input.stop();
    expect(el.listeners['pointerdown']).toBeUndefined();
    el.listeners['pointerdown']?.({ clientX: 1, clientY: 1, pointerId: 1 });
    expect(frames).toHaveLength(0);
  });
});