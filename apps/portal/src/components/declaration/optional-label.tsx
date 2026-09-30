/** A field label marked "(optional)", for fields the declaration can go without. */
export function optionalLabel(label: string) {
  return (
    <>
      {label} <span className="font-normal text-muted-foreground">(optional)</span>
    </>
  );
}
