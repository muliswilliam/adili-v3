import { Button, Icon, Tooltip } from '@adili/ui';
import { Upload04Icon } from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';

import { messages as m } from './messages';

/** The way into the import wizard; disabled, saying why, while an import runs. */
export function ImportRosterButton({ running }: { running: boolean }) {
  if (running) {
    return (
      <Tooltip content={m.waitForImport}>
        {/* A disabled button takes no focus or hover; the wrapper explains it. */}
        <span tabIndex={0} className="inline-flex rounded-lg">
          <Button disabled>
            <Icon icon={Upload04Icon} />
            {m.importRoster}
          </Button>
        </span>
      </Tooltip>
    );
  }
  return (
    <Button asChild>
      <Link to="/roster/import">
        <Icon icon={Upload04Icon} />
        {m.importRoster}
      </Link>
    </Button>
  );
}
