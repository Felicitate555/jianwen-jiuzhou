import { useEffect } from 'react';

export function IntroCinematic({ onComplete }: { onComplete: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onComplete, 4600);
    return () => window.clearTimeout(timer);
  }, [onComplete]);

  return (
    <div data-ui-interactive className="intro-cinematic absolute inset-0 z-[70] overflow-hidden bg-[#030708]" role="dialog" aria-label="剑问九州开场">
      <div className="intro-moon" />
      <div className="intro-mountains intro-mountains-far" />
      <div className="intro-mountains intro-mountains-near" />
      <div className="intro-sword" aria-hidden="true"><span className="intro-sword-blade" /><span className="intro-sword-hilt" /></div>
      <div className="intro-title absolute inset-0 flex flex-col items-center justify-center">
        <p className="mb-4 text-[10px] tracking-[.65em] text-[#9dbcb3]/50">一剑入世 · 命问九州</p>
        <h1 className="font-display text-5xl font-normal tracking-[.28em] text-[#e8e2d6] [text-shadow:0_0_28px_rgba(205,239,232,.18)] md:text-7xl">剑问九州</h1>
        <span className="mt-6 h-px w-40 bg-gradient-to-r from-transparent via-[#c9ad6c]/65 to-transparent" />
      </div>
      <button type="button" onClick={onComplete} className="absolute bottom-7 right-8 rounded-sm border border-[#9ab4a8]/20 px-3 py-1.5 text-[10px] tracking-[.25em] text-[#9ab4a8]/55 hover:text-[#d6ebe5]">跳过序章</button>
    </div>
  );
}
