/** Adds or removes `item` in `list`, returning the entries in the order of `order`. */
export function toggleInOrder<T>(
  list: readonly T[],
  item: T,
  on: boolean,
  order: readonly T[],
): T[] {
  return order.filter((entry) => (entry === item ? on : list.includes(entry)));
}
