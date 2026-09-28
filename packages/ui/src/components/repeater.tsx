import {
  Copy01Icon,
  Delete02Icon,
  PencilEdit02Icon,
  PlusSignIcon,
} from '@hugeicons/core-free-icons';
import { type ComponentProps, type ReactNode, useEffect, useId, useRef } from 'react';

import { cn } from '../lib/cn';
import { Button } from './button';
import { Icon, type IconProps } from './icon';

export interface RepeaterActionLabels {
  /** Defaults to "Edit {title}". */
  edit?: (title: string) => string;
  /** Defaults to "Duplicate {title}". */
  duplicate?: (title: string) => string;
  /** Defaults to "Remove {title}". */
  remove?: (title: string) => string;
}

export type RepeaterProps<T> = Omit<ComponentProps<'div'>, 'children'> & {
  /** Names the list, e.g. "Spouses". */
  label: string;
  items: T[];
  /** A stable key for an item. */
  getKey: (item: T) => string;
  /** The card's heading, and the name its actions carry, e.g. "Mary Wanjiru Kennedy". */
  getTitle: (item: T, index: number) => string;
  /** A line under the title, e.g. "Spouse 1" or the item type. */
  renderDescription?: (item: T, index: number) => ReactNode;
  /** Shown at the end of the summary row, e.g. an amount. */
  renderAside?: (item: T, index: number) => ReactNode;
  /** The item's fields, shown while it is being edited. */
  renderEditor: (item: T, index: number) => ReactNode;
  /** Key of the item being edited, or null. */
  editingKey: string | null;
  onEditingKeyChange: (key: string | null) => void;
  /** Adds an item; set editingKey to open it. */
  onAdd: () => void;
  /** Names the add button, e.g. "Add a spouse". */
  addLabel: string;
  /** Removes an item. Confirm first in the caller when removal loses work. */
  onRemove: (item: T, index: number) => void;
  /** Shows a duplicate action when set, e.g. copying a joint asset to another person. */
  onDuplicate?: (item: T, index: number) => void;
  actionLabels?: RepeaterActionLabels;
  /** Names the button that closes the editor. Defaults to "Done". */
  doneLabel?: string;
  /** Shown when there are no items. */
  emptyText?: ReactNode;
  /** Shown in each card's icon well. */
  icon?: IconProps['icon'];
  /** Heading level of each card title. Defaults to 3. */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  /** Disables adding and every action, e.g. while "Nothing to declare" is ticked. */
  disabled?: boolean;
};

/**
 * A list of cards the user adds, edits, duplicates and removes, e.g. spouses or assets. Each
 * card has a heading, and its buttons are named after the item ("Remove Mary Wanjiru
 * Kennedy"). Opening a card moves focus to its first field; removing one moves focus to the
 * add button so it is not lost. Items and the open card are controlled by the caller.
 */
export function Repeater<T>({
  label,
  items,
  getKey,
  getTitle,
  renderDescription,
  renderAside,
  renderEditor,
  editingKey,
  onEditingKeyChange,
  onAdd,
  addLabel,
  onRemove,
  onDuplicate,
  actionLabels,
  doneLabel = 'Done',
  emptyText,
  icon,
  headingLevel = 3,
  disabled = false,
  className,
  ...props
}: RepeaterProps<T>) {
  const baseId = useId();
  const addRef = useRef<HTMLButtonElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const previousCount = useRef(items.length);
  const Heading = `h${String(headingLevel)}` as 'h3';
  const editLabel = actionLabels?.edit ?? ((title: string) => `Edit ${title}`);
  const duplicateLabel = actionLabels?.duplicate ?? ((title: string) => `Duplicate ${title}`);
  const removeLabel = actionLabels?.remove ?? ((title: string) => `Remove ${title}`);

  // A removed card takes its focused button with it; send focus to the add button instead.
  useEffect(() => {
    const removed = items.length < previousCount.current;
    previousCount.current = items.length;
    const active = document.activeElement;
    if (removed && (active === null || active === document.body)) addRef.current?.focus();
  }, [items.length]);

  // Opening a card moves focus to its first field; closing it with Done returns focus to its
  // edit button.
  const previousEditing = useRef(editingKey);
  useEffect(() => {
    const closed = previousEditing.current;
    previousEditing.current = editingKey;
    if (editingKey !== null) {
      editorRef.current
        ?.querySelector<HTMLElement>(
          'input, select, textarea, button, [tabindex]:not([tabindex="-1"])',
        )
        ?.focus();
      return;
    }
    const active = document.activeElement;
    if (closed !== null && (active === null || active === document.body)) {
      const buttons = listRef.current?.querySelectorAll<HTMLElement>('[data-edit-for]') ?? [];
      Array.from(buttons)
        .find((button) => button.dataset.editFor === closed)
        ?.focus();
    }
  }, [editingKey]);

  return (
    <div className={cn('grid gap-2.5', className)} {...props}>
      {items.length === 0 && emptyText ? (
        <p className="rounded-2xl bg-muted px-4 py-5 text-center text-sm text-muted-foreground">
          {emptyText}
        </p>
      ) : null}
      {items.length > 0 ? (
        <ul ref={listRef} aria-label={label} className="grid gap-2.5">
          {items.map((item, index) => {
            const key = getKey(item);
            const title = getTitle(item, index);
            const editing = key === editingKey;
            const editorId = `${baseId}-${key}-editor`;
            const description = renderDescription?.(item, index);
            const aside = renderAside?.(item, index);

            return (
              <li
                key={key}
                data-editing={editing || undefined}
                className="rounded-item bg-card shadow-card data-editing:shadow-card-editing"
              >
                <div className="flex items-center gap-3 px-4 py-3.5">
                  {icon ? (
                    <span className="grid size-[38px] shrink-0 place-items-center rounded-lg bg-muted text-secondary-foreground max-sm:self-start">
                      <Icon icon={icon} className="size-[17px]" />
                    </span>
                  ) : null}
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5">
                    <div className="min-w-0 flex-1 basis-48">
                      <Heading className="text-[15px] leading-snug font-medium">{title}</Heading>
                      {description ? (
                        <div className="mt-px text-[13px] leading-snug text-muted-foreground">
                          {description}
                        </div>
                      ) : null}
                    </div>
                    {aside ? (
                      <div className="text-[14.5px] font-semibold whitespace-nowrap tabular-nums sm:text-right">
                        {aside}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-0.5 max-sm:self-start">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={editLabel(title)}
                      data-edit-for={key}
                      aria-expanded={editing}
                      aria-controls={editing ? editorId : undefined}
                      disabled={disabled}
                      onClick={() => {
                        onEditingKeyChange(editing ? null : key);
                      }}
                    >
                      <Icon icon={PencilEdit02Icon} />
                    </Button>
                    {onDuplicate ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={duplicateLabel(title)}
                        disabled={disabled}
                        onClick={() => {
                          onDuplicate(item, index);
                        }}
                      >
                        <Icon icon={Copy01Icon} />
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={removeLabel(title)}
                      disabled={disabled}
                      onClick={() => {
                        onRemove(item, index);
                      }}
                    >
                      <Icon icon={Delete02Icon} />
                    </Button>
                  </div>
                </div>
                {editing ? (
                  <div
                    ref={editorRef}
                    id={editorId}
                    role="group"
                    aria-label={title}
                    className="grid gap-4 border-t border-border px-4 pt-4 pb-4"
                  >
                    {renderEditor(item, index)}
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          onEditingKeyChange(null);
                        }}
                      >
                        {doneLabel}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      <button
        ref={addRef}
        type="button"
        disabled={disabled}
        onClick={onAdd}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-item border-[1.5px] border-dashed border-input text-sm font-medium text-secondary-foreground outline-none hover:border-foreground hover:bg-brand-faint hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:border-input disabled:hover:bg-transparent"
      >
        <Icon icon={PlusSignIcon} />
        {addLabel}
      </button>
    </div>
  );
}
