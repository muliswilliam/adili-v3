import { createFileRoute } from '@tanstack/react-router';

import { SectionComingSoon } from '../../../components/declaration/route-helpers';

// Placeholder until #128 builds this screen The route files stay put.
export const Route = createFileRoute('/declarations/$id/other')({
  head: () => ({ meta: [{ title: 'Other information · Adili Online' }] }),
  component: SectionComingSoon,
});
