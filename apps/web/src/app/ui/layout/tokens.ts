/**
 * The layout primitives' vocabulary (ID81), each value a static literal class string
 * and never a template like `gap-${x}`: Tailwind generates what it sees in a source
 * file, and a string built at runtime is one it never sees.
 *
 * The spacing steps are the design language's, 4, 8, 12, 16, 24 and 32, under one
 * name per step. The surfaces, the radii and the widths name the tokens `styles.css`
 * declares, so a primitive can be given a token's name and never a colour.
 */

export const GAP = {
  none: "gap-0",
  xs: "gap-1",
  sm: "gap-2",
  md: "gap-3",
  lg: "gap-4",
  xl: "gap-6",
  xxl: "gap-8",
} as const;
export type Gap = keyof typeof GAP;

export const PAD = {
  none: "p-0",
  xs: "p-1",
  sm: "p-2",
  md: "p-3",
  lg: "p-4",
  xl: "p-6",
  xxl: "p-8",
} as const;
export type Pad = keyof typeof PAD;

export const PAD_X: Record<Pad, string> = {
  none: "px-0",
  xs: "px-1",
  sm: "px-2",
  md: "px-3",
  lg: "px-4",
  xl: "px-6",
  xxl: "px-8",
};

export const PAD_Y: Record<Pad, string> = {
  none: "py-0",
  xs: "py-1",
  sm: "py-2",
  md: "py-3",
  lg: "py-4",
  xl: "py-6",
  xxl: "py-8",
};

export const ALIGN = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  baseline: "items-baseline",
  stretch: "items-stretch",
} as const;
export type Align = keyof typeof ALIGN;

export const JUSTIFY = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
} as const;
export type Justify = keyof typeof JUSTIFY;

export const SURFACE = {
  card: "bg-card",
  muted: "bg-muted",
  accent: "bg-accent",
  "ok-soft": "bg-ok-soft",
  "warn-soft": "bg-warn-soft",
  "danger-soft": "bg-danger-soft",
} as const;
export type Surface = keyof typeof SURFACE;

export const RADIUS = {
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
} as const;
export type Radius = keyof typeof RADIUS;

/** sm is the sign-in column (420 px); md and lg wait for the screens that need them. */
export const WIDTH = {
  sm: "max-w-[420px]",
  md: "max-w-3xl",
  lg: "max-w-5xl",
} as const;
export type Width = keyof typeof WIDTH;
