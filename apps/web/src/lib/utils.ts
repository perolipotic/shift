import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn/ui's class merger. Wired by `components.json`'s `utils` alias. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
