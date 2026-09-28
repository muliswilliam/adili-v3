import { Icon } from '@adili/ui';
import { CloudIcon, File02Icon, SecurityCheckIcon } from '@hugeicons/core-free-icons';

const TITLE = 'Declare your income, assets and liabilities, simply and securely.';
const ITEMS = [
  [SecurityCheckIcon, 'Goes only to your Responsible Commission'],
  [CloudIcon, 'Saves as you type, on any device'],
  [File02Icon, 'Signed slip anyone can check'],
] as const;

/** A 1×1 transparent GIF: phones, where the panel is hidden, pick it instead of the photo. */
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/**
 * The photo panel beside the landing page, from 1000px wide. The Get started steps show the form
 * alone, so nothing competes with the step. Decorative: it repeats what the
 * pages say, so it is hidden from assistive technology. It stays in view while a long step
 * scrolls. The colours are fixed rather than tokens because they sit on the photo, which does not
 * change with the theme.
 */
export function AuthArt() {
  return (
    <aside
      aria-hidden="true"
      className="sticky top-0 m-2.5 hidden h-[calc(100dvh-20px)] min-h-[560px] overflow-hidden rounded-[24px] bg-[#9cc8ee] min-[1000px]:block"
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
      <div className="absolute inset-x-0 top-0 h-1/2 bg-linear-to-b from-white/35 to-transparent" />
      <div className="absolute inset-0 bg-[radial-gradient(rgb(255_255_255/0.22)_1px,transparent_1.4px)] bg-size-[5px_5px] mix-blend-soft-light" />
      <div className="absolute inset-x-11 top-12 text-[#1a1a1a]">
        <h2 className="max-w-[460px] text-[34px] leading-[1.12] font-semibold tracking-[-0.025em] text-balance">
          {TITLE}
        </h2>
      </div>
      <ul className="absolute inset-x-11 bottom-10 grid gap-2.5">
        {ITEMS.map(([icon, text]) => (
          <li
            key={text}
            className="flex max-w-[400px] items-center gap-3 rounded-[14px] bg-white/72 px-3.5 py-3 text-sm font-medium text-[#1a1a1a] shadow-[0_1px_2px_rgb(0_0_0/0.06)] backdrop-blur-[10px]"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-white text-brand">
              <Icon icon={icon} className="size-[17px]" />
            </span>
            {text}
          </li>
        ))}
      </ul>
    </aside>
  );
}
