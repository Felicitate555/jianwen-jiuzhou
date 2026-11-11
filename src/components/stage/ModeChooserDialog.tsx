import { Camera, MousePointer2 } from 'lucide-react';

export function ModeChooserDialog({ starting, onCamera, onPointer }: { starting: boolean; onCamera: () => void; onPointer: () => void }) {
  return (
    <div data-ui-interactive className="absolute inset-0 z-[65] flex items-center justify-center bg-[rgba(3,8,10,.78)] p-4 backdrop-blur-[5px]" role="dialog" aria-label="选择执剑方式">
      <section className="scroll-ink anim-unfurl relative w-full max-w-2xl overflow-hidden rounded-md px-7 py-8 md:px-10">
        <div className="scroll-rod absolute inset-x-[-8px] top-0" />
        <div className="text-center"><p className="text-[10px] tracking-[.35em] text-[#9ab4a8]/55">入画之前</p><h2 className="mt-2 font-display text-2xl tracking-[.24em] text-[#e8dfcf]">选择执剑之法</h2><p className="mt-2 text-xs leading-5 text-[#cdefe8]/55">初次游玩建议使用指针；真人入画可让食指化作剑锋。</p></div>
        <div className="mt-7 grid gap-3 sm:grid-cols-2">
          <button type="button" disabled={starting} onClick={onCamera} className="fate-slip group rounded-sm p-5 text-left transition hover:-translate-y-0.5 disabled:opacity-50">
            <Camera className="size-5 text-[#9fd8c8]" /><strong className="mt-3 block font-display text-lg font-normal tracking-[.16em] text-[#e8dfcf]">真人入画</strong><span className="mt-2 block text-xs leading-5 text-[#b8b09c]">允许摄像头后，张手出剑、握拳收势，小飞剑随食指而行。</span><span className="mt-3 block text-[10px] text-[#9fd8c8]/65">{starting ? '正在请剑入镜……' : '沉浸御剑 · 需要摄像头权限'}</span>
          </button>
          <button type="button" onClick={onPointer} className="fate-slip group rounded-sm p-5 text-left transition hover:-translate-y-0.5">
            <MousePointer2 className="size-5 text-[#d9b76f]" /><strong className="mt-3 block font-display text-lg font-normal tracking-[.16em] text-[#e8dfcf]">以指代剑</strong><span className="mt-2 block text-xs leading-5 text-[#b8b09c]">按住鼠标拖动出剑，松开收势；无需摄像头即可走完整章。</span><span className="mt-3 block text-[10px] text-[#d9b76f]/65">稳定易用 · 推荐初次选择</span>
          </button>
        </div>
        <div className="scroll-rod absolute inset-x-[-8px] bottom-0" />
      </section>
    </div>
  );
}
