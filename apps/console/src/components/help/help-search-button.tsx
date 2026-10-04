import { Button, Icon } from '@adili/ui';
import { Search01Icon } from '@hugeicons/core-free-icons';
import { useState } from 'react';

import type { HelpScope } from '../../server/help.server';
import { messages as m } from './messages';
import { useHelpSession } from './scope';
import { HelpSearchDrawer } from './search-drawer';

/** "Test help search" in a help page's header, with the drawer it opens. */
export function HelpSearchButton({ scope }: { scope: HelpScope }) {
  const [open, setOpen] = useState(false);
  const session = useHelpSession();
  return (
    <>
      <Button
        variant="secondary"
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
        }}
      >
        <Icon icon={Search01Icon} />
        {m.testSearch}
      </Button>
      <HelpSearchDrawer
        open={open}
        onOpenChange={setOpen}
        scope={scope}
        search={session.searchAsDeclarants}
        justPublished={session.justPublished}
        onUnauthenticated={session.onUnauthenticated}
      />
    </>
  );
}
