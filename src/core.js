'use strict';
document.documentElement.lang = 'de';
const $ = id => document.getElementById(id);
const cv = $('cv'), ctx = cv.getContext('2d'), cmd = $('cmd');

// ---------- Zustand (alle Maße in mm, Y-Achse zeigt nach oben, Winkel in Grad gegen den Uhrzeigersinn) ----------
// Elemente:  line {id,t,l,x1,y1,x2,y2} · dim {…,x1,y1,x2,y2,px,py,mode:'a'|'h'|'v'} · circle {…,cx,cy,r}
//            arc {…,cx,cy,r,a1,a2} (von a1 gegen den Uhrzeigersinn bis a2) · ellipse {…,cx,cy,rx,ry,rot}
//            insert {…,name,x,y,s,rot,fx} = eingefügter Block (fx: gespiegelt); l = Layer
let ents = [];
let nextId = 1;
let layers = [];      // {id,name,color,type,width,on,dims?}; dims = Layer, auf dem neue Bemaßungen landen
let curLayer = 1;     // Layer für neue Elemente
let blocks = {};      // Blockdefinitionen: Name -> {ents} mit Koordinaten relativ zum Basispunkt (0;0)
let model = { params: [], parts: [] };          // 3D-Modell (Variablen und Bauteile), siehe model3d.js
let mode3d = false;
const sel = new Set();
let tool = 'line';
let view = { s: 3, ox: 80, oy: 400 };            // Bildschirm = (ox + x*s, oy - y*s)
const mouse = { x: 0, y: 0, in: false };
let cur = { x: 0, y: 0, snap: null };            // Zeigerposition nach dem Fang
let chain = [];       // Linie: Punkte des laufenden Linienzugs
let pts = [];         // gesetzte Punkte des laufenden Befehls
let selecting = false;                           // Verschieben/Kopieren/Spiegeln: erst noch Elemente auswählen
let first = null;                                // Versetzen/Ecke/Fase/Abrunden: zuerst angeklickte Linie {id, x, y}
let offDist = 0;                                 // zuletzt benutzter Abstand beim Versetzen
let hoverId = 0;                                 // Element unter dem Zeiger (beim Auswählen)
let grip = null;                                 // Griff-Bearbeitung: {refs:[{id,k}], from, kind, held, sx, sy}
let copyHist = [];                               // Kopieren: vorige Auswahl und Ausgangspunkt je Kopie (für Rückgängig)
let dirHold = null;                              // Mausposition beim letzten getippten Maß: bleibt die Maus dort, gilt die alte Richtung
let win = null;                                  // Strecken: Fenster in Weltkoordinaten {x0,y0,x1,y1}
let insName = '';                                // Block einfügen: gewählter Block
let blockName = '';                              // Block bilden: Name des neuen Blocks
let lastDir = 0, drag = null, spaceDown = false, lastMid = 0, raf = 0, flashMsg = '', flashTimer = 0;
let undoStack = [], redoStack = [];
let gver = 0;                                    // Stand der Geometrie (für zwischengespeicherte Blockteile)
const touches = new Map();
let pinch = null, gesture = false;
const opt = { ang: true, step: 45, osnap: true, grid: true, gridStep: 1, gap: false, dia: false, mirKeep: true, radius: 10, cham: [10, 10] };
const sheet = { dimH: 3.5, paper: 'A4', orient: 'quer', scale: 0, title: '' };   // Blatt: Maßtexthöhe in mm auf dem Papier
const APERTURE = 10;                                              // Fangradius in Pixeln
const DIM = { arrow: 9, gap: 3, over: 5, text: 12, textGap: 4 };  // Bemaßung in Maßeinheiten (Schriftgröße = 12)
const EM = 0.72;                                                  // Höhe der Großbuchstaben im Verhältnis zur Schriftgröße
const KEY = 'minicad.v1';
const C = {};                                                     // Farben der Zeichenfläche (aus dem CSS)
const LTYPES = {                             // Linienarten; Strichmuster in Pixeln (für Stärken bis 1,5 px)
  solid:    { name: 'durchgehend',      dash: [],                       dxf: 'CONTINUOUS', desc: 'Solid line' },
  dashed:   { name: 'gestrichelt',      dash: [10, 5],                  dxf: 'DASHED',     desc: '__ __ __' },
  dotted:   { name: 'gepunktet',        dash: [0.01, 4.5],              dxf: 'DOT',        desc: '. . . .' },
  dashdot:  { name: 'Strich-Punkt',     dash: [14, 5, 0.01, 5],         dxf: 'DASHDOT',    desc: '__ . __ .' },
  dashdot2: { name: 'Strich-Zweipunkt', dash: [14, 5, 0.01, 5, 0.01, 5], dxf: 'DIVIDE',    desc: '__ . . __ . .' },
};
const WIDTHS = [[1, 'dünn'], [1.5, 'normal'], [2.5, 'dick'], [4, 'sehr dick']];
const PEN = { 1: 0.18, 1.5: 0.25, 2.5: 0.5, 4: 0.7 };            // Linienstärke auf dem Papier in mm
const PALETTE = ['#1971c2', '#c2255c', '#e8590c', '#6741d9', '#0c8599', '#2b8a3e', '#8a5a44', '#495057'];

// ---------- Hilfsfunktionen ----------
const w2s = (x, y, v = view) => [v.ox + x * v.s, v.oy - y * v.s];
const s2w = (sx, sy) => ({ x: (sx - view.ox) / view.s, y: (view.oy - sy) / view.s });
const R = v => Math.round(v * 1e9) / 1e9;
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const same = (a, b) => Math.abs(a.x - b.x) < 1e-7 && Math.abs(a.y - b.y) < 1e-7;
const angleDeg = (a, b) => (Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI + 360) % 360;
const num = s => /^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/.test(s = s.trim()) ? parseFloat(s.replace(',', '.')) : NaN;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const byId = id => ents.find(e => e.id === id);
const rad = d => d * Math.PI / 180, dg = r => r * 180 / Math.PI;
const n360 = a => ((a % 360) + 360) % 360;
const dimU = v => sheet.dimH / 3.5 / v.s;                         // Maßeinheit in mm für eine Bildschirmansicht
const moving = () => tool === 'move' || tool === 'copy';
const needsSel = () => moving() || tool === 'mirror';             // Befehle, die mit einer Auswahl arbeiten
const boxMode = () => (tool === 'select' && !grip) || selecting || (tool === 'stretch' && !win);   // Klick/Fenster wählt aus
const freePick = () => boxMode() || ['offset', 'trim', 'corner', 'chamfer', 'fillet', 'extend'].includes(tool);   // Zeiger pickt Elemente
const isLine = e => e.t === 'line';
const trimable = e => e.t === 'line' || e.t === 'arc' || e.t === 'circle';
function rayBase() {                         // Ausgangspunkt für Winkelfang und getippte Längen
  if (grip) return grip.from;
  if (tool === 'line') return chain[chain.length - 1] || null;
  return (moving() || tool === 'mirror' || tool === 'stretch') && pts.length ? pts[0] : null;
}
function shiftEnt(e, dx, dy) {               // Element verschieben (verändert e)
  if (e.t === 'line' || e.t === 'dim') {
    e.x1 = R(e.x1 + dx); e.y1 = R(e.y1 + dy); e.x2 = R(e.x2 + dx); e.y2 = R(e.y2 + dy);
    if (e.t === 'dim') { e.px = R(e.px + dx); e.py = R(e.py + dy); }
  } else if (e.t === 'insert') { e.x = R(e.x + dx); e.y = R(e.y + dy); }
  else { e.cx = R(e.cx + dx); e.cy = R(e.cy + dy); }
  return e;
}
function roundEnt(e) {
  for (const k of ['x1', 'y1', 'x2', 'y2', 'px', 'py', 'cx', 'cy', 'r', 'a1', 'a2', 'rx', 'ry', 'rot', 'x', 'y', 's']) if (typeof e[k] === 'number') e[k] = R(e[k]);
  return e;
}

function fmt(n, d = 2) {
  let s = n.toFixed(d);
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  return (s === '-0' ? '0' : s).replace('.', ',');
}
function dirVec(deg) {                      // Einheitsvektor; für 45°-Schritte exakt
  deg = ((deg % 360) + 360) % 360;
  if (deg % 45 === 0) { const q = Math.SQRT1_2; return [[1, 0], [q, q], [0, 1], [-q, q], [-1, 0], [-q, -q], [0, -1], [q, -q]][deg / 45]; }
  const r = deg * Math.PI / 180;
  return [Math.cos(r), Math.sin(r)];
}
function distSeg(px, py, x1, y1, x2, y2) {   // Abstand Punkt – Strecke
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)) : 0;
  return Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
}
function segInt(a, b) {                      // Schnittpunkt zweier Strecken oder null
  const ax = a.x2 - a.x1, ay = a.y2 - a.y1, bx = b.x2 - b.x1, by = b.y2 - b.y1;
  const den = ax * by - ay * bx;
  if (Math.abs(den) <= 1e-10 * Math.hypot(ax, ay) * Math.hypot(bx, by)) return null;
  const t = ((b.x1 - a.x1) * by - (b.y1 - a.y1) * bx) / den, u = ((b.x1 - a.x1) * ay - (b.y1 - a.y1) * ax) / den;
  return t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9 ? null : { x: a.x1 + t * ax, y: a.y1 + t * ay };
}
function gridUnit() {                        // Abstand der feinen Gitterlinien (Zehnerpotenz in mm)
  let m = 1;
  while (m * view.s < 8) m *= 10;
  while (m * view.s >= 80) m /= 10;
  return m;
}
function flash(msg) {
  flashMsg = msg; clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { flashMsg = ''; status(); }, 3500);
  status();
}

// ---------- Layer ----------
const layerById = id => layers.find(l => l.id === id);
const lay = e => layerById(e.l) || layers[0];
const isOn = e => lay(e).on;
const shown = () => ents.filter(isOn);                           // nur Elemente auf sichtbaren Layern
const dimLayer = () => layers.find(l => l.dims) || layers[0];
const baseLayer = () => layers.find(l => !l.dims) || layers[0];
const curName = () => '„' + (layerById(curLayer) || baseLayer()).name + '“';
function defaultLayers() {
  return [
    { id: 1, name: 'Standard', color: '#000000', type: 'solid', width: 1.5, on: true },
    { id: 2, name: 'Bemaßung', color: '#0b7a43', type: 'solid', width: 1, on: true, dims: true },
  ];
}
function uniqueName(base, skip, list = layers) {
  let n = base, i = 2;
  while (list.some(l => l !== skip && l.name.toLowerCase() === n.toLowerCase())) n = base + ' ' + i++;
  return n;
}
function dashFor(l) {                        // Strichmuster, bei dicken Linien mitwachsend
  const f = Math.max(1, l.width / 1.5);
  return LTYPES[l.type].dash.map(d => d * f);
}
const rgbOf = hex => { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const toHex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
function lum(c) {
  const f = v => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}
const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const inkCache = new Map();
function ink(hex, bg, fg) {                  // Layerfarbe so anpassen, dass sie auf dem Hintergrund sichtbar bleibt
  const key = hex + bg + fg;
  let out = inkCache.get(key);
  if (out) return out;
  const c = rgbOf(hex), Lb = lum(rgbOf(bg)), dark = Lb < 0.3, hi = Math.max(...c), lo = Math.min(...c);
  out = hex;
  if (hi - lo < 16 && (dark ? hi < 48 : lo > 224)) out = fg;     // Schwarz bzw. Weiß tauschen wie AutoCAD-Farbe 7
  else if (contrast(lum(c), Lb) < 3.5) {
    for (let k = 1; k <= 10; k++) {          // sonst schrittweise aufhellen bzw. abdunkeln
      const m = c.map(v => Math.round(v + ((dark ? 255 : 0) - v) * k / 10));
      out = toHex(m);
      if (contrast(lum(m), Lb) >= 3.5) break;
    }
  }
  inkCache.set(key, out);
  return out;
}

// ---------- Kurven und Blöcke ----------
const sweepOf = e => { const s = n360(e.a2 - e.a1); return s < 1e-9 ? 360 : s; };   // Öffnungswinkel eines Bogens
const onArc = (e, a) => n360(a - e.a1) <= sweepOf(e) + 1e-7;
const angOf = (cx, cy, x, y) => n360(dg(Math.atan2(y - cy, x - cx)));
const arcPt = (e, a) => ({ x: e.cx + e.r * Math.cos(rad(a)), y: e.cy + e.r * Math.sin(rad(a)) });
function ellPt(e, t) {                       // Punkt einer Ellipse zum Parameter t (Bogenmaß)
  const c = Math.cos(rad(e.rot)), s = Math.sin(rad(e.rot)), x = e.rx * Math.cos(t), y = e.ry * Math.sin(t);
  return { x: e.cx + x * c - y * s, y: e.cy + x * s + y * c };
}
function sample(e, n) {                      // Punkte entlang eines Elements (Kurven als Polygon)
  const o = [];
  if (e.t === 'line') return [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }];
  if (e.t === 'circle') { n = n || 72; for (let i = 0; i <= n; i++) o.push(arcPt(e, 360 * i / n)); }
  else if (e.t === 'arc') { const sw = sweepOf(e); n = n || Math.max(4, Math.ceil(sw / 5)); for (let i = 0; i <= n; i++) o.push(arcPt(e, e.a1 + sw * i / n)); }
  else if (e.t === 'ellipse') { n = n || 96; for (let i = 0; i <= n; i++) o.push(ellPt(e, 2 * Math.PI * i / n)); }
  return o;
}
function segsOf(e) {                         // Strecken entlang eines Elements
  if (e.t === 'line') return [e];
  const p = sample(e), o = [];
  for (let i = 1; i < p.length; i++) o.push({ x1: p[i - 1].x, y1: p[i - 1].y, x2: p[i].x, y2: p[i].y });
  return o;
}
function insertX(e) {                        // Abbildung eines eingefügten Blocks: Maßstab, Spiegelung, Drehung, Lage
  const c = Math.cos(rad(e.rot)), s = Math.sin(rad(e.rot)), sy = e.fx ? -e.s : e.s;
  return { rot: e.rot, flip: !!e.fx, s: e.s, map: (x, y) => { const u = x * e.s, v = y * sy; return { x: e.x + u * c - v * s, y: e.y + u * s + v * c }; } };
}
function mirrorX(a, b) {                     // Spiegelung an der Achse a–b
  const phi = Math.atan2(b.y - a.y, b.x - a.x), c2 = Math.cos(2 * phi), s2 = Math.sin(2 * phi);
  return { rot: dg(2 * phi), flip: true, s: 1, map: (x, y) => { const dx = x - a.x, dy = y - a.y; return { x: a.x + dx * c2 + dy * s2, y: a.y + dx * s2 - dy * c2 }; } };
}
function xformEnt(e, X) {                    // Element abbilden (X: map, rot in Grad, flip, s) – liefert eine Kopie
  const c = { ...e }, m = X.map;
  if (e.t === 'line' || e.t === 'dim') {
    const p = m(e.x1, e.y1), q = m(e.x2, e.y2);
    Object.assign(c, { x1: p.x, y1: p.y, x2: q.x, y2: q.y });
    if (e.t === 'dim') {
      const d = m(e.px, e.py); c.px = d.x; c.py = d.y;
      if (e.mode !== 'a') {                  // waagerechte/senkrechte Maße bleiben es bei Vierteldrehungen
        const k = n360(X.rot) / 90;
        if (Math.abs(k - Math.round(k)) < 1e-9) { if (Math.round(k) % 2) c.mode = e.mode === 'h' ? 'v' : 'h'; }
        else c.mode = 'a';
      }
    }
  } else if (e.t === 'insert') {
    const p = m(e.x, e.y); c.x = p.x; c.y = p.y; c.s = e.s * X.s;
    c.rot = n360(X.flip ? X.rot - e.rot : e.rot + X.rot); c.fx = X.flip ? !e.fx : !!e.fx;
  } else {
    const p = m(e.cx, e.cy); c.cx = p.x; c.cy = p.y;
    if (e.t === 'ellipse') { c.rx = e.rx * X.s; c.ry = e.ry * X.s; c.rot = n360(X.flip ? X.rot - e.rot : e.rot + X.rot); }
    else {
      c.r = e.r * X.s;
      if (e.t === 'arc') { if (X.flip) { c.a1 = n360(X.rot - e.a2); c.a2 = n360(X.rot - e.a1); } else { c.a1 = n360(e.a1 + X.rot); c.a2 = n360(e.a2 + X.rot); } }
    }
  }
  return c;
}
const flatCache = new WeakMap();
function flat(e, depth = 0) {                // Block in seine Teile zerlegen (verschachtelt); sonst das Element selbst
  if (e.t !== 'insert') return [e];
  const hit = flatCache.get(e);
  if (hit && hit.v === gver) return hit.list;
  const b = blocks[e.name], list = [];
  if (b && depth < 8) {
    const X = insertX(e);
    for (const be of b.ents) {
      const c = xformEnt(be, X);
      c.id = e.id;
      if (c.t === 'insert') list.push(...flat(c, depth + 1)); else list.push(c);
    }
  }
  flatCache.set(e, { v: gver, list });
  return list;
}
const prims = list => list.flatMap(e => flat(e));
function usesBlock(name, target, depth = 0) { // enthält Block name (auch verschachtelt) den Block target?
  if (name === target) return true;
  const b = blocks[name];
  return !!b && depth < 8 && b.ents.some(e => e.t === 'insert' && usesBlock(e.name, target, depth + 1));
}
function ptsOf(e, u) {                       // charakteristische Punkte (Kurven abgetastet)
  if (e.t === 'dim') { const g = dimGeom(e, u); return [{ x: g.p1[0], y: g.p1[1] }, { x: g.p2[0], y: g.p2[1] }]; }
  return flat(e).flatMap(p => p.t === 'dim' ? ptsOf(p, u) : sample(p));
}
function bboxOf(e, u) {                      // umschließendes Rechteck [x0, y0, x1, y1]
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  if (e.t === 'line') { add(e.x1, e.y1); add(e.x2, e.y2); }
  else if (e.t === 'dim') { add(e.x1, e.y1); add(e.x2, e.y2); const g = dimGeom(e, u || 0); add(...g.p1); add(...g.p2); }
  else if (e.t === 'circle') { add(e.cx - e.r, e.cy - e.r); add(e.cx + e.r, e.cy + e.r); }
  else if (e.t === 'arc') {
    for (const p of [arcPt(e, e.a1), arcPt(e, e.a2)]) add(p.x, p.y);
    for (let a = 0; a < 360; a += 90) if (onArc(e, a)) { const p = arcPt(e, a); add(p.x, p.y); }
  } else if (e.t === 'ellipse') {
    const c = Math.cos(rad(e.rot)), s = Math.sin(rad(e.rot)), hx = Math.hypot(e.rx * c, e.ry * s), hy = Math.hypot(e.rx * s, e.ry * c);
    add(e.cx - hx, e.cy - hy); add(e.cx + hx, e.cy + hy);
  } else if (e.t === 'insert') {
    add(e.x, e.y);
    for (const c of flat(e)) { const b = bboxOf(c, u); add(b[0], b[1]); add(b[2], b[3]); }
  }
  return [x0, y0, x1, y1];
}
function distTo(e, w, u) {                   // Abstand Punkt – Element
  switch (e.t) {
    case 'line': return distSeg(w.x, w.y, e.x1, e.y1, e.x2, e.y2);
    case 'circle': return Math.abs(Math.hypot(w.x - e.cx, w.y - e.cy) - e.r);
    case 'arc': {
      if (onArc(e, angOf(e.cx, e.cy, w.x, w.y))) return Math.abs(Math.hypot(w.x - e.cx, w.y - e.cy) - e.r);
      const p = arcPt(e, e.a1), q = arcPt(e, e.a2);
      return Math.min(Math.hypot(w.x - p.x, w.y - p.y), Math.hypot(w.x - q.x, w.y - q.y));
    }
    case 'ellipse': { let d = Infinity; for (const s of segsOf(e)) d = Math.min(d, distSeg(w.x, w.y, s.x1, s.y1, s.x2, s.y2)); return d; }
    case 'dim': {
      const g = dimGeom(e, u);
      let d = Math.max(0, Math.hypot(w.x - g.tx, w.y - g.ty) - 8 * u);
      for (const l of g.lines) d = Math.min(d, distSeg(w.x, w.y, ...l));
      return d;
    }
    case 'insert': { let d = Infinity; for (const c of flat(e)) d = Math.min(d, distTo(c, w, u)); return d; }
  }
  return Infinity;
}
function snapPts(e, out = []) {              // Fangpunkte: end, mid, cen (Zentrum), quad (Quadrant), ins (Einfügepunkt)
  switch (e.t) {
    case 'line': out.push({ x: e.x1, y: e.y1, type: 'end' }, { x: e.x2, y: e.y2, type: 'end' }, { x: (e.x1 + e.x2) / 2, y: (e.y1 + e.y2) / 2, type: 'mid' }); break;
    case 'circle': out.push({ x: e.cx, y: e.cy, type: 'cen' }); for (let a = 0; a < 360; a += 90) out.push({ ...arcPt(e, a), type: 'quad' }); break;
    case 'arc':
      out.push({ ...arcPt(e, e.a1), type: 'end' }, { ...arcPt(e, e.a2), type: 'end' }, { ...arcPt(e, e.a1 + sweepOf(e) / 2), type: 'mid' }, { x: e.cx, y: e.cy, type: 'cen' });
      for (let a = 0; a < 360; a += 90) if (onArc(e, a)) out.push({ ...arcPt(e, a), type: 'quad' });
      break;
    case 'ellipse': out.push({ x: e.cx, y: e.cy, type: 'cen' }); for (const t of [0, 0.5, 1, 1.5]) out.push({ ...ellPt(e, t * Math.PI), type: 'quad' }); break;
    case 'insert': out.push({ x: e.x, y: e.y, type: 'ins' }); for (const c of flat(e)) snapPts(c, out); break;
  }
  return out;
}
function segCirc(s, c) {                     // Strecke s mit Kreis bzw. Bogen c
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1, fx = s.x1 - c.cx, fy = s.y1 - c.cy;
  const A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), D = B * B - 4 * A * (fx * fx + fy * fy - c.r * c.r), out = [];
  if (A < 1e-18 || D < -1e-9) return out;
  const sq = Math.sqrt(Math.max(0, D));
  for (const t of D < 1e-12 ? [-B / (2 * A)] : [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) {
    if (t < -1e-9 || t > 1 + 1e-9) continue;
    const p = { x: s.x1 + t * dx, y: s.y1 + t * dy };
    if (c.t !== 'arc' || onArc(c, angOf(c.cx, c.cy, p.x, p.y))) out.push(p);
  }
  return out;
}
function circCirc(a, b) {                    // zwei Kreise bzw. Bögen
  const dx = b.cx - a.cx, dy = b.cy - a.cy, d = Math.hypot(dx, dy), out = [];
  if (d < 1e-9 || d > a.r + b.r + 1e-9 || d < Math.abs(a.r - b.r) - 1e-9) return out;
  const x = (d * d + a.r * a.r - b.r * b.r) / (2 * d), h = Math.sqrt(Math.max(0, a.r * a.r - x * x));
  const mx = a.cx + x * dx / d, my = a.cy + x * dy / d;
  for (const s of h < 1e-9 ? [0] : [-1, 1]) {
    const p = { x: mx - s * h * dy / d, y: my + s * h * dx / d };
    if (a.t === 'arc' && !onArc(a, angOf(a.cx, a.cy, p.x, p.y))) continue;
    if (b.t === 'arc' && !onArc(b, angOf(b.cx, b.cy, p.x, p.y))) continue;
    out.push(p);
  }
  return out;
}
function intersect(a, b) {                   // Schnittpunkte zweier Elemente (Ellipsen angenähert)
  const A = a.t === 'ellipse' ? segsOf(a) : [a], B = b.t === 'ellipse' ? segsOf(b) : [b], out = [];
  for (const p of A) for (const q of B) {
    const lp = !('r' in p), lq = !('r' in q);
    if (lp && lq) { const s = segInt(p, q); if (s) out.push(s); }
    else if (lp) out.push(...segCirc(p, q));
    else if (lq) out.push(...segCirc(q, p));
    else out.push(...circCirc(p, q));
  }
  return out;
}
function rayHits(px, py, dx, dy, o) {        // Parameter t, an denen der Strahl p + t·d (d Einheitsvektor) das Element o trifft
  const out = [];
  const seg = s => {
    const ex = s.x2 - s.x1, ey = s.y2 - s.y1, den = dx * ey - dy * ex;
    if (Math.abs(den) <= 1e-12 * Math.hypot(ex, ey)) return;
    const t = ((s.x1 - px) * ey - (s.y1 - py) * ex) / den, u = ((s.x1 - px) * dy - (s.y1 - py) * dx) / den;
    if (u >= -1e-9 && u <= 1 + 1e-9) out.push(t);
  };
  if (o.t === 'line') seg(o);
  else if (o.t === 'ellipse') segsOf(o).forEach(seg);
  else if (o.t === 'circle' || o.t === 'arc') {
    const fx = px - o.cx, fy = py - o.cy, b = fx * dx + fy * dy, D = b * b - (fx * fx + fy * fy - o.r * o.r);
    if (D >= -1e-9) for (const t of D < 1e-12 ? [-b] : [-b - Math.sqrt(D), -b + Math.sqrt(D)]) {
      if (o.t === 'arc' && !onArc(o, angOf(o.cx, o.cy, px + t * dx, py + t * dy))) continue;
      out.push(t);
    }
  }
  return out;
}
