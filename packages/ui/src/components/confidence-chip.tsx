import { AlertCircleIcon, MinusSignIcon, Tick02Icon } from '@hugeicons/core-free-icons';
import type { ComponentProps } from 'react';

import { Badge } from './badge';
import { Icon } from './icon';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

/** A score from 0 to 1 → its level: 0.85 and up is high, 0.6 and up medium, anything lower low. */
export function confidenceLevel(score: number): ConfidenceLevel {
  if (score >= 0.85) return 'high';
  if (score >= 0.6) return 'medium';
  return 'low';
}

export interface ConfidenceMessages {
  high: string;
  medium: string;
  low: string;
  /** Read before the level by screen readers only, e.g. "Confidence: ". */
  prefix: string;
}

const DEFAULT_MESSAGES: ConfidenceMessages = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  prefix: 'Confidence: ',
};

const LOOK = {
  high: { variant: 'success', icon: Tick02Icon },
  medium: { variant: 'warning', icon: MinusSignIcon },
  low: { variant: 'destructive', icon: AlertCircleIcon },
} as const;

export type ConfidenceChipProps = Omit<ComponentProps<'span'>, 'children'> & {
  /** A level, or a score from 0 to 1 that `confidenceLevel` turns into one. */
  confidence: ConfidenceLevel | number;
  /** Replaces any of the default copy. */
  messages?: Partial<ConfidenceMessages>;
};

/**
 * How sure the reader of a document is about one field: High, Medium or Low. The level is
 * always in text with its own icon (tick, dash, alert), so it never depends on colour, and
 * screen readers hear "Confidence: Low".
 */
export function ConfidenceChip({ confidence, messages, ...props }: ConfidenceChipProps) {
  const level = typeof confidence === 'number' ? confidenceLevel(confidence) : confidence;
  const copy = { ...DEFAULT_MESSAGES, ...messages };
  const look = LOOK[level];

  return (
    <Badge variant={look.variant} data-level={level} {...props}>
      <Icon icon={look.icon} strokeWidth={2.2} />
      <span className="sr-only">{copy.prefix}</span>
      {copy[level]}
    </Badge>
  );
}
