import {
  CheckboxItem,
  CountrySelect,
  CountySelect,
  FormField,
  Icon,
  Input,
  MoneyInput,
  type MoneyInvalidReason,
  PercentInput,
  SegmentedChoice,
  Select,
  SelectItem,
  Textarea,
} from '@adili/ui';
import { LockIcon } from '@hugeicons/core-free-icons';
import type { ReactNode } from 'react';

import type { AssetItem, Attachment, Draft, Location, Money } from '../../declaration/contents';
import type { JsonObject } from '../../server/declarations.server';
import {
  AMOUNT_KEY,
  type AnyItem,
  type Category,
  centsToMinorUnits,
  CURRENCIES,
  currencyLabel,
  type Item,
  type ItemField,
  originalCents,
  withCurrency,
} from '../../declaration/statement';
import { DETAIL_FIELD_LABELS, ITEM_FIELD_LABELS } from '../../declaration/field-labels';
import { CATEGORY_WORDS, CHANGE_KIND_OPTIONS, TYPE_LABELS } from '../../declaration/labels';
import { optionalLabel } from './optional-label';

/**
 * Where #125 mounts the AttachmentList for an item. Called for assets and liabilities (the
 * spec lists attachments on those two), inside the item editor after the change flag.
 */
export interface ItemAttachmentSlot {
  sectionKey: string;
  category: 'assets' | 'liabilities';
  itemId: string;
  /** "asset" or "liability", e.g. for "Add a document to this asset". */
  itemNoun: string;
  attachments: Draft<Attachment>[];
  /** Replaces the item's attachments in the screen's state and queues a save of the section. */
  setAttachments: (next: Attachment[]) => void;
  /** Editing is off, e.g. after a conflict. */
  disabled: boolean;
  /** The item's type, e.g. `vehicle`: what a document read into the form is read as (#316). */
  itemType?: string | undefined;
  /** The item as on screen, to show what reading a document into it would change. */
  item?: unknown;
  /** Takes the item an accept added or filled, from the section as read back (#316). */
  onAccepted?: (itemId: string, contents: JsonObject) => void;
}

export type RenderAttachments = (slot: ItemAttachmentSlot) => ReactNode;

/** The id of an item field's control, so focus can move to the first one to fix. */
export function itemFieldId(itemId: string, field: string) {
  return `item-${itemId}-${field}`;
}

const COPY = {
  income: {
    type: 'Type of income',
    description: 'e.g. Rent from 2 units in Kapsoya',
    amount: 'Approximate amount for the period',
    amountHint: 'In KES, before tax. A rough figure is fine.',
    abroad: 'This income is from outside Kenya',
  },
  assets: {
    type: 'Type of asset',
    description: 'e.g. Quarter-acre residential plot, Kapsoya',
    amount: 'Approximate value as at the statement date',
    amountHint: 'In KES. What it would sell for. The whole value, even if shared.',
    abroad: '',
  },
  liabilities: {
    type: 'Type of liability',
    description: 'e.g. Construction loan on the Kapsoya plot',
    amount: 'Outstanding amount as at the statement date',
    amountHint: 'In KES, as on your loan statement.',
    abroad: 'This is owed outside Kenya',
  },
} as const;

const CO_OWNERS = ['Spouse', 'Child', 'Other relative', 'Business partner', 'Other'];

type AssetDetails = NonNullable<Draft<AssetItem>['details']>;

interface DetailField {
  key: keyof AssetDetails;
  label: string;
  placeholder: string;
  maxLength: number;
  hint?: string;
  optional?: boolean;
}

/** The fields a type of asset adds, shown right after the type in DOM order. */
const ASSET_DETAILS: Partial<Record<string, DetailField[]>> = {
  land: [
    {
      key: 'parcelNumber',
      label: DETAIL_FIELD_LABELS.parcelNumber,
      placeholder: 'e.g. Eldoret Municipality Block 7/1234',
      maxLength: 100,
      hint: 'As on the title deed.',
    },
    {
      key: 'size',
      label: DETAIL_FIELD_LABELS.size,
      placeholder: 'e.g. 0.25 acres',
      maxLength: 50,
      optional: true,
    },
  ],
  vehicle: [
    {
      key: 'registration',
      label: DETAIL_FIELD_LABELS.registration,
      placeholder: 'e.g. KDA 123X',
      maxLength: 20,
    },
    {
      key: 'makeModel',
      label: DETAIL_FIELD_LABELS.makeModel,
      placeholder: 'e.g. Toyota Fielder, 2014',
      maxLength: 100,
    },
  ],
  securities: [
    {
      key: 'issuer',
      label: DETAIL_FIELD_LABELS.issuer,
      placeholder: 'e.g. Safaricom PLC',
      maxLength: 200,
    },
    {
      key: 'quantityOrPercent',
      label: DETAIL_FIELD_LABELS.quantityOrPercent,
      placeholder: 'e.g. 20,000 shares or 5%',
      maxLength: 50,
    },
  ],
  'bank-account': [
    {
      key: 'institution',
      label: DETAIL_FIELD_LABELS.institution,
      placeholder: 'e.g. KCB Bank, Mwalimu SACCO, M-Pesa',
      maxLength: 200,
    },
    {
      key: 'accountType',
      label: DETAIL_FIELD_LABELS.accountType,
      placeholder: 'e.g. Savings, current, fixed deposit',
      maxLength: 50,
    },
  ],
  receivable: [
    {
      key: 'debtor',
      label: DETAIL_FIELD_LABELS.debtor,
      placeholder: 'Who owes you, e.g. Peter Kennedy (brother)',
      maxLength: 200,
    },
  ],
};
ASSET_DETAILS.building = ASSET_DETAILS.land;
ASSET_DETAILS.shareholding = ASSET_DETAILS.securities;

export interface ItemEditorProps {
  category: Category;
  item: Item;
  sectionKey: string;
  onChange: (next: (item: Item) => Item) => void;
  /** The message to show for a field now, or undefined. */
  errorFor: (field: ItemField) => string | undefined;
  onTouch: (field: ItemField) => void;
  /** Reports text in a money field that is not an amount, so the screen can say so. */
  /** A money field's text is not an amount (null when it is), and why. */
  onMoneyText: (field: 'amount' | 'originalAmount', problem: MoneyInvalidReason | null) => void;
  /** "My share", or "Mary's share" on someone else's statement. */
  shareLabel: string;
  disabled: boolean;
  renderAttachments?: RenderAttachments | undefined;
}

/**
 * One income, asset or liability item's fields. The type comes first; the fields a type adds
 * follow it in DOM order, then the fields every item has, the foreign amount, joint holding
 * and the change flag.
 */
export function ItemEditor({
  category,
  item,
  sectionKey,
  onChange,
  errorFor,
  onTouch,
  onMoneyText,
  shareLabel,
  disabled,
  renderAttachments,
}: ItemEditorProps) {
  const anyItem = item as AnyItem;
  const id = anyItem.id ?? '';
  const copy = COPY[category];
  const amountKey = AMOUNT_KEY[category];
  const money: Draft<Money> = anyItem[amountKey] ?? {};
  const location: Draft<Location> = anyItem.location ?? { inKenya: true };
  const abroad = location.inKenya === false;
  const fid = (field: string) => itemFieldId(id, field);

  const set = (patch: (current: AnyItem) => AnyItem) => {
    onChange((current) => patch(current));
  };
  const setMoney = (next: (current: Draft<Money>) => Draft<Money>) => {
    set((current) => ({ ...current, [amountKey]: next(current[amountKey] ?? {}) }));
  };
  const setLocation = (next: Draft<Location>) => {
    set((current) => {
      const updated: AnyItem = { ...current, location: next };
      // Back in Kenya: the original currency amount no longer applies.
      if (next.inKenya) {
        const kept = { ...current[amountKey] };
        delete kept.original;
        updated[amountKey] = kept;
      }
      return updated;
    });
  };
  const setDetail = (key: keyof AssetDetails, value: string) => {
    set((current) => ({ ...current, details: { ...current.details, [key]: value } }));
  };

  const type = (
    <SegmentedChoice
      id={fid('type')}
      legend={copy.type}
      options={Object.entries(TYPE_LABELS[category]).map(([value, label]) => ({ value, label }))}
      value={anyItem.type ?? null}
      error={errorFor('type')}
      onValueChange={(value) => {
        onTouch('type');
        set((current) => ({ ...current, type: value as AnyItem['type'] }));
      }}
    />
  );

  if (!anyItem.type) {
    return (
      <div className="grid gap-4">
        {type}
        <p className="text-sm text-muted-foreground">Choose a type first.</p>
      </div>
    );
  }

  const details = category === 'assets' ? (ASSET_DETAILS[anyItem.type] ?? []) : [];

  return (
    <div className="grid gap-5">
      {type}

      {details.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {details.map((field) => (
            <FormField
              key={field.key}
              label={field.optional ? optionalLabel(field.label) : field.label}
              hint={field.hint}
              controlId={fid(field.key)}
            >
              <Input
                value={anyItem.details?.[field.key] ?? ''}
                maxLength={field.maxLength}
                placeholder={field.placeholder}
                onChange={(event) => {
                  const value =
                    field.key === 'registration'
                      ? event.target.value.toUpperCase()
                      : event.target.value;
                  setDetail(field.key, value);
                }}
              />
            </FormField>
          ))}
          {anyItem.type === 'bank-account' ? (
            <p className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-secondary-foreground sm:col-span-2">
              <Icon icon={LockIcon} className="size-4 shrink-0" />
              Do not enter account numbers.
            </p>
          ) : null}
        </div>
      ) : null}

      <FormField
        label={ITEM_FIELD_LABELS.description}
        error={errorFor('description')}
        controlId={fid('description')}
      >
        <Input
          value={anyItem.description ?? ''}
          maxLength={200}
          placeholder={copy.description}
          onBlur={() => {
            onTouch('description');
          }}
          onChange={(event) => {
            const description = event.target.value;
            set((current) => ({ ...current, description }));
          }}
        />
      </FormField>

      {category === 'liabilities' ? (
        <FormField
          label={ITEM_FIELD_LABELS.creditor}
          error={errorFor('creditor')}
          controlId={fid('creditor')}
        >
          <Input
            value={anyItem.creditor ?? ''}
            maxLength={200}
            placeholder="Who you owe, e.g. HFC Bank, Mwalimu SACCO"
            onBlur={() => {
              onTouch('creditor');
            }}
            onChange={(event) => {
              const creditor = event.target.value;
              set((current) => ({ ...current, creditor }));
            }}
          />
        </FormField>
      ) : null}

      {category === 'assets' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <SegmentedChoice
            id={fid('location')}
            legend={ITEM_FIELD_LABELS.location}
            options={[
              { value: 'kenya', label: 'In Kenya' },
              { value: 'abroad', label: 'Outside Kenya' },
            ]}
            value={abroad ? 'abroad' : 'kenya'}
            onValueChange={(value) => {
              setLocation(
                value === 'abroad'
                  ? { inKenya: false, country: location.country }
                  : { inKenya: true, county: location.county },
              );
            }}
          />
          {abroad ? (
            <FormField
              label={ITEM_FIELD_LABELS.country}
              error={errorFor('country')}
              controlId={fid('country')}
            >
              <CountrySelect
                exclude={['KE']}
                value={location.country ?? null}
                onBlur={() => {
                  onTouch('country');
                }}
                onValueChange={(country) => {
                  onTouch('country');
                  setLocation({ ...location, country: country ?? undefined });
                }}
              />
            </FormField>
          ) : (
            <FormField
              label={ITEM_FIELD_LABELS.county}
              error={errorFor('county')}
              controlId={fid('county')}
            >
              <CountySelect
                value={location.county ?? null}
                onBlur={() => {
                  onTouch('county');
                }}
                onValueChange={(county) => {
                  onTouch('county');
                  setLocation({ ...location, county: county ?? undefined });
                }}
              />
            </FormField>
          )}
        </div>
      ) : null}

      <FormField
        label={copy.amount}
        hint={copy.amountHint}
        error={errorFor('amount')}
        controlId={fid('amount')}
      >
        <MoneyInput
          value={money.kesCents ?? null}
          onBlur={() => {
            onTouch('amount');
          }}
          onValueChange={(cents, { reason }) => {
            onMoneyText('amount', reason ?? null);
            setMoney((current) => ({ ...current, kesCents: cents ?? undefined }));
          }}
        />
      </FormField>

      {category !== 'assets' ? (
        <div className="grid gap-3">
          <CheckboxItem
            label={copy.abroad}
            checked={abroad}
            onChange={(event) => {
              setLocation(
                event.target.checked
                  ? { inKenya: false, country: location.country }
                  : { inKenya: true },
              );
            }}
          />
          {abroad ? (
            <div className="ml-7 rounded-lg bg-muted p-4">
              <FormField
                label={ITEM_FIELD_LABELS.country}
                error={errorFor('country')}
                controlId={fid('country')}
              >
                <CountrySelect
                  exclude={['KE']}
                  value={location.country ?? null}
                  onBlur={() => {
                    onTouch('country');
                  }}
                  onValueChange={(country) => {
                    onTouch('country');
                    setLocation({ ...location, country: country ?? undefined });
                  }}
                />
              </FormField>
            </div>
          ) : null}
        </div>
      ) : null}

      {abroad ? (
        <div className="grid gap-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label={optionalLabel('Original currency')}
              error={errorFor('originalCurrency')}
              controlId={fid('originalCurrency')}
            >
              <Select
                placeholder="Currency"
                value={money.original?.currency ?? ''}
                onValueChange={(currency) => {
                  onTouch('originalCurrency');
                  setMoney((current) => withCurrency(current, currency));
                }}
              >
                {[
                  ...CURRENCIES,
                  ...(money.original?.currency &&
                  !(CURRENCIES as readonly string[]).includes(money.original.currency)
                    ? [money.original.currency]
                    : []),
                ].map((code) => (
                  <SelectItem key={code} value={code}>
                    {currencyLabel(code)}
                  </SelectItem>
                ))}
              </Select>
            </FormField>
            <FormField
              label={optionalLabel('Original amount')}
              error={errorFor('originalAmount')}
              controlId={fid('originalAmount')}
            >
              <MoneyInput
                currency={money.original?.currency ?? '···'}
                value={originalCents(money)}
                onBlur={() => {
                  onTouch('originalAmount');
                }}
                onValueChange={(cents, { reason }) => {
                  onMoneyText('originalAmount', reason ?? null);
                  setMoney((current) => {
                    const currency = current.original?.currency;
                    const original = { ...current.original };
                    if (cents === null) delete original.minorUnits;
                    else original.minorUnits = centsToMinorUnits(cents, currency ?? 'USD');
                    const next: Draft<Money> = { ...current, original };
                    if (original.currency === undefined && original.minorUnits === undefined) {
                      delete next.original;
                    }
                    return next;
                  });
                }}
              />
            </FormField>
          </div>
          <p className="text-[13px] text-muted-foreground">No exact conversion needed.</p>
        </div>
      ) : null}

      {category === 'assets' ? (
        <div className="grid gap-3">
          <CheckboxItem
            label={ITEM_FIELD_LABELS.joint}
            checked={anyItem.joint?.isJoint === true}
            onChange={(event) => {
              const isJoint = event.target.checked;
              set((current) => ({
                ...current,
                joint: isJoint ? { ...current.joint, isJoint } : { isJoint: false },
              }));
            }}
          />
          {anyItem.joint?.isJoint ? (
            <div className="ml-7 grid gap-4 rounded-lg bg-muted p-4 sm:grid-cols-2">
              <FormField label={shareLabel} error={errorFor('share')} controlId={fid('share')}>
                <PercentInput
                  value={anyItem.joint.sharePercent ?? null}
                  placeholder="50"
                  onBlur={() => {
                    onTouch('share');
                  }}
                  onValueChange={(share) => {
                    const sharePercent = share ?? undefined;
                    set((current) => ({
                      ...current,
                      joint: { ...current.joint, isJoint: true, sharePercent },
                    }));
                  }}
                />
              </FormField>
              <FormField
                label={optionalLabel(ITEM_FIELD_LABELS.coOwner)}
                controlId={fid('coOwner')}
              >
                <Select
                  placeholder="Choose one"
                  value={anyItem.joint.coOwner ?? ''}
                  onValueChange={(coOwner) => {
                    set((current) => ({
                      ...current,
                      joint: { ...current.joint, isJoint: true, coOwner },
                    }));
                  }}
                >
                  {CO_OWNERS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </Select>
              </FormField>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-3">
        <CheckboxItem
          label={ITEM_FIELD_LABELS.change}
          hint="Value up or down 25% or more, acquired, disposed of or settled."
          checked={anyItem.change?.changed === true}
          onChange={(event) => {
            const changed = event.target.checked;
            set((current) => ({
              ...current,
              change: changed ? { ...current.change, changed } : { changed: false },
            }));
          }}
        />
        {anyItem.change?.changed ? (
          <div className="ml-7 grid gap-4 rounded-lg bg-muted p-4">
            <SegmentedChoice
              id={fid('changeKind')}
              legend="What changed?"
              options={CHANGE_KIND_OPTIONS[category]}
              value={anyItem.change.kind ?? null}
              error={errorFor('changeKind')}
              onValueChange={(kind) => {
                onTouch('changeKind');
                set((current) => ({
                  ...current,
                  change: {
                    ...current.change,
                    changed: true,
                    kind: kind as NonNullable<AnyItem['change']>['kind'],
                  },
                }));
              }}
            />
            <FormField
              label={ITEM_FIELD_LABELS.explanation}
              error={errorFor('explanation')}
              controlId={fid('explanation')}
            >
              <Textarea
                rows={3}
                maxLength={1000}
                placeholder="e.g. Bought in January 2026 with savings and a SACCO loan."
                value={anyItem.change.explanation ?? ''}
                onBlur={() => {
                  onTouch('explanation');
                }}
                onChange={(event) => {
                  const explanation = event.target.value;
                  set((current) => ({
                    ...current,
                    change: { ...current.change, changed: true, explanation },
                  }));
                }}
              />
            </FormField>
          </div>
        ) : null}
      </div>

      {category !== 'income' && renderAttachments
        ? renderAttachments({
            sectionKey,
            category,
            itemId: id,
            itemNoun: CATEGORY_WORDS[category].one,
            attachments: anyItem.attachments ?? [],
            setAttachments: (attachments) => {
              set((current) => ({ ...current, attachments }));
            },
            disabled,
            itemType: anyItem.type,
            item,
          })
        : null}
    </div>
  );
}
