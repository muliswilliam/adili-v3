import { createFileRoute } from '@tanstack/react-router';

import { SectionComingSoon, statementKey } from '../../../../components/declaration/route-helpers';

// Placeholder until #122 builds this screen. The loader already 404s for a malformed person key.
export const Route = createFileRoute('/declarations/$id/statements/$personKey')({
  loader: ({ params }) => ({ sectionKey: statementKey(params.personKey) }),
  head: () => ({ meta: [{ title: 'Financial statement · Adili Online' }] }),
  component: SectionComingSoon,
});
