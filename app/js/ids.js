/** Id generati dall'app: lettere e cifre casuali, prefisso per riconoscerli. */
export function nuovoId(prefisso) {
  const a = new Uint8Array(10);
  crypto.getRandomValues(a);
  return prefisso + '_' + Array.from(a, b => (b % 36).toString(36)).join('');
}
