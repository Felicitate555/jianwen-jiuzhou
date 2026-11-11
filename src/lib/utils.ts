import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatMs(ms: number): string {
  return `${(ms / 1000).toFixed(2)} s`;
}

export function formatCoord(v: number | null): string {
  return v === null ? '—' : v.toFixed(1);
}