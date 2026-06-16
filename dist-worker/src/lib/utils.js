"use strict";
// FB_EVENTOS — shadcn-ui utility helper (Phase 0, Plan 04).
//
// Standard shadcn `cn()` helper that merges Tailwind classes. Used by every
// shadcn primitive (button, input, label, form, card, checkbox) to compose
// className props without conflicts (tailwind-merge resolves duplicates).
Object.defineProperty(exports, "__esModule", { value: true });
exports.cn = cn;
const clsx_1 = require("clsx");
const tailwind_merge_1 = require("tailwind-merge");
function cn(...inputs) {
    return (0, tailwind_merge_1.twMerge)((0, clsx_1.clsx)(inputs));
}
