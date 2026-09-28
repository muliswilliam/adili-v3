import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MaskedContact, maskEmail, maskPhone } from './masked-contact';

describe('maskEmail', () => {
  it('keeps the first letter and the domain', () => {
    expect(maskEmail('jane.doe@moe.go.ke')).toBe('j***@moe.go.ke');
    expect(maskEmail('j@moe.go.ke')).toBe('j***@moe.go.ke');
  });

  it('leaves an already masked value alone and hides a malformed one', () => {
    expect(maskEmail('j***@moe.go.ke')).toBe('j***@moe.go.ke');
    expect(maskEmail('not-an-email')).toBe('***');
  });

  it('masks a value that merely contains a star', () => {
    expect(maskEmail('a*b@moe.go.ke')).toBe('a***@moe.go.ke');
    expect(maskEmail('jane*doe.smith@moe.go.ke')).toBe('j***@moe.go.ke');
  });
});

describe('maskPhone', () => {
  it('shows Kenyan numbers in local format with the last three digits', () => {
    expect(maskPhone('+254712345678')).toBe('07** *** 678');
    expect(maskPhone('0712 345 678')).toBe('07** *** 678');
  });

  it('normalises 254 without the plus, spaces and dashes', () => {
    expect(maskPhone('254712345678')).toBe('07** *** 678');
    expect(maskPhone('+254 712-345-678')).toBe('07** *** 678');
    expect(maskPhone('0712-345-678')).toBe('07** *** 678');
    expect(maskPhone('+254110345678')).toBe('01** *** 678');
  });

  it('keeps the country code of other international numbers', () => {
    expect(maskPhone('+44 20 7946 0958')).toBe('+44 ** *** 958');
    expect(maskPhone('+442079460958')).toBe('+44 ** *** 958');
    expect(maskPhone('+1 415 555 2671')).toBe('+1 ** *** 671');
    expect(maskPhone('+256 772 123456')).toBe('+256 ** *** 456');
  });

  it('hides every digit of a short value', () => {
    expect(maskPhone('123')).toBe('** *** ***');
    expect(maskPhone('12345678')).toBe('** *** ***');
    expect(maskPhone('+44 1234')).toBe('** *** ***');
  });

  it('hides every digit after the country code of a short international number', () => {
    expect(maskPhone('+504038659')).toBe('+504 ** *** ***');
    expect(maskPhone('+2547123456')).toBe('+254 ** *** ***');
    expect(maskPhone('+44 2079 460')).toBe('+44 ** *** ***');
  });

  it('shows the last three digits once the national number has eight', () => {
    expect(maskPhone('+44 2079 4609')).toBe('+44 ** *** 609');
    expect(maskPhone('+256 772 12345')).toBe('+256 ** *** 345');
  });

  it('leaves an already masked value alone', () => {
    expect(maskPhone('07** *** 678')).toBe('07** *** 678');
    expect(maskPhone('07** *** 123')).toBe('07** *** 123');
    expect(maskPhone('+44 ** *** 958')).toBe('+44 ** *** 958');
    expect(maskPhone('** *** ***')).toBe('** *** ***');
    expect(maskPhone('+504 ** *** ***')).toBe('+504 ** *** ***');
  });

  it('masks a value that merely contains a star', () => {
    expect(maskPhone('0712*345678')).toBe('07** *** 678');
    expect(maskPhone('07*2345678')).toBe('07** *** 678');
    expect(maskPhone('0712345678*')).toBe('07** *** 678');
  });
});

describe('MaskedContact', () => {
  it('never renders the full value', () => {
    const { container } = render(<MaskedContact kind="email" value="jane.doe@moe.go.ke" />);

    expect(container.textContent).not.toContain('jane.doe');
    expect(screen.getByText('j***@moe.go.ke')).toBeDefined();
  });

  it('never renders the full value when it contains a star', () => {
    const email = render(<MaskedContact kind="email" value="a*b@moe.go.ke" />);
    expect(email.container.textContent).not.toContain('a*b');
    email.unmount();

    const phone = render(<MaskedContact kind="phone" value="0712*345678" />);
    expect(phone.container.textContent).not.toContain('0712');
    expect(phone.container.textContent).toContain('07** *** 678');
  });

  it('tells screen reader users the value is partly hidden', () => {
    render(<MaskedContact kind="phone" value="+254712345678" />);

    const hint = screen.getByText('(partially hidden for privacy)');
    expect(hint.className).toContain('sr-only');
  });

  it('shows a verified badge when verified', () => {
    const { rerender } = render(<MaskedContact kind="phone" value="07** *** 123" />);
    expect(screen.queryByText('Verified')).toBeNull();

    rerender(<MaskedContact kind="phone" value="07** *** 123" verified />);
    expect(screen.getByText('Verified')).toBeDefined();
  });
});
