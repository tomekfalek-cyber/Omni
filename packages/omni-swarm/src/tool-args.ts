/** Leniwy odzysk argumentow narzedzia z niepoprawnego JSON (bez regex/escape w zrodle). */

function readQuoted(src: string, from: number): { value: string } | null {
  const Q = String.fromCharCode(34);
  let i = from;
  while (i < src.length && src[i] !== Q) { i++; }
  if (i >= src.length) { return null; }
  i++;
  let out = '';
  while (i < src.length) {
    const c = src[i];
    if (c === Q) { return { value: out }; }
    if (c === String.fromCharCode(92)) {
      const nx = src[i + 1];
      const code = nx ? nx.charCodeAt(0) : 0;
      if (code === 110) { out += String.fromCharCode(10); i += 2; continue; }
      if (code === 116) { out += String.fromCharCode(9); i += 2; continue; }
      if (code === 114) { out += String.fromCharCode(13); i += 2; continue; }
      if (code === 34) { out += Q; i += 2; continue; }
      if (code === 92) { out += String.fromCharCode(92); i += 2; continue; }
      if (code === 47) { out += String.fromCharCode(47); i += 2; continue; }
      if (code === 117) { const hex = src.slice(i + 2, i + 6); const num = parseInt(hex, 16); out += String.fromCharCode(isNaN(num) ? 63 : num); i += 6; continue; }
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return null;
}

/** Odzyskuje path/content z surowego (byc moze uszkodzonego) JSON-a argumentow. */
export function recoverToolArgs(s: string): any {
  const Q = String.fromCharCode(34);
  const src = String(s || '');
  const out: any = {};
  const pi = src.indexOf(Q + 'path' + Q);
  if (pi !== -1) { const r = readQuoted(src, pi + 6); if (r) { out.path = r.value; } }
  const ci = src.indexOf(Q + 'content' + Q);
  if (ci !== -1) {
    const colon = src.indexOf(':', ci);
    const r = readQuoted(src, colon === -1 ? ci + 9 : colon + 1);
    if (r) { out.content = r.value; }
  }
  return out;
}
