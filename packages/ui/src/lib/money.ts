export type MoneyParseResult =
  | { status: 'empty' }
  | { status: 'valid'; cents: number }
  | { status: 'invalid'; reason: 'negative' | 'format' | 'too-large' };

// Digits with optional correctly placed thousands separators, then up to two decimals.
const AMOUNT = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{0,2}))?$/;

/**
 * Reads an amount typed by a person into integer cents, so money never passes through a float:
 * `1,250,000.50` → 125000050. Accepts an optional `KES` prefix. Blank text is empty, not zero.
 */
export function parseMoney(text: string): MoneyParseResult {
  const trimmed = text
    .trim()
    .replace(/^KES\s*/i, '')
    .trim();
  if (text.trim() === '') return { status: 'empty' };
  if (trimmed.startsWith('-')) return { status: 'invalid', reason: 'negative' };
  const match = AMOUNT.exec(trimmed);
  if (!match) return { status: 'invalid', reason: 'format' };
  const whole = BigInt((match[1] ?? '').replaceAll(',', ''));
  const fraction = BigInt((match[2] ?? '').padEnd(2, '0'));
  const cents = whole * 100n + fraction;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) return { status: 'invalid', reason: 'too-large' };
  return { status: 'valid', cents: Number(cents) };
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Integer cents → `1,250,000.50`. Cents are shown only when there are some, unless
 * `alwaysShowCents`; `currency` adds a prefix such as `KES`.
 */
export function formatMoney(
  cents: number,
  { currency, alwaysShowCents = false }: { currency?: string; alwaysShowCents?: boolean } = {},
): string {
  const whole = Math.floor(cents / 100);
  const fraction = cents % 100;
  const decimals = fraction !== 0 || alwaysShowCents ? `.${String(fraction).padStart(2, '0')}` : '';
  const amount = `${groupThousands(String(whole))}${decimals}`;
  return currency ? `${currency} ${amount}` : amount;
}

/**
 * Reshapes text as it is typed into a money field: keeps digits and one point, at most two
 * decimals, and regroups the thousands. Minus signs are dropped, so a negative cannot be typed.
 */
export function shapeMoneyText(raw: string): string {
  const kept = raw.replace(/[^\d.]/g, '');
  const [wholePart = '', ...rest] = kept.split('.');
  const whole = wholePart.replace(/^0+(?=\d)/, '');
  const hasPoint = rest.length > 0;
  const decimals = rest.join('').slice(0, 2);
  if (whole === '' && !hasPoint) return '';
  return `${groupThousands(whole === '' ? '0' : whole)}${hasPoint ? `.${decimals}` : ''}`;
}
