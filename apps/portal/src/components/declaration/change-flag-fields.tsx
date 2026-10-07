import { CheckboxItem, FormField, SegmentedChoice, Textarea } from '@adili/ui';

import type { ChangeFlag, ChangeKind, Draft } from '../../declaration/contents';
import { ITEM_FIELD_LABELS } from '../../declaration/field-labels';

type ChangeField = 'kind' | 'explanation';

/**
 * "Changed since last declaration" on a statement item, directorship or membership: what
 * changed and an explanation once it is ticked. Paragraph 9 lists it as a material change.
 */
export function ChangeFlagFields({
  id,
  className = 'grid gap-3',
  change,
  hint,
  options,
  placeholder,
  ids,
  errors,
  onTouch,
  onChange,
}: {
  /** The group's element id, for a link that focuses it. */
  id?: string;
  className?: string;
  change: Draft<ChangeFlag> | undefined;
  /** What counts as a change, under the checkbox. */
  hint: string;
  options: { value: ChangeKind; label: string }[];
  /** The explanation's example. */
  placeholder: string;
  ids: Record<ChangeField, string>;
  errors: Partial<Record<ChangeField, string>>;
  onTouch: (field: ChangeField) => void;
  onChange: (next: Draft<ChangeFlag>) => void;
}) {
  return (
    <div id={id} className={className}>
      <CheckboxItem
        label={ITEM_FIELD_LABELS.change}
        hint={hint}
        checked={change?.changed === true}
        onChange={(event) => {
          const changed = event.target.checked;
          onChange(changed ? { ...change, changed } : { changed: false });
        }}
      />
      {change?.changed ? (
        <div className="ml-7 grid gap-4 rounded-lg bg-muted p-4">
          <SegmentedChoice
            id={ids.kind}
            legend="What changed?"
            options={options}
            value={change.kind ?? null}
            error={errors.kind}
            onValueChange={(kind) => {
              onTouch('kind');
              onChange({ ...change, changed: true, kind: kind as ChangeKind });
            }}
          />
          <FormField
            label={ITEM_FIELD_LABELS.explanation}
            error={errors.explanation}
            controlId={ids.explanation}
          >
            <Textarea
              rows={3}
              maxLength={1000}
              placeholder={`e.g. ${placeholder}`}
              value={change.explanation ?? ''}
              onBlur={() => {
                onTouch('explanation');
              }}
              onChange={(event) => {
                onChange({ ...change, changed: true, explanation: event.target.value });
              }}
            />
          </FormField>
        </div>
      ) : null}
    </div>
  );
}
