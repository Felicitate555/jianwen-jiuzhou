import shanlang from '@/assets/portraits/shanlang.webp';
import yaoxiu from '@/assets/portraits/yaoxiu.webp';
import chitongshanxiao from '@/assets/portraits/chitongshanxiao.webp';

export type PortraitId = 'shanlang' | 'yaoxiu' | 'chitongshanxiao';
export const PORTRAITS = { shanlang, yaoxiu, chitongshanxiao } as const;
const cache = new Map<PortraitId, HTMLImageElement>();

/** Lazy canvas asset. Rendering falls back to the existing vector body until ready. */
export function getPortrait(id: PortraitId): HTMLImageElement | null {
  const hit = cache.get(id);
  if (hit) return hit.complete && hit.naturalWidth > 0 ? hit : null;
  const image = new Image();
  image.decoding = 'async';
  image.src = PORTRAITS[id];
  cache.set(id, image);
  return null;
}
