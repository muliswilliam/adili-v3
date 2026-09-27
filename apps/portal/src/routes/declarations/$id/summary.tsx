import { createFileRoute } from '@tanstack/react-router';

import { SectionComingSoon } from '../../../components/declaration/route-helpers';

// Placeholder until #128 builds this screen The route files stay put.
export const Route = createFileRoute('/declarations/$id/summary')({
  head: () => ({ meta: [{ title: 'Summary · Adili Online' }] }),
  component: SectionComingSoon,
});
