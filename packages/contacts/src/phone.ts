/** An E.164 number grouped for reading: `+254 712 345 678`; other countries' numbers as stored. */
export function formatPhone(e164: string): string {
  const kenyan = /^\+254(\d{3})(\d{3})(\d{3})$/.exec(e164);
  return kenyan ? `+254 ${kenyan[1]} ${kenyan[2]} ${kenyan[3]}` : e164;
}
