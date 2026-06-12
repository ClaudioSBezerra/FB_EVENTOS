// FB_EVENTOS — shadcn-ui utility helper (Phase 0, Plan 04).
//
// Standard shadcn `cn()` helper that merges Tailwind classes. Used by every
// shadcn primitive (button, input, label, form, card, checkbox) to compose
// className props without conflicts (tailwind-merge resolves duplicates).

import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
