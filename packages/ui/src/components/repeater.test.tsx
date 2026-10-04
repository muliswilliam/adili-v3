import { Building03Icon, Home01Icon, UserGroupIcon } from '@hugeicons/core-free-icons';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { FormField } from './form-field';
import { Icon, type IconProps } from './icon';
import { Input } from './input';
import { Repeater } from './repeater';

interface Membership {
  id: string;
  entity: string;
}

function Memberships({
  initial = [],
  disabled,
  onDuplicate,
  icon,
  getIcon,
}: {
  initial?: Membership[];
  disabled?: boolean;
  onDuplicate?: (item: Membership, index: number) => void;
  icon?: IconProps['icon'];
  getIcon?: (item: Membership, index: number) => IconProps['icon'];
}) {
  const [items, setItems] = useState(initial);
  const [editing, setEditing] = useState<string | null>(null);
  const [next, setNext] = useState(1);
  return (
    <>
      <h2>Memberships</h2>
      <Repeater
        label="Memberships"
        items={items}
        getKey={(item) => item.id}
        getTitle={(item) => item.entity || 'New membership'}
        renderDescription={(_item, index) => `Membership ${String(index + 1)}`}
        renderEditor={(item) => (
          <FormField label="Entity">
            <Input
              value={item.entity}
              onChange={(event) => {
                setItems((current) =>
                  current.map((entry) =>
                    entry.id === item.id ? { ...entry, entity: event.target.value } : entry,
                  ),
                );
              }}
            />
          </FormField>
        )}
        editingKey={editing}
        onEditingKeyChange={setEditing}
        onAdd={() => {
          const id = `new-${String(next)}`;
          setNext(next + 1);
          setItems((current) => [...current, { id, entity: '' }]);
          setEditing(id);
        }}
        addLabel="Add a membership"
        onRemove={(item) => {
          setItems((current) => current.filter((entry) => entry.id !== item.id));
        }}
        onDuplicate={onDuplicate}
        emptyText="No memberships added."
        disabled={disabled}
        icon={icon}
        getIcon={getIcon}
      />
    </>
  );
}

/** The drawing an icon renders, to tell icons apart. */
function drawingOf(icon: IconProps['icon']) {
  const { container, unmount } = render(<Icon icon={icon} />);
  const drawing = container.querySelector('svg')?.innerHTML;
  unmount();
  return drawing;
}

function cardIcon(title: string) {
  return screen.getByRole('heading', { name: title }).closest('li')?.querySelector('svg')
    ?.innerHTML;
}

const clubs: Membership[] = [
  { id: 'a', entity: 'Nairobi Rotary Club' },
  { id: 'b', entity: 'Kenya Farmers Society' },
];

describe('Repeater', () => {
  it('shows the empty text and the add button when there are no items', () => {
    render(<Memberships />);

    expect(screen.getByText('No memberships added.')).toBeDefined();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add a membership' })).toBeDefined();
  });

  it('gives each card a heading and names its actions after the item', () => {
    render(<Memberships initial={clubs} onDuplicate={vi.fn()} />);

    const list = screen.getByRole('list', { name: 'Memberships' });
    const [first, ...rest] = within(list).getAllByRole('listitem');
    expect(rest).toHaveLength(1);
    if (!first) throw new Error('No cards');
    expect(
      within(first).getByRole('heading', {
        level: 3,
        name: 'Nairobi Rotary Club',
      }),
    ).toBeDefined();
    for (const action of ['Edit', 'Duplicate', 'Remove']) {
      expect(screen.getByRole('button', { name: `${action} Kenya Farmers Society` })).toBeDefined();
    }
  });

  it('adds an item, opens it for editing and focuses its first field', () => {
    render(<Memberships />);

    fireEvent.click(screen.getByRole('button', { name: 'Add a membership' }));

    const edit = screen.getByRole('button', { name: 'Edit New membership' });
    expect(edit.getAttribute('aria-expanded')).toBe('true');
    const editor = screen.getByRole('group', { name: 'New membership' });
    expect(edit.getAttribute('aria-controls')).toBe(editor.id);
    expect(document.activeElement).toBe(within(editor).getByRole('textbox', { name: 'Entity' }));
  });

  it('edits an item and returns focus to its edit button on Done', () => {
    render(<Memberships initial={clubs} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit Nairobi Rotary Club' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Entity' }), {
      target: { value: 'Mombasa Rotary Club' },
    });
    screen.getByRole('button', { name: 'Done' }).focus();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(screen.queryByRole('textbox', { name: 'Entity' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Mombasa Rotary Club' })).toBeDefined();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Edit Mombasa Rotary Club' }),
    );
  });

  it('removes an item and moves focus to the add button', () => {
    render(<Memberships initial={clubs} />);

    const remove = screen.getByRole('button', { name: 'Remove Nairobi Rotary Club' });
    remove.focus();
    fireEvent.click(remove);

    expect(screen.queryByRole('heading', { name: 'Nairobi Rotary Club' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add a membership' }));
  });

  it('duplicates an item when the caller allows it', () => {
    const onDuplicate = vi.fn();
    render(<Memberships initial={clubs} onDuplicate={onDuplicate} />);

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Nairobi Rotary Club' }));

    expect(onDuplicate).toHaveBeenCalledWith(clubs[0], 0);
  });

  it('has no duplicate action unless the caller asks for one', () => {
    render(<Memberships initial={clubs} />);

    expect(screen.queryByRole('button', { name: /^Duplicate/ })).toBeNull();
  });

  it('disables adding and every action when disabled', () => {
    render(<Memberships initial={clubs} disabled />);

    for (const button of screen.getAllByRole<HTMLButtonElement>('button')) {
      expect(button.disabled).toBe(true);
    }
  });

  it('shows the list icon in every card', () => {
    render(<Memberships initial={clubs} icon={UserGroupIcon} />);

    expect(cardIcon('Nairobi Rotary Club')).toBe(drawingOf(UserGroupIcon));
    expect(cardIcon('Kenya Farmers Society')).toBe(drawingOf(UserGroupIcon));
  });

  it("shows each card's own icon when the caller picks one per item", () => {
    render(
      <Memberships
        initial={clubs}
        icon={UserGroupIcon}
        getIcon={(item) => (item.id === 'a' ? Home01Icon : Building03Icon)}
      />,
    );

    expect(cardIcon('Nairobi Rotary Club')).toBe(drawingOf(Home01Icon));
    expect(cardIcon('Kenya Farmers Society')).toBe(drawingOf(Building03Icon));
  });
});
