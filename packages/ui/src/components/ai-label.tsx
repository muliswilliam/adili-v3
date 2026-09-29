import { PencilEdit02Icon, SparklesIcon } from '@hugeicons/core-free-icons';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';
import { focusRing } from '../lib/focus';
import { formatDateTime } from '../lib/format-date';
import { Badge } from './badge';
import { Icon } from './icon';
import { Tooltip } from './tooltip';

/** What each ai-gateway task's output is called. A task not listed here is printed as given. */
export const AI_TASK_NAMES: Record<string, string> = {
  'summarize-declaration': 'Summary',
  'explain-flags': 'Flag explanations',
  'draft-clarification': 'Clarification draft',
  'extract-document': 'Document reading',
  'answer-declarant-question': 'Answer',
  'narrate-compliance-report': 'Report narrative',
};

/** Display names of providers. A provider not listed here is printed as given. */
export const AI_PROVIDER_NAMES: Record<string, string> = {
  anthropic: 'Anthropic',
};

/**
 * Where an AI output came from: the fields of the `AiLabel` every ai-gateway output carries, so
 * an output's label can be passed as it is.
 */
export interface AiLabelDetails {
  /** The ai-gateway task, e.g. `summarize-declaration`. */
  task: string;
  provider: string;
  model: string;
  promptVersion: number;
  /** When the output was generated, as an ISO timestamp. */
  generatedAt: string;
}

/**
 * The sentence an AiLabel shows in its tooltip: "Summary · Anthropic claude-opus-5 · prompt v3 ·
 * generated 2 Sep 2026, 14:33", in Kenyan time.
 */
export function describeAiOutput({
  task,
  provider,
  model,
  promptVersion,
  generatedAt,
}: AiLabelDetails): string {
  const taskName = AI_TASK_NAMES[task] ?? task;
  const providerName = AI_PROVIDER_NAMES[provider] ?? provider;
  return `${taskName} · ${providerName} ${model} · prompt v${String(promptVersion)} · generated ${formatDateTime(generatedAt)}`;
}

export type AiLabelProps = Omit<ComponentProps<'span'>, 'children'> & {
  details: AiLabelDetails;
  /**
   * The label's text, e.g. "AI-assisted · generated 3 hours ago for version 2" in a panel header
   * or "AI draft" on a drafted item. Defaults to "AI-assisted".
   */
  text?: string;
  /** Marks AI content a person has since changed: grey, with a pencil. */
  edited?: boolean;
  /** The text once `edited`. Defaults to "AI draft, edited". */
  editedText?: string;
  /** Replaces the tooltip sentence. Defaults to `describeAiOutput`. */
  describe?: (details: AiLabelDetails) => string;
  /** `sm` is the 20px mark for a block or an item inside a panel. */
  size?: 'default' | 'sm';
};

/**
 * Marks content an AI produced, so it is never mistaken for the record. Always text ("AI-assisted")
 * with a sparkle, never colour alone. It takes keyboard focus; its tooltip (and accessible name,
 * "AI-assisted. Summary · Anthropic claude-opus-5 · prompt v3 · generated 2 Sep 2026, 14:33")
 * gives the task, provider, model, prompt version and time. Needs no TooltipProvider, but shares
 * one when mounted.
 */
export function AiLabel({
  details,
  text = 'AI-assisted',
  edited = false,
  editedText = 'AI draft, edited',
  describe = describeAiOutput,
  size = 'default',
  className,
  ...props
}: AiLabelProps) {
  const sentence = describe(details);
  const shown = edited ? editedText : text;

  return (
    <Tooltip content={sentence}>
      <Badge
        variant={edited ? 'default' : 'ai'}
        role="img"
        tabIndex={0}
        aria-label={`${shown}. ${sentence}`}
        data-edited={edited ? '' : undefined}
        className={cn(
          focusRing,
          'max-w-full font-semibold',
          size === 'sm' && 'h-5 gap-1 px-[7px] text-[11.5px] [&_svg]:size-[11px]',
          className,
        )}
        {...props}
      >
        <Icon icon={edited ? PencilEdit02Icon : SparklesIcon} strokeWidth={2} />
        <span className="truncate">{shown}</span>
      </Badge>
    </Tooltip>
  );
}
