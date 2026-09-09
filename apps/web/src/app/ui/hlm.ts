import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * `tailwind-merge` knows Tailwind's own scale, not the one `styles.css` declares. The
 * type scale there is one name per role (`text-ui`, `text-caption`, …), and a name it
 * does not recognise after `text-` it reads as a colour, so `text-ui` would silently
 * cancel `text-primary-foreground` and a blue button would print its label in ink.
 * Naming the scale here is what stops that. It is the one place these names are
 * repeated outside `styles.css`, and a name added there without being added here goes
 * back to cancelling colours, which is why they sit under the same comment.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["label", "caption", "ui", "body", "figure"] }],
    },
  },
});

/**
 * Merge class values the way spartan/ui's helm layer does: `clsx` flattens whatever a
 * caller passed (strings, arrays, conditionals) and `tailwind-merge` then drops the
 * utilities a later one overrides, so `hlm(buttonVariants(...), "px-6")` keeps one
 * padding rather than two that fight by source order.
 *
 * Copied from spartan/ui 1.4.1 (`libs/helm/utils/src/lib/hlm.ts`), which is the whole
 * of that file bar the configuration above. Its neighbour there, the `classes()`
 * host-class manager, was left behind: it carries a document-wide MutationObserver to
 * let several directives write one element's class attribute, which is a problem this
 * repo does not have yet, and a `[class]` host binding does the same job for one.
 */
export function hlm(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
