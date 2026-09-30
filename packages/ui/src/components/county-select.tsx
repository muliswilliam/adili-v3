import { COUNTIES } from '../lib/places';
import { Combobox, type ComboboxProps } from './combobox';

export type CountySelectProps = Omit<ComboboxProps, 'options' | 'value' | 'onValueChange'> & {
  /** County code "001" to "047", or null. */
  value: string | null;
  onValueChange: (code: string | null) => void;
};

const OPTIONS = [...COUNTIES]
  .sort((a, b) => a.name.localeCompare(b.name, 'en'))
  .map((county) => ({ value: county.code, label: county.name }));

/**
 * Picks one of Kenya's 47 counties by typing its name, listed alphabetically. The value is the
 * official county code, e.g. "047" for Nairobi City. Other props go to the Combobox input, so
 * it works inside a FormField.
 */
export function CountySelect({
  value,
  onValueChange,
  placeholder = 'Choose a county',
  ...props
}: CountySelectProps) {
  return (
    <Combobox
      {...props}
      options={OPTIONS}
      value={value}
      onValueChange={onValueChange}
      placeholder={placeholder}
    />
  );
}
