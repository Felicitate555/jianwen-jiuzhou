// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { PointerInput } from '@/input/pointerInput';
import { InputManager } from '@/input/inputManager';

function setup() {
  const stage = document.createElement('div');
  stage.innerHTML = '<button><span>继续</span></button><div data-ui-interactive><p>剧情</p></div><canvas></canvas>';
  document.body.replaceChildren(stage);
  stage.setPointerCapture = vi.fn();
  stage.releasePointerCapture = vi.fn();
  stage.hasPointerCapture = () => true;
  const frames = vi.fn();
  const input = new PointerInput(frames, () => stage);
  input.start();
  const fire = (target: Element, type: string, id = 1, button = 0, primary = true) => {
    const ev = new Event(type, { bubbles: true });
    Object.assign(ev, { pointerId: id, button, isPrimary: primary, clientX: 20, clientY: 30 });
    target.dispatchEvent(ev);
  };
  return { stage, frames, input, fire };
}

describe('Pointer UI boundary', () => {
  it('button children and marked narrative never start a sword stroke', () => {
    const { stage, frames, input, fire } = setup();
    fire(stage.querySelector('span')!, 'pointerdown');
    fire(stage.querySelector('p')!, 'pointerdown');
    expect(frames).not.toHaveBeenCalled();
    expect(stage.setPointerCapture).not.toHaveBeenCalled();
    input.stop();
  });
  it('blank canvas owns only primary left pointer and releases capture', () => {
    const { stage, frames, input, fire } = setup();
    const canvas = stage.querySelector('canvas')!;
    fire(canvas, 'pointerdown', 2, 2);
    fire(canvas, 'pointerdown', 3, 0, false);
    expect(frames).not.toHaveBeenCalled();
    fire(canvas, 'pointerdown');
    fire(canvas, 'pointermove', 2);
    expect(frames).toHaveBeenCalledTimes(1);
    fire(canvas, 'pointermove');
    fire(canvas, 'pointerup');
    expect(frames).toHaveBeenCalledTimes(3);
    expect(stage.releasePointerCapture).toHaveBeenCalledWith(1);
    input.stop();
  });
  it('late camera failure cannot unset a newly selected pointer', async () => {
    const manager = new InputManager();
    let reject!: (e: Error) => void;
    const pending = manager.switchTo({ source: 'camera', start: () => new Promise<void>((_, r) => { reject = r; }), stop: vi.fn() });
    await manager.switchTo({ source: 'pointer', start: vi.fn(), stop: vi.fn() });
    reject(new Error('cancelled camera'));
    await expect(pending).rejects.toThrow();
    expect(manager.activeSource).toBe('pointer');
  });
});
