// ---------- Änderungen, Rückgängig, Speichern ----------
let pending = null, pendTimer = 0;           // Farbwahl: Zustand vor dem Ziehen im Farbwähler
let sampleSig = '';                          // Inhalt der Beispielzeichnung, solange ihr Hinweis sichtbar ist
function snapshot() { return JSON.stringify({ ents, layers, blocks, model }); }
function pushUndo(s) { undoStack.push(s); if (undoStack.length > 300) undoStack.shift(); redoStack = []; }
function commitLive() { clearTimeout(pendTimer); if (pending) { pushUndo(pending); pending = null; save(); } }
function fixState() {                        // Auswahl und Bezüge an geänderte Daten anpassen
  if (!layerById(curLayer)) curLayer = baseLayer().id;
  for (const id of [...sel]) { const e = byId(id); if (!e || !isOn(e)) sel.delete(id); }
  if (first) { const e = byId(first.id); if (!e || !isOn(e)) first = null; }
  if (grip && grip.refs.some(r => { const e = byId(r.id); return !e || !isOn(e); })) grip = null;
}
function setEnts(list) {
  gver++;
  ents = list; nextId = ents.reduce((m, e) => Math.max(m, e.id), 0) + 1; first = null;
  fixState();
}
function restore(s) { const o = JSON.parse(s); layers = o.layers; blocks = o.blocks || {}; if (o.model) model = o.model; setEnts(o.ents); modelChanged(); }
function save() { try { localStorage.setItem(KEY, JSON.stringify({ ents, layers, curLayer, blocks, opt, sheet, model })); } catch (e) { /* kein Speicher verfügbar */ } }
function change(fn) {
  commitLive();
  pushUndo(snapshot());
  fn(); gver++; fixState(); modelChanged(); save();
  if (!$('note').hidden && JSON.stringify(ents) !== sampleSig) $('note').hidden = true;   // Hinweis weg, sobald gezeichnet wird
}
function undo() {
  commitLive();
  if (tool === 'line' && chain.length === 1) chain = [];     // nur den Startpunkt zurücknehmen
  else if (undoStack.length) {
    redoStack.push(snapshot());
    restore(undoStack.pop());
    if (chain.length > 1) {                  // zurückgenommenes Stück auch aus dem laufenden Linienzug nehmen
      const a = chain[chain.length - 2], b = chain[chain.length - 1];
      if (!ents.some(e => e.t === 'line' && same({ x: e.x1, y: e.y1 }, a) && same({ x: e.x2, y: e.y2 }, b))) chain.pop();
    }
    pts = []; grip = null;
    const h = copyHist[copyHist.length - 1];
    if (tool === 'copy' && h && h.depth === undoStack.length) {   // Kopieren läuft weiter: zurück zur vorigen Kopie
      copyHist.pop(); sel.clear();
      for (const id of h.ids) if (byId(id)) sel.add(id);
      if (sel.size) pts = [h.base];
    }
    save();
  }
  refresh();
}
function redo() {
  commitLive();
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  restore(redoStack.pop());
  chain = []; pts = []; grip = null; copyHist = []; save(); refresh();
}
function delSel() {
  if (!sel.size) return;
  grip = null;
  change(() => { ents = ents.filter(e => !sel.has(e.id)); });
  sel.clear(); refresh();
}
function clearDrawing() {
  if (!ents.length) return;
  change(() => setEnts([]));
  chain = []; pts = [];
  zoomFit();
  flash('Zeichnung geleert, die Layer bleiben erhalten. Strg+Z holt die Zeichnung zurück.');
}
function cleanLayers(list) {                 // geladene Layer prüfen; null = keine brauchbaren dabei
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const l of list) {
    if (!l || !Number.isInteger(l.id) || l.id < 1 || out.some(o => o.id === l.id)) continue;
    const name = typeof l.name === 'string' ? l.name.trim().replace(/\s+/g, ' ').slice(0, 40) : '';
    const c = { id: l.id, name: '', color: typeof l.color === 'string' && /^#[0-9a-f]{6}$/i.test(l.color) ? l.color.toLowerCase() : '#000000',
                type: typeof l.type === 'string' && has(LTYPES, l.type) ? l.type : 'solid',
                width: WIDTHS.some(w => w[0] === l.width) ? l.width : 1.5, on: l.on !== false };
    if (l.dims === true && !out.some(o => o.dims)) c.dims = true;
    c.name = uniqueName(name || 'Layer ' + l.id, c, out);
    out.push(c);
  }
  if (!out.length) return null;
  if (!out.some(o => o.dims)) out.push({ id: Math.max(...out.map(o => o.id)) + 1, name: uniqueName('Bemaßung', null, out),
                                         color: '#0b7a43', type: 'solid', width: 1, on: true, dims: true });
  return out;
}
function cleanEnts(list, ls, names = new Set(Object.keys(blocks))) {   // geladene Elemente prüfen; unbekannte Layer -> Standard bzw. Bemaßung
  const ok = v => typeof v === 'number' && isFinite(v), pos = v => ok(v) && v > 0, out = [];
  const base = (ls.find(l => !l.dims) || ls[0]).id, dl = (ls.find(l => l.dims) || ls[0]).id;
  for (const e of Array.isArray(list) ? list : []) {
    if (!e || typeof e !== 'object') continue;
    const l = ls.some(o => o.id === e.l) ? e.l : e.t === 'dim' ? dl : base, id = out.length + 1;
    if (e.t === 'line' && [e.x1, e.y1, e.x2, e.y2].every(ok)) out.push({ id, t: 'line', l, x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2 });
    else if (e.t === 'dim' && [e.x1, e.y1, e.x2, e.y2, e.px, e.py].every(ok))
      out.push({ id, t: 'dim', l, x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, px: e.px, py: e.py, mode: e.mode === 'h' || e.mode === 'v' ? e.mode : 'a' });
    else if (e.t === 'circle' && ok(e.cx) && ok(e.cy) && pos(e.r)) out.push({ id, t: 'circle', l, cx: e.cx, cy: e.cy, r: e.r });
    else if (e.t === 'arc' && ok(e.cx) && ok(e.cy) && pos(e.r) && ok(e.a1) && ok(e.a2)) out.push({ id, t: 'arc', l, cx: e.cx, cy: e.cy, r: e.r, a1: n360(e.a1), a2: n360(e.a2) });
    else if (e.t === 'ellipse' && ok(e.cx) && ok(e.cy) && pos(e.rx) && pos(e.ry)) out.push({ id, t: 'ellipse', l, cx: e.cx, cy: e.cy, rx: e.rx, ry: e.ry, rot: ok(e.rot) ? n360(e.rot) : 0 });
    else if (e.t === 'insert' && typeof e.name === 'string' && names.has(e.name) && ok(e.x) && ok(e.y))
      out.push({ id, t: 'insert', l, name: e.name, x: e.x, y: e.y, s: pos(e.s) ? e.s : 1, rot: ok(e.rot) ? n360(e.rot) : 0, fx: e.fx === true });
  }
  return out;
}
function cleanBlocks(raw, ls) {              // geladene Blockdefinitionen prüfen (ohne Zirkelbezüge)
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const names = new Set(Object.keys(raw).filter(n => n.trim() && n.length <= 60 && raw[n] && Array.isArray(raw[n].ents)));
  for (const n of names) out[n] = { ents: cleanEnts(raw[n].ents, ls, names).map(({ id, ...e }) => e) };
  const keep = blocks;
  blocks = out;
  for (const n of Object.keys(out)) out[n].ents = out[n].ents.filter(e => e.t !== 'insert' || !usesBlock(e.name, n));
  blocks = keep;
  return out;
}
function loadSample() {                      // Beispiel für den ersten Start: Nische mit Korpus auf eigenen Layern
  layers = [
    { id: 1, name: 'Standard', color: '#000000', type: 'solid', width: 1.5, on: true },
    { id: 2, name: 'Bemaßung', color: '#0b7a43', type: 'solid', width: 1, on: true, dims: true },
    { id: 3, name: 'Wand', color: '#000000', type: 'solid', width: 2.5, on: true },
    { id: 4, name: 'Korpus', color: '#1971c2', type: 'solid', width: 1.5, on: true },
    { id: 5, name: 'Mittellinie', color: '#c2255c', type: 'dashdot', width: 1, on: true },
  ];
  const L = (l, x1, y1, x2, y2) => ({ t: 'line', l, x1, y1, x2, y2 });
  const D = (x1, y1, x2, y2, px, py, mode) => ({ t: 'dim', l: 2, x1, y1, x2, y2, px, py, mode });
  setEnts([
    L(3, 0, 0, 0, 600), L(3, 0, 600, 1200, 600), L(3, 1200, 600, 1200, 0),          // Nische innen 1200 × 600
    L(3, -150, 0, -150, 750), L(3, -150, 750, 1350, 750), L(3, 1350, 750, 1350, 0),   // Wand außen, 150 mm stark
    L(3, -150, 0, 0, 0), L(3, 1200, 0, 1350, 0),                                      // Wandenden
    L(4, 50, 20, 1150, 20), L(4, 1150, 20, 1150, 580), L(4, 1150, 580, 50, 580), L(4, 50, 580, 50, 20),   // Korpus 1100 × 560
    L(5, 600, -60, 600, 820),                                                         // Mittellinie
    D(0, 0, 1200, 0, 600, -300, 'h'), D(50, 20, 1150, 20, 600, -170, 'h'),
    D(1150, 20, 1150, 580, 1500, 300, 'v'), D(-150, 750, 0, 600, -75, 900, 'h'),
  ].map((e, i) => ({ id: i + 1, ...e })));
  curLayer = 1;
  sampleSig = JSON.stringify(ents);
}

// ---------- Layer verwalten ----------
let layerSig = '', rowIds = '', armed = 0, armTimer = 0;
function svgLine(l, w) {                     // kleine Vorschau einer Linienart
  if (!l) return '';
  const d = dashFor(l).join(' '), p = l.width / 2 + 2;
  return '<line x1="' + p + '" y1="7" x2="' + (w - p) + '" y2="7" stroke="' + ink(l.color, C.ui, C.line) + '" stroke-width="' + l.width +
         '" stroke-linecap="round"' + (d ? ' stroke-dasharray="' + d + '"' : '') + '/>';
}
function selInfo() {                         // im Auswahlmodus: der gemeinsame Layer der ausgewählten Elemente (0 = verschiedene)
  if (tool !== 'select' || !sel.size) return null;
  const ids = new Set(ents.filter(e => sel.has(e.id)).map(e => e.l));
  return { one: ids.size === 1 ? [...ids][0] : 0 };
}
function syncLayerUI(force) {
  const counts = new Map();
  for (const e of ents) counts.set(e.l, (counts.get(e.l) || 0) + 1);
  const si = selInfo(), showId = si ? si.one : curLayer;
  const sig = JSON.stringify([layers, curLayer, [...counts], si, armed, C.ui, C.line]);
  if (!force && sig === layerSig) return;
  layerSig = sig;
  const s = $('layerSel');
  if (document.activeElement !== s) {
    s.textContent = '';
    if (!showId) { const o = new Option('– verschiedene –', ''); o.disabled = true; s.add(o); }
    for (const l of layers) s.add(new Option(l.name + (l.on ? '' : ' (ausgeblendet)'), String(l.id)));
    s.value = showId ? String(showId) : '';
  }
  $('layerLbl').textContent = si ? 'Auswahl auf' : 'Layer';
  $('layerSw').innerHTML = svgLine(layerById(showId), 36);
  const ids = layers.map(l => l.id).join();
  if (ids !== rowIds) { rowIds = ids; buildRows(); }
  for (const l of layers) updateRow(l, counts.get(l.id) || 0);
  $('layerHint').textContent = 'Neue Linien und Rechtecke landen auf dem markierten Layer. Bemaßungen landen immer auf „' + dimLayer().name +
    '“. Vorhandene Linien umstellen: Linien auswählen und oben bei „Auswahl auf“ den Ziel-Layer wählen.';
}
function buildRows() {
  const box = $('layerRows');
  box.textContent = '';
  for (const l of layers) {
    const id = l.id, row = document.createElement('div');
    row.className = 'lrow'; row.id = 'lrow-' + id;
    row.innerHTML =
      '<input type="radio" name="curLayer" id="lcur-' + id + '" class="lcur" title="Aktueller Layer: neue Linien landen hier" aria-label="Aktueller Layer">' +
      '<input type="text" id="lname-' + id + '" class="lname" maxlength="40" spellcheck="false" autocomplete="off" aria-label="Name des Layers">' +
      '<input type="color" id="lcolor-' + id + '" class="lcolor" title="Farbe" aria-label="Farbe">' +
      '<select id="ltype-' + id + '" class="ltype" title="Linienart" aria-label="Linienart">' +
        Object.keys(LTYPES).map(k => '<option value="' + k + '">' + LTYPES[k].name + '</option>').join('') + '</select>' +
      '<svg class="lprev" width="56" height="14" aria-hidden="true"></svg>' +
      '<select id="lwidth-' + id + '" class="lwidth" title="Linienstärke" aria-label="Linienstärke">' +
        WIDTHS.map(([v, n]) => '<option value="' + v + '">' + n + '</option>').join('') + '</select>' +
      '<label class="lon" title="Layer ein- oder ausblenden"><input type="checkbox" id="lon-' + id + '"> sichtbar</label>' +
      '<button type="button" class="lsel" id="lsel-' + id + '" title="Alle Elemente dieses Layers auswählen"></button>' +
      '<button type="button" class="ldel" id="ldel-' + id + '"></button>';
    const q = c => row.querySelector(c), name = q('.lname'), col = q('.lcolor');
    q('.lcur').onchange = () => { curLayer = id; save(); refresh(); };
    name.onchange = () => renameLayer(id, name);
    name.onkeydown = ev => { if (ev.key === 'Escape') { const L = layerById(id); if (L) name.value = L.name; } };
    col.oninput = () => liveColor(id, col.value);
    col.onchange = () => { liveColor(id, col.value); commitLive(); };
    q('.ltype').onchange = ev => { setProp(id, 'type', ev.target.value); ev.target.blur(); };
    q('.lwidth').onchange = ev => { setProp(id, 'width', +ev.target.value); ev.target.blur(); };
    q('.lon input').onchange = ev => setProp(id, 'on', ev.target.checked);
    q('.lsel').onclick = () => selectLayer(id);
    q('.ldel').onclick = () => deleteLayer(id);
    box.appendChild(row);
  }
}
function updateRow(l, count) {               // Werte einer Zeile nachführen, ohne Eingaben zu stören
  const row = $('lrow-' + l.id);
  if (!row) return;
  const q = c => row.querySelector(c), act = document.activeElement;
  row.classList.toggle('cur', l.id === curLayer);
  row.classList.toggle('off', !l.on);
  q('.lcur').checked = l.id === curLayer;
  const name = q('.lname'), col = q('.lcolor');
  if (name !== act && name.value !== l.name) name.value = l.name;
  if (col !== act && col.value !== l.color) col.value = l.color;
  q('.ltype').value = l.type;
  q('.lwidth').value = String(l.width);
  q('.lon input').checked = l.on;
  const pv = q('.lprev'), ps = l.color + l.type + l.width + C.ui + C.line;
  if (pv.dataset.s !== ps) { pv.dataset.s = ps; pv.innerHTML = svgLine(l, 56); }
  const b = q('.lsel');
  b.textContent = 'Auswählen (' + count + ')';
  b.disabled = !count || !l.on;
  const d = q('.ldel');
  d.disabled = !!l.dims;
  d.textContent = armed === l.id ? 'Wirklich löschen?' : 'Löschen';
  d.classList.toggle('armed', armed === l.id);
  d.title = l.dims ? 'Auf diesem Layer landen die Bemaßungen, er bleibt deshalb erhalten.'
    : count ? 'Layer samt ' + count + (count === 1 ? ' Element' : ' Elementen') + ' löschen' : 'Layer löschen';
}
function renameLayer(id, input) {
  const l = layerById(id), n = input.value.trim().replace(/\s+/g, ' ');
  if (!l) return;
  if (n === l.name) { input.value = n; return; }
  if (!n) { input.value = l.name; return flash('Der Name darf nicht leer sein.'); }
  if (layers.some(o => o !== l && o.name.toLowerCase() === n.toLowerCase())) { input.value = l.name; return flash('Einen Layer „' + n + '“ gibt es schon.'); }
  change(() => { l.name = n; });
  refresh();
}
function setProp(id, key, val) {
  const l = layerById(id);
  if (!l || l[key] === val) return;
  change(() => { l[key] = val; });
  refresh();
}
function liveColor(id, value) {              // Farbe live zeigen, als ein Rückgängig-Schritt speichern
  const l = layerById(id);
  if (!l || !/^#[0-9a-f]{6}$/i.test(value) || l.color === value.toLowerCase()) return;
  if (!pending) pending = snapshot();
  l.color = value.toLowerCase();
  clearTimeout(pendTimer); pendTimer = setTimeout(commitLive, 700);
  refresh();
}
function addLayer() {
  const id = layers.reduce((m, l) => Math.max(m, l.id), 0) + 1, used = new Set(layers.map(l => l.color));
  let i = 1;
  while (layers.some(l => l.name.toLowerCase() === 'layer ' + i)) i++;
  const color = PALETTE.find(c => !used.has(c)) || PALETTE[id % PALETTE.length];
  change(() => layers.push({ id, name: 'Layer ' + i, color, type: 'solid', width: 1.5, on: true }));
  curLayer = id; save();
  syncLayerUI(true);
  const inp = $('lname-' + id);
  if (inp) { inp.focus(); inp.select(); inp.scrollIntoView({ block: 'nearest' }); }
  flash('Neuer Layer angelegt und als aktueller gesetzt. Namen eintippen und Enter drücken.');
  refresh();
}
function deleteLayer(id) {
  const l = layerById(id), n = ents.filter(e => e.l === id).length;
  if (!l || l.dims) return;
  if (n && armed !== id) {                   // Layer mit Inhalt: zweiter Klick bestätigt
    armed = id; clearTimeout(armTimer);
    armTimer = setTimeout(() => { armed = 0; refresh(); }, 4000);
    return refresh();
  }
  armed = 0; clearTimeout(armTimer);
  change(() => {
    ents = ents.filter(e => e.l !== id); layers = layers.filter(o => o !== l);
    const nb = (layers.find(o => !o.dims) || layers[0]).id;          // Teile von Blöcken bleiben, kommen auf den Standard-Layer
    for (const b of Object.values(blocks)) for (const e of b.ents) if (e.l === id) e.l = nb;
  });
  flash(n ? 'Layer „' + l.name + '“ mit ' + n + (n === 1 ? ' Element' : ' Elementen') + ' gelöscht. Strg+Z holt ihn zurück.' : 'Layer „' + l.name + '“ gelöscht.');
  refresh();
}
function selectLayer(id) {
  const l = layerById(id);
  if (!l || !l.on) return;
  setTool('select');
  sel.clear();
  for (const e of ents) if (e.l === id) sel.add(e.id);
  $('layers').hidden = true;
  flash(sel.size + (sel.size === 1 ? ' Element' : ' Elemente') + ' auf „' + l.name + '“ ausgewählt · M verschieben · K kopieren · Entf löscht');
  refresh();
}
function togglePanel(id) {
  const p = $(id), open = p.hidden;
  for (const q of ['layers', 'help', 'sheet', 'blocks']) $(q).hidden = true;
  p.hidden = !open;
  if (open && id === 'layers') syncLayerUI(true);
  if (open && id === 'blocks') blockRows();
  if (open && id === 'sheet') sheetUI();
}

// ---------- Maus / Touch ----------
function setMouse(ev) { const r = cv.getBoundingClientRect(); mouse.x = ev.clientX - r.left; mouse.y = ev.clientY - r.top; mouse.in = true; }

cv.addEventListener('mousedown', ev => { if (ev.button === 1) ev.preventDefault(); });   // kein Auto-Scroll
cv.addEventListener('contextmenu', ev => ev.preventDefault());
cv.addEventListener('pointerdown', ev => {
  const f = document.activeElement;
  if (f && f !== document.body && f !== cmd) f.blur();
  try { cv.setPointerCapture(ev.pointerId); } catch (e) { /* egal */ }
  setMouse(ev); flashMsg = '';
  if (ev.pointerType === 'touch') return touchDown(ev);
  if (ev.button === 1 || ev.button === 2 || (ev.button === 0 && spaceDown)) {
    if (ev.button === 1) { if (ev.timeStamp - lastMid < 350) zoomFit(); lastMid = ev.timeStamp; }
    drag = { type: 'pan', btn: ev.button, x: ev.clientX, y: ev.clientY, moved: 0 };
    ev.preventDefault();
  } else if (ev.button === 0) {
    const g = tool === 'select' && !grip && !ev.shiftKey && gripAt(mouse.x, mouse.y, 7);
    if (g) startGrip(g);
    else if (boxMode()) drag = { type: 'box', x0: mouse.x, y0: mouse.y, add: ev.shiftKey || selecting };
    else click();
  }
  refresh();
});
cv.addEventListener('pointermove', ev => {
  if (ev.pointerType === 'touch') return touchMove(ev);
  setMouse(ev);
  if (drag && drag.type === 'pan') {
    const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy); drag.x = ev.clientX; drag.y = ev.clientY;
    view.ox += dx; view.oy += dy;
  }
  refresh();
});
cv.addEventListener('pointerup', ev => {
  if (ev.pointerType === 'touch') return touchUp(ev);
  setMouse(ev);
  if (grip && grip.held && ev.button === 0) {                // Griff gezogen und losgelassen: dort ablegen
    grip.held = false;
    if (Math.hypot(mouse.x - grip.sx, mouse.y - grip.sy) > 4) click();
  }
  if (drag && drag.type === 'pan' && drag.btn === 2 && drag.moved < 5) finish();   // Rechtsklick = Befehl beenden
  if (drag && drag.type === 'box') endBox();
  drag = null; refresh();
});
cv.addEventListener('pointerleave', () => { if (!drag) { mouse.in = false; refresh(); } });
cv.addEventListener('pointercancel', () => { drag = null; touches.clear(); pinch = null; gesture = false; refresh(); });
cv.addEventListener('wheel', ev => {
  ev.preventDefault();
  setMouse(ev);
  const dy = ev.deltaMode === 1 ? ev.deltaY * 33 : ev.deltaY;
  zoomAt(mouse.x, mouse.y, Math.exp(-dy * (ev.ctrlKey ? 0.01 : 0.0015)));
  refresh();
}, { passive: false });

// Touch: tippen/ziehen = Punkt setzen, zwei Finger = verschieben und zoomen
function touchDown(ev) {
  touches.set(ev.pointerId, [ev.clientX, ev.clientY]);
  if (touches.size === 2) {
    const [a, b] = [...touches.values()];
    pinch = { d: Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, v: { ...view } };
    gesture = true; drag = null;
  } else if (!gesture) {
    const g = tool === 'select' && !grip && gripAt(mouse.x, mouse.y, 14);
    if (g) startGrip(g);
    else if (boxMode()) drag = { type: 'box', x0: mouse.x, y0: mouse.y, add: selecting };
  }
  refresh();
}
function touchMove(ev) {
  if (!touches.has(ev.pointerId)) return;
  touches.set(ev.pointerId, [ev.clientX, ev.clientY]);
  if (pinch && touches.size === 2) {
    const [a, b] = [...touches.values()], r = cv.getBoundingClientRect(), v = pinch.v;
    const s = Math.min(5000, Math.max(0.002, v.s * (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1) / pinch.d));
    const wx = (pinch.cx - r.left - v.ox) / v.s, wy = (v.oy - (pinch.cy - r.top)) / v.s;
    view = { s, ox: (a[0] + b[0]) / 2 - r.left - wx * s, oy: (a[1] + b[1]) / 2 - r.top + wy * s };
  } else if (!gesture) setMouse(ev);
  refresh();
}
function touchUp(ev) {
  touches.delete(ev.pointerId);
  if (gesture) { if (!touches.size) { gesture = false; pinch = null; } return; }
  setMouse(ev);
  if (grip && grip.held) { grip.held = false; if (Math.hypot(mouse.x - grip.sx, mouse.y - grip.sy) > 8) click(); }
  else if (drag && drag.type === 'box') endBox(); else if (!boxMode()) click();
  drag = null; refresh();
}

// ---------- Tastatur ----------
function toggle(id, key) { opt[key] = $(id).checked = !opt[key]; save(); }

window.addEventListener('keydown', ev => {
  const t = ev.target, k = ev.key;
  if ((t instanceof HTMLInputElement && t !== cmd && t.type !== 'checkbox' && t.type !== 'radio') || t instanceof HTMLSelectElement) {
    if (k === 'Escape' || k === 'Enter') t.blur();
    return;
  }
  if (!$('dlg').hidden) { if (k === 'Escape') { ev.preventDefault(); closeDialog(false); } return; }
  const altGr = ev.getModifierState('AltGraph');              // AltGr (z. B. für @) meldet sich als Strg+Alt
  flashMsg = '';
  if (mode3d) return key3d(ev, altGr);
  if ((ev.ctrlKey || ev.metaKey) && !altGr) {
    const l = k.toLowerCase();
    if (l === 'z') { ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); }
    else if (l === 'y') { ev.preventDefault(); redo(); }
    else if (l === 's') { ev.preventDefault(); saveFile(); }
    else if (l === 'a') { ev.preventDefault(); if (!boxMode()) setTool('select'); for (const e of shown()) sel.add(e.id); refresh(); }
    return;
  }
  if (ev.altKey && !altGr) return;
  if (k === 'Escape') escape();
  else if (k === 'Enter') applyTyped();
  else if (k === 'Delete' || k === 'Backspace') {
    if (cmd.value) { if (t === cmd) return; cmd.value = cmd.value.slice(0, -1); }
    else delSel();
  }
  else if (k === 'F3') toggle('oSnap', 'osnap');
  else if (k === 'F8') toggle('oAng', 'ang');
  else if (k === 'F9') toggle('oGrid', 'grid');
  else if (k === ' ') { spaceDown = true; cv.style.cursor = 'grab'; }
  else if (/^[0-9.,;<@+\-]$/.test(k)) { if (t === cmd) return; cmd.value += k; }
  else if (k.length === 1) {
    if (t === cmd) return;                   // Buchstaben im Eingabefeld schalten kein Werkzeug um
    const l = k.toLowerCase();
    if (l === 'l') setTool('line');
    else if (l === 'r') setTool('rect');
    else if (l === 'b' || l === 'd') setTool('dim');
    else if (l === 'a') setTool('select');
    else if (l === 'm') setTool('move');
    else if (l === 'k') setTool('copy');
    else if (l === 'v' || l === 'o') setTool('offset');
    else if (l === 't') setTool('trim');
    else if (l === 'e') setTool('corner');
    else if (l === 'c') { if (tool === 'line' && chain.length > 2) pick(chain[0]); else setTool('circle'); }
    else if (l === 's') setTool('stretch');
    else if (l === 'x') setTool('extend');
  }
  else return;
  ev.preventDefault();
  refresh();
});
window.addEventListener('keyup', ev => { if (ev.key === ' ') { spaceDown = false; cv.style.cursor = ''; } });
window.addEventListener('blur', () => { spaceDown = false; cv.style.cursor = ''; });
cmd.addEventListener('input', () => { cmd.value = cmd.value.replace(/[^0-9.,;<@+\-]/g, ''); refresh(); });

// ---------- Bedienelemente ----------
document.querySelectorAll('[data-tool]').forEach(b => { b.onclick = () => setTool(b.dataset.tool); });
$('undo').onclick = undo; $('redo').onclick = redo; $('del').onclick = delSel; $('fit').onclick = zoomFit;
$('ok').onclick = applyTyped;
$('png').onclick = exportPNG; $('dxf').onclick = exportDXF; $('print').onclick = printDrawing; $('save').onclick = saveFile;
$('open').onclick = () => $('file').click();
$('file').onchange = ev => { if (ev.target.files[0]) openFile(ev.target.files[0]); ev.target.value = ''; };
$('new').onclick = clearDrawing;
$('helpBtn').onclick = () => togglePanel('help');
$('closeHelp').onclick = () => { $('help').hidden = true; };
$('layersBtn').onclick = () => togglePanel('layers');
$('closeLayers').onclick = () => { $('layers').hidden = true; };
$('addLayer').onclick = addLayer;
$('noteClear').onclick = () => { clearDrawing(); $('note').hidden = true; };
$('noteClose').onclick = () => { $('note').hidden = true; };
$('mvShift').onclick = () => { opt.gap = false; save(); refresh(); };
$('cmR').onclick = () => { opt.dia = false; save(); refresh(); };
$('cmD').onclick = () => { opt.dia = true; save(); refresh(); };
$('mmKeep').onclick = () => { opt.mirKeep = true; save(); refresh(); };
$('mmDel').onclick = () => { opt.mirKeep = false; save(); refresh(); };
$('exportBtn').onclick = () => togglePanel('sheet');
$('closeSheet').onclick = () => { $('sheet').hidden = true; };
$('blocksBtn').onclick = () => togglePanel('blocks');
$('closeBlocks').onclick = () => { $('blocks').hidden = true; };
$('blockMake').onclick = startBlockMake;
$('explode').onclick = explodeSel;
$('mvGap').onclick = () => { opt.gap = true; save(); refresh(); };
$('layerSel').onchange = ev => {             // ohne Auswahl: aktueller Layer; mit Auswahl: deren Layer ändern
  const id = +ev.target.value, l = layerById(id);
  ev.target.blur();
  if (!l) return;
  if (tool === 'select' && sel.size) {
    const n = sel.size;
    change(() => { for (const e of ents) if (sel.has(e.id)) e.l = id; l.on = true; });
    flash(n + (n === 1 ? ' Element' : ' Elemente') + ' auf Layer „' + l.name + '“ gesetzt.');
  } else { curLayer = id; save(); }
  refresh();
};
for (const [id, key] of [['oAng', 'ang'], ['oSnap', 'osnap'], ['oGrid', 'grid']]) $(id).onchange = ev => { opt[key] = ev.target.checked; save(); refresh(); };
$('oStep').onchange = ev => { opt.step = +ev.target.value; ev.target.blur(); save(); refresh(); };
$('oGridStep').onchange = ev => {
  const v = parseFloat(ev.target.value);
  if (v > 0) opt.gridStep = v;
  ev.target.value = opt.gridStep; save(); refresh();
};


// ---------- Eingabedialog ----------
let dlgResolve = null;
function ask({ title, text, fields, ok = 'OK' }) {   // kleiner Dialog im Fenster; liefert die Werte oder null
  closeDialog(false);
  return new Promise(res => {
    dlgResolve = res;
    $('dlgTitle').textContent = title; $('dlgText').textContent = text || ''; $('dlgOk').textContent = ok;
    const f = $('dlgForm');
    f.textContent = '';
    for (const fd of fields) {
      const lab = document.createElement('label');
      lab.append(fd.label + ' ');
      let inp;
      if (fd.options) { inp = document.createElement('select'); for (const [v, t] of fd.options) inp.add(new Option(t, v)); }
      else { inp = document.createElement('input'); inp.type = 'text'; inp.autocomplete = 'off'; inp.spellcheck = false; }
      inp.id = 'dlg-' + fd.id; inp.value = fd.value === undefined ? '' : String(fd.value);
      lab.appendChild(inp);
      if (fd.unit) lab.append(' ' + fd.unit);
      f.appendChild(lab);
    }
    $('dlg').hidden = false;
    const fi = f.querySelector('input,select');
    if (fi) { fi.focus(); if (fi.select) fi.select(); }
  });
}
function closeDialog(ok) {
  if ($('dlg').hidden) return;
  const vals = ok ? Object.fromEntries([...$('dlgForm').querySelectorAll('input,select')].map(i => [i.id.slice(4), i.value])) : null;
  $('dlg').hidden = true;
  const r = dlgResolve;
  dlgResolve = null;
  if (r) r(vals);
}
$('dlgOk').onclick = () => closeDialog(true);
$('dlgCancel').onclick = () => closeDialog(false);
$('dlgForm').addEventListener('keydown', ev => {
  if (ev.key === 'Enter') { ev.preventDefault(); closeDialog(true); }
  else if (ev.key === 'Escape') { ev.preventDefault(); closeDialog(false); }
});

// ---------- Blöcke ----------
async function startBlockMake() {
  if (mode3d) return;
  if (!sel.size) return flash('Erst die Elemente auswählen, die zum Block werden sollen.');
  let i = 1;
  while (blocks['Block ' + i]) i++;
  const v = await ask({ title: 'Block bilden', text: 'Ein vorhandener Name ersetzt diesen Block überall, wo er eingefügt ist.', fields: [{ id: 'name', label: 'Name', value: 'Block ' + i }], ok: 'Weiter' });
  if (!v) return;
  const n = v.name.trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!n) return flash('Der Block braucht einen Namen.');
  if (!sel.size) return flash('Die Auswahl ist leer.');
  blockName = n;
  setTool('blockbase');
}
function blockRows() {                       // Liste der Blockdefinitionen
  const box = $('blockRows'), names = Object.keys(blocks).sort((a, b) => a.localeCompare(b, 'de'));
  box.textContent = '';
  if (!names.length) {
    const p = document.createElement('p');
    p.className = 'hint'; p.textContent = 'Noch keine Blöcke. Elemente auswählen und „Block bilden“ klicken.';
    return box.appendChild(p);
  }
  for (const n of names) {
    const used = ents.filter(e => e.t === 'insert' && e.name === n).length + Object.values(blocks).filter(b => b.ents.some(e => e.t === 'insert' && e.name === n)).length;
    const row = document.createElement('div'), name = document.createElement('span'), info = document.createElement('span');
    const ins = document.createElement('button'), del = document.createElement('button');
    row.className = 'lrow'; name.className = 'bname'; name.textContent = n;
    info.className = 'hint'; info.textContent = used + '× eingefügt';
    ins.type = del.type = 'button'; ins.textContent = 'Einfügen'; del.textContent = 'Löschen';
    ins.onclick = () => { insName = n; $('blocks').hidden = true; setTool('insert'); };
    del.disabled = used > 0; del.title = used ? 'Der Block ist noch eingefügt.' : 'Blockdefinition löschen';
    del.onclick = () => { change(() => { delete blocks[n]; }); blockRows(); refresh(); };
    row.append(name, info, ins, del);
    box.appendChild(row);
  }
}
