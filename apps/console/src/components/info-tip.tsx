import { cn, focusRing, Icon, Tooltip } from '@adili/ui';
import { InformationCircleIcon } from '@hugeicons/core-free-icons';

/**
 * A small (i) button beside a label or value that shows `content` in a tooltip, named `label` for
 * assistive technology, e.g. "About the obligations start date".
 */
export function InfoTip({
  content,
  label,
  className,
}: {
  content: string;
  label: string;
  className?: string;
}) {
  return (
    <Tooltip content={content}>
      <button
        type="button"
        aria-label={label}
        className={cn(
          'inline-grid size-5 place-items-center rounded-full hover:text-foreground',
          focusRing,
          className,
        )}
      >
        <Icon icon={InformationCircleIcon} className="size-3.5" />
      </button>
    </Tooltip>
  );
}
