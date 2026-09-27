import { COUNTRIES } from '../lib/places';
import { Combobox, type ComboboxOption, type ComboboxProps } from './combobox';

export type CountrySelectProps = Omit<
  ComboboxProps,
  'options' | 'filter' | 'value' | 'onValueChange'
> & {
  /** ISO 3166-1 alpha-2 code, e.g. "UG", or null. */
  value: string | null;
  onValueChange: (code: string | null) => void;
  /** Codes to leave out, e.g. ["KE"] when asking for a country outside Kenya. */
  exclude?: string[];
};

function matches(option: ComboboxOption, query: string) {
  const needle = query.trim().toLowerCase();
  return (
    needle === '' ||
    option.label.toLowerCase().includes(needle) ||
    option.value.toLowerCase() === needle
  );
}

/**
 * Picks a country by typing its name (or its two-letter code). The value is the ISO 3166-1
 * alpha-2 code. Other props go to the Combobox input, so it works inside a FormField.
 */
export function CountrySelect({
  value,
  onValueChange,
  exclude = [],
  placeholder = 'Choose a country',
  ...props
}: CountrySelectProps) {
  const options = COUNTRIES.filter((country) => !exclude.includes(country.code)).map((country) => ({
    value: country.code,
    label: country.name,
  }));
  return (
    <Combobox
      {...props}
      options={options}
      filter={matches}
      value={value}
      onValueChange={onValueChange}
      placeholder={placeholder}
    />
  );
}
