export function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') { if (quoted && source[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (c === ',' || c === '\n' || c === '\r')) {
      row.push(cell); cell = '';
      if (c !== ',') { if (row.some(v => v.trim())) rows.push(row); row = []; if (c === '\r' && source[i + 1] === '\n') i++; }
    } else cell += c;
  }
  if (quoted) throw new Error('Unclosed quotation mark in CSV file.');
  row.push(cell); if (row.some(v => v.trim())) rows.push(row);
  if (!rows.length) throw new Error('The CSV file is empty.');
  const headers = rows.shift().map(v => v.trim());
  if (new Set(headers).size !== headers.length) throw new Error('Duplicate CSV columns.');
  return rows.map((values, index) => { if (values.length !== headers.length) throw new Error(`Row ${index + 2} has the wrong number of columns.`); return Object.fromEntries(headers.map((key, i) => [key, values[i].trim()])); });
}
export function csvText(rows) {
  return rows.map(row => row.map(value => { let s = String(value ?? ''); if (/^[=+@\-\t\r]/.test(s)) s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; }).join(',')).join('\r\n');
}
export function downloadCsv(name, rows) {
  const url = URL.createObjectURL(new Blob(['\uFEFF' + csvText(rows)], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}
