import { useEffect } from 'react';
import { PORTRAITS } from '@/combat/portraits';

function TimedIntro({ duration, onComplete, children, label }: { duration: number; onComplete: () => void; children: React.ReactNode; label: string }) {
  useEffect(() => { const timer = window.setTimeout(onComplete, duration); return () => window.clearTimeout(timer); }, [duration, onComplete]);
  return <div data-ui-interactive className="enemy-intro absolute inset-0 z-[55] overflow-hidden bg-[rgba(2,6,8,.88)]" role="status" aria-label={label}>{children}</div>;
}

export function RangedIntroCinematic({ onComplete }: { onComplete: () => void }) {
  return <TimedIntro duration={2200} onComplete={onComplete} label="妖修现身">
    <div className="enemy-intro-mist" /><img src={PORTRAITS.yaoxiu} alt="" className="enemy-intro-portrait absolute bottom-[-18%] right-[8%] h-[112%]" />
    <div className="enemy-intro-copy absolute left-[9%] top-1/2 -translate-y-1/2"><p className="text-[10px] tracking-[.45em] text-[#9d8ec9]/70">山狼伏诛 · 妖气未散</p><h2 className="mt-3 font-display text-4xl tracking-[.3em] text-[#e8dfcf] md:text-6xl">雾岭妖修</h2><p className="mt-4 text-sm tracking-[.18em] text-[#b8b09c]">蓄力露心可破势 · 妖气弹以剑斩之</p></div>
  </TimedIntro>;
}

export function WolfIntroCinematic({ onComplete }: { onComplete: () => void }) {
  return <TimedIntro duration={2200} onComplete={onComplete} label="山狼现身">
    <div className="enemy-intro-mist wolf" /><img src={PORTRAITS.shanlang} alt="" className="enemy-intro-portrait absolute bottom-[-20%] right-[5%] h-[118%]" />
    <div className="enemy-intro-copy absolute left-[9%] top-1/2 -translate-y-1/2"><p className="text-[10px] tracking-[.45em] text-[#c85860]/70">雾岭初试 · 腥风将至</p><h2 className="mt-3 font-display text-4xl tracking-[.3em] text-[#e8dfcf] md:text-6xl">墨影山狼</h2><p className="mt-4 text-sm tracking-[.18em] text-[#b8b09c]">扑击将至便收势 · 觑准赤瞳再出剑</p></div>
  </TimedIntro>;
}

export function BossIntroCinematic({ onComplete }: { onComplete: () => void }) {
  return <TimedIntro duration={3000} onComplete={onComplete} label="赤瞳山魈登场">
    <div className="enemy-intro-mist boss" /><div className="boss-eye-flare" /><img src={PORTRAITS.chitongshanxiao} alt="" className="boss-intro-portrait absolute bottom-[-24%] left-1/2 h-[128%] -translate-x-1/2" />
    <div className="boss-intro-copy absolute inset-x-0 bottom-[10%] text-center"><p className="text-[10px] tracking-[.55em] text-[#c85860]/80">雾岭之夜 · 百兽俯首</p><h2 className="mt-2 font-display text-5xl tracking-[.34em] text-[#eee3d7] [text-shadow:0_0_24px_rgba(194,64,58,.42)] md:text-7xl">赤瞳山魈</h2><p className="mt-3 text-xs tracking-[.24em] text-[#cabca8]/75">此一战，问你三式是否入骨</p></div>
  </TimedIntro>;
}
