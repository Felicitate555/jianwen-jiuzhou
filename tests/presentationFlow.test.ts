// @vitest-environment jsdom
import { createElement } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IntroCinematic } from '@/components/stage/IntroCinematic';
import { ModeChooserDialog } from '@/components/stage/ModeChooserDialog';
import { BossIntroCinematic, RangedIntroCinematic, WolfIntroCinematic } from '@/components/stage/EnemyIntroCinematics';

afterEach(() => vi.useRealTimers());

describe('presentation transition flow', () => {
  it('开场可跳过且会自动落幕', () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    const view = render(createElement(IntroCinematic, { onComplete }));
    fireEvent.click(screen.getByRole('button', { name: '跳过序章' }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    view.rerender(createElement(IntroCinematic, { onComplete }));
    act(() => vi.advanceTimersByTime(4600));
    expect(onComplete).toHaveBeenCalledTimes(2);
  });

  it('输入方式选择明确提供摄像头与指针入口', () => {
    const onCamera = vi.fn();
    const onPointer = vi.fn();
    render(createElement(ModeChooserDialog, { starting: false, onCamera, onPointer }));
    fireEvent.click(screen.getByRole('button', { name: /真人入画/ }));
    fireEvent.click(screen.getByRole('button', { name: /以指代剑/ }));
    expect(onCamera).toHaveBeenCalledOnce();
    expect(onPointer).toHaveBeenCalledOnce();
  });

  it.each([
    ['山狼', WolfIntroCinematic, 2200],
    ['妖修', RangedIntroCinematic, 2200],
    ['山魈', BossIntroCinematic, 3000],
  ] as const)('%s 登场演出会自动交还战斗', (_name, Component, duration) => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    render(createElement(Component, { onComplete }));
    act(() => vi.advanceTimersByTime(duration));
    expect(onComplete).toHaveBeenCalledOnce();
  });
});
