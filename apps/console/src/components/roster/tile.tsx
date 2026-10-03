import { Card, cn, Icon, type IconProps } from '@adili/ui';
import type { ReactNode } from 'react';

/** A stat tile (the prototype's `.tile`): an icon and label, then the value and any detail. */
export function Tile({
  icon,
  label,
  hint,
  className,
  children,
}: {
  icon: IconProps['icon'];
  label: string;
  /** After the label, e.g. a tooltip saying what the count holds. */
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn('gap-1.5', className)}>
      <p className="flex items-center gap-1.5 text-[13.5px] font-medium text-muted-foreground [&_svg]:size-[15px]">
        <Icon icon={icon} />
        {label}
        {hint}
      </p>
      {children}
    </Card>
  );
}

/** The tile's number. */
export function TileValue({ children }: { children: ReactNode }) {
  return (
    <p className="text-[26px] leading-tight font-semibold tracking-[-0.02em] tabular-nums">
      {children}
    </p>
  );
}
