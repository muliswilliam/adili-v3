import { useToast } from '@adili/ui';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { z } from 'zod';

import { DiscardDraftButton } from '../../../components/declaration/discard-dialog';
import { DeclarationOverview } from '../../../components/declaration/overview';
import { useWorkspace } from '../../../components/declaration/workspace';

export const STARTED_COPY = 'Draft started. It saves as you type.';

export const Route = createFileRoute('/declarations/$id/')({
  validateSearch: z.object({ started: z.boolean().optional() }),
  component: OverviewRoute,
});

function OverviewRoute() {
  const { started } = Route.useSearch();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { declaration } = useWorkspace();
  const announced = useRef(false);

  useEffect(() => {
    if (!started || announced.current) return;
    announced.current = true;
    toast({ title: STARTED_COPY });
  }, [started, toast]);

  return (
    <DeclarationOverview
      footer={
        declaration.status === 'draft' ? (
          <DiscardDraftButton
            declarationId={declaration.id}
            onDiscarded={() => navigate({ to: '/', search: { discarded: true } })}
          />
        ) : null
      }
    />
  );
}
