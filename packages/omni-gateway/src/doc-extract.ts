import * as zlib from 'zlib';

/** Minimalny czytnik ZIP (do plikow DOCX). */
export function zipEntries(buf: Buffer): Array<{ name: string; data: Buffer }> {
  const out: Array<{ name: string; data: Buffer }> = [];
  let i = 0;
  while (i >= 0 && i < buf.length - 30) {
    const sig = buf.readUInt32LE(i);
    if (sig !== 0x04034b50) { break; }
    const method = buf.readUInt16LE(i + 8);
    const compSize = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const nameStart = i + 30;
    const name = buf.slice(nameStart, nameStart + nameLen).toString('utf8');
    const dataStart = nameStart + nameLen + extraLen;
    let data = buf.slice(dataStart, dataStart + compSize);
    if (method === 8) { try { data = zlib.inflateRawSync(data); } catch (e) { } }
    if (compSize > 0) { out.push({ name: name, data: data }); }
    i = dataStart + compSize;
  }
  return out;
}

/** Wyciaga tekst z DOCX. */
export function docxText(buf: Buffer): string {
  const entries = zipEntries(buf);
  const doc = entries.filter((e) => e.name === 'word/document.xml')[0];
  const src = doc ? doc.data : (entries.filter((e) => e.name.indexOf('document') !== -1)[0] || { data: Buffer.from('') }).data;
  if (!src || !src.length) { return ''; }
  let xml = src.toString('utf8');
  xml = xml.split('</w:p>').join("\n");
  xml = xml.replace(new RegExp('<[^>]+>', 'g'), '');
  xml = xml.split('&amp;').join('&').split('&lt;').join('<').split('&gt;').join('>');
  xml = xml.replace(new RegExp('^[>\s]+', 'gm'), '');
  return xml;
}

/** Zbiera tekst z nawiasow PDF - prosty skaner znakow (bez wyrazen regularnych). */
function pdfStrings(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    if (ch === '(') { depth++; if (depth === 1) { cur = ''; } continue; }
    if (ch === ')') { if (depth > 0) { depth--; if (depth === 0) { out.push(cur); } } continue; }
    if (depth > 0 && ch === '\\') { i++; cur = cur + (s.charAt(i) || ''); continue; }
    if (depth > 0) { cur = cur + ch; }
  }
  return out;
}

/** Wyciaga tekst z PDF (proste dokumenty tekstowe). */
export function pdfText(buf: Buffer): string {
  const raw = buf.toString('latin1');
  const parts = raw.split('stream');
  const pieces: string[] = [];
  for (let k = 1; k < parts.length; k++) {
    let body = parts[k];
    const end = body.indexOf('endstream');
    if (end !== -1) { body = body.slice(0, end); }
    body = body.replace(new RegExp('^[\\r\\n]+'), '');
    let dec = body;
    try { dec = zlib.inflateSync(Buffer.from(body, 'latin1')).toString('latin1'); } catch (e) { }
    const found = pdfStrings(dec);
    for (const s of found) { if (s.length > 1) { pieces.push(s); } }
  }
  return pieces.join(' ');
}

/** Rozpoznaje typ i wyciaga tekst. */
export function extractAny(buf: Buffer): { kind: string; text: string } {
  const head = buf.slice(0, 5).toString('latin1');
  let kind = 'text';
  let text = '';
  if (head.indexOf('%PDF') === 0) { kind = 'pdf'; text = pdfText(buf); }
  else if (buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b) { kind = 'docx/zip'; text = docxText(buf); }
  else { text = buf.toString('utf8'); }
  text = text.split(String.fromCharCode(0)).join('');
  text = text.replace(new RegExp('[ \t]+', 'g'), ' ');
  text = text.replace(new RegExp('[\r\n]{3,}', 'g'), "\n\n");
  return { kind: kind, text: text.trim() };
}
