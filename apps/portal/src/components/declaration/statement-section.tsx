import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  CheckboxItem,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldError,
  formatDate,
  formatMoney,
  FormField,
  Icon,
  Input,
  type MoneyInvalidReason,
  Repeater,
  SegmentedChoice,
  Tabs,
  TabsContent,
  TabsCount,
  TabsList,
  TabsTrigger,
  Textarea,
  useToast,
} from '@adili/ui';
import {
  Alert02Icon,
  Attachment01Icon,
  Coins01Icon,
  Globe02Icon,
  Home01Icon,
  InformationCircleIcon,
  Invoice01Icon,
  RefreshIcon,
  Tick02Icon,
  UserMultipleIcon,
} from '@hugeicons/core-free-icons';
import { type ReactNode, useId, useState } from 'react';

import { getDeclarationSection } from '../../server/declarations';
import type { LoadedSection } from '../../server/declarations.server';
import type { AssetItem, Draft, Statement } from '../../declaration/contents';
import {
  AMOUNT_KEY,
  type AnyItem,
  CATEGORIES,
  type Category,
  addJointCopy,
  firstItemIssue,
  isBlankItem,
  type Item,
  ITEM_FIELD_ORDER,
  ITEM_MESSAGES,
  type ItemField,
  itemIssues,
  itemSummary,
  jointCopy,
  NIL_KEY,
  newItem,
  originalCents,
  statementTotal,
  tabState,
} from '../../declaration/statement';
import { CATEGORY_WORDS, changeWord, TYPE_LABELS } from '../../declaration/labels';
import { fullName } from '../../declaration/format';
import { ItemEditor, itemFieldId, type RenderAttachments } from './statement-item-editor';
import { personKeyOf } from '../../declaration/section-key';
import { liveSections, relationLabel } from './steps';
import { useFocusFirstError, useShownErrors } from './section-errors';
import { useSectionAutosave, useWorkspace } from './workspace';

export type { ItemAttachmentSlot, RenderAttachments } from './statement-item-editor';

export const NIL_COPY = "Untick 'Nothing to declare' to add items.";
export const NIL_BLOCKED_COPY = 'Remove the items below first.';
export const SEPARATED_COPY =
  "You declare what you know of a separated spouse's finances. Say so in the statement if you do not know.";

const ICONS = { income: Coins01Icon, assets: Home01Icon, liabilities: Invoice01Icon } as const;
const NEW_TITLES = {
  income: 'New income item',
  assets: 'New asset',
  liabilities: 'New liability',
} as const;

function dateText(iso: string | undefined) {
  return iso ? formatDate(iso) : '-';
}

function typeLabel(category: Category, item: Item) {
  const type = (item as AnyItem).type;
  return type ? TYPE_LABELS[category][type] : undefined;
}

/** The card heading, which also names the card's buttons: "Land: Quarter-acre plot". */
function itemTitle(category: Category, item: Item) {
  const type = typeLabel(category, item) ?? NEW_TITLES[category];
  const description = item.description?.trim();
  return description ? `${type}: ${description}` : type;
}

function sectionRelationship(key: string, separated: boolean) {
  const label = relationLabel(key);
  return label === 'Spouse' && separated ? 'Spouse, separated' : label;
}

export interface StatementSectionProps {
  section: LoadedSection;
  etag: string;
  /** Show every missing answer at once, e.g. when arriving from the summary's list. */
  showErrors?: boolean;
  /** The spouse is separated: declare what is known, and say how much. */
  separated?: boolean;
  /**
   * Slot for #125: renders an item's documents inside its editor (assets and liabilities).
   * Nothing is rendered when omitted.
   */
  renderAttachments?: RenderAttachments;
}

interface Removing {
  category: Category;
  item: Item;
}

/**
 * One person's financial statement (paragraph 8): tabs for income, assets and liabilities,
 * each a list of items or an explicit "Nothing to declare". The two exclude each other: the
 * checkbox is disabled while items exist, and adding is disabled while it is ticked. An item's
 * errors show once its editor was closed, a field was left, or all at once with `showErrors`.
 */
export function StatementSection({
  section,
  etag,
  showErrors = false,
  separated = false,
  renderAttachments,
}: StatementSectionProps) {
  const { declaration } = useWorkspace();
  const { toast } = useToast();
  const {
    value: statement,
    update,
    disabled,
  } = useSectionAutosave<Draft<Statement>>(section, etag);
  const key = section.key;
  const isOfficer = key === 'statement:officer';
  const firstName = statement.personName?.firstName?.trim() ?? '';
  const [tab, setTab] = useState<Category>(() =>
    showErrors ? firstCategoryWithIssues(statement) : 'income',
  );
  // Arriving with errors shown opens the first item to fix.
  const [editing, setEditing] = useState<string | null>(() =>
    showErrors ? (firstIssue(statement, firstCategoryWithIssues(statement))?.id ?? null) : null,
  );
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const { touch, shown } = useShownErrors(showErrors);
  const [badMoney, setBadMoney] = useState<ReadonlyMap<string, MoneyInvalidReason>>(new Map());
  const [removing, setRemoving] = useState<Removing | null>(null);
  const [copying, setCopying] = useState<Draft<AssetItem> | null>(null);

  const statementDate = statement.statementDate ?? declaration.statementDate;
  const period = statement.incomePeriod ?? declaration.incomePeriod;
  const name = fullName(statement.personName);
  const relation = sectionRelationship(key, separated);

  useFocusFirstError(showErrors, () => {
    const first = firstIssue(statement, tab);
    return first ? itemFieldId(first.id, first.field) : null;
  });

  function itemsOf(category: Category): Item[] {
    return statement[category] ?? [];
  }

  function setItems(category: Category, next: (items: Item[]) => Item[]) {
    update((current) => ({ ...current, [category]: next(current[category] ?? []) }));
  }

  function updateItem(category: Category, id: string, next: (item: Item) => Item) {
    setItems(category, (items) => items.map((item) => (item.id === id ? next(item) : item)));
  }

  function removeItem(category: Category, id: string) {
    setItems(category, (items) => items.filter((item) => item.id !== id));
  }

  function mark(id: string) {
    setChecked((current) => (current.has(id) ? current : new Set([...current, id])));
  }

  function showsErrors(id: string) {
    return showErrors || checked.has(id);
  }

  function errorFor(category: Category, item: Item, field: ItemField): string | undefined {
    const id = item.id ?? '';
    const problem =
      field === 'amount' || field === 'originalAmount' ? badMoney.get(`${id}:${field}`) : undefined;
    if (problem === 'negative') return ITEM_MESSAGES.negative;
    if (problem) {
      return field === 'amount' ? ITEM_MESSAGES.amountFormat : ITEM_MESSAGES.originalAmount;
    }
    const message = itemIssues(category, item)[field];
    if (!message) return undefined;
    return checked.has(id) || shown(`${id}:${field}`) ? message : undefined;
  }

  function onEditingChange(category: Category, next: string | null) {
    if (next === null && editing !== null) {
      const closing = itemsOf(category).find((item) => item.id === editing);
      if (closing && isBlankItem(category, closing)) removeItem(category, editing);
      else mark(editing);
    }
    setEditing(next);
  }

  function addItem(category: Category) {
    if (editing !== null) mark(editing);
    const item = newItem(category);
    setItems(category, (items) => [...items, item]);
    setEditing(item.id ?? null);
  }

  function confirmRemove() {
    if (!removing) return;
    const id = removing.item.id ?? '';
    removeItem(removing.category, id);
    if (editing === id) setEditing(null);
    setRemoving(null);
    toast({ title: 'Removed' });
  }

  return (
    <div className="grid gap-5">
      <div className="grid gap-0.5">
        <p className="text-base font-semibold">
          {name || 'Unnamed person'}
          {relation ? ` · ${relation}` : ''}
        </p>
        <p className="text-sm text-muted-foreground">Statement date {formatDate(statementDate)}</p>
      </div>

      {separated ? (
        <Alert variant="neutral">
          <Icon icon={InformationCircleIcon} />
          <AlertDescription>{SEPARATED_COPY}</AlertDescription>
        </Alert>
      ) : null}

      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value as Category);
        }}
      >
        <TabsList aria-label="Parts of the statement">
          {CATEGORIES.map((category) => {
            const state = tabState(statement, category);
            return (
              <TabsTrigger key={category} value={category}>
                {CATEGORY_WORDS[category].tab}
                {state.nil ? (
                  <TabsCount>
                    <Icon icon={Tick02Icon} className="size-3 text-success" />
                    <span className="sr-only">Nothing to declare</span>
                  </TabsCount>
                ) : state.count > 0 ? (
                  <TabsCount>
                    {state.count}
                    <span className="sr-only">{state.count === 1 ? ' item' : ' items'}</span>
                  </TabsCount>
                ) : null}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {CATEGORIES.map((category) => (
          <TabsContent key={category} value={category} className="grid gap-4">
            <CategoryPanel
              category={category}
              statement={statement}
              intro={
                category === 'income'
                  ? `Received ${dateText(period.from)} to ${dateText(period.to)}.`
                  : category === 'assets'
                    ? `Owned on ${formatDate(statementDate)}, in Kenya or abroad, alone or jointly.`
                    : `Owed on ${formatDate(statementDate)}.`
              }
              showErrors={showErrors}
              isOfficer={isOfficer}
              editing={editing}
              disabled={disabled}
              onNilChange={(nil) => {
                update((current) => ({ ...current, [NIL_KEY[category]]: nil }));
              }}
              onEditingChange={(next) => {
                onEditingChange(category, next);
              }}
              onAdd={() => {
                addItem(category);
              }}
              onRemove={(item) => {
                if (isBlankItem(category, item)) removeItem(category, item.id ?? '');
                else setRemoving({ category, item });
              }}
              onCopy={(item) => {
                setCopying(item);
              }}
              showsErrors={showsErrors}
              renderEditor={(item) => (
                <ItemEditor
                  category={category}
                  item={item}
                  sectionKey={key}
                  disabled={disabled}
                  shareLabel={isOfficer ? 'My share' : `${firstName || 'Their'}'s share`}
                  renderAttachments={renderAttachments}
                  onChange={(next) => {
                    updateItem(category, item.id ?? '', next);
                  }}
                  errorFor={(field) => errorFor(category, item, field)}
                  onTouch={(field) => {
                    touch(`${item.id ?? ''}:${field}`);
                  }}
                  onMoneyText={(field, problem) => {
                    const moneyKey = `${item.id ?? ''}:${field}`;
                    setBadMoney((current) => {
                      if ((current.get(moneyKey) ?? null) === problem) return current;
                      const next = new Map(current);
                      if (problem) next.set(moneyKey, problem);
                      else next.delete(moneyKey);
                      return next;
                    });
                  }}
                />
              )}
            />
          </TabsContent>
        ))}
      </Tabs>

      {separated ? (
        <FormField
          label={
            <>
              The extent of your knowledge of their affairs{' '}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </>
          }
          hint="For example, that you do not know their income since you separated."
        >
          <Textarea
            rows={3}
            maxLength={1000}
            value={statement.knowledgeLimitation ?? ''}
            onChange={(event) => {
              const knowledgeLimitation = event.target.value;
              update((current) => ({ ...current, knowledgeLimitation }));
            }}
          />
        </FormField>
      ) : null}

      <RemoveDialog
        removing={removing}
        whose={isOfficer ? 'your' : `${firstName || 'their'}'s`}
        onCancel={() => {
          setRemoving(null);
        }}
        onConfirm={confirmRemove}
      />
      <AlsoDeclareDialog
        item={copying}
        sectionKey={key}
        isOfficer={isOfficer}
        onClose={() => {
          setCopying(null);
        }}
        onCopied={(source) => {
          updateItem('assets', source.id ?? '', () => source);
        }}
      />
    </div>
  );
}

function firstCategoryWithIssues(statement: Draft<Statement>): Category {
  return (
    CATEGORIES.find((category) => {
      const items: Item[] = statement[category] ?? [];
      if (items.length === 0) return statement[NIL_KEY[category]] !== true;
      return items.some((item) => firstItemIssue(category, item) !== null);
    }) ?? 'income'
  );
}

/** The first item in a category with something to fix, and the field. */
function firstIssue(
  statement: Draft<Statement>,
  category: Category,
): { id: string; field: ItemField } | null {
  const items: Item[] = statement[category] ?? [];
  for (const item of items) {
    const issues = itemIssues(category, item);
    const field = ITEM_FIELD_ORDER[category].find((candidate) => issues[candidate]);
    if (field && item.id) return { id: item.id, field };
  }
  return null;
}

interface CategoryPanelProps {
  category: Category;
  statement: Draft<Statement>;
  intro: string;
  showErrors: boolean;
  isOfficer: boolean;
  editing: string | null;
  disabled: boolean;
  onNilChange: (nil: boolean) => void;
  onEditingChange: (next: string | null) => void;
  onAdd: () => void;
  onRemove: (item: Item) => void;
  onCopy: (item: Draft<AssetItem>) => void;
  showsErrors: (id: string) => boolean;
  renderEditor: (item: Item) => ReactNode;
}

function CategoryPanel({
  category,
  statement,
  intro,
  showErrors,
  isOfficer,
  editing,
  disabled,
  onNilChange,
  onEditingChange,
  onAdd,
  onRemove,
  onCopy,
  showsErrors,
  renderEditor,
}: CategoryPanelProps) {
  const items: Item[] = statement[category] ?? [];
  const nil = statement[NIL_KEY[category]] === true;
  const words = CATEGORY_WORDS[category];
  const total = statementTotal(statement, category);
  const unanswered = items.length === 0 && !nil;

  return (
    <>
      <p className="text-sm text-muted-foreground">{intro}</p>
      <div className="grid gap-1.5">
        <CheckboxItem
          label="Nothing to declare"
          checked={nil}
          disabled={disabled || items.length > 0}
          hint={items.length > 0 ? NIL_BLOCKED_COPY : nil ? NIL_COPY : undefined}
          onChange={(event) => {
            onNilChange(event.target.checked);
          }}
        />
        {showErrors && unanswered ? (
          <FieldError>{`Add at least one ${words.one}, or tick "Nothing to declare".`}</FieldError>
        ) : null}
      </div>

      <Repeater<Item>
        label={words.tab}
        items={items}
        getKey={(item) => item.id ?? ''}
        getTitle={(item) => itemTitle(category, item)}
        icon={ICONS[category]}
        editingKey={editing !== null && items.some((item) => item.id === editing) ? editing : null}
        onEditingKeyChange={onEditingChange}
        onAdd={onAdd}
        addLabel={words.add}
        onRemove={onRemove}
        {...(category === 'assets'
          ? {
              onDuplicate: (item: Item) => {
                onCopy(item as Draft<AssetItem>);
              },
            }
          : {})}
        actionLabels={{ duplicate: (title) => `Also declare ${title} for…` }}
        disabled={disabled || nil}
        renderDescription={(item) => (
          <ItemCardDetails
            category={category}
            item={item}
            isOfficer={isOfficer}
            issue={
              showsErrors(item.id ?? '') && editing !== item.id
                ? firstItemIssue(category, item)
                : null
            }
          />
        )}
        renderAside={(item) => {
          const cents = (item as AnyItem)[AMOUNT_KEY[category]]?.kesCents;
          return (
            <span className="grid">
              {cents === undefined ? '-' : formatMoney(cents, { currency: 'KES' })}
              {category === 'assets' && (item as AnyItem).joint?.isJoint ? (
                <span className="text-xs font-normal text-muted-foreground">whole value</span>
              ) : null}
            </span>
          );
        }}
        renderEditor={renderEditor}
      />

      {items.length > 0 ? (
        <p className="flex flex-wrap justify-between gap-2 border-t border-border pt-3 text-sm">
          <span className="text-secondary-foreground">
            Total {words.lower} declared{total.abroad ? ' (KES estimates)' : ''}
          </span>
          <span className="font-semibold tabular-nums">
            {formatMoney(total.cents, { currency: 'KES' })}
          </span>
        </p>
      ) : null}
    </>
  );
}

function ItemCardDetails({
  category,
  item,
  isOfficer,
  issue,
}: {
  category: Category;
  item: Item;
  isOfficer: boolean;
  issue: string | null;
}) {
  const any = item as AnyItem;
  const description = item.description?.trim();
  const parts = itemSummary(category, item).filter((part) => part !== description);
  const money = any[AMOUNT_KEY[category]];
  const original = money?.original;
  const originalAmount = originalCents(money);
  const documents = any.attachments?.length ?? 0;
  const tags: ReactNode[] = [];

  if (category === 'assets' && any.joint?.isJoint) {
    tags.push(
      <Badge key="joint">
        <Icon icon={UserMultipleIcon} />
        {`Joint · ${isOfficer ? 'my' : 'their'} share ${any.joint.sharePercent === undefined ? '?' : String(any.joint.sharePercent)}%`}
      </Badge>,
    );
  }
  if (any.location?.inKenya === false) {
    tags.push(
      <Badge key="abroad" variant="info">
        <Icon icon={Globe02Icon} />
        {`Outside Kenya${original?.currency && originalAmount !== null ? ` · ${original.currency} ${formatMoney(originalAmount)}` : ''}`}
      </Badge>,
    );
  }
  if (any.change?.changed) {
    tags.push(
      <Badge key="change" variant="brand">
        <Icon icon={RefreshIcon} />
        {`Changed: ${any.change.kind ? changeWord(category, any.change.kind) : 'kind not chosen'}`}
      </Badge>,
    );
  }
  if (documents > 0) {
    tags.push(
      <Badge key="documents">
        <Icon icon={Attachment01Icon} />
        {documents === 1 ? '1 document' : `${String(documents)} documents`}
      </Badge>,
    );
  }
  if (issue) {
    tags.push(
      <Badge key="issue" variant="warning">
        <Icon icon={Alert02Icon} />
        {issue}
      </Badge>,
    );
  }

  return (
    <span className="grid gap-1.5">
      <span>
        {parts.length > 0 ? parts.join(' · ') : description ? null : 'No description yet'}
      </span>
      {tags.length > 0 ? <span className="flex flex-wrap gap-1.5">{tags}</span> : null}
    </span>
  );
}

function RemoveDialog({
  removing,
  whose,
  onCancel,
  onConfirm,
}: {
  removing: Removing | null;
  whose: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const category = removing?.category ?? 'income';
  const item = removing?.item;
  const withDocuments = (item?.attachments?.length ?? 0) > 0;
  return (
    <Dialog
      open={removing !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`Remove this ${CATEGORY_WORDS[category].one}?`}</DialogTitle>
          <DialogDescription>
            <strong className="font-medium text-foreground">
              {item ? itemTitle(category, item) : ''}
            </strong>
            {` will be removed from ${whose} statement${withDocuments ? ', with its documents' : ''}.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm}>
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AlsoDeclareDialog({
  item,
  sectionKey,
  isOfficer,
  onClose,
  onCopied,
}: {
  item: Draft<AssetItem> | null;
  sectionKey: string;
  isOfficer: boolean;
  onClose: () => void;
  onCopied: (source: Draft<AssetItem>) => void;
}) {
  const { declaration, edit, flush } = useWorkspace();
  const { toast } = useToast();
  const persons = liveSections(declaration.sections)
    .filter((section) => personKeyOf(section.key) !== null && section.key !== sectionKey)
    .map((section) => ({
      key: section.key,
      name: section.personName ?? 'Unnamed person',
      relation: relationLabel(section.key),
    }));
  const theirShareId = useId();
  const [target, setTarget] = useState<string | null>(null);
  const [share, setShare] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // A new item to copy: start from its share, or half.
  const [seen, setSeen] = useState(item);
  if (seen !== item) {
    setSeen(item);
    setTarget(persons[0]?.key ?? null);
    setShare(String(item?.joint?.isJoint ? (item.joint.sharePercent ?? 50) : 50));
    setFailed(false);
  }

  const mine = Number(share);
  const valid = share !== '' && mine > 0 && mine < 100;
  const chosen = persons.find((person) => person.key === target);

  async function confirm() {
    if (!item || !chosen || !valid) return;
    setBusy(true);
    setFailed(false);
    try {
      const result = await getDeclarationSection({
        data: { declarationId: declaration.id, sectionKey: chosen.key },
      });
      if (result.status !== 'ok') {
        setFailed(true);
        return;
      }
      const { source, copy } = jointCopy(item, mine);
      onCopied(source);
      edit(chosen.key, addJointCopy(result.section.contents, copy));
      flush(chosen.key);
      const whose =
        chosen.key === 'statement:officer'
          ? 'your'
          : `${chosen.name.split(/\s+/)[0] ?? chosen.name}'s`;
      toast({
        title: `Added to ${whose} statement as jointly held (${String(100 - mine)}%)`,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const title = item ? itemTitle('assets', item) : '';

  return (
    <Dialog
      open={item !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent busy={busy}>
        <DialogHeader>
          <DialogTitle>Also declare for…</DialogTitle>
          <DialogDescription>{title}</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          {persons.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No one else to add it for. Add a spouse or child first.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Added to their statement as jointly held, with the other share.
              </p>
              <SegmentedChoice
                legend="Whose statement?"
                options={persons.map((person) => ({
                  value: person.key,
                  label: person.relation ? `${person.name} · ${person.relation}` : person.name,
                }))}
                value={target}
                onValueChange={setTarget}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  label={isOfficer ? 'My share' : 'Share on this statement'}
                  error={share !== '' && !valid ? 'Enter a share from 1 to 99.' : undefined}
                >
                  <Input
                    inputMode="numeric"
                    maxLength={3}
                    value={share}
                    onChange={(event) => {
                      setShare(event.target.value.replace(/\D/g, ''));
                    }}
                  />
                </FormField>
                <div className="grid content-start gap-1.5">
                  <span
                    id={theirShareId}
                    className="text-sm leading-5 font-medium text-secondary-foreground"
                  >
                    Their share
                  </span>
                  <output
                    aria-labelledby={theirShareId}
                    className="flex h-10 items-center text-sm font-medium tabular-nums"
                  >
                    {valid ? `${String(100 - mine)}%` : '-'}
                  </output>
                </div>
              </div>
              {failed ? <FieldError>We could not add it just now. Try again.</FieldError> : null}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          {persons.length > 0 ? (
            <Button
              type="button"
              disabled={!valid || !chosen || busy}
              onClick={() => {
                void confirm();
              }}
            >
              Add as jointly held
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
