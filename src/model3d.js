// ---------- 3D: Modell aus Bauteilen (Koordinaten X = Breite, Y = Tiefe, Z = Höhe; alles in mm) ----------
// model = { params: [{name, expr}], parts: [{id, name, color, material, hide, pos: {x,y,z}, features: [...]}] }
// Erstes Merkmal = Grundkörper: box {sx,sy,sz} · extrude {plane, depth, offset, loops, src} · revolve {plane, angle, axis, loops, src} · copy {of}
// weitere Merkmale ändern ihn: hole {d, depth, x, y, z, dir} · cut {sx, sy, sz, x, y, z} · bool {op: sub|add|int, of}
// Alle Maße sind Formeln (Text) mit + − * / ( ) und Variablen.
const PLANES = {
  XY: { name: 'XY · Draufsicht (Tiefe nach oben)', map: (u, v, w) => [u, v, w] },
  XZ: { name: 'XZ · Vorderansicht (Tiefe nach hinten)', map: (u, v, w) => [u, w, v] },
  YZ: { name: 'YZ · Seitenansicht (Tiefe in X)', map: (u, v, w) => [w, u, v] },
};
const WOOD = ['#c9a77c', '#a3b18a', '#8fa3b8', '#d8b48a', '#b5838d', '#9c7a54', '#7f9c96', '#c2a14d'];
const DIRS = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] };
const DIRNAME = { '+x': 'X+', '-x': 'X−', '+y': 'Y+', '-y': 'Y−', '+z': 'Z+', '-z': 'Z−' };

// ---------- Formeln und Variablen ----------
function evalExpr(src, vars) {               // + − * / ( ) Zahlen (Komma oder Punkt) und Variablen; Fehler als deutsche Meldung
  const s = String(src).trim();
  let i = 0;
  const err = m => { throw new Error(m); };
  const ws = () => { while (s[i] === ' ') i++; };
  const factor = () => {
    ws();
    if (s[i] === '-') { i++; return -factor(); }
    if (s[i] === '+') { i++; return factor(); }
    if (s[i] === '(') { i++; const v = expr(); ws(); if (s[i] !== ')') err('Klammer „)“ fehlt'); i++; return v; }
    const m = /^(\d+(?:[.,]\d*)?|[.,]\d+)/.exec(s.slice(i));
    if (m) { i += m[0].length; return parseFloat(m[0].replace(',', '.')); }
    const n = /^[A-Za-zÄÖÜäöüß_][A-Za-z0-9ÄÖÜäöüß_]*/.exec(s.slice(i));
    if (n) { i += n[0].length; const v = vars(n[0]); if (v === undefined) err('„' + n[0] + '“ ist keine Variable'); return v; }
    return err(i < s.length ? 'Unerwartetes Zeichen „' + s[i] + '“' : 'Die Formel ist unvollständig');
  };
  const term = () => {
    let v = factor(); ws();
    while (s[i] === '*' || s[i] === '/') { const op = s[i++], r = factor(); if (op === '/' && r === 0) err('Division durch 0'); v = op === '*' ? v * r : v / r; ws(); }
    return v;
  };
  const expr = () => {
    let v = term(); ws();
    while (s[i] === '+' || s[i] === '-') { const op = s[i++], r = term(); v = op === '+' ? v + r : v - r; ws(); }
    return v;
  };
  if (!s) err('Bitte einen Wert eingeben');
  const v = expr(); ws();
  if (i < s.length) err('Unerwartetes Zeichen „' + s[i] + '“');
  if (!isFinite(v)) err('Das Ergebnis ist keine Zahl');
  return v;
}
let pvals = {}, perrs = {};                  // berechnete Variablen (Name klein) und Fehler
function evalParams() {
  pvals = {}; perrs = {};
  const byName = new Map(model.params.map(p => [p.name.toLowerCase(), p])), busy = new Set();
  const get = name => {
    const k = name.toLowerCase();
    if (k in pvals) return pvals[k];
    const p = byName.get(k);
    if (!p) return undefined;
    if (busy.has(k)) throw new Error('Zirkelbezug bei „' + p.name + '“');
    busy.add(k);
    try { pvals[k] = evalExpr(p.expr, get); } finally { busy.delete(k); }
    return pvals[k];
  };
  for (const p of model.params) { try { get(p.name); } catch (e) { perrs[p.name.toLowerCase()] = e.message; } }
}
const pvar = name => { const k = name.toLowerCase(); return k in pvals ? pvals[k] : undefined; };
const val = expr => evalExpr(expr, pvar);
const isNum = s => /^\s*-?(\d+([.,]\d*)?|[.,]\d+)\s*$/.test(String(s));
const fnum = v => fmt(v, 2).replace(',', '.') === String(v) ? fmt(v, 2) : fmt(v, 3);

// ---------- Vektoren ----------
const v3 = { sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k], dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: a => Math.hypot(a[0], a[1], a[2]), norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t] };

// ---------- Boolesche Operationen (BSP-Baum, nach csg.js von Evan Wallace) ----------
const CSG_EPS = 1e-5;
class Plane3 {
  constructor(n, w) { this.n = n; this.w = w; }
  static from(a, b, c) { const n = v3.norm(v3.cross(v3.sub(b, a), v3.sub(c, a))); return new Plane3(n, v3.dot(n, a)); }
  clone() { return new Plane3(this.n.slice(), this.w); }
  flip() { this.n = v3.mul(this.n, -1); this.w = -this.w; }
  split(poly, cf, cb, f, b) {               // Polygon an der Ebene teilen bzw. einsortieren
    let type = 0;
    const types = poly.v.map(v => { const t = v3.dot(this.n, v) - this.w, ty = t < -CSG_EPS ? 2 : t > CSG_EPS ? 1 : 0; type |= ty; return ty; });
    if (type === 0) (v3.dot(this.n, poly.plane().n) > 0 ? cf : cb).push(poly);
    else if (type === 1) f.push(poly);
    else if (type === 2) b.push(poly);
    else {
      const fv = [], bv = [];
      for (let i = 0; i < poly.v.length; i++) {
        const j = (i + 1) % poly.v.length, ti = types[i], tj = types[j], vi = poly.v[i], vj = poly.v[j];
        if (ti !== 2) fv.push(vi);
        if (ti !== 1) bv.push(vi);
        if ((ti | tj) === 3) { const v = v3.lerp(vi, vj, (this.w - v3.dot(this.n, vi)) / v3.dot(this.n, v3.sub(vj, vi))); fv.push(v); bv.push(v); }
      }
      if (fv.length >= 3) f.push(new Poly3(fv, poly.s));
      if (bv.length >= 3) b.push(new Poly3(bv, poly.s));
    }
  }
}
class Poly3 {
  constructor(v, s) { this.v = v; this.s = s || null; this.p = null; }
  plane() { return this.p || (this.p = Plane3.from(this.v[0], this.v[1], this.v[2])); }
  clone() { const c = new Poly3(this.v.slice(), this.s); if (this.p) c.p = this.p.clone(); return c; }
  flip() { this.v = this.v.slice().reverse(); if (this.p) this.p.flip(); }
}
class Node3 {
  constructor(polys) { this.plane = null; this.front = null; this.back = null; this.polys = []; if (polys) this.build(polys); }
  invert() {
    for (const p of this.polys) p.flip();
    if (this.plane) this.plane.flip();
    if (this.front) this.front.invert();
    if (this.back) this.back.invert();
    [this.front, this.back] = [this.back, this.front];
  }
  clipPolys(polys) {
    if (!this.plane) return polys.slice();
    let f = [], b = [];
    for (const p of polys) this.plane.split(p, f, b, f, b);
    if (this.front) f = this.front.clipPolys(f);
    b = this.back ? this.back.clipPolys(b) : [];
    return f.concat(b);
  }
  clipTo(bsp) { this.polys = bsp.clipPolys(this.polys); if (this.front) this.front.clipTo(bsp); if (this.back) this.back.clipTo(bsp); }
  all() { let r = this.polys.slice(); if (this.front) r = r.concat(this.front.all()); if (this.back) r = r.concat(this.back.all()); return r; }
  build(polys) {
    if (!polys.length) return;
    if (!this.plane) this.plane = polys[0].plane().clone();
    const f = [], b = [];
    for (const p of polys) this.plane.split(p, this.polys, this.polys, f, b);
    if (f.length) { if (!this.front) this.front = new Node3(); this.front.build(f); }
    if (b.length) { if (!this.back) this.back = new Node3(); this.back.build(b); }
  }
}
function csg(op, A, B) {                     // op: add (vereinigen), sub (abziehen), int (Schnittmenge)
  if (!A.length) return op === 'add' ? B.map(p => p.clone()) : [];
  if (!B.length) return op === 'int' ? [] : A.map(p => p.clone());
  const a = new Node3(A.map(p => p.clone())), b = new Node3(B.map(p => p.clone()));
  if (op === 'add') { a.clipTo(b); b.clipTo(a); b.invert(); b.clipTo(a); b.invert(); a.build(b.all()); return a.all(); }
  if (op === 'sub') { a.invert(); a.clipTo(b); b.clipTo(a); b.invert(); b.clipTo(a); b.invert(); a.build(b.all()); a.invert(); return a.all(); }
  a.invert(); b.clipTo(a); b.invert(); a.clipTo(b); b.clipTo(a); a.build(b.all()); a.invert(); return a.all();
}
function volumeOf(polys) {                   // Rauminhalt eines geschlossenen Körpers (Vorzeichen = Orientierung)
  let v = 0;
  for (const p of polys) for (let i = 1; i < p.v.length - 1; i++) v += v3.dot(p.v[0], v3.cross(p.v[i], p.v[i + 1]));
  return v / 6;
}
const orient = polys => { if (volumeOf(polys) < 0) polys.forEach(p => p.flip()); return polys; };
const movePolys = (polys, d) => polys.map(p => new Poly3(p.v.map(v => v3.add(v, d)), p.s));

// ---------- Grundkörper ----------
function boxPolys(x0, y0, z0, x1, y1, z1) {
  const P = i => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
  return [[0, 4, 6, 2], [1, 3, 7, 5], [0, 1, 5, 4], [2, 6, 7, 3], [0, 2, 3, 1], [4, 5, 7, 6]].map(f => new Poly3(f.map(P)));
}
function cylPolys(c, dir, r, len, key) {     // Zylinder ab c in Richtung dir (achsparallel)
  const n = 32, k = dir.findIndex(v => v !== 0), s = dir[k], i1 = (k + 1) % 3, i2 = (k + 2) % 3, ring = [];
  for (let j = 0; j < n; j++) { const a = 2 * Math.PI * j / n, p = c.slice(); p[i1] += r * Math.cos(a); p[i2] += r * Math.sin(a); ring.push(p); }
  const top = ring.map(p => { const q = p.slice(); q[k] += s * len; return q; }), polys = [];
  for (let j = 0; j < n; j++) { const j2 = (j + 1) % n; polys.push(new Poly3([ring[j], ring[j2], top[j2], top[j]], key)); }
  polys.push(new Poly3(ring.slice().reverse()), new Poly3(top.slice()));
  return orient(polys);
}
const area2 = loop => { let a = 0; for (let i = 0; i < loop.length; i++) { const p = loop[i], q = loop[(i + 1) % loop.length]; a += p.u * q.v - q.u * p.v; } return a / 2; };
function insideLoop(pt, loop) {              // Punkt im Polygon (gerade/ungerade)
  let c = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i], b = loop[j];
    if ((a.v > pt.v) !== (b.v > pt.v) && pt.u < (b.u - a.u) * (pt.v - a.v) / (b.v - a.v) + a.u) c = !c;
  }
  return c;
}
function segCross(p, q, a, b) {              // echte Kreuzung zweier Strecken (ohne Berührung an Enden)
  const d = (x, y, z) => (y.u - x.u) * (z.v - x.v) - (y.v - x.v) * (z.u - x.u);
  const d1 = d(p, q, a), d2 = d(p, q, b), d3 = d(a, b, p), d4 = d(a, b, q);
  return ((d1 > 1e-12 && d2 < -1e-12) || (d1 < -1e-12 && d2 > 1e-12)) && ((d3 > 1e-12 && d4 < -1e-12) || (d3 < -1e-12 && d4 > 1e-12));
}
function bridgeHole(poly, hole, others) {    // Loch über eine freie Verbindung in den Umriss einhängen
  let mi = 0;
  for (let i = 1; i < hole.length; i++) if (hole[i].u > hole[mi].u) mi = i;
  const M = hole[mi], edges = [];
  const addEdges = L => { for (let i = 0; i < L.length; i++) edges.push([L[i], L[(i + 1) % L.length]]); };
  addEdges(poly); for (const h of others) addEdges(h);
  const cand = poly.map((p, i) => [i, (p.u - M.u) ** 2 + (p.v - M.v) ** 2]).sort((a, b) => a[1] - b[1]);
  for (const [i] of cand) {
    const P = poly[i];
    if (edges.every(([a, b]) => a === P || b === P || a === M || b === M || !segCross(P, M, a, b)))
      return poly.slice(0, i + 1).concat(hole.slice(mi), hole.slice(0, mi + 1), [P]).concat(poly.slice(i + 1));
  }
  return poly;
}
function earClip(pts) {                      // Dreiecke eines einfachen Polygons (gegen den Uhrzeigersinn)
  const idx = pts.map((_, i) => i), tris = [];
  const cr = (a, b, c) => (b.u - a.u) * (c.v - a.v) - (b.v - a.v) * (c.u - a.u);
  const inTri = (p, a, b, c) => cr(a, b, p) > 1e-9 && cr(b, c, p) > 1e-9 && cr(c, a, p) > 1e-9;
  let guard = 0;
  while (idx.length > 3 && guard++ < 20000) {
    let found = -1;
    for (let k = 0; k < idx.length && found < 0; k++) {
      const a = pts[idx[(k + idx.length - 1) % idx.length]], b = pts[idx[k]], c = pts[idx[(k + 1) % idx.length]];
      if (cr(a, b, c) <= 1e-12) continue;
      if (idx.every(j => { const p = pts[j]; return p === a || p === b || p === c || (p.u === a.u && p.v === a.v) || (p.u === b.u && p.v === b.v) || (p.u === c.u && p.v === c.v) || !inTri(p, a, b, c); })) found = k;
    }
    if (found < 0) {                         // keine Ohrecke: entartete Ecke entfernen
      let worst = 0, wv = Infinity;
      for (let k = 0; k < idx.length; k++) { const a = pts[idx[(k + idx.length - 1) % idx.length]], b = pts[idx[k]], c = pts[idx[(k + 1) % idx.length]], v = cr(a, b, c); if (v < wv) { wv = v; worst = k; } }
      if (wv > 1e-12) break;
      idx.splice(worst, 1);
      continue;
    }
    tris.push([pts[idx[(found + idx.length - 1) % idx.length]], pts[idx[found]], pts[idx[(found + 1) % idx.length]]]);
    idx.splice(found, 1);
  }
  if (idx.length === 3) tris.push(idx.map(i => pts[i]));
  return tris;
}
function regions(loops) {                    // Umrisse mit ihren Löchern (Verschachtelung gerade/ungerade)
  const info = loops.map(l => ({ l, a: Math.abs(area2(l)) })).sort((x, y) => y.a - x.a);
  for (const it of info) it.depth = info.filter(o => o !== it && o.a > it.a && insideLoop(it.l[0], o.l)).length;
  const outs = info.filter(it => it.depth % 2 === 0).map(it => ({ outer: it.l, holes: [], depth: it.depth }));
  for (const it of info.filter(it => it.depth % 2 === 1)) {
    const host = outs.filter(o => o.depth === it.depth - 1 && insideLoop(it.l[0], o.outer)).sort((a, b) => Math.abs(area2(a.outer)) - Math.abs(area2(b.outer)))[0];
    if (host) host.holes.push(it.l);
  }
  for (const r of outs) {
    if (area2(r.outer) < 0) r.outer = r.outer.slice().reverse();
    r.holes = r.holes.map(h => area2(h) > 0 ? h.slice().reverse() : h);
  }
  return outs;
}
function capTris(r) {                        // Deckfläche eines Umrisses mit Löchern in Dreiecken
  let poly = r.outer.slice();
  const hs = r.holes.slice().sort((a, b) => Math.max(...b.map(p => p.u)) - Math.max(...a.map(p => p.u)));
  hs.forEach((h, i) => { poly = bridgeHole(poly, h, hs.slice(i + 1)); });
  return earClip(poly);
}
function extrudePolys(loops, plane, w0, w1, key) {   // Profil zwischen w0 und w1 aufziehen
  const map = PLANES[plane].map, polys = [];
  for (const r of regions(loops)) {
    for (const t of capTris(r)) {
      polys.push(new Poly3(t.map(p => map(p.u, p.v, w1))));
      polys.push(new Poly3(t.slice().reverse().map(p => map(p.u, p.v, w0))));
    }
    for (const L of [r.outer, ...r.holes]) for (let i = 0; i < L.length; i++) {
      const a = L[i], b = L[(i + 1) % L.length];
      polys.push(new Poly3([map(a.u, a.v, w0), map(b.u, b.v, w0), map(b.u, b.v, w1), map(a.u, a.v, w1)], a.smooth ? key + '-' + a.src : null));
    }
  }
  return orient(polys);
}
function revolvePolys(loops, plane, axis, angle, key) {   // Profil um eine Achse in der Skizzenebene drehen
  const map = PLANES[plane].map, full = Math.abs(angle) >= 360 - 1e-9, n = Math.max(3, Math.ceil(Math.abs(angle) / 7.5));
  const A = [axis.x1, axis.y1, 0], D = v3.norm([axis.x2 - axis.x1, axis.y2 - axis.y1, 0]), polys = [];
  const rot = (p, phi) => {                  // Drehung um die Achse (Rodrigues)
    const q = v3.sub([p.u, p.v, 0], A), c = Math.cos(phi), s = Math.sin(phi);
    const r = v3.add(v3.add(v3.mul(q, c), v3.mul(v3.cross(D, q), s)), v3.mul(D, v3.dot(D, q) * (1 - c)));
    const w = v3.add(A, r);
    return map(w[0], w[1], w[2]);
  };
  const step = rad(angle) / n;
  for (const r of regions(loops)) {
    for (const L of [r.outer, ...r.holes]) for (let i = 0; i < L.length; i++) {
      const a = L[i], b = L[(i + 1) % L.length];
      for (let k = 0; k < n; k++) {
        const vs = [rot(a, k * step), rot(b, k * step), rot(b, (k + 1) * step), rot(a, (k + 1) * step)].filter((v, j, arr) => j === 0 || v3.len(v3.sub(v, arr[j - 1])) > 1e-9);
        if (vs.length > 3 && v3.len(v3.sub(vs[0], vs[vs.length - 1])) < 1e-9) vs.pop();
        if (vs.length >= 3) polys.push(new Poly3(vs, key + '-' + (a.src || 0)));
      }
    }
    if (!full) for (const t of capTris(r)) {
      polys.push(new Poly3(t.slice().reverse().map(p => rot(p, 0))));
      polys.push(new Poly3(t.map(p => rot(p, rad(angle)))));
    }
  }
  return orient(polys);
}

// ---------- Konturen aus der 2D-Zeichnung ----------
function profileLoops(list) {                // geschlossene Ketten aus Linien/Bögen sowie Kreise und Ellipsen
  const loops = [], segs = [], close = (a, b) => Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.y - b.y) < 1e-3;
  for (const e of list) {
    if (e.t === 'circle' || e.t === 'ellipse') loops.push(sample(e, e.t === 'circle' ? 64 : 96).slice(0, -1).map(p => ({ u: p.x, v: p.y, src: e.id, smooth: true })));
    else if (e.t === 'line') segs.push({ pts: [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }], id: e.id, smooth: false });
    else if (e.t === 'arc') segs.push({ pts: sample(e, Math.max(4, Math.ceil(sweepOf(e) / 7.5))), id: e.id, smooth: true });
  }
  const used = new Set();
  let open = 0;
  for (let i = 0; i < segs.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const chain = segs[i].pts.map(p => ({ u: p.x, v: p.y, src: segs[i].id, smooth: segs[i].smooth })), ids = [segs[i].id];
    let closed = false;
    for (;;) {
      const end = chain[chain.length - 1], e2 = { x: end.u, y: end.v };
      if (chain.length > 2 && close(e2, { x: chain[0].u, y: chain[0].v })) { chain.pop(); closed = true; break; }
      let next = -1, rev = false;
      for (let j = 0; j < segs.length && next < 0; j++) {
        if (used.has(j)) continue;
        const s = segs[j].pts;
        if (close(s[0], e2)) next = j; else if (close(s[s.length - 1], e2)) { next = j; rev = true; }
      }
      if (next < 0) break;
      used.add(next); ids.push(segs[next].id);
      const s = rev ? segs[next].pts.slice().reverse() : segs[next].pts;
      end.src = segs[next].id; end.smooth = segs[next].smooth;
      for (const p of s.slice(1)) chain.push({ u: p.x, v: p.y, src: segs[next].id, smooth: segs[next].smooth });
    }
    if (closed && chain.length >= 3) loops.push(chain); else open++;
  }
  return { loops, open };
}
const plainLoops = loops => loops.map(l => l.map(p => ({ u: R(p.u), v: R(p.v), src: p.src, smooth: !!p.smooth })));

// ---------- Bauteile auswerten ----------
const partById = id => model.parts.find(p => p.id === id);
const consumed = () => new Set(model.parts.flatMap(p => p.features.filter(f => f.type === 'bool').map(f => f.of)));
const geoCache = new Map();                  // Bauteil-Nr. -> {sig, polys (lokal), errs, err}
function linkedLoops(f) {                    // Kontur aus der aktuellen 2D-Zeichnung, sonst die gespeicherte
  if (Array.isArray(f.src) && f.src.length && f.src.every(id => byId(id))) {
    const { loops } = profileLoops(f.src.map(byId).filter(e => e.t !== 'insert'));
    if (loops.length) return loops;
  }
  return f.loops || [];
}
function partSig(part, depth) {              // Fingerabdruck aller Eingaben eines Bauteils
  const refs = part.features.filter(f => f.of).map(f => { const o = partById(f.of); return o && depth < 6 ? [partSig(o, depth + 1), o.pos] : null; });
  const src = part.features.filter(f => Array.isArray(f.src)).map(f => f.src.map(id => byId(id) || null));
  return JSON.stringify([part.features, refs, src, pvals]);
}
function partGeo(part, depth = 0) {          // Körper eines Bauteils in eigenen Koordinaten (ohne Lage)
  const sig = partSig(part, depth), hit = geoCache.get(part.id);
  if (hit && hit.sig === sig) return hit;
  const errs = [];
  let polys = [];
  part.features.forEach((f, i) => {
    try {
      const n = k => { const v = val(f[k]); return v; };
      if (i === 0) {
        if (f.type === 'box') {
          const sx = n('sx'), sy = n('sy'), sz = n('sz');
          if (!(sx > 0 && sy > 0 && sz > 0)) throw new Error('Alle Maße müssen größer als 0 sein');
          polys = boxPolys(0, 0, 0, sx, sy, sz);
        } else if (f.type === 'extrude') {
          const d = n('depth'), off = n('offset');
          if (!(Math.abs(d) > 0)) throw new Error('Die Tiefe muss ungleich 0 sein');
          const loops = linkedLoops(f);
          if (!loops.length) throw new Error('Keine geschlossene Kontur');
          polys = extrudePolys(loops, f.plane, Math.min(off, off + d), Math.max(off, off + d), 'x' + part.id);
        } else if (f.type === 'revolve') {
          const a = n('angle');
          if (!(Math.abs(a) > 0 && Math.abs(a) <= 360)) throw new Error('Der Winkel muss zwischen 0 und 360° liegen');
          const loops = linkedLoops(f), ax = f.srcAxis && byId(f.srcAxis) && byId(f.srcAxis).t === 'line' ? byId(f.srcAxis) : f.axis;
          if (!loops.length) throw new Error('Keine geschlossene Kontur');
          polys = revolvePolys(loops, f.plane, ax, a, 'r' + part.id);
        } else if (f.type === 'copy') {
          const o = partById(f.of);
          if (!o || o === part || depth > 5) throw new Error('Das Original fehlt');
          const g = partGeo(o, depth + 1);
          if (g.err) throw new Error('Das Original hat einen Fehler');
          polys = g.polys.map(p => p.clone());
        }
        return;
      }
      if (f.type === 'hole') {
        const d = n('d'), depthV = n('depth'), dir = DIRS[f.dir] || DIRS['-z'];
        if (!(d > 0 && depthV > 0)) throw new Error('Durchmesser und Tiefe müssen größer als 0 sein');
        const c = [n('x'), n('y'), n('z')], start = v3.sub(c, v3.mul(dir, 0.01));
        polys = csg('sub', polys, cylPolys(start, dir, d / 2, depthV + 0.01, 'h' + part.id + '-' + i));
      } else if (f.type === 'cut') {
        const sx = n('sx'), sy = n('sy'), sz = n('sz'), x = n('x'), y = n('y'), z = n('z');
        if (!(sx > 0 && sy > 0 && sz > 0)) throw new Error('Alle Maße müssen größer als 0 sein');
        polys = csg('sub', polys, boxPolys(x, y, z, x + sx, y + sy, z + sz));
      } else if (f.type === 'bool') {
        const o = partById(f.of);
        if (!o || o === part || depth > 5) throw new Error('Das andere Bauteil fehlt');
        const g = partGeo(o, depth + 1), d = v3.sub(posOf(o), posOf(part));
        polys = csg(f.op, polys, movePolys(g.polys, d));
      }
    } catch (e) { errs[i] = e.message; }
  });
  const res = { sig, polys, errs, err: errs[0] || (errs.length ? errs.find(Boolean) : '') };
  geoCache.set(part.id, res);
  return res;
}
function posOf(part) {                       // Lage eines Bauteils (Fehler zählen als 0)
  return ['x', 'y', 'z'].map(k => { try { return val(part.pos[k]); } catch (e) { return 0; } });
}

// ---------- Darstellungsdaten: Dreiecke, Kanten, Fangpunkte ----------
function featureEdges(polys) {               // Kanten zwischen verschiedenen Flächen (T-Stellen aus CSG werden geteilt)
  const q = v => Math.round(v * 1e3) / 1e3, groups = new Map();
  for (const p of polys) {
    const pl = p.plane();
    if (!isFinite(pl.n[0]) || !isFinite(pl.w)) continue;
    const key = p.s || ('P' + q(pl.n[0]) + ',' + q(pl.n[1]) + ',' + q(pl.n[2]) + ',' + Math.round(pl.w * 100) / 100);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const vk = v => Math.round(v[0] * 1e3) + ',' + Math.round(v[1] * 1e3) + ',' + Math.round(v[2] * 1e3);
  const out = new Map(), faces = [];
  for (const [key, list] of groups) {
    const verts = new Map();
    for (const p of list) for (const v of p.v) verts.set(vk(v), v);
    const vlist = [...verts.values()], cnt = new Map();
    for (const p of list) for (let i = 0; i < p.v.length; i++) {
      const a = p.v[i], b = p.v[(i + 1) % p.v.length], ab = v3.sub(b, a), L2 = v3.dot(ab, ab);
      if (L2 < 1e-12) continue;
      const inner = [];
      for (const v of vlist) {
        const t = v3.dot(v3.sub(v, a), ab) / L2;
        if (t > 1e-6 && t < 1 - 1e-6 && v3.len(v3.sub(v, v3.add(a, v3.mul(ab, t)))) < 1e-4) inner.push([t, v]);
      }
      inner.sort((x, y) => x[0] - y[0]);
      const ch = [a, ...inner.map(x => x[1]), b];
      for (let k = 0; k < ch.length - 1; k++) {
        const ka = vk(ch[k]), kb = vk(ch[k + 1]), kk = ka < kb ? ka + '|' + kb : kb + '|' + ka, e = cnt.get(kk);
        if (e) e.n++; else cnt.set(kk, { n: 1, a: ch[k], b: ch[k + 1] });
      }
    }
    for (const [kk, e] of cnt) if (e.n % 2 === 1) out.set(kk, [e.a, e.b]);
    if (key[0] === 'P') {                    // Flächenmitte als Fangpunkt
      let A = 0, c = [0, 0, 0];
      for (const p of list) for (let i = 1; i < p.v.length - 1; i++) {
        const ar = v3.len(v3.cross(v3.sub(p.v[i], p.v[0]), v3.sub(p.v[i + 1], p.v[0]))) / 2;
        A += ar; c = v3.add(c, v3.mul(v3.add(v3.add(p.v[0], p.v[i]), p.v[i + 1]), ar / 3));
      }
      if (A > 1e-6) faces.push(v3.mul(c, 1 / A));
    }
  }
  return { edges: [...out.values()], faces };
}
const meshCache = new Map();                 // Bauteil-Nr. -> {g, tri, edges, tris, snaps, bb, buf}
function meshOf(part) {
  const g = partGeo(part), hit = meshCache.get(part.id);
  if (hit && hit.g === g) return hit;
  if (hit && hit.buf && gl) { gl.deleteBuffer(hit.buf.t); gl.deleteBuffer(hit.buf.e); }
  const tri = [], tris = [], lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of g.polys) {
    const n = p.plane().n;
    if (!isFinite(n[0])) continue;
    for (const v of p.v) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); }
    for (let i = 1; i < p.v.length - 1; i++) { const a = p.v[0], b = p.v[i], c = p.v[i + 1]; tris.push([a, b, c, n]); tri.push(...a, ...n, ...b, ...n, ...c, ...n); }
  }
  const fe = featureEdges(g.polys), ed = [], snaps = [], seen = new Set();
  const addS = (p, type) => { const k = p.map(v => Math.round(v * 100)).join() + type; if (!seen.has(k)) { seen.add(k); snaps.push({ p, type }); } };
  for (const [a, b] of fe.edges) { ed.push(...a, ...b); addS(a, 'end'); addS(b, 'end'); if (v3.len(v3.sub(b, a)) > 5) addS(v3.lerp(a, b, 0.5), 'mid'); }
  for (const c of fe.faces) addS(c, 'face');
  const m = { g, tri: new Float32Array(tri), edges: new Float32Array(ed), tris, snaps, bb: tris.length ? [lo, hi] : [[0, 0, 0], [0, 0, 0]], buf: null, edgeList: fe.edges };
  meshCache.set(part.id, m);
  return m;
}
const visibleParts = () => { const used = consumed(); return model.parts.filter(p => !p.hide && !used.has(p.id)); };
function worldBox(list) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of list) {
    const m = meshOf(p), o = posOf(p);
    if (!m.tris.length) continue;
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], m.bb[0][k] + o[k]); hi[k] = Math.max(hi[k], m.bb[1][k] + o[k]); }
  }
  return isFinite(lo[0]) ? [lo, hi] : null;
}

// ---------- WebGL ----------
let gl = null, prog = null, loc = {}, glFail = false, gridBuf = null, gridN = 0, gridSig = '';
const cam = { target: [300, 200, 300], dist: 2600, yaw: 35, pitch: 25, persp: true, fov: 35 };
let sel3 = 0, tool3 = null, hover3 = null, snap3 = null, drag3 = null, section = null, fitted = false;
const mouse3 = { x: 0, y: 0, in: false }, collide = new Set(), touches3 = new Map();
let pinch3 = null;
function initGL() {
  if (gl || glFail) return !!gl;
  gl = $('gl').getContext('webgl', { antialias: true }) || $('gl').getContext('experimental-webgl');
  if (!gl) { glFail = true; flash('3D braucht WebGL – dieser Browser stellt es nicht bereit.'); return false; }
  const vs = 'attribute vec3 p; attribute vec3 n; uniform mat4 mvp; uniform vec3 off; varying vec3 vn; varying vec3 vp;\n' +
    'void main() { vec3 w = p + off; vn = n; vp = w; gl_Position = mvp * vec4(w, 1.0); }';
  const fs = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n' +
    'uniform vec3 col; uniform vec3 cap; uniform vec4 clip; uniform float useClip; uniform float lit; uniform float alpha;\n' +
    'varying vec3 vn; varying vec3 vp;\n' +
    'void main() {\n' +
    '  if (useClip > 0.5 && dot(vp, clip.xyz) > clip.w) discard;\n' +
    '  if (lit < 0.5) { gl_FragColor = vec4(col, alpha); return; }\n' +
    '  if (!gl_FrontFacing) { gl_FragColor = vec4(cap, 1.0); return; }\n' +
    '  vec3 N = normalize(vn);\n' +
    '  float d = 0.5 * max(dot(N, normalize(vec3(0.35, -0.55, 0.75))), 0.0) + 0.22 * max(dot(N, normalize(vec3(-0.6, 0.4, 0.35))), 0.0) + 0.08 * abs(N.z);\n' +
    '  gl_FragColor = vec4(col * (0.46 + d), alpha);\n' +
    '}';
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  for (const k of ['mvp', 'off', 'col', 'cap', 'clip', 'useClip', 'lit', 'alpha']) loc[k] = gl.getUniformLocation(prog, k);
  loc.p = gl.getAttribLocation(prog, 'p'); loc.n = gl.getAttribLocation(prog, 'n');
  return true;
}
function mat4mul(a, b) {
  const o = new Float32Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; }
  return o;
}
function camBasis() {
  const cy = Math.cos(rad(cam.yaw)), sy = Math.sin(rad(cam.yaw)), cp = Math.cos(rad(cam.pitch)), sp = Math.sin(rad(cam.pitch));
  const back = [sy * cp, -cy * cp, sp], eye = v3.add(cam.target, v3.mul(back, cam.dist)), f = v3.mul(back, -1);
  let r = v3.cross(f, [0, 0, 1]);
  if (v3.len(r) < 1e-6) r = [cy, sy, 0];
  r = v3.norm(r);
  return { eye, f, r, u: v3.cross(r, f) };
}
function viewProj(W, H) {
  const { eye, f, r, u } = camBasis(), a = W / H, ht = Math.tan(rad(cam.fov) / 2);
  const V = new Float32Array([r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -v3.dot(r, eye), -v3.dot(u, eye), v3.dot(f, eye), 1]);
  let P;
  if (cam.persp) {
    const t = 1 / ht, near = cam.dist / 100, far = cam.dist * 60 + 20000;
    P = new Float32Array([t / a, 0, 0, 0, 0, t, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0]);
  } else {
    const h = cam.dist * ht, w = h * a, far = cam.dist * 60 + 20000, near = -far;
    P = new Float32Array([1 / w, 0, 0, 0, 0, 1 / h, 0, 0, 0, 0, -2 / (far - near), 0, 0, 0, -(far + near) / (far - near), 1]);
  }
  return { M: mat4mul(P, V), eye, f, r, u, ht, a, W, H };
}
function toScreen(p, VP) {
  const M = VP.M, x = p[0], y = p[1], z = p[2];
  const cx = M[0] * x + M[4] * y + M[8] * z + M[12], cy = M[1] * x + M[5] * y + M[9] * z + M[13], cw = M[3] * x + M[7] * y + M[11] * z + M[15];
  if (cw <= 1e-9) return null;
  return [(cx / cw * 0.5 + 0.5) * VP.W, (0.5 - cy / cw * 0.5) * VP.H];
}
function rayAt(sx, sy, VP) {
  const nx = sx / VP.W * 2 - 1, ny = 1 - sy / VP.H * 2;
  if (cam.persp) return { o: VP.eye, d: v3.norm(v3.add(v3.add(VP.f, v3.mul(VP.r, nx * VP.ht * VP.a)), v3.mul(VP.u, ny * VP.ht))) };
  const h = cam.dist * VP.ht, w = h * VP.a;
  return { o: v3.add(v3.add(v3.sub(VP.eye, v3.mul(VP.f, cam.dist * 50)), v3.mul(VP.r, nx * w)), v3.mul(VP.u, ny * h)), d: VP.f };
}
function rayTri(o, d, a, b, c) {             // Möller–Trumbore: Abstand oder -1
  const e1 = v3.sub(b, a), e2 = v3.sub(c, a), p = v3.cross(d, e2), det = v3.dot(e1, p);
  if (Math.abs(det) < 1e-12) return -1;
  const inv = 1 / det, t0 = v3.sub(o, a), u = v3.dot(t0, p) * inv;
  if (u < -1e-9 || u > 1 + 1e-9) return -1;
  const q = v3.cross(t0, e1), v = v3.dot(d, q) * inv;
  if (v < -1e-9 || u + v > 1 + 1e-9) return -1;
  return v3.dot(e2, q) * inv;
}
function rayBox(o, d, bb) {
  let t0 = -Infinity, t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-12) { if (o[k] < bb[0][k] - 1e-6 || o[k] > bb[1][k] + 1e-6) return false; continue; }
    let a = (bb[0][k] - 1e-6 - o[k]) / d[k], b = (bb[1][k] + 1e-6 - o[k]) / d[k];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
  }
  return t1 >= Math.max(t0, 0);
}
const clipped = p => section && (section.flip ? -p[section.axis] > -section.at : p[section.axis] > section.at);
function pick3(ray, filter, list = visibleParts()) {   // nächster Treffer {t, part, n (lokal), p (Welt)}
  let best = null;
  for (const part of list) {
    if (filter && !filter(part)) continue;
    const m = meshOf(part), off = posOf(part), o = v3.sub(ray.o, off);
    if (!rayBox(o, ray.d, m.bb)) continue;
    for (const [a, b, c, n] of m.tris) {
      const t = rayTri(o, ray.d, a, b, c);
      if (t > 1e-6 && (!best || t < best.t)) {
        const p = v3.add(v3.add(o, v3.mul(ray.d, t)), off);
        if (!clipped(p)) best = { t, part, n, p };
      }
    }
  }
  return best;
}
const PRIO3 = { end: 0, mid: 1, face: 2 };
function findSnap3(VP) {                     // Fangpunkt (Ecke, Kantenmitte, Flächenmitte) nahe am Zeiger, nicht verdeckt
  const cands = [];
  for (const part of visibleParts()) {
    const m = meshOf(part), off = posOf(part);
    for (const s of m.snaps) {
      const p = v3.add(s.p, off);
      if (clipped(p)) continue;
      const q = toScreen(p, VP);
      if (!q) continue;
      const d = Math.hypot(q[0] - mouse3.x, q[1] - mouse3.y);
      if (d <= 12) cands.push({ d: d + PRIO3[s.type] * 3, p, type: s.type, part });
    }
  }
  cands.sort((a, b) => a.d - b.d);
  for (const c of cands.slice(0, 10)) {
    const o = cam.persp ? VP.eye : v3.sub(c.p, v3.mul(VP.f, cam.dist * 50)), L = v3.len(v3.sub(c.p, o)), h = pick3({ o, d: v3.norm(v3.sub(c.p, o)) });
    if (!h || h.t >= L - Math.max(0.5, L * 2e-4)) return c;
  }
  return null;
}
const rgb01 = hex => rgbOf(/^#[0-9a-f]{6}$/i.test(hex) ? hex : '#888888').map(v => v / 255);
const mix3 = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function gridLines(bb) {                     // Raster auf der Grundfläche (Z = 0) unter dem Modell
  const lo = bb ? bb[0] : [0, 0, 0], hi = bb ? bb[1] : [1000, 600, 0], size = Math.max(hi[0] - lo[0], hi[1] - lo[1], 600);
  const step = size > 3000 ? 500 : size > 1200 ? 100 : 50, x0 = Math.floor((lo[0] - size * 0.25) / step) * step, x1 = Math.ceil((hi[0] + size * 0.25) / step) * step;
  const y0 = Math.floor((lo[1] - size * 0.25) / step) * step, y1 = Math.ceil((hi[1] + size * 0.25) / step) * step, a = [];
  for (let x = x0; x <= x1; x += step) a.push(x, y0, 0, x, y1, 0);
  for (let y = y0; y <= y1; y += step) a.push(x0, y, 0, x1, y, 0);
  return new Float32Array(a);
}
function draw3d() {
  if (!initGL()) return;
  const c = $('gl'), W = c.clientWidth, H = c.clientHeight, dpr = window.devicePixelRatio || 1;
  if (!W || !H) return;
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  const VP = viewProj(W, H), used = consumed(), bg = rgb01(cssVar('--m3-bg')), selCol = rgb01(C.sel), edgeCol = rgb01(C.bg === '#ffffff' ? '#2b2f36' : '#11151a');
  gl.viewport(0, 0, c.width, c.height);
  gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
  gl.useProgram(prog);
  gl.uniformMatrix4fv(loc.mvp, false, VP.M);
  gl.uniform1f(loc.alpha, 1);
  gl.uniform3fv(loc.cap, rgb01(cssVar('--m3-cut')));
  if (section) { const n = [0, 0, 0]; n[section.axis] = section.flip ? -1 : 1; gl.uniform4f(loc.clip, n[0], n[1], n[2], section.flip ? -section.at : section.at); }
  gl.uniform1f(loc.useClip, section ? 1 : 0);
  const bb = worldBox(visibleParts()), gs = JSON.stringify(bb);
  if (gs !== gridSig || !gridBuf) { gridSig = gs; const g = gridLines(bb); if (!gridBuf) gridBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, gridBuf); gl.bufferData(gl.ARRAY_BUFFER, g, gl.STATIC_DRAW); gridN = g.length / 3; }
  const lines = (buf, n, col) => {
    gl.uniform1f(loc.lit, 0); gl.uniform3fv(loc.col, col);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(loc.p); gl.vertexAttribPointer(loc.p, 3, gl.FLOAT, false, 12, 0);
    gl.disableVertexAttribArray(loc.n); gl.vertexAttrib3f(loc.n, 0, 0, 1);
    gl.drawArrays(gl.LINES, 0, n);
  };
  gl.uniform3f(loc.off, 0, 0, 0);
  lines(gridBuf, gridN, rgb01(C.grid2));
  for (const part of model.parts) {
    if (part.hide || (used.has(part.id) && part.id !== sel3)) continue;
    const m = meshOf(part);
    if (!m.tris.length) continue;
    if (!m.buf) {
      m.buf = { t: gl.createBuffer(), e: gl.createBuffer() };
      gl.bindBuffer(gl.ARRAY_BUFFER, m.buf.t); gl.bufferData(gl.ARRAY_BUFFER, m.tri, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.buf.e); gl.bufferData(gl.ARRAY_BUFFER, m.edges, gl.STATIC_DRAW);
    }
    gl.uniform3fv(loc.off, posOf(part));
    const isSel = part.id === sel3;
    if (!used.has(part.id)) {
      let col = rgb01(part.color);
      if (collide.has(part.id)) col = mix3(col, [0.9, 0.15, 0.15], 0.6);
      if (isSel) col = mix3(col, selCol, 0.35);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 1);
      gl.uniform1f(loc.lit, 1); gl.uniform3fv(loc.col, col);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.buf.t);
      gl.enableVertexAttribArray(loc.p); gl.vertexAttribPointer(loc.p, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(loc.n); gl.vertexAttribPointer(loc.n, 3, gl.FLOAT, false, 24, 12);
      gl.drawArrays(gl.TRIANGLES, 0, m.tri.length / 6);
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }
    lines(m.buf.e, m.edges.length / 3, isSel ? selCol : edgeCol);
  }
  drawOverlay(VP);
}
function drawOverlay(VP) {                   // Fangmarke, Gummiband, Achsenkreuz
  const c = $('ov'), dpr = window.devicePixelRatio || 1, g = c.getContext('2d');
  if (c.width !== Math.round(VP.W * dpr) || c.height !== Math.round(VP.H * dpr)) { c.width = Math.round(VP.W * dpr); c.height = Math.round(VP.H * dpr); }
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, VP.W, VP.H);
  const ax = [[1, 0, 0, '#d9480f', 'X'], [0, 1, 0, '#2b8a3e', 'Y'], [0, 0, 1, '#1c64d8', 'Z']], o = [44, VP.H - 44];
  g.lineWidth = 2; g.font = '600 11px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const [x, y, z, col, name] of ax) {
    const d = [x, y, z], sx = v3.dot(d, VP.r) * 28, sy = -v3.dot(d, VP.u) * 28;
    g.strokeStyle = g.fillStyle = col; g.beginPath(); g.moveTo(o[0], o[1]); g.lineTo(o[0] + sx, o[1] + sy); g.stroke();
    g.fillText(name, o[0] + sx * 1.3, o[1] + sy * 1.3);
  }
  if (tool3 && tool3.type === 'move' && tool3.base) {
    const a = toScreen(tool3.base, VP), t = snap3 ? snap3.p : hover3 ? hover3.p : null, b = t && toScreen(t, VP);
    if (a && b) { g.strokeStyle = C.prev; g.lineWidth = 1.5; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke(); g.setLineDash([]); }
  }
  if (snap3) {
    const q = toScreen(snap3.p, VP), m = 6;
    if (q) {
      g.strokeStyle = C.snap; g.lineWidth = 2; g.beginPath();
      if (snap3.type === 'end') g.rect(q[0] - m, q[1] - m, 2 * m, 2 * m);
      else if (snap3.type === 'mid') { g.moveTo(q[0], q[1] - m); g.lineTo(q[0] + m, q[1] + m); g.lineTo(q[0] - m, q[1] + m); g.closePath(); }
      else { g.moveTo(q[0] + m, q[1]); g.arc(q[0], q[1], m, 0, 2 * Math.PI); }
      g.stroke();
    }
  }
}

// ---------- Ansicht steuern ----------
function fit3d() {
  const bb = worldBox(visibleParts().length ? visibleParts() : model.parts);
  if (bb) {
    cam.target = v3.mul(v3.add(bb[0], bb[1]), 0.5);
    const r = Math.max(v3.len(v3.sub(bb[1], bb[0])) / 2, 50), a = Math.max(0.3, Math.min(1, ($('gl').clientWidth || 4) / ($('gl').clientHeight || 3)));
    cam.dist = r / Math.sin(rad(cam.fov) / 2) / a * 1.1;
  }
  refresh();
}
function setView(name) {
  const v = { front: [0, 0], top: [0, 90], right: [90, 0], iso: [35, 28] }[name];
  cam.yaw = v[0]; cam.pitch = v[1];
  fit3d();
}
function setMode(is3d) {
  if (is3d === mode3d) return;
  if (is3d && !initGL()) return;
  mode3d = is3d;
  for (const [id, on] of [['mode2d', !is3d], ['mode3d', is3d]]) { $(id).classList.toggle('on', on); $(id).setAttribute('aria-pressed', String(on)); }
  $('pal2d').hidden = is3d; $('pal3d').hidden = !is3d; $('p3d').hidden = !is3d;
  $('cv').hidden = is3d; $('gl').hidden = !is3d; $('ov').hidden = !is3d;
  for (const el of document.querySelectorAll('.only2d')) el.hidden = is3d;
  for (const id of ['layers', 'sheet', 'blocks', 'bom']) $(id).hidden = true;
  $('note').hidden = true;
  cmd.value = ''; tool3 = null; grip = null;
  if (is3d) {
    modelChanged();
    if (!fitted) { fitted = true; requestAnimationFrame(fit3d); }
  } else setTool(tool);
  refresh();
}
function moveCam(dx, dy) {                   // Ansicht verschieben (Pixel)
  const VP = camBasis(), k = 2 * cam.dist * Math.tan(rad(cam.fov) / 2) / ($('gl').clientHeight || 600);
  cam.target = v3.add(cam.target, v3.add(v3.mul(VP.r, -dx * k), v3.mul(VP.u, dy * k)));
}
function orbit(dx, dy) { cam.yaw = n360(cam.yaw - dx * 0.4); cam.pitch = Math.max(-89.9, Math.min(89.9, cam.pitch + dy * 0.4)); }
function setMouse3(ev) { const r = $('gl').getBoundingClientRect(); mouse3.x = ev.clientX - r.left; mouse3.y = ev.clientY - r.top; mouse3.in = true; }
function hoverUpdate() {                     // Treffer und Fangpunkt unter dem Zeiger
  const c = $('gl'), VP = viewProj(c.clientWidth, c.clientHeight);
  hover3 = pick3(rayAt(mouse3.x, mouse3.y, VP));
  snap3 = tool3 && tool3.type !== 'bool' ? findSnap3(VP) : null;
}
const glc = $('gl');
glc.addEventListener('contextmenu', ev => ev.preventDefault());
glc.addEventListener('pointerdown', ev => {
  const f = document.activeElement;
  if (f && f !== document.body && f !== cmd) f.blur();
  try { glc.setPointerCapture(ev.pointerId); } catch (e) { /* egal */ }
  setMouse3(ev); flashMsg = '';
  if (ev.pointerType === 'touch') {
    touches3.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (touches3.size === 2) { const [a, b] = [...touches3.values()]; pinch3 = { d: Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, dist: cam.dist }; drag3 = null; return; }
  }
  drag3 = { btn: ev.button, x: ev.clientX, y: ev.clientY, moved: 0, pan: ev.button === 1 || ev.button === 2 || ev.shiftKey || spaceDown };
  ev.preventDefault();
});
glc.addEventListener('pointermove', ev => {
  if (ev.pointerType === 'touch' && touches3.has(ev.pointerId)) {
    touches3.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (pinch3 && touches3.size === 2) {
      const [a, b] = [...touches3.values()], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      cam.dist = Math.max(10, pinch3.dist * pinch3.d / (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1));
      moveCam(mx - pinch3.x, my - pinch3.y); pinch3.x = mx; pinch3.y = my;
      return refresh();
    }
  }
  setMouse3(ev);
  if (drag3) {
    const dx = ev.clientX - drag3.x, dy = ev.clientY - drag3.y;
    drag3.moved += Math.abs(dx) + Math.abs(dy); drag3.x = ev.clientX; drag3.y = ev.clientY;
    if (drag3.moved > 4) { if (drag3.pan) moveCam(dx, dy); else orbit(dx, dy); }
  } else hoverUpdate();
  refresh();
});
glc.addEventListener('pointerup', ev => {
  if (ev.pointerType === 'touch') { touches3.delete(ev.pointerId); if (pinch3) { if (!touches3.size) pinch3 = null; drag3 = null; return; } }
  setMouse3(ev);
  const d = drag3;
  drag3 = null;
  if (d && d.moved <= 4) {
    if (d.btn === 2) { tool3 = null; cmd.value = ''; }
    else if (d.btn === 0) { hoverUpdate(); click3(); }
  }
  refresh();
});
glc.addEventListener('pointerleave', () => { if (!drag3) { mouse3.in = false; snap3 = null; refresh(); } });
glc.addEventListener('wheel', ev => {
  ev.preventDefault();
  setMouse3(ev);
  const c = $('gl'), VP = viewProj(c.clientWidth, c.clientHeight), dy = ev.deltaMode === 1 ? ev.deltaY * 33 : ev.deltaY;
  const f = Math.exp(dy * (ev.ctrlKey ? 0.01 : 0.0015)), ray = rayAt(mouse3.x, mouse3.y, VP), h = pick3(ray);
  const p = h ? h.p : v3.add(ray.o, v3.mul(ray.d, cam.persp ? cam.dist : cam.dist * 51));
  cam.target = v3.add(cam.target, v3.mul(v3.sub(p, cam.target), 1 - f));
  cam.dist = Math.max(5, cam.dist * f);
  refresh();
}, { passive: false });
new ResizeObserver(() => { if (mode3d) refresh(); }).observe($('stage'));

// ---------- Befehle im 3D-Modus ----------
const nextPartId = () => model.parts.reduce((m, p) => Math.max(m, p.id), 0) + 1;
const thick = () => model.params.some(p => p.name.toLowerCase() === 'staerke') ? 'Staerke' : '19';
function newPart(name, features, pos) {      // Bauteil anlegen, auswählen und zeigen
  const id = nextPartId(), color = WOOD[(id - 1) % WOOD.length];
  sel3 = id;                                 // vor dem Neuaufbau setzen, damit rechts gleich das neue Bauteil steht
  change(() => model.parts.push({ id, name, color, material: '', hide: false, pos: pos || { x: '0', y: '0', z: '0' }, features }));
  return id;
}
function besidePos() {                       // Lage rechts neben dem bisherigen Modell
  const bb = worldBox(visibleParts());
  return { x: bb ? String(Math.ceil(bb[1][0] + 50)) : '0', y: bb ? String(Math.round(bb[0][1])) : '0', z: '0' };
}
async function addBox() {
  const n = model.parts.length + 1;
  const v = await ask({ title: 'Platte / Quader', text: 'Maße dürfen Formeln mit Variablen sein, z. B. Breite - 2*Staerke. Für eine stehende Seitenwand: X = Stärke.',
    fields: [{ id: 'name', label: 'Name', value: 'Platte ' + n }, { id: 'sx', label: 'Breite X', value: '600', unit: 'mm' }, { id: 'sy', label: 'Tiefe Y', value: '400', unit: 'mm' }, { id: 'sz', label: 'Höhe Z', value: thick(), unit: 'mm' }], ok: 'Anlegen' });
  if (!v) return;
  newPart(v.name.trim() || 'Platte ' + n, [{ type: 'box', sx: v.sx.trim() || '600', sy: v.sy.trim() || '400', sz: v.sz.trim() || '19' }], besidePos());
  fit3d();
}
function twoDSelection() { return ents.filter(e => sel.has(e.id) && isOn(e)).flatMap(e => flat(e).map(p => ({ ...p, id: e.t === 'insert' ? 0 : p.id }))); }
async function extrudeFrom2D(revolve) {
  const list = twoDSelection();
  if (!list.length) return flash(revolve ? 'Erst eine geschlossene Kontur und eine Achslinie auswählen.' : 'Erst eine geschlossene Kontur auswählen (Rechteck, Linienzug, Kreis …).');
  let axis = null, prof = list;
  if (revolve) {
    const loopIds = new Set(profileLoops(list).loops.flatMap(l => l.map(p => p.src)));
    const cands = list.filter(e => e.t === 'line' && !loopIds.has(e.id));
    if (cands.length !== 1) return flash('Für einen Drehkörper genau eine einzelne Linie als Drehachse mit auswählen.');
    axis = cands[0]; prof = list.filter(e => e !== axis);
  }
  const { loops, open } = profileLoops(prof);
  if (!loops.length) return flash('Die Auswahl ergibt keine geschlossene Kontur' + (open ? ' – ' + open + ' offene Kette(n). Enden mit Fang verbinden.' : '.'));
  const fields = [{ id: 'name', label: 'Name', value: (revolve ? 'Drehteil ' : 'Körper ') + (model.parts.length + 1) },
    { id: 'plane', label: 'Skizze liegt in', options: Object.entries(PLANES).map(([k, p]) => [k, p.name]), value: 'XZ' }];
  if (revolve) fields.push({ id: 'angle', label: 'Winkel', value: '360', unit: '°' });
  else fields.push({ id: 'depth', label: 'Tiefe', value: thick(), unit: 'mm' }, { id: 'offset', label: 'Versatz', value: '0', unit: 'mm' });
  const v = await ask({ title: revolve ? 'Drehkörper aus 2D' : 'Extrusion aus 2D', text: loops.length + ' geschlossene Kontur(en). Die Kontur bleibt mit der 2D-Zeichnung verknüpft.', fields, ok: 'Erzeugen' });
  if (!v) return;
  const src = [...new Set(prof.map(e => e.id).filter(Boolean))];
  const f = revolve ? { type: 'revolve', plane: v.plane, angle: v.angle.trim() || '360', loops: plainLoops(loops), src, srcAxis: axis.id || 0, axis: { x1: axis.x1, y1: axis.y1, x2: axis.x2, y2: axis.y2 } }
    : { type: 'extrude', plane: v.plane, depth: v.depth.trim() || '19', offset: v.offset.trim() || '0', loops: plainLoops(loops), src };
  newPart(v.name.trim() || 'Körper', [f]);
  setMode(true);
  fit3d();
}
function copyPart() {
  const p = partById(sel3);
  if (!p) return flash('Erst ein Bauteil auswählen.');
  const m = meshOf(p), w = m.bb[1][0] - m.bb[0][0], src = p.features[0].type === 'copy' ? p.features[0].of : p.id;
  const pos = { ...p.pos, x: isNum(p.pos.x) ? String(R(val(p.pos.x) + w + 50)) : p.pos.x + ' + ' + fnum(R(w + 50)) };
  newPart(p.name.replace(/( \(Kopie\))+$/, '') + ' (Kopie)', [{ type: 'copy', of: src }], pos);
  flash('Verknüpfte Kopie angelegt: Sie ändert sich mit dem Original. Lage rechts anpassen oder „Verschieben“.');
}
function deletePart() {
  const p = partById(sel3);
  if (!p) return flash('Erst ein Bauteil auswählen.');
  const users = model.parts.filter(o => o !== p && o.features.some(f => f.of === p.id));
  if (users.length) return flash('„' + p.name + '“ wird noch von „' + users.map(o => o.name).join('“, „') + '“ benutzt.');
  change(() => { model.parts = model.parts.filter(o => o !== p); });
  sel3 = 0;
  flash('„' + p.name + '“ gelöscht. Strg+Z holt es zurück.');
}
function startTool3(type, op) {
  if (!model.parts.length) return flash('Es gibt noch kein Bauteil.');
  if (type !== 'move' && !partById(sel3)) return flash('Erst das Bauteil auswählen, das bearbeitet wird.');
  if (type === 'move' && !partById(sel3)) return flash('Erst das Bauteil auswählen, das verschoben wird.');
  tool3 = { type, op, base: null };
  cmd.value = '';
  refresh();
}
function localHit(part) {                    // Treffpunkt (oder Fangpunkt) in Bauteilkoordinaten und Flächennormale
  const off = posOf(part), p = snap3 && snap3.part === part ? snap3.p : hover3 && hover3.part === part ? hover3.p : null;
  return p && hover3 && hover3.part === part ? { p: v3.sub(p, off), n: hover3.n } : null;
}
const r1 = v => String(Math.round(v * 10) / 10);
function click3() {
  if (!tool3) { sel3 = hover3 ? hover3.part.id : 0; panel3d(); return; }
  const part = partById(sel3);
  if (tool3.type === 'move') {
    const p = snap3 ? snap3.p : hover3 ? hover3.p : null;
    if (!p) return flash('Bitte einen Punkt auf einem Bauteil anklicken.');
    if (!tool3.base) { tool3.base = p; return; }
    return movePart(part, v3.sub(p, tool3.base));
  }
  if (tool3.type === 'bool') {
    const o = hover3 && hover3.part;
    if (!o || o === part) return flash('Bitte ein anderes Bauteil anklicken.');
    if (o.features.some(f => f.of === part.id)) return flash('Diese beiden Bauteile hängen schon voneinander ab.');
    change(() => part.features.push({ type: 'bool', op: tool3.op, of: o.id }));
    tool3 = null;
    return flash('„' + o.name + '“ ' + { sub: 'abgezogen', add: 'vereinigt', int: 'geschnitten' }[part.features[part.features.length - 1].op] + '. Es bleibt rechts in der Liste und lässt sich weiter ändern.');
  }
  const h = localHit(part);
  if (!h) return flash('Bitte eine Fläche von „' + part.name + '“ anklicken.');
  const k = [0, 1, 2].reduce((a, b) => Math.abs(h.n[b]) > Math.abs(h.n[a]) ? b : a, 0), s = h.n[k] > 0 ? 1 : -1;
  if (tool3.type === 'hole') {
    const dir = (s > 0 ? '-' : '+') + 'xyz'[k];
    change(() => part.features.push({ type: 'hole', d: '8', depth: '10', x: r1(h.p[0]), y: r1(h.p[1]), z: r1(h.p[2]), dir }));
    flash('Bohrung Ø 8 × 10 angelegt – Durchmesser, Tiefe und Lage rechts ändern.');
  } else if (tool3.type === 'cut') {
    const bb = meshOf(part).bb, [a, b] = [0, 1, 2].filter(i => i !== k), A = bb[1][a] - bb[0][a] >= bb[1][b] - bb[0][b] ? a : b, B = A === a ? b : a;
    const lo = [0, 0, 0], sz = [0, 0, 0];
    lo[A] = bb[0][A] - 1; sz[A] = bb[1][A] - bb[0][A] + 2;
    lo[B] = h.p[B] - 4; sz[B] = 8;
    lo[k] = s > 0 ? bb[1][k] - 10 : bb[0][k] - 1; sz[k] = 11;
    change(() => part.features.push({ type: 'cut', sx: r1(sz[0]), sy: r1(sz[1]), sz: r1(sz[2]), x: r1(lo[0]), y: r1(lo[1]), z: r1(lo[2]) }));
    flash('Nut 8 mm breit, 10 mm tief angelegt – Maße und Lage rechts ändern.');
  }
  tool3 = null;
}
function movePart(part, d) {                 // Lage um d verschieben (Formeln bleiben erhalten)
  if (!part || v3.len(d) < 1e-9) { tool3 = null; return; }
  change(() => {
    ['x', 'y', 'z'].forEach((k, i) => {
      if (Math.abs(d[i]) < 1e-9) return;
      const e = part.pos[k];
      part.pos[k] = isNum(e) ? fnum(R(val(e) + d[i])) : e + (d[i] > 0 ? ' + ' : ' - ') + fnum(R(Math.abs(d[i])));
    });
  });
  tool3 = null;
  flash('„' + part.name + '“ verschoben um ' + d.map(v => fmt(v)).join(' / ') + ' mm.');
}
function typed3() {                          // Eingabe im 3D-Modus: Verschiebung x;y;z
  const s = cmd.value.trim();
  if (!s) { tool3 = null; return; }
  if (tool3 && tool3.type === 'move') {
    const v = s.replace(/^@/, '').split(';').map(num);
    if (v.length !== 3 || v.some(isNaN)) return flash('Bitte die Verschiebung als x;y;z tippen, z. B. 0;0;150.');
    cmd.value = '';
    return movePart(partById(sel3), v);
  }
  flash('Hier gibt es nichts einzugeben.');
}
function key3d(ev, altGr) {
  const k = ev.key, t = ev.target;
  if ((ev.ctrlKey || ev.metaKey) && !altGr) {
    const l = k.toLowerCase();
    if (l === 'z') { ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); }
    else if (l === 'y') { ev.preventDefault(); redo(); }
    else if (l === 's') { ev.preventDefault(); saveFile(); }
    return;
  }
  if (ev.altKey && !altGr) return;
  if (k === 'Escape') {
    if (cmd.value) cmd.value = '';
    else if (tool3) tool3 = null;
    else if (!$('bom').hidden) $('bom').hidden = true;
    else if (!$('help').hidden) $('help').hidden = true;
    else { sel3 = 0; panel3d(); }
  } else if (k === 'Enter') typed3();
  else if (k === 'Delete' || k === 'Backspace') {
    if (cmd.value) { if (t === cmd) return; cmd.value = cmd.value.slice(0, -1); }
    else deletePart();
  } else if (/^[0-9.,;<@+\-]$/.test(k)) { if (t === cmd) return; cmd.value += k; }
  else if (k === ' ') spaceDown = true;
  else return;
  ev.preventDefault();
  refresh();
}
function status3d() {
  const p = partById(sel3);
  if (glFail) return '3D braucht WebGL – dieser Browser stellt es nicht bereit.';
  if (tool3) {
    if (tool3.type === 'move') return tool3.base ? 'VERSCHIEBEN: Zielpunkt anklicken oder Weg als x;y;z tippen + Enter (z. B. 0;0;150) · Esc bricht ab'
      : 'VERSCHIEBEN „' + p.name + '“: Ausgangspunkt anklicken – Ecken □, Kantenmitten △ und Flächenmitten ○ werden gefangen';
    if (tool3.type === 'hole') return 'BOHRUNG: Fläche von „' + p.name + '“ anklicken, wo gebohrt wird · Esc bricht ab';
    if (tool3.type === 'cut') return 'NUT: Fläche von „' + p.name + '“ anklicken, in der die Nut liegt · Esc bricht ab';
    if (tool3.type === 'bool') return { sub: 'ABZIEHEN', add: 'VEREINIGEN', int: 'SCHNITTMENGE' }[tool3.op] + ': das andere Bauteil anklicken · Esc bricht ab';
  }
  if (!model.parts.length) return '3D: „+ Platte / Quader“ anlegen oder in 2D eine Kontur auswählen und „Extrudieren“ wählen · linke Maustaste dreht, rechte verschiebt, Mausrad zoomt';
  if (p) return '„' + p.name + '“ ausgewählt · Maße rechts ändern · Bohrung, Nut, Abziehen … wirken auf dieses Bauteil · Entf löscht';
  return 'Bauteil anklicken zum Auswählen · linke Maustaste dreht, rechte oder mittlere verschiebt, Mausrad zoomt';
}
function coords3d() {
  const p = snap3 ? snap3.p : hover3 ? hover3.p : null;
  return p ? 'X ' + fmt(p[0], 1) + '   Y ' + fmt(p[1], 1) + '   Z ' + fmt(p[2], 1) : (section ? 'Schnitt ' + 'XYZ'[section.axis] + ' = ' + fmt(section.at, 1) + ' mm' : '');
}

// ---------- Bauteilbaum, Variablen, Eigenschaften (rechts) ----------
const IDENT = /^[A-Za-zÄÖÜäöüß_][A-Za-z0-9ÄÖÜäöüß_]*$/;
const FEATS = {
  box: { name: 'Quader', fields: [['sx', 'Breite X'], ['sy', 'Tiefe Y'], ['sz', 'Höhe Z']] },
  extrude: { name: 'Extrusion aus 2D', fields: [['depth', 'Tiefe'], ['offset', 'Versatz']] },
  revolve: { name: 'Drehkörper aus 2D', fields: [['angle', 'Winkel']] },
  copy: { name: 'Verknüpfte Kopie', fields: [] },
  hole: { name: 'Bohrung', fields: [['d', 'Ø'], ['depth', 'Tiefe'], ['x', 'Mitte X'], ['y', 'Mitte Y'], ['z', 'Mitte Z']] },
  cut: { name: 'Nut / Ausschnitt', fields: [['sx', 'Länge X'], ['sy', 'Länge Y'], ['sz', 'Länge Z'], ['x', 'ab X'], ['y', 'ab Y'], ['z', 'ab Z']] },
  bool: { name: '', fields: [] },
};
const BOOLNAME = { sub: 'Abziehen', add: 'Vereinigen', int: 'Schnittmenge' };
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) { if (k === 'cls') e.className = v; else if (k === 'text') e.textContent = v; else e[k] = v; }
  for (const c of kids) if (c != null) e.append(c);
  return e;
}
function exprField(grid, id, label, value, onSet, unit) {   // Feld für Maß oder Formel mit berechnetem Wert daneben
  const inp = el('input', { type: 'text', id, value, spellcheck: false, autocomplete: 'off' }), out = el('span', { cls: 'val' });
  try { const v = val(value); out.textContent = isNum(value) ? (unit || '') : '= ' + fmt(v) + (unit ? ' ' + unit : ''); }
  catch (e) { inp.classList.add('bad'); inp.title = e.message; out.textContent = '⚠'; out.title = e.message; }
  inp.onchange = () => { const v = inp.value.trim(); if (v && v !== value) onSet(v); else inp.value = value; };
  grid.append(el('label', { htmlFor: id, text: label }), inp, out);
}
function selectField(grid, id, label, options, value, onSet) {
  const s = el('select', { id });
  for (const [v, t] of options) s.add(new Option(t, v));
  s.value = String(value);
  s.onchange = () => onSet(s.value);
  grid.append(el('label', { htmlFor: id, text: label }), s, el('span'));
}
function panel3d() {
  if (!mode3d) return;
  const act = document.activeElement, keep = act && act.id && $('p3d').contains(act) ? act.id : null, used = consumed();
  const pr = $('paramRows'); pr.textContent = '';
  if (!model.params.length) pr.append(el('p', { cls: 'hint', text: 'Variablen wie Staerke = 19 oder Breite = 600 lassen sich in allen Maßen verwenden, auch in Formeln.' }));
  else {
    const g = el('div', { cls: 'fgrid' });
    g.style.gridTemplateColumns = 'minmax(60px, 1fr) minmax(60px, 1.3fr) auto auto';
    model.params.forEach((p, i) => {
      const k = p.name.toLowerCase(), err = perrs[k];
      const name = el('input', { type: 'text', id: 'pv-n-' + i, value: p.name, spellcheck: false, autocomplete: 'off', title: 'Name der Variable' });
      const ex = el('input', { type: 'text', id: 'pv-e-' + i, value: p.expr, spellcheck: false, autocomplete: 'off', title: err || 'Wert oder Formel' });
      name.onchange = () => renameParam(i, name.value.trim(), name);
      ex.onchange = () => { const v = ex.value.trim(); if (!v) { ex.value = p.expr; return; } change(() => { p.expr = v; }); refresh(); };
      if (err) ex.classList.add('bad');
      const out = el('span', { cls: 'val', text: err ? '⚠' : isNum(p.expr) ? '' : '= ' + fmt(pvals[k]) });
      if (err) out.title = err;
      g.append(name, ex, out, el('button', { type: 'button', cls: 'x', text: '×', title: 'Variable „' + p.name + '“ löschen', onclick: () => { change(() => { model.params.splice(i, 1); }); refresh(); } }));
    });
    pr.append(g);
  }
  const pl = $('partRows'); pl.textContent = '';
  if (!model.parts.length) pl.append(el('p', { cls: 'hint', text: 'Noch keine Bauteile. Links „+ Platte / Quader“ oder in 2D „Extrudieren“.' }));
  for (const p of model.parts) {
    const g = partGeo(p), user = used.has(p.id) ? model.parts.find(o => o.features.some(f => f.type === 'bool' && f.of === p.id)) : null;
    const row = el('div', { cls: 'prow' + (p.id === sel3 ? ' cur' : '') + (user ? ' used' : '') });
    const vis = el('input', { type: 'checkbox', id: 'pt-v-' + p.id, checked: !p.hide, title: 'Bauteil ein- oder ausblenden' });
    vis.onchange = () => { change(() => { p.hide = !vis.checked; }); refresh(); };
    const dot = el('span', { cls: 'pdot' });
    dot.style.background = p.color;
    const name = el('span', { cls: 'pname', text: p.name + (user ? ' – Werkzeug für „' + user.name + '“' : ''), title: 'Auswählen' });
    name.onclick = () => { sel3 = p.id; tool3 = null; panel3d(); refresh(); };
    row.append(vis, dot, name);
    if (g.err) row.append(el('span', { cls: 'perr', text: '⚠', title: g.err }));
    pl.append(row);
  }
  const pp = $('propRows'), p = partById(sel3);
  pp.textContent = '';
  if (!p) pp.append(el('p', { cls: 'hint', text: 'Bauteil im Modell oder in der Liste anklicken, um Maße, Lage und Arbeitsschritte zu ändern.' }));
  else {
    const g0 = el('div', { cls: 'fgrid' }), name = el('input', { type: 'text', id: 'pp-name', value: p.name, autocomplete: 'off' });
    name.onchange = () => { const v = name.value.trim().slice(0, 60); if (v && v !== p.name) { change(() => { p.name = v; }); refresh(); } else name.value = p.name; };
    const col = el('input', { type: 'color', id: 'pp-color', value: p.color, title: 'Farbe' });
    col.onchange = () => { change(() => { p.color = col.value.toLowerCase(); }); refresh(); };
    const mat = el('input', { type: 'text', id: 'pp-mat', value: p.material, placeholder: 'z. B. Eiche 19 mm', autocomplete: 'off' });
    mat.onchange = () => { change(() => { p.material = mat.value.trim().slice(0, 60); }); refresh(); };
    g0.append(el('label', { htmlFor: 'pp-name', text: 'Name' }), name, col, el('label', { htmlFor: 'pp-mat', text: 'Material' }), mat, el('span'));
    for (const k of ['x', 'y', 'z']) exprField(g0, 'pp-' + k, 'Lage ' + k.toUpperCase(), p.pos[k], v => { change(() => { p.pos[k] = v; }); refresh(); }, 'mm');
    pp.append(g0);
    const geo = partGeo(p), others = model.parts.filter(o => o !== p).map(o => [o.id, o.name]);
    p.features.forEach((f, i) => {
      const box = el('div', { cls: 'feat' }), h = el('h3', {}, el('span', { text: (i ? '' : 'Grundkörper: ') + (f.type === 'bool' ? BOOLNAME[f.op] : FEATS[f.type].name) }));
      if (i) h.append(el('button', { type: 'button', cls: 'x', text: '×', title: 'Arbeitsschritt löschen', onclick: () => { change(() => { p.features.splice(i, 1); }); refresh(); } }));
      box.append(h);
      if (geo.errs[i]) box.append(el('p', { cls: 'err', text: geo.errs[i] }));
      const g = el('div', { cls: 'fgrid' }), set = (k, v) => { change(() => { f[k] = v; }); refresh(); };
      if (f.type === 'extrude' || f.type === 'revolve') selectField(g, 'pp-f' + i + '-plane', 'Skizze in', Object.entries(PLANES).map(([k, pl]) => [k, pl.name]), f.plane, v => set('plane', v));
      if (f.type === 'bool') selectField(g, 'pp-f' + i + '-op', 'Art', Object.entries(BOOLNAME), f.op, v => set('op', v));
      if (f.type === 'copy' || f.type === 'bool') selectField(g, 'pp-f' + i + '-of', f.type === 'copy' ? 'Original' : 'mit Bauteil', others, f.of, v => set('of', +v));
      if (f.type === 'hole') selectField(g, 'pp-f' + i + '-dir', 'Richtung', Object.entries(DIRNAME), f.dir, v => set('dir', v));
      for (const [k, lab] of FEATS[f.type].fields) exprField(g, 'pp-f' + i + '-' + k, lab, f[k], v => set(k, v), k === 'angle' ? '°' : 'mm');
      box.append(g);
      if (f.type === 'extrude' || f.type === 'revolve') {
        const linked = Array.isArray(f.src) && f.src.length && f.src.every(id => byId(id));
        box.append(el('p', { cls: 'hint', text: linked ? 'Kontur aus der 2D-Zeichnung – Änderungen dort wirken hier mit.' : 'Kontur gespeichert (die 2D-Elemente gibt es nicht mehr).' }));
      }
      pp.append(box);
    });
    const m = meshOf(p);
    if (m.tris.length) {
      const d = [0, 1, 2].map(k => m.bb[1][k] - m.bb[0][k]);
      pp.append(el('p', { cls: 'hint', text: 'Außenmaße ' + d.map(v => fmt(v, 1)).join(' × ') + ' mm (X × Y × Z) · Volumen ' + fmt(Math.abs(volumeOf(geo.polys)) / 1e6, 3) + ' dm³' }));
    }
  }
  if (keep && $(keep)) $(keep).focus();
}
function renameParam(i, n, inp) {            // Variable umbenennen und alle Formeln mitziehen
  const p = model.params[i];
  if (n === p.name) return;
  if (!IDENT.test(n)) { inp.value = p.name; return flash('Namen bestehen aus Buchstaben, Ziffern und _ und beginnen mit einem Buchstaben.'); }
  if (model.params.some((q, j) => j !== i && q.name.toLowerCase() === n.toLowerCase())) { inp.value = p.name; return flash('Eine Variable „' + n + '“ gibt es schon.'); }
  const re = new RegExp('(^|[^A-Za-z0-9ÄÖÜäöüß_])' + p.name + '(?![A-Za-z0-9ÄÖÜäöüß_])', 'gi'), sub = s => typeof s === 'string' ? s.replace(re, (m, a) => a + n) : s;
  change(() => {
    for (const q of model.params) q.expr = sub(q.expr);
    for (const part of model.parts) {
      for (const k of ['x', 'y', 'z']) part.pos[k] = sub(part.pos[k]);
      for (const f of part.features) for (const key of Object.keys(f)) if (!['type', 'plane', 'op', 'dir'].includes(key)) f[key] = sub(f[key]);
    }
    p.name = n;
  });
  flash('Variable umbenannt – alle Formeln verwenden jetzt „' + n + '“.');
  refresh();
}
async function addParam() {
  const first = !model.params.length;
  const v = await ask({ title: 'Neue Variable', text: 'Beispiele: Staerke = 19 · Breite = 600 · Innenbreite = Breite - 2*Staerke',
    fields: [{ id: 'name', label: 'Name', value: first ? 'Staerke' : 'Wert' + (model.params.length + 1) }, { id: 'expr', label: 'Wert', value: first ? '19' : '0' }], ok: 'Anlegen' });
  if (!v) return;
  const n = v.name.trim(), e = v.expr.trim() || '0';
  if (!IDENT.test(n)) return flash('Namen bestehen aus Buchstaben, Ziffern und _ und beginnen mit einem Buchstaben.');
  if (model.params.some(q => q.name.toLowerCase() === n.toLowerCase())) return flash('Eine Variable „' + n + '“ gibt es schon.');
  change(() => model.params.push({ name: n, expr: e }));
  refresh();
}
function modelChanged() {                    // nach jeder Änderung: Variablen rechnen, Auswahl prüfen, Liste neu
  evalParams();
  collide.clear();
  if (sel3 && !partById(sel3)) sel3 = 0;
  if (tool3 && !partById(sel3)) tool3 = null;
  if (mode3d) { panel3d(); sectionUI(); }
}
function cleanModel(raw) {                   // geladenes Modell prüfen
  const out = { params: [], parts: [] };
  if (!raw || typeof raw !== 'object') return out;
  const str = v => typeof v === 'string' ? v.slice(0, 200) : typeof v === 'number' && isFinite(v) ? String(v) : null;
  const names = new Set();
  for (const p of Array.isArray(raw.params) ? raw.params : []) {
    const e = p && str(p.expr);
    if (!p || typeof p.name !== 'string' || !IDENT.test(p.name) || names.has(p.name.toLowerCase()) || e === null) continue;
    names.add(p.name.toLowerCase()); out.params.push({ name: p.name, expr: e });
  }
  const okLoops = l => Array.isArray(l) ? l.filter(Array.isArray).map(L => L.filter(q => q && isFinite(q.u) && isFinite(q.v)).map(q => ({ u: q.u, v: q.v, src: Number.isInteger(q.src) ? q.src : 0, smooth: q.smooth === true }))).filter(L => L.length >= 3) : [];
  const ids = new Set();
  for (const p of Array.isArray(raw.parts) ? raw.parts : []) {
    if (!p || !Number.isInteger(p.id) || p.id < 1 || ids.has(p.id) || !Array.isArray(p.features)) continue;
    const feats = [];
    p.features.forEach((f, i) => {
      if (!f || typeof f !== 'object' || (i === 0) !== ['box', 'extrude', 'revolve', 'copy'].includes(f.type)) return;
      const s = (k, d) => str(f[k]) || d;
      if (f.type === 'box') feats.push({ type: 'box', sx: s('sx', '600'), sy: s('sy', '400'), sz: s('sz', '19') });
      else if (f.type === 'extrude' && PLANES[f.plane]) feats.push({ type: 'extrude', plane: f.plane, depth: s('depth', '19'), offset: s('offset', '0'), loops: okLoops(f.loops), src: Array.isArray(f.src) ? f.src.filter(Number.isInteger) : [] });
      else if (f.type === 'revolve' && PLANES[f.plane] && f.axis && ['x1', 'y1', 'x2', 'y2'].every(k => isFinite(f.axis[k])))
        feats.push({ type: 'revolve', plane: f.plane, angle: s('angle', '360'), loops: okLoops(f.loops), src: Array.isArray(f.src) ? f.src.filter(Number.isInteger) : [], srcAxis: Number.isInteger(f.srcAxis) ? f.srcAxis : 0, axis: { x1: +f.axis.x1, y1: +f.axis.y1, x2: +f.axis.x2, y2: +f.axis.y2 } });
      else if (f.type === 'copy' && Number.isInteger(f.of)) feats.push({ type: 'copy', of: f.of });
      else if (f.type === 'hole') feats.push({ type: 'hole', d: s('d', '8'), depth: s('depth', '10'), x: s('x', '0'), y: s('y', '0'), z: s('z', '0'), dir: DIRS[f.dir] ? f.dir : '-z' });
      else if (f.type === 'cut') feats.push({ type: 'cut', sx: s('sx', '10'), sy: s('sy', '10'), sz: s('sz', '10'), x: s('x', '0'), y: s('y', '0'), z: s('z', '0') });
      else if (f.type === 'bool' && BOOLNAME[f.op] && Number.isInteger(f.of)) feats.push({ type: 'bool', op: f.op, of: f.of });
    });
    if (!feats.length || !['box', 'extrude', 'revolve', 'copy'].includes(feats[0].type)) continue;
    ids.add(p.id);
    const pos = p.pos && typeof p.pos === 'object' ? p.pos : {};
    out.parts.push({ id: p.id, name: typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 60) : 'Bauteil ' + p.id,
      color: typeof p.color === 'string' && /^#[0-9a-f]{6}$/i.test(p.color) ? p.color.toLowerCase() : WOOD[(p.id - 1) % WOOD.length],
      material: typeof p.material === 'string' ? p.material.slice(0, 60) : '', hide: p.hide === true,
      pos: { x: str(pos.x) || '0', y: str(pos.y) || '0', z: str(pos.z) || '0' }, features: feats });
  }
  for (const p of out.parts) p.features = p.features.filter((f, i) => i === 0 || !f.of || (ids.has(f.of) && f.of !== p.id));
  return out;
}

// ---------- Prüfen und Ausgeben ----------
function bomData() {                         // gleiche Teile (Maße und Material) zusammengefasst
  const groups = new Map();
  for (const p of visibleParts()) {
    const g = partGeo(p), m = meshOf(p);
    if (g.err || !m.tris.length) continue;
    const d = [0, 1, 2].map(k => Math.round((m.bb[1][k] - m.bb[0][k]) * 10) / 10).sort((a, b) => b - a), key = d.join('x') + '|' + (p.material || '');
    if (!groups.has(key)) groups.set(key, { names: [], n: 0, d, mat: p.material || '' });
    const gr = groups.get(key), base = p.name.replace(/( \(Kopie\))+$/, '');
    gr.n++;
    if (!gr.names.includes(base)) gr.names.push(base);
  }
  return [...groups.values()].sort((a, b) => b.d[0] - a.d[0] || b.d[1] - a.d[1] || b.d[2] - a.d[2]);
}
function showBom() {
  const rows = bomData(), t = $('bomTable');
  t.textContent = '';
  if (!rows.length) t.append(el('p', { cls: 'hint', text: 'Es gibt noch keine Bauteile.' }));
  else {
    const tb = el('tbody');
    rows.forEach((r, i) => tb.append(el('tr', {}, el('td', { cls: 'n', text: String(i + 1) }), el('td', { cls: 'n', text: String(r.n) }), el('td', { text: r.names.join(', ') }),
      el('td', { cls: 'n', text: fmt(r.d[0], 1) }), el('td', { cls: 'n', text: fmt(r.d[1], 1) }), el('td', { cls: 'n', text: fmt(r.d[2], 1) }), el('td', { text: r.mat }))));
    const th = el('tr');
    for (const h of ['Pos', 'Anzahl', 'Bezeichnung', 'Länge', 'Breite', 'Dicke', 'Material']) th.append(el('th', { text: h }));
    t.append(el('table', {}, el('thead', {}, th), tb));
  }
  for (const id of ['layers', 'help', 'sheet', 'blocks']) $(id).hidden = true;
  $('bom').hidden = false;
}
function bomCsv() {
  const rows = bomData(), q = s => '"' + String(s).replace(/"/g, '""') + '"';
  if (!rows.length) return flash('Es gibt noch keine Bauteile.');
  const lines = ['Pos;Anzahl;Bezeichnung;Länge;Breite;Dicke;Material', ...rows.map((r, i) => [i + 1, r.n, q(r.names.join(', ')), fmt(r.d[0], 1), fmt(r.d[1], 1), fmt(r.d[2], 1), q(r.mat)].join(';'))];
  download('stueckliste.csv', '﻿' + lines.join('\r\n') + '\r\n', 'text/csv');
}
function exportSTL() {                       // binäres STL aller sichtbaren Bauteile (mm)
  const tris = [];
  for (const p of visibleParts()) { const m = meshOf(p), o = posOf(p); for (const [a, b, c, n] of m.tris) tris.push([n, v3.add(a, o), v3.add(b, o), v3.add(c, o)]); }
  if (!tris.length) return flash('Es gibt noch kein Bauteil.');
  const buf = new ArrayBuffer(84 + tris.length * 50), dv = new DataView(buf), head = 'Mini-CAD STL, Einheit mm';
  for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i));
  dv.setUint32(80, tris.length, true);
  let o = 84;
  for (const t of tris) { for (const v of t) for (const x of v) { dv.setFloat32(o, x, true); o += 4; } dv.setUint16(o, 0, true); o += 2; }
  const bytes = new Uint8Array(buf);
  if (inViewer) download('modell-stl.zip', zip1('modell.stl', bytes));      // .stl selbst lässt der Viewer nicht zu
  else download('modell.stl', new Blob([bytes], { type: 'model/stl' }));
}
function checkCollisions() {
  const list = visibleParts().filter(p => !partGeo(p).err && meshOf(p).tris.length), pairs = [];
  const wb = list.map(p => { const m = meshOf(p), o = posOf(p); return [v3.add(m.bb[0], o), v3.add(m.bb[1], o)]; });
  const plainBox = p => p.features.length === 1 && p.features[0].type === 'box';
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = wb[i], b = wb[j];
    if ([0, 1, 2].some(k => Math.min(a[1][k], b[1][k]) - Math.max(a[0][k], b[0][k]) <= 0.01)) continue;   // berühren sich höchstens
    if (plainBox(list[i]) && plainBox(list[j])) { pairs.push([list[i], list[j]]); continue; }
    const A = movePolys(partGeo(list[i]).polys, posOf(list[i])), B = movePolys(partGeo(list[j]).polys, posOf(list[j]));
    if (Math.abs(volumeOf(csg('int', A, B))) > 1) pairs.push([list[i], list[j]]);
  }
  collide.clear();
  for (const [a, b] of pairs) { collide.add(a.id); collide.add(b.id); }
  flash(pairs.length ? 'Überschneidung: ' + pairs.slice(0, 4).map(([a, b]) => a.name + ' ↔ ' + b.name).join(' · ') + (pairs.length > 4 ? ' und ' + (pairs.length - 4) + ' weitere' : '') + ' (rot markiert)'
    : 'Keine Überschneidungen – die Bauteile berühren sich höchstens.');
  refresh();
}
const secCtl = el('span', { cls: 'grp', id: 'secCtl', hidden: true });
secCtl.innerHTML = '<span>Schnitt</span><select id="secAxis" aria-label="Schnittachse"><option value="0">X</option><option value="1">Y</option><option value="2">Z</option></select>' +
  '<input type="range" id="secPos" aria-label="Lage des Schnitts"><button type="button" id="secFlip" title="Andere Hälfte zeigen">Seite</button><button type="button" id="secOff">Aus</button>';
$('status').insertBefore(secCtl, $('coords'));
function sectionUI() {
  const bb = worldBox(visibleParts());
  $('secCtl').hidden = !section || !mode3d;
  $('m3section').classList.toggle('on', !!section);
  if (!section || !bb) return;
  const r = $('secPos'), k = section.axis;
  r.min = String(Math.floor(bb[0][k])); r.max = String(Math.ceil(bb[1][k])); r.step = 'any'; r.value = String(section.at);
  $('secAxis').value = String(k);
}
function toggleSection() {
  if (section) section = null;
  else {
    const bb = worldBox(visibleParts());
    if (!bb) return flash('Es gibt noch kein Bauteil.');
    section = { axis: 1, at: (bb[0][1] + bb[1][1]) / 2, flip: true };
  }
  sectionUI(); refresh();
}
$('secAxis').onchange = ev => { const bb = worldBox(visibleParts()), k = +ev.target.value; section.axis = k; if (bb) section.at = (bb[0][k] + bb[1][k]) / 2; sectionUI(); refresh(); };
$('secPos').oninput = ev => { section.at = +ev.target.value; refresh(); };
$('secFlip').onclick = () => { section.flip = !section.flip; refresh(); };
$('secOff').onclick = () => { section = null; sectionUI(); refresh(); };

// 2D-Ansichten nach DIN (Projektionsmethode 1): Draufsicht unter, Seitenansicht von links rechts neben der Vorderansicht
const VIEWS = {
  front: { name: 'Vorderansicht', to: [0, -1, 0], uv: p => [p[0], p[2]] },
  top: { name: 'Draufsicht', to: [0, 0, 1], uv: p => [p[0], p[1]] },
  left: { name: 'Seitenansicht', to: [-1, 0, 0], uv: p => [-p[1], p[2]] },
};
function projectView(key, world) {           // sichtbare und verdeckte Kanten einer Ansicht
  const V = VIEWS[key], out = [], seen = new Set(), sk = (a, b) => [a, b].map(p => p.map(v => Math.round(v * 100)).join(',')).sort().join('|');
  const hidden = p => {
    const o = v3.add(p, v3.mul(V.to, 0.05));
    for (const w of world) { if (!rayBox(o, V.to, w.bb)) continue; for (const [a, b, c] of w.tris) if (rayTri(o, V.to, a, b, c) > 1e-4) return true; }
    return false;
  };
  for (const w of world) for (const [a, b] of w.edges) {
    const A = V.uv(a), B = V.uv(b), L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    if (L < 1e-6) continue;
    const n = Math.max(1, Math.min(64, Math.ceil(L / 4))), vis = [];
    for (let i = 0; i < n; i++) vis.push(hidden(v3.lerp(a, b, (i + 0.5) / n)));
    let s = 0;
    for (let i = 1; i <= n; i++) if (i === n || vis[i] !== vis[s]) {
      const pu = V.uv(v3.lerp(a, b, s / n)), qu = V.uv(v3.lerp(a, b, i / n)), k = sk(pu, qu) + vis[s];
      if (!seen.has(k)) { seen.add(k); out.push({ a: pu, b: qu, hidden: vis[s] }); }
      s = i;
    }
  }
  const shownKeys = new Set(out.filter(x => !x.hidden).map(x => sk(x.a, x.b)));
  return out.filter(x => !x.hidden || !shownKeys.has(sk(x.a, x.b)));
}
async function makeViews() {
  if (!visibleParts().some(p => meshOf(p).tris.length)) return flash('Es gibt noch kein Bauteil.');
  const v = await ask({ title: '2D-Ansichten erzeugen', text: 'Anordnung nach DIN: Draufsicht unter, Seitenansicht von links rechts neben der Vorderansicht. Verdeckte Kanten kommen gestrichelt auf einen eigenen Layer.',
    fields: [{ id: 'which', label: 'Ansichten', options: [['all', 'Vorder-, Drauf- und Seitenansicht'], ['front', 'nur Vorderansicht'], ['top', 'nur Draufsicht'], ['left', 'nur Seitenansicht von links']] }], ok: 'Erzeugen' });
  if (!v) return;
  flash('Ansichten werden berechnet …');
  await new Promise(r => setTimeout(r, 30));
  const world = visibleParts().map(p => { const m = meshOf(p), o = posOf(p); return { tris: m.tris.map(([a, b, c]) => [v3.add(a, o), v3.add(b, o), v3.add(c, o)]), bb: [v3.add(m.bb[0], o), v3.add(m.bb[1], o)], edges: m.edgeList.map(([a, b]) => [v3.add(a, o), v3.add(b, o)]) }; }).filter(w => w.tris.length);
  const keys = v.which === 'all' ? ['front', 'top', 'left'] : [v.which], views = {};
  for (const k of keys) views[k] = projectView(k, world);
  const bbOf = segs => { const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }; for (const s of segs) for (const p of [s.a, s.b]) { b.x0 = Math.min(b.x0, p[0]); b.y0 = Math.min(b.y0, p[1]); b.x1 = Math.max(b.x1, p[0]); b.y1 = Math.max(b.y1, p[1]); } return b; };
  const ext = extents(ents, 0), ox = ext ? Math.ceil(ext.x1 + 300) : 0, gap = 150, sh = {};
  const F = views.front && bbOf(views.front);
  if (F) sh.front = [ox - F.x0, -F.y0];
  if (views.top) { const T = bbOf(views.top); sh.top = F ? [sh.front[0], -gap - T.y1] : [ox - T.x0, -T.y0]; }
  if (views.left) { const Lb = bbOf(views.left); sh.left = F ? [F.x1 + sh.front[0] + gap - Lb.x0, sh.front[1]] : [ox - Lb.x0, -Lb.y0]; }
  let n = 0;
  change(() => {
    let lv = layers.find(l => l.name === 'Ansicht'), lh = layers.find(l => l.name === 'Ansicht verdeckt');
    const nid = () => layers.reduce((m, l) => Math.max(m, l.id), 0) + 1;
    if (!lv) { lv = { id: nid(), name: uniqueName('Ansicht'), color: '#000000', type: 'solid', width: 1.5, on: true }; layers.push(lv); }
    if (!lh) { lh = { id: nid(), name: uniqueName('Ansicht verdeckt'), color: '#868e96', type: 'dashed', width: 1, on: true }; layers.push(lh); }
    lv.on = lh.on = true;
    for (const k of keys) for (const s of views[k]) {
      const [dx, dy] = sh[k];
      ents.push({ id: nextId++, t: 'line', l: s.hidden ? lh.id : lv.id, x1: R(s.a[0] + dx), y1: R(s.a[1] + dy), x2: R(s.b[0] + dx), y2: R(s.b[1] + dy) });
      n++;
    }
  });
  setMode(false);
  zoomFit();
  flash(keys.map(k => VIEWS[k].name).join(', ') + ' erzeugt: ' + n + ' Linien auf den Layern „Ansicht“ und „Ansicht verdeckt“. Jetzt bemaßen und über „Blatt & Export“ als PDF speichern.');
}
function clearModel() {
  if (!model.parts.length) return;
  change(() => { model.parts = []; });
  sel3 = 0; tool3 = null; section = null; sectionUI();
  flash('Modell geleert, die Variablen bleiben. Strg+Z holt die Bauteile zurück.');
  refresh();
}

// ---------- Knöpfe ----------
$('mode2d').onclick = () => setMode(false);
$('mode3d').onclick = () => setMode(true);
$('toExtrude').onclick = () => extrudeFrom2D(false);
$('toRevolve').onclick = () => extrudeFrom2D(true);
for (const k of ['front', 'top', 'right', 'iso']) $('v3' + k).onclick = () => setView(k);
$('v3persp').onclick = () => { cam.persp = !cam.persp; $('v3persp').textContent = cam.persp ? 'Perspektive' : 'Parallelprojektion'; refresh(); };
$('m3box').onclick = addBox;
$('m3copy').onclick = copyPart;
$('m3move').onclick = () => startTool3('move');
$('m3del').onclick = deletePart;
$('m3hole').onclick = () => startTool3('hole');
$('m3cut').onclick = () => startTool3('cut');
$('m3sub').onclick = () => startTool3('bool', 'sub');
$('m3add').onclick = () => startTool3('bool', 'add');
$('m3int').onclick = () => startTool3('bool', 'int');
$('m3section').onclick = toggleSection;
$('m3collide').onclick = checkCollisions;
$('m3bom').onclick = showBom;
$('m3stl').onclick = exportSTL;
$('m3views').onclick = makeViews;
$('addParam').onclick = addParam;
$('bomCsv').onclick = bomCsv;
$('closeBom').onclick = () => { $('bom').hidden = true; };
$('del').onclick = () => (mode3d ? deletePart() : delSel());
$('new').onclick = () => (mode3d ? clearModel() : clearDrawing());
function bumpIds() {                         // neue 2D-Nummern nie mit Nummern kollidieren lassen, auf die 3D-Körper verweisen
  let m = 0;
  for (const p of model.parts) for (const f of p.features) { for (const id of f.src || []) m = Math.max(m, id); if (f.srcAxis) m = Math.max(m, f.srcAxis); }
  nextId = Math.max(nextId, m + 1);
}
