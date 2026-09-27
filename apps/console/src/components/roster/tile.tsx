import { Card, Icon, type IconProps } from '@adili/ui';
import type { ReactNode } from 'react';

/** A stat tile (the prototype's `.tile`): an icon and label, then the value and any detail. */
export function Tile({
  icon,
  label,
  children,
}: {
  icon: IconProps['icon'];
  label: string;
  children: ReactNode;
}) {
  return (
    <Card className="gap-1.5">
      <p className="flex items-center gap-1.5 text-[13.5px] font-medium text-muted-foreground [&_svg]:size-[15px]">
        <Icon icon={icon} />
        {label}
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
