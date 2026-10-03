// @vitest-environment jsdom
import { TooltipProvider } from '@adili/ui';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HelpPassage, HelpPassageDetail } from '../../server/declarations/types';
import { HelpArticle, HelpHome, type HelpHomeProps } from './help-pages';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    search,
    children,
    ...props
  }: {
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string>;
    children: ReactNode;
  }) => {
    const path = to.replace('$passageId', params?.passageId ?? '');
    const query = new URLSearchParams(search).toString();
    return (
      <a href={query ? `${path}?${query}` : path} {...props}>
        {children}
      </a>
    );
  },
}));
vi.mock('../sign-out-button', () => ({ SignOutButton: () => null }));

const JOINT: HelpPassage = {
  id: 'help-joint',
  source: 'help',
  citation: 'Help: Joint assets',
  title: 'Joint assets',
  snippet: 'Switch on "Jointly held" and enter your share.',
  language: 'en',
};
const AM24: HelpPassage = {
  id: 'am-24',
  source: 'am',
  citation: 'AM 24',
  title: 'Approximate values',
  snippet: 'Declare jointly held assets at their whole value.',
  language: 'en',
};

const onQuery = vi.fn();
const onTopic = vi.fn();
const onLanguage = vi.fn();

function renderHome(props: Partial<HelpHomeProps> = {}) {
  return render(
    <TooltipProvider>
      <HelpHome
        language="en"
        query=""
        listing={{ kind: 'topics' }}
        onQuery={onQuery}
        onTopic={onTopic}
        onLanguage={onLanguage}
        {...props}
      />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  onQuery.mockReset();
  onTopic.mockReset();
  onLanguage.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('help home (S12)', () => {
  it('lists the topics to browse, each opening its passages', () => {
    renderHome();
    expect(screen.getByRole('heading', { level: 1, name: 'Help' })).toBeTruthy();
    for (const name of [
      'Getting started',
      'Spouses and children',
      'Income',
      'Assets',
      'Liabilities',
      'Material changes',
      'Submitting and slips',
      'The law',
    ]) {
      expect(screen.getByRole('button', { name: new RegExp(`^${name}`) })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole('button', { name: /^Assets/ }));
    expect(onTopic).toHaveBeenCalledWith('assets');
  });

  it('searches as the declarant types, once they pause', () => {
    vi.useFakeTimers();
    renderHome();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search the help' }), {
      target: { value: 'joint ' },
    });
    expect(onQuery).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(onQuery).toHaveBeenCalledWith('joint');
  });

  it('shows the results with their citations, the words marked, each opening its page', () => {
    renderHome({
      query: 'joint',
      listing: { kind: 'search', query: 'joint', passages: [AM24, JOINT] },
    });

    expect(screen.getByText('2 results', { selector: '[role=status]' })).toBeTruthy();
    const links = screen.getAllByRole('link', { name: /Approximate values|Joint assets/ });
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/help/am-24?lang=en',
      '/help/help-joint?lang=en',
    ]);
    const [law, article] = links;
    if (!law || !article) throw new Error('two links');
    expect(within(law).getByText('AM 24')).toBeTruthy();
    expect(within(article).getByText('Help')).toBeTruthy();
    expect(
      [...document.querySelectorAll('mark')].map((mark) => mark.textContent.toLowerCase()),
    ).toEqual(['joint', 'joint']);
  });

  it('says when nothing matches', () => {
    renderHome({
      query: 'xylophone',
      listing: { kind: 'search', query: 'xylophone', passages: [] },
    });
    expect(screen.getByRole('heading', { name: 'No results' })).toBeTruthy();
    expect(screen.getByText('No results', { selector: '[role=status]' })).toBeTruthy();
    expect(screen.getByText('Try other words, for example "joint".')).toBeTruthy();
  });

  it('says when the help cannot be read', () => {
    renderHome({ query: 'joint', listing: { kind: 'search', query: 'joint', passages: null } });
    expect(
      screen.getByText('Help cannot be shown right now. Try again in a few minutes.'),
    ).toBeTruthy();
  });

  it("lists a topic's passages with a way back to all topics", () => {
    renderHome({ listing: { kind: 'topic', topic: 'assets', passages: [AM24, JOINT] } });
    expect(screen.getByRole('heading', { level: 2, name: 'Assets' })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /Approximate values|Joint assets/ })).toHaveLength(
      2,
    );
    fireEvent.click(screen.getByRole('button', { name: 'All topics' }));
    expect(onTopic).toHaveBeenCalledWith(null);
  });

  it('is in Kiswahili, marking passages only in English', () => {
    renderHome({
      language: 'sw',
      query: 'mali',
      listing: {
        kind: 'search',
        query: 'mali',
        passages: [{ ...JOINT, title: 'Mali ya pamoja', language: 'sw' }, AM24],
      },
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Msaada' })).toBeTruthy();
    expect(screen.getByText('Matokeo 2', { selector: '[role=status]' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Mali ya pamoja/ }).getAttribute('href')).toBe(
      '/help/help-joint?lang=sw',
    );
    expect(screen.getAllByText('Kiingereza tu')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(onLanguage).toHaveBeenCalledWith('en');
  });

  it('says the language changed once the page is in it', () => {
    const { rerender } = renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'Kiswahili' }));
    expect(onLanguage).toHaveBeenCalledWith('sw');
    rerender(
      <TooltipProvider>
        <HelpHome
          language="sw"
          query=""
          listing={{ kind: 'topics' }}
          onQuery={onQuery}
          onTopic={onTopic}
          onLanguage={onLanguage}
        />
      </TooltipProvider>,
    );
    expect(
      screen.getByText('Msaada sasa uko kwa Kiswahili.', { selector: '[role=status]' }),
    ).toBeTruthy();
  });
});

const MATERIAL_CHANGE: HelpPassageDetail = {
  id: 'act-31-4',
  source: 'act',
  citation: 'Act s.31(4)',
  title: 'Material change',
  text: '"Material change" means: (a) at least twenty-five percent increase or decrease.',
  language: 'en',
  tags: ['other', 'material-change'],
  commission: null,
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
};

function renderArticle(passage: HelpPassageDetail, language: 'en' | 'sw' = 'en', related = [AM24]) {
  return render(
    <TooltipProvider>
      <HelpArticle
        language={language}
        passage={passage}
        related={related}
        onLanguage={onLanguage}
      />
    </TooltipProvider>,
  );
}

describe('help article (S12)', () => {
  it('shows a passage of the law whole, read only, with its citation and when it took effect', () => {
    renderArticle(MATERIAL_CHANGE);
    const article = screen.getByRole('article', { name: 'Material change' });
    expect(within(article).getByText('Act s.31(4)')).toBeTruthy();
    expect(
      within(article).getByText(
        'Conflict of Interest Act, 2025 · In force from 1 Jan 2026 · Statutory text, read only',
      ),
    ).toBeTruthy();
    expect(article.querySelector('blockquote')?.textContent).toBe(MATERIAL_CHANGE.text);
    // The breadcrumb names its topic; others on the topic follow.
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(
      within(crumbs).getByRole('link', { name: 'Material changes' }).getAttribute('href'),
    ).toBe('/help?topic=changes&lang=en');
    const related = screen.getByRole('region', { name: 'Related' });
    expect(within(related).getByRole('link', { name: /Approximate values/ })).toBeTruthy();
  });

  it("names the Commission of a Commission's article", () => {
    renderArticle({
      ...MATERIAL_CHANGE,
      id: 'help-file',
      source: 'help',
      citation: 'Help: File numbers at TSC',
      title: 'File numbers at TSC',
      text: 'Your personnel file number is the TSC number on your payslip.',
      tags: ['bio', 'employment'],
      commission: { slug: 'tsc', issuerCode: 'TSC', name: 'Teachers Service Commission' },
      effectiveFrom: '2026-07-01',
    });
    const article = screen.getByRole('article', { name: 'File numbers at TSC' });
    expect(within(article).getByText('TSC help')).toBeTruthy();
    expect(
      within(article).getByText('Teachers Service Commission · In force from 1 Jul 2026'),
    ).toBeTruthy();
    expect(article.querySelector('blockquote')).toBeNull();
  });

  it('says a passage is shown in English when it has no Kiswahili text', () => {
    renderArticle(MATERIAL_CHANGE, 'sw');
    expect(
      screen.getByText('Bado haipatikani kwa Kiswahili. Inaonyeshwa kwa Kiingereza.'),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).getAttribute('lang')).toBe('en');
    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(onLanguage).toHaveBeenCalledWith('en');
  });

  it('has no fallback note when the Kiswahili text is there', () => {
    renderArticle({ ...MATERIAL_CHANGE, title: 'Mabadiliko makubwa', language: 'sw' }, 'sw');
    expect(screen.queryByText(/Bado haipatikani/)).toBeNull();
  });
});
