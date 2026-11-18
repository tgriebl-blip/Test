// ---------- Datei, Blatt, Export, Druck ----------
const inViewer = !!(window.claude && typeof window.claude.use === 'function');   // als Artifact in claude.ai geöffnet
let saver = null;                            // dort laufen Downloads über den Viewer
async function download(name, data, type) {
  if (inViewer) {
    if (!saver) return flash('Dateien können hier nicht gespeichert werden.');
    try { await saver.save({ filename: name, data }); flash('„' + name + '“ gespeichert.'); }
    catch (e) {
      const c = e && e.code;
      flash(c === 'declined' ? 'Speichern abgebrochen.' : c === 'rate_limited' ? 'Bitte einen Moment warten und dann noch einmal versuchen.' : 'Speichern ist hier gerade nicht möglich.');
    }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// Blatt: Papier in mm, Rahmen, Schriftfeld; Maßstab 1:N automatisch oder fest; Maße mit Texthöhe sheet.dimH auf dem Papier
const PAPER = { A4: [297, 210], A3: [420, 297] };
const SCALES = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000];
const dimUPaper = N => sheet.dimH * N / (EM * DIM.text);
function pageLayout(list = shown()) {
  const [a, b] = PAPER[sheet.paper] || PAPER.A4, W = sheet.orient === 'hoch' ? b : a, H = sheet.orient === 'hoch' ? a : b;
  const m = 10, foot = 9, aw = W - 2 * m - 6, ah = H - 2 * m - foot - 6;
  if (!list.length) return null;
  const box = N => {                         // Ausdehnung der Zeichnung bei Maßstab 1:N (Maßtexte wachsen mit N)
    const u = dimUPaper(N), b = extents(list, u), t = DIM.text * u * 1.4;
    if (list.some(e => e.t === 'dim' || (e.t === 'insert' && flat(e).some(p => p.t === 'dim')))) { b.x0 -= t; b.y0 -= t; b.x1 += t; b.y1 += t; }
    return b;
  };
  const fits = N => { const b = box(N); return (b.x1 - b.x0) / N <= aw + 1e-6 && (b.y1 - b.y0) / N <= ah + 1e-6; };
  const N = sheet.scale || SCALES.find(fits) || SCALES[SCALES.length - 1], bx = box(N);
  const cx = (bx.x0 + bx.x1) / 2, cy = (bx.y0 + bx.y1) / 2, mx = m + 3 + aw / 2, my = m + foot + 3 + ah / 2;
  return { W, H, m, foot, N, fits: fits(N), u: dimUPaper(N), toPaper: (x, y) => [mx + (x - cx) / N, my + (y - cy) / N], cx, cy, mx, my };
}
const today = () => new Date().toLocaleDateString('de-DE');
const footText = L => [sheet.title || 'Zeichnung', 'Maßstab 1:' + L.N, today(), 'Mini-CAD'];
function renderPage(D) {                     // Blatt als Bild mit D Pixeln je mm
  const L = pageLayout();
  if (!L) { flash(ents.length ? 'Alle Layer sind ausgeblendet.' : 'Die Zeichnung ist noch leer.'); return null; }
  const c = document.createElement('canvas'), g = c.getContext('2d');
  c.width = Math.round(L.W * D); c.height = Math.round(L.H * D);
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#000'; g.lineWidth = 0.35 * D;
  g.strokeRect(L.m * D, L.m * D, (L.W - 2 * L.m) * D, (L.H - 2 * L.m) * D);
  g.beginPath(); g.moveTo(L.m * D, (L.H - L.m - L.foot) * D); g.lineTo((L.W - L.m) * D, (L.H - L.m - L.foot) * D); g.stroke();
  g.fillStyle = '#000'; g.font = (3 / EM * D) + 'px Helvetica, Arial, sans-serif'; g.textBaseline = 'alphabetic';
  footText(L).forEach((t, i) => g.fillText(t, (L.m + 3 + i * (L.W - 2 * L.m) / 4) * D, (L.H - L.m - 3) * D));
  const v = { s: D / L.N, ox: D * (L.mx - L.cx / L.N), oy: D * (L.H - L.my + L.cy / L.N), pen: D };
  g.save(); g.beginPath(); g.rect(L.m * D, L.m * D, (L.W - 2 * L.m) * D, (L.H - 2 * L.m - L.foot) * D); g.clip();
  drawEnts(g, v, '#ffffff', '#000000', false, L.u);
  g.restore();
  if (!L.fits) flash('Bei 1:' + L.N + ' passt die Zeichnung nicht ganz auf ' + sheet.paper + ' ' + sheet.orient + '.');
  return { c, L };
}
function exportPNG() { const r = renderPage(6); if (r) r.c.toBlob(b => { if (b) download('zeichnung.png', b); }); }
function printDrawing() {
  const r = renderPage(8);
  if (!r) return;
  $('pageStyle').textContent = '@page { size: ' + r.L.W + 'mm ' + r.L.H + 'mm; margin: 0; } @media print { #printimg { width: ' + r.L.W + 'mm; height: ' + r.L.H + 'mm; max-height: none; } }';
  const img = $('printimg');
  img.onload = () => window.print();
  img.src = r.c.toDataURL('image/png');
}

// Vektor-PDF (eine Seite, Helvetica, Koordinaten in mm)
const HELV = { ',': 278, '.': 278, '-': 333, ' ': 278, 'R': 722, 'Ø': 778, '×': 584, '°': 400 };
const pdfStr = s => '(' + [...s].map(ch => {
  const m = { '–': '\x96', '„': '\x84', '“': '\x93', '”': '\x94', '€': '\x80' }[ch] || ch, c = m.charCodeAt(0);
  return c > 255 ? '?' : m === '(' || m === ')' || m === '\\' ? '\\' + m : m;
}).join('') + ')';
function curveBez(e) {                       // Bézier-Segmente (je höchstens 90°) für Kreis, Bogen, Ellipse
  const start = e.t === 'arc' ? e.a1 : 0, sw = e.t === 'arc' ? sweepOf(e) : 360, n = Math.max(1, Math.ceil(sw / 90 - 1e-9)), st = sw / n, segs = [];
  const map = e.t === 'ellipse'
    ? (x, y) => { const c = Math.cos(rad(e.rot)), s = Math.sin(rad(e.rot)), X = e.rx * x, Y = e.ry * y; return [e.cx + X * c - Y * s, e.cy + X * s + Y * c]; }
    : (x, y) => [e.cx + e.r * x, e.cy + e.r * y];
  for (let i = 0; i < n; i++) {
    const a = rad(start + i * st), b = rad(start + (i + 1) * st), k = 4 / 3 * Math.tan(rad(st) / 4);
    const c0 = Math.cos(a), s0 = Math.sin(a), c1 = Math.cos(b), s1 = Math.sin(b);
    segs.push([map(c0, s0), map(c0 - k * s0, s0 + k * c0), map(c1 + k * s1, s1 - k * c1), map(c1, s1)]);
  }
  return segs;
}
function pdfBytes(W, H, content) {
  const k = 72 / 25.4, f = v => String(Math.round(v * 1000) / 1000);
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + f(W * k) + ' ' + f(H * k) + '] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'];
  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const xref = out.length;
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
  return bytes;
}
function pdfPage() {                         // Inhalt der PDF-Seite
  const L = pageLayout();
  if (!L) { flash(ents.length ? 'Alle Layer sind ausgeblendet.' : 'Die Zeichnung ist noch leer.'); return null; }
  const f = v => String(Math.round(v * 1000) / 1000), P = (x, y) => L.toPaper(x, y).map(f).join(' ');
  const col = (hex, op) => rgbOf(ink(hex, '#ffffff', '#000000')).map(v => f(v / 255)).join(' ') + ' ' + op;
  const o = ['2.834646 0 0 2.834646 0 0 cm', '1 J 1 j', '0 0 0 RG 0 0 0 rg 0.35 w [] 0 d'];
  o.push(f(L.m) + ' ' + f(L.m) + ' ' + f(L.W - 2 * L.m) + ' ' + f(L.H - 2 * L.m) + ' re S');
  o.push(f(L.m) + ' ' + f(L.m + L.foot) + ' m ' + f(L.W - L.m) + ' ' + f(L.m + L.foot) + ' l S');
  footText(L).forEach((t, i) => o.push('BT /F1 ' + f(3 / EM) + ' Tf ' + f(L.m + 3 + i * (L.W - 2 * L.m) / 4) + ' ' + f(L.m + 3) + ' Td ' + pdfStr(t) + ' Tj ET'));
  o.push('q ' + f(L.m) + ' ' + f(L.m + L.foot) + ' ' + f(L.W - 2 * L.m) + ' ' + f(L.H - 2 * L.m - L.foot) + ' re W n');   // auf die Zeichenfläche beschränken
  const dims = [];
  for (const e of shown()) for (const p of flat(e)) {
    if (p.t === 'dim') { dims.push(p); continue; }
    const l = lay(p);
    if (!l.on) continue;
    const dash = LTYPES[l.type].dash.map(d => f(d * 0.3 * Math.max(1, l.width / 1.5)));
    o.push(col(l.color, 'RG') + ' ' + f(PEN[l.width] || 0.25) + ' w [' + dash.join(' ') + '] 0 d');
    if (p.t === 'line') o.push(P(p.x1, p.y1) + ' m ' + P(p.x2, p.y2) + ' l S');
    else {
      const segs = curveBez(p);
      o.push(P(...segs[0][0]) + ' m ' + segs.map(s => P(...s[1]) + ' ' + P(...s[2]) + ' ' + P(...s[3]) + ' c').join(' ') + ' S');
    }
  }
  const size = DIM.text * L.u / L.N;         // Schriftgröße auf dem Papier in mm
  for (const d of dims) {
    const l = lay(d);
    if (!l.on) continue;
    const g = dimGeom(d, L.u), c = ink(l.color, '#ffffff', '#000000');
    o.push(col(c, 'RG') + ' ' + col(c, 'rg') + ' 0.18 w [] 0 d');
    for (const [x1, y1, x2, y2] of g.lines) o.push(P(x1, y1) + ' m ' + P(x2, y2) + ' l S');
    for (const t of g.tris) o.push(P(...t[0]) + ' m ' + P(...t[1]) + ' l ' + P(...t[2]) + ' l h f');
    const w = [...g.text].reduce((s, ch) => s + (HELV[ch] || 556), 0) / 1000 * size, ca = Math.cos(g.ang), sa = Math.sin(g.ang);
    const [px, py] = L.toPaper(g.tx, g.ty);
    o.push('BT /F1 ' + f(size) + ' Tf ' + [ca, sa, -sa, ca, px - ca * w / 2, py - sa * w / 2].map(f).join(' ') + ' Tm ' + pdfStr(g.text) + ' Tj ET');
  }
  o.push('Q');
  return { L, bytes: pdfBytes(L.W, L.H, o.join('\n')) };
}
function exportPDF() {
  const r = pdfPage();
  if (!r) return;
  download('zeichnung.pdf', new Blob([r.bytes], { type: 'application/pdf' }));
  if (!r.L.fits) flash('Bei 1:' + r.L.N + ' passt die Zeichnung nicht ganz auf ' + sheet.paper + ' ' + sheet.orient + '.');
}
function sheetUI() {                         // Felder des Blatt-Fensters füllen und Maßstab anzeigen
  $('shPaper').value = sheet.paper; $('shOrient').value = sheet.orient; $('shScale').value = String(sheet.scale);
  if (document.activeElement !== $('shDimH')) $('shDimH').value = String(sheet.dimH);
  if (document.activeElement !== $('shTitle')) $('shTitle').value = sheet.title;
  const L = pageLayout();
  $('shInfo').textContent = !L ? 'Die Zeichnung ist noch leer.'
    : 'Maßstab 1:' + L.N + (sheet.scale ? '' : ' (automatisch)') + ' · ' + sheet.paper + ' ' + sheet.orient + (L.fits ? ' · passt aufs Blatt' : ' · passt nicht ganz aufs Blatt') + ' · Maßtext ' + fmt(sheet.dimH, 1) + ' mm hoch';
}
function sheetChanged() { save(); sheetUI(); refresh(); }
$('shPaper').onchange = ev => { sheet.paper = ev.target.value; sheetChanged(); };
$('shOrient').onchange = ev => { sheet.orient = ev.target.value; sheetChanged(); };
$('shScale').onchange = ev => { sheet.scale = +ev.target.value || 0; sheetChanged(); };
$('shDimH').onchange = ev => {
  const v = num(ev.target.value);
  if (v >= 1 && v <= 20) sheet.dimH = v; else flash('Die Maßtexthöhe muss zwischen 1 und 20 mm liegen.');
  ev.target.value = String(sheet.dimH); sheetChanged();
};
$('shTitle').onchange = ev => { sheet.title = ev.target.value.trim().slice(0, 60); sheetChanged(); };
$('pdf').onclick = exportPDF;

// DXF R12 mit Layern, Linienarten, Kreisen, Bögen, Ellipsen (als Polylinie) und Blöcken
const ACI = [];
function aci(hex) {                          // nächstliegende AutoCAD-Farbnummer (DXF R12 kennt nur diese 255 Farben)
  if (!ACI.length) {
    [[255, 0, 0], [255, 255, 0], [0, 255, 0], [0, 255, 255], [0, 0, 255], [255, 0, 255], [255, 255, 255], [128, 128, 128], [192, 192, 192]]
      .forEach((c, i) => { ACI[i + 1] = c; });
    const V = [1, 1, 0.8, 0.8, 0.6, 0.6, 0.5, 0.5, 0.3, 0.3];
    for (let i = 10; i < 250; i++) {
      const h = (Math.floor(i / 10) - 1) * 15, s = i % 2 ? 0.5 : 1, v = V[i % 10];
      ACI[i] = [5, 3, 1].map(n => { const k = (n + h / 60) % 6; return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)))); });
    }
    [51, 91, 132, 173, 214, 255].forEach((g, i) => { ACI[250 + i] = [g, g, g]; });
  }
  const c = rgbOf(hex), hi = Math.max(...c), lo = Math.min(...c);
  if (hi - lo < 16 && (hi < 48 || lo > 224)) return 7;          // Schwarz/Weiß = Farbe 7
  let best = 7, bd = Infinity;
  for (let i = 1; i < 256; i++) {
    if (i === 7) continue;
    const t = ACI[i], d = 2 * (t[0] - c[0]) ** 2 + 4 * (t[1] - c[1]) ** 2 + 3 * (t[2] - c[2]) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    let c = (crc ^ bytes[i]) & 0xFF;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function zip1(name, content) {               // ZIP-Archiv mit genau einer unkomprimierten Datei (Text oder Bytes)
  const enc = new TextEncoder(), nm = enc.encode(name), data = typeof content === 'string' ? enc.encode(content) : content, crc = crc32(data), d = new Date();
  const time = d.getHours() << 11 | d.getMinutes() << 5 | d.getSeconds() >> 1;
  const date = (d.getFullYear() - 1980) << 9 | (d.getMonth() + 1) << 5 | d.getDate();
  const head = central => {
    const v = new DataView(new ArrayBuffer(central ? 46 : 30));
    let o = 0;
    const u16 = x => { v.setUint16(o, x, true); o += 2; }, u32 = x => { v.setUint32(o, x, true); o += 4; };
    u32(central ? 0x02014b50 : 0x04034b50);
    if (central) u16(20);
    u16(20); u16(0); u16(0); u16(time); u16(date); u32(crc); u32(data.length); u32(data.length); u16(nm.length); u16(0);
    if (central) { u16(0); u16(0); u16(0); u32(0); u32(0); }
    return new Uint8Array(v.buffer);
  };
  const local = head(false), central = head(true), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, 1, true); end.setUint16(10, 1, true);
  end.setUint32(12, central.length + nm.length, true); end.setUint32(16, local.length + nm.length + data.length, true);
  return new Blob([local, nm, data, central, nm, new Uint8Array(end.buffer)], { type: 'application/zip' });
}
const dxfName = s => s.toUpperCase().replace(/Ä/g, 'AE').replace(/Ö/g, 'OE').replace(/Ü/g, 'UE').replace(/[^A-Z0-9$_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 27);
function uniqueDxf(map, used, key, raw, fallback) {
  const s = dxfName(raw) || fallback;
  let u = s, i = 2;
  while (used.has(u)) u = s + '_' + i++;
  used.add(u); map.set(key, u);
}
function exportDXF() {
  if (!ents.length) return flash('Die Zeichnung ist noch leer.');
  const L = pageLayout(ents) || { u: dimU(view), N: 1 };      // Maßtexte wie auf dem Blatt
  const u = L.u, n = x => String(Math.round(x * 1e6) / 1e6), out = [];
  const put = (...a) => { for (const x of a) out.push(typeof x === 'number' ? n(x) : x); };
  const names = new Map(), used = new Set(['0']), bnames = new Map(), bused = new Set();
  for (const l of layers) uniqueDxf(names, used, l.id, l.name, 'LAYER');
  for (const b of Object.keys(blocks)) uniqueDxf(bnames, bused, b, b, 'BLOCK');
  const lts = Object.values(LTYPES);          // Strichmuster: 1 px ≈ 0,3 mm auf dem Papier, mal Maßstab
  put('0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '0', 'ENDSEC');
  put('0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LTYPE', '70', lts.length);
  for (const t of lts) {
    const pat = t.dash.map((d, i) => i % 2 ? -d * 0.3 * L.N : d < 0.1 ? 0 : d * 0.3 * L.N);
    put('0', 'LTYPE', '2', t.dxf, '70', 0, '3', t.desc, '72', 65, '73', pat.length, '40', pat.reduce((s, d) => s + Math.abs(d), 0));
    for (const d of pat) put('49', d);
  }
  put('0', 'ENDTAB', '0', 'TABLE', '2', 'LAYER', '70', layers.length + 1);
  put('0', 'LAYER', '2', '0', '70', 0, '62', 7, '6', 'CONTINUOUS');
  for (const l of layers) put('0', 'LAYER', '2', names.get(l.id), '70', 0, '62', l.on ? aci(l.color) : -aci(l.color), '6', LTYPES[l.type].dxf);
  put('0', 'ENDTAB', '0', 'TABLE', '2', 'STYLE', '70', 1);
  put('0', 'STYLE', '2', 'STANDARD', '70', 0, '40', 0, '41', 1, '50', 0, '71', 0, '42', 2.5, '3', 'txt', '4', '');
  put('0', 'ENDTAB', '0', 'ENDSEC');
  const entity = e => {
    const LN = names.get(e.l) || '0';
    switch (e.t) {
      case 'line': put('0', 'LINE', '8', LN, '10', e.x1, '20', e.y1, '11', e.x2, '21', e.y2); break;
      case 'circle': put('0', 'CIRCLE', '8', LN, '10', e.cx, '20', e.cy, '40', e.r); break;
      case 'arc': put('0', 'ARC', '8', LN, '10', e.cx, '20', e.cy, '40', e.r, '50', e.a1, '51', e.a2); break;
      case 'ellipse':                        // R12 kennt keine Ellipse: geschlossene Polylinie
        put('0', 'POLYLINE', '8', LN, '66', 1, '70', 1);
        for (const p of sample(e, 96).slice(0, -1)) put('0', 'VERTEX', '8', LN, '10', p.x, '20', p.y);
        put('0', 'SEQEND', '8', LN);
        break;
      case 'insert':
        if (!bnames.has(e.name)) break;
        put('0', 'INSERT', '8', LN, '2', bnames.get(e.name), '10', e.x, '20', e.y, '41', e.s, '42', e.fx ? -e.s : e.s, '50', e.rot);
        break;
      case 'dim': {
        const g = dimGeom(e, u);
        for (const [x1, y1, x2, y2] of g.lines) put('0', 'LINE', '8', LN, '6', 'CONTINUOUS', '10', x1, '20', y1, '11', x2, '21', y2);
        for (const [a, b, c] of g.tris) put('0', 'SOLID', '8', LN, '10', a[0], '20', a[1], '11', b[0], '21', b[1], '12', c[0], '22', c[1], '13', c[0], '23', c[1]);
        put('0', 'TEXT', '8', LN, '10', g.tx, '20', g.ty, '40', DIM.text * EM * u, '1', g.text, '50', g.deg, '72', 1, '11', g.tx, '21', g.ty);
      }
    }
  };
  put('0', 'SECTION', '2', 'BLOCKS');
  for (const [name, b] of Object.entries(blocks)) {
    const bn = bnames.get(name);
    put('0', 'BLOCK', '8', '0', '2', bn, '70', 0, '10', 0, '20', 0, '30', 0, '3', bn);
    b.ents.forEach(entity);
    put('0', 'ENDBLK', '8', '0');
  }
  put('0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES');
  ents.forEach(entity);
  put('0', 'ENDSEC', '0', 'EOF');
  const text = out.join('\r\n') + '\r\n';
  if (inViewer) download('zeichnung-dxf.zip', zip1('zeichnung.dxf', text));   // .dxf selbst lässt der Viewer nicht zu
  else download('zeichnung.dxf', text, 'application/dxf');
}
function saveFile() { download('zeichnung.json', JSON.stringify({ format: 'mini-cad', version: 3, unit: 'mm', layers, blocks, ents, sheet, model }, null, 1), 'application/json'); }
function applySheet(o) {                     // gespeicherte Blatteinstellungen übernehmen
  if (!o || typeof o !== 'object') return;
  if (PAPER[o.paper]) sheet.paper = o.paper;
  if (o.orient === 'hoch' || o.orient === 'quer') sheet.orient = o.orient;
  if (SCALES.includes(o.scale) || o.scale === 0) sheet.scale = o.scale;
  if (o.dimH >= 1 && o.dimH <= 20) sheet.dimH = o.dimH;
  if (typeof o.title === 'string') sheet.title = o.title.slice(0, 60);
}
function openFile(file) {
  const rd = new FileReader();
  rd.onload = () => {
    let d = null;
    try { d = JSON.parse(rd.result); } catch (e) { /* unten gemeldet */ }
    const obj = d && !Array.isArray(d) ? d : null, raw = Array.isArray(d) ? d : d && d.ents;
    const ls = (obj && cleanLayers(obj.layers)) || layers;   // ältere Dateien ohne Layer: aktuelle Layer behalten
    const bl = obj && obj.blocks ? cleanBlocks(obj.blocks, ls) : blocks;
    const list = cleanEnts(raw, ls, new Set(Object.keys(bl))), mdl = obj && obj.model ? cleanModel(obj.model) : null;
    if (!list.length && !(mdl && mdl.parts.length)) return flash('Die Datei enthält keine lesbare Zeichnung.');
    sel.clear();
    change(() => { layers = ls; blocks = bl; if (mdl) model = mdl; setEnts(list); });
    bumpIds();
    if (obj) applySheet(obj.sheet);
    chain = []; pts = [];
    zoomFit();
  };
  rd.readAsText(file);
}
