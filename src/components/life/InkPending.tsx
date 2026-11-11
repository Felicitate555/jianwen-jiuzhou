import { cn } from '@/lib/utils';

export function InkPending({ compact = false }: { compact?: boolean }) {
  return (
    <span className={cn('ink-wait', compact ? 'text-xs' : 'text-sm')} role="status" aria-label="剑意落字中">
      <span className="qi-wisp" aria-hidden="true"><span className="qi-orb" /></span>
      <span>剑意落字中</span>
      <span aria-hidden="true" className="flex items-center gap-1">
        <span className="ink-drop" /><span className="ink-drop" /><span className="ink-drop" />
      </span>
    </span>
  );
}
