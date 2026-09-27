import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { COUNTIES, COUNTRIES } from '../lib/places';
import { CountrySelect } from './country-select';
import { CountySelect } from './county-select';
import { FormField } from './form-field';

// jsdom does not implement scrolling.
beforeAll(() => {
  Element.prototype.scrollIntoView = () => undefined;
});

function CountryField({
  onValueChange = vi.fn(),
  exclude,
  initial = null,
}: {
  onValueChange?: (code: string | null) => void;
  exclude?: string[];
  initial?: string | null;
}) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <FormField label="Country">
      <CountrySelect
        value={value}
        exclude={exclude}
        onValueChange={(next) => {
          setValue(next);
          onValueChange(next);
        }}
      />
    </FormField>
  );
}

function CountyField({
  onValueChange = vi.fn(),
}: {
  onValueChange?: (code: string | null) => void;
}) {
  const [value, setValue] = useState<string | null>(null);
  return (
    <FormField label="County" error={value ? undefined : 'Choose a county.'}>
      <CountySelect
        value={value}
        onValueChange={(next) => {
          setValue(next);
          onValueChange(next);
        }}
      />
    </FormField>
  );
}

describe('place data', () => {
  it('has 47 counties with codes 001 to 047 and unique names', () => {
    expect(COUNTIES).toHaveLength(47);
    expect(COUNTIES.map((county) => county.code)).toEqual(
      Array.from({ length: 47 }, (_, index) => String(index + 1).padStart(3, '0')),
    );
    expect(new Set(COUNTIES.map((county) => county.name)).size).toBe(47);
    expect(COUNTIES.find((county) => county.code === '047')?.name).toBe('Nairobi City');
  });

  it('has every ISO 3166-1 alpha-2 country once', () => {
    expect(COUNTRIES).toHaveLength(249);
    expect(new Set(COUNTRIES.map((country) => country.code)).size).toBe(249);
    for (const country of COUNTRIES) expect(country.code).toMatch(/^[A-Z]{2}$/);
  });
});

describe('CountrySelect', () => {
  it('is a combobox labelled by its field', () => {
    render(<CountryField />);

    const input = screen.getByRole('combobox', { name: 'Country' });
    expect(input.getAttribute('placeholder')).toBe('Choose a country');
  });

  it('finds a country by name or code and stores the code', () => {
    const onValueChange = vi.fn();
    render(<CountryField onValueChange={onValueChange} />);
    const input = screen.getByRole('combobox', { name: 'Country' });

    fireEvent.change(input, { target: { value: 'gb' } });
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toContain(
      'United Kingdom',
    );

    fireEvent.change(input, { target: { value: 'Ugan' } });
    fireEvent.click(screen.getByRole('option', { name: 'Uganda' }));

    expect(onValueChange).toHaveBeenCalledWith('UG');
  });

  it('shows the name for a stored code and leaves out excluded countries', () => {
    render(<CountryField initial="TZ" exclude={['KE']} />);

    expect(screen.getByRole<HTMLInputElement>('combobox', { name: 'Country' }).value).toBe(
      'Tanzania',
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Country' }), {
      target: { value: 'Kenya' },
    });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });
});

describe('CountySelect', () => {
  it('lists all 47 counties alphabetically and stores the county code', () => {
    const onValueChange = vi.fn();
    render(<CountyField onValueChange={onValueChange} />);
    const input = screen.getByRole('combobox', { name: 'County' });

    fireEvent.click(input);
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(47);
    expect(options[0]?.textContent).toBe('Baringo');
    expect(options[46]?.textContent).toBe('West Pokot');

    fireEvent.click(screen.getByRole('option', { name: 'Nairobi City' }));
    expect(onValueChange).toHaveBeenCalledWith('047');
  });

  it('shows an error from its field', () => {
    render(<CountyField />);

    expect(screen.getByRole('combobox', { name: 'County' }).getAttribute('aria-invalid')).toBe(
      'true',
    );
    expect(screen.getByRole('alert').textContent).toBe('Choose a county.');
  });
});
