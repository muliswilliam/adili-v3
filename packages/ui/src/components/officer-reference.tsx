import { cn } from '../lib/cn';
import { CopyButton } from './copy-button';

/**
 * An officer reference (OFR) in mono, with a button to copy it. Needs a ToastProvider for the
 * copy confirmation. Sits in a `DescriptionItem` with `className="items-center"`.
 */
export function OfficerReference({ value, className }: { value: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <span className="font-mono font-semibold tracking-[0.02em]">{value}</span>
      <CopyButton
        value={value}
        label="Copy officer reference"
        copiedMessage="Officer reference copied"
        className="-my-1.5"
      />
    </span>
  );
}
