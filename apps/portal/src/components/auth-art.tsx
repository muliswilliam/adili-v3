import { Icon, IconTile } from '@adili/ui';
import {
  Building03Icon,
  Clock01Icon,
  CloudIcon,
  File02Icon,
  SecurityCheckIcon,
  SquareLock02Icon,
} from '@hugeicons/core-free-icons';

export type AuthArtVariant = 'landing' | 'onboarding';

const ART = {
  landing: {
    title: 'Declare your income, assets and liabilities, simply and securely.',
    items: [
      [SecurityCheckIcon, 'Goes only to your Responsible Commission'],
      [CloudIcon, 'Saves as you type, on any device'],
      [File02Icon, 'Signed slip anyone can check'],
    ],
  },
  onboarding: {
    title: 'Set up your Adili account in a few minutes.',
    items: [
      [Building03Icon, 'For officers on a Commission roster'],
      [SquareLock02Icon, 'Codes go to your contacts on file'],
      [Clock01Icon, 'Takes about 5 minutes'],
    ],
  },
} as const;

/** A 1×1 transparent GIF: phones, where the panel is hidden, pick it instead of the photo. */
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/**
 * The photo panel beside the signed-out pages, from 1000px wide. Decorative: it repeats what the
 * pages say, so it is hidden from assistive technology. It stays in view while a long step
 * scrolls. Its colours are the `art` tokens, which stay the same in both themes because they sit
 * on the photo.
 */
export function AuthArt({ variant }: { variant: AuthArtVariant }) {
  const { title, items } = ART[variant];
  return (
    <aside
      aria-hidden="true"
      className="sticky top-0 m-2.5 hidden h-[calc(100dvh-20px)] min-h-[560px] overflow-hidden rounded-3xl bg-art min-[1000px]:block"
    >
      <picture>
        <source media="(max-width: 999px)" srcSet={BLANK} />
        <source
          type="image/webp"
          srcSet="/images/onboarding-hero-1000.webp 1000w, /images/onboarding-hero.webp 1500w"
          sizes="55vw"
        />
        <img
          src="/images/onboarding-hero.jpg"
          alt=""
          decoding="async"
          // The sky fills the top of the photo, behind the headline; the hills sit under the list.
          className="absolute inset-0 size-full object-cover object-[50%_35%]"
        />
      </picture>
      {/* Lifts the sky behind the headline, so the ink text stays above 4.5:1. */}
      <div className="absolute inset-x-0 top-0 h-1/2 bg-linear-to-b from-art-lift to-transparent" />
      <div className="absolute inset-0 bg-art-grain mix-blend-soft-light" />
      <div className="absolute inset-x-11 top-12 text-art-foreground">
        <h2 className="max-w-[460px] text-[34px] leading-[1.12] font-semibold tracking-[-0.025em] text-balance">
          {title}
        </h2>
      </div>
      <ul className="absolute inset-x-11 bottom-10 grid gap-2.5">
        {items.map(([icon, text]) => (
          <li
            key={text}
            className="flex max-w-[400px] items-center gap-3 rounded-item bg-art-item px-3.5 py-3 text-sm font-medium text-art-foreground shadow-art-item backdrop-blur-[10px]"
          >
            <IconTile tone="art" size="sm">
              <Icon icon={icon} />
            </IconTile>
            {text}
          </li>
        ))}
      </ul>
    </aside>
  );
}
