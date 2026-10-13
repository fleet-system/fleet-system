// نسخة من كاتب XLSX الخاص بالموقع (web/js/xlsx.js) لاستخدامه في دالة Supabase. لا يعتمد على المتصفح.
// عند تعديل web/js/xlsx.js انسخ التعديل هنا أيضاً.
const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------------------------------------------------------------------
// CRC32 + ZIP
// ---------------------------------------------------------------------
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

export function zipStore(files, type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
  const parts = []; const central = []; let offset = 0;
  for (const [name, text] of files) {
    const nameB = enc.encode(name); const data = typeof text === 'string' ? enc.encode(text) : text; const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true); lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
    lh.setUint16(26, nameB.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), nameB, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, 0, true); ch.setUint16(14, 0x21, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
    ch.setUint16(28, nameB.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nameB);
    offset += 30 + nameB.length + data.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type });
}

export async function unzip(buf, badMsg = 'الملف ليس ملف Excel صالحاً (xlsx).') {
  const u8 = new Uint8Array(buf); const dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error(badMsg);
  const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const out = {};
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    const raw = u8.subarray(start, start + csize);
    if (method === 0) out[name] = raw;
    else if (method === 8) out[name] = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

// ---------------------------------------------------------------------
// كتابة
// ---------------------------------------------------------------------
const xmlEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const colName = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const EPOCH = Date.UTC(1899, 11, 30);
export const dateToSerial = (iso) => { const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? (Date.UTC(+m[1], +m[2] - 1, +m[3]) - EPOCH) / 864e5 : null; };
export const serialToDate = (n) => { const d = new Date(EPOCH + Math.round(n * 864e5)); return d.toISOString().slice(0, 10); };
// timestamp => رقم Excel بتوقيت الرياض
const tsToSerial = (ts) => { const d = new Date(ts); return isNaN(d) ? null : (d.getTime() + 3 * 3600e3 - EPOCH) / 864e5; };

// الأنماط: 0 عادي، 1 رأس الجدول، 2 تاريخ، 3 تاريخ ووقت، 4 مبلغ، 5 عدد صحيح، 6 نص ملفوف
const STYLE = { text: 0, date: 2, datetime: 3, money: 4, int: 5, number: 4, wrap: 6 };
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="yyyy/mm/dd"/><numFmt numFmtId="165" formatCode="yyyy/mm/dd hh:mm"/><numFmt numFmtId="166" formatCode="#,##0.00"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1E4636"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD0D7D2"/></left><right style="thin"><color rgb="FFD0D7D2"/></right><top style="thin"><color rgb="FFD0D7D2"/></top><bottom style="thin"><color rgb="FFD0D7D2"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/**
 * sheets: [{ name, columns: [{ header, type: 'text'|'int'|'money'|'number'|'date'|'datetime'|'wrap', width?, value(row) }], rows }]
 */
export function writeXlsx(sheets) {
  const sst = []; const sstIdx = new Map();
  const s = (str) => { str = String(str); if (!sstIdx.has(str)) { sstIdx.set(str, sst.length); sst.push(str); } return sstIdx.get(str); };
  const sheetXml = sheets.map((sh) => {
    const cols = sh.columns;
    const rowsXml = [];
    rowsXml.push(`<row r="1" ht="30" customHeight="1">${cols.map((c, i) => `<c r="${colName(i)}1" t="s" s="1"><v>${s(c.header)}</v></c>`).join('')}</row>`);
    sh.rows.forEach((r, ri) => {
      const rn = ri + 2;
      const cells = cols.map((c, i) => {
        let v = c.value(r); const ref = `${colName(i)}${rn}`; const st = STYLE[c.type] ?? 0;
        if (v === null || v === undefined || v === '') return `<c r="${ref}" s="${st}"/>`;
        if (c.type === 'date') { const n = dateToSerial(v); return n === null ? `<c r="${ref}" t="s" s="0"><v>${s(v)}</v></c>` : `<c r="${ref}" s="${st}"><v>${n}</v></c>`; }
        if (c.type === 'datetime') { const n = tsToSerial(v); return n === null ? `<c r="${ref}" s="0"/>` : `<c r="${ref}" s="${st}"><v>${n}</v></c>`; }
        if (['money', 'int', 'number'].includes(c.type) && v !== '' && isFinite(Number(v))) return `<c r="${ref}" s="${st}"><v>${Number(v)}</v></c>`;
        if (typeof v === 'boolean') v = v ? 'نعم' : 'لا';
        return `<c r="${ref}" t="s" s="${st}"><v>${s(v)}</v></c>`;
      });
      rowsXml.push(`<row r="${rn}">${cells.join('')}</row>`);
    });
    const last = `${colName(Math.max(cols.length - 1, 0))}${Math.max(sh.rows.length + 1, 1)}`;
    const widths = cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || (c.type === 'date' ? 13 : c.type === 'datetime' ? 18 : c.type === 'money' ? 14 : c.type === 'wrap' ? 40 : 18)}" customWidth="1"/>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<dimension ref="A1:${last}"/><sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/><cols>${widths}</cols><sheetData>${rowsXml.join('')}</sheetData>
${sh.rows.length ? `<autoFilter ref="A1:${last}"/>` : ''}</worksheet>`;
  });
  const names = sheets.map((sh, i) => xmlEsc(String(sh.name).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)) || `Sheet${i + 1}`);
  const files = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`],
    ['docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Fleet System</Application></Properties>`],
    ['docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>Fleet System</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`],
    ['xl/styles.xml', STYLES_XML],
    ...sheetXml.map((x, i) => [`xl/worksheets/sheet${i + 1}.xml`, x]),
  ];
  files.push(['xl/sharedStrings.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sst.length}" uniqueCount="${sst.length}">${sst.map((t) => `<si><t xml:space="preserve">${xmlEsc(t)}</t></si>`).join('')}</sst>`]);
  return zipStore(files);
}

