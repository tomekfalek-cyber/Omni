import { describe, it, expect } from 'vitest';
import * as zlib from 'zlib';
import { extractAny } from './doc-extract.js';

/** Buduje minimalny PDF z jednym fragmentem tekstu. */
function makePdf(text: string): Buffer {
  const stream = 'BT /F1 24 Tf 72 700 Td (' + text + ') Tj ET';
  const s = '%PDF-1.4' + String.fromCharCode(10) +
    '1 0 obj << /Type /Catalog >> endobj' + String.fromCharCode(10) +
    '4 0 obj << /Length ' + stream.length + ' >> stream' + String.fromCharCode(10) +
    stream + String.fromCharCode(10) + 'endstream endobj' + String.fromCharCode(10) +
    'trailer << /Root 1 0 R >>' + String.fromCharCode(10) + '%%EOF';
  return Buffer.from(s, 'latin1');
}

/** Buduje minimalne archiwum ZIP z jednym plikiem (jak DOCX). */
function makeZip(name: string, content: string): Buffer {
  const data = zlib.deflateRawSync(Buffer.from(content, 'utf8'));
  const nameBuf = Buffer.from(name, 'utf8');
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(8, 8);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(Buffer.byteLength(content), 22);
  header.writeUInt16LE(nameBuf.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, nameBuf, data]);
}

describe('doc-extract', () => {
  it('czyta zwykly plik tekstowy', () => {
    const out = extractAny(Buffer.from('Ala ma kota', 'utf8'));
    expect(out.kind).toBe('text');
    expect(out.text).toContain('Ala ma kota');
  });

  it('wyciaga tekst z PDF', () => {
    const out = extractAny(makePdf('Faktura nr 42'));
    expect(out.kind).toBe('pdf');
    expect(out.text).toContain('Faktura nr 42');
  });

  it('wyciaga tekst z DOCX', () => {
    const xml = '<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:t>Umowa luty</w:t></w:r></w:p></w:body></w:document>';
    const out = extractAny(makeZip('word/document.xml', xml));
    expect(out.kind).toBe('docx/zip');
    expect(out.text).toContain('Umowa luty');
  });

  it('rozpoznaje PDF po naglowku', () => {
    expect(extractAny(Buffer.from('%PDF-1.4')).kind).toBe('pdf');
  });

  it('nie wywala sie na pustym pliku', () => {
    const out = extractAny(Buffer.from(''));
    expect(out.kind).toBe('text');
  });
});
