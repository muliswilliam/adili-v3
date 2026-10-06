import { Button, Icon } from '@adili/ui';
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';

/** The way back to Home, above the heading of a list page Home links to. */
export function HomeLink({ label }: { label: string }) {
  return (
    <Button asChild variant="ghost" size="sm" className="-ml-3 mb-3">
      <Link to="/">
        <Icon icon={ArrowLeft01Icon} />
        {label}
      </Link>
    </Button>
  );
}
