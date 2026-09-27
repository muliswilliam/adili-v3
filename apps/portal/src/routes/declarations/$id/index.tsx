import { useToast } from '@adili/ui';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { z } from 'zod';

import { DeclarationOverview } from '../../../components/declaration/overview';

export const STARTED_COPY = 'Draft started. It saves as you type.';

export const Route = createFileRoute('/declarations/$id/')({
  validateSearch: z.object({ started: z.boolean().optional() }),
  component: OverviewRoute,
});

function OverviewRoute() {
  const { started } = Route.useSearch();
  const { toast } = useToast();
  const announced = useRef(false);

  useEffect(() => {
    if (!started || announced.current) return;
    announced.current = true;
    toast({ title: STARTED_COPY });
  }, [started, toast]);

  return <DeclarationOverview />;
}
