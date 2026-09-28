export type Tone = 'default' | 'success' | 'warning' | 'destructive' | 'info' | 'brand' | 'ai';

/**
 * Soft fill and text for each status tone: the kit's .badge tints. Text is the solid status
 * colour, except info and brand, whose solids miss 4.5:1 on their soft fill and so take the
 * darker -subtle-foreground (the kit's #1f4f96 and --brand-ink). Pair the colour with text or an
 * icon; never rely on colour alone.
 */
export const toneClassNames: Record<Tone, string> = {
  default: 'bg-muted text-secondary-foreground',
  success: 'bg-success-subtle text-success',
  warning: 'bg-warning-subtle text-warning',
  destructive: 'bg-destructive-subtle text-destructive',
  info: 'bg-info-subtle text-info-subtle-foreground',
  brand: 'bg-brand-subtle text-brand-subtle-foreground',
  ai: 'bg-ai-subtle text-ai',
};
