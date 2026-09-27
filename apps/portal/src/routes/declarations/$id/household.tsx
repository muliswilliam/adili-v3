import { createFileRoute } from '@tanstack/react-router';

import { SectionComingSoon } from '../../../components/declaration/route-helpers';

// Placeholder until #119 builds this screen The route files stay put.
export const Route = createFileRoute('/declarations/$id/household')({
  head: () => ({ meta: [{ title: 'Spouses and children · Adili Online' }] }),
  component: SectionComingSoon,
});
