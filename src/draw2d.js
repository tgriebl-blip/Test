// ---------- Fang ----------
const SNAP_PRIO = { end: 0, ins: 0, int: 0.1, cen: 0.15, quad: 0.15, mid: 0.2 };
function findSnap(w, skip) {                 // Objektfang: End-, Mittel-, Zentrums-, Quadranten- und Schnittpunkte nahe am Zeiger
  const r = APERTURE / view.s, near = [];
  let best = null;
  const cand = (x, y, type) => {
    if (skip && Math.abs(x - skip.x) < 1e-7 && Math.abs(y - skip.y) < 1e-7) return;
    const prio = SNAP_PRIO[type] || 0, score = Math.hypot(x - w.x, y - w.y) + prio * r;
    if (score - prio * r <= r && (!best || score < best.score)) best = { x, y, type, score };
  };
  for (const e of shown()) {
    if (e.t === 'dim') continue;
    const parts = flat(e).filter(p => p.t !== 'dim' && isOn(p)), close = parts.filter(p => distTo(p, w) <= r);
    for (const p of snapPts(e)) if (close.length || p.type === 'cen' || p.type === 'ins') cand(p.x, p.y, p.type);   // Zentren auch ohne Nähe zur Kurve
    near.push(...close);
  }
  for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) for (const p of intersect(near[i], near[j])) cand(p.x, p.y, 'int');
  return best;
}
function curDir(base) {                      // Zeichenrichtung in Grad – abhängig von der Lage des Zeigers
  if (dirHold && dirHold.x === mouse.x && dirHold.y === mouse.y) return lastDir;   // mehrmals tippen ohne Maus: gleiche Richtung
  const w = !opt.ang && cur.snap ? cur : s2w(mouse.x, mouse.y);
  if (dist(base, w) * view.s < 1) return lastDir;
  let d = angleDeg(base, w);
  if (opt.ang) d = Math.round(d / opt.step) * opt.step;
  return d % 360;
}
function resolve() {                         // Zeigerposition -> Zeichenpunkt (Objektfang > Winkelfang > Rasterfang)
  const w = s2w(mouse.x, mouse.y), res = { x: w.x, y: w.y, snap: null };
  if (freePick()) return res;
  const base = rayBase();
  const placing = tool === 'dim' && pts.length === 2;
  const g = opt.grid && opt.gridStep > 0 ? opt.gridStep : 0;
  const s = opt.osnap && !placing ? findSnap(w, base) : null;
  if (s) { res.x = s.x; res.y = s.y; res.snap = s.type; }
  else if (base && opt.ang) {                // auf dem Winkelstrahl bleiben
    const deg = curDir(base), [dx, dy] = dirVec(deg), r = APERTURE / view.s;
    let t = Math.max(0, (w.x - base.x) * dx + (w.y - base.y) * dy), best = null;
    const cand = (tt, type, gx, gy) => {
      const d = Math.abs(tt - t), hard = type !== 'track';
      if (tt < 1e-7 || d > (hard ? r : r * 0.6)) return;
      if (!best || (hard === best.hard ? d < best.d : hard)) best = { t: tt, type, gx, gy, d, hard };
    };
    if (opt.osnap) for (const e of prims(shown())) {
      if (e.t === 'dim' || !isOn(e)) continue;
      for (const tt of rayHits(base.x, base.y, dx, dy, e)) cand(tt, 'int');               // Strahl kreuzt vorhandene Kurve
      const tp = e.t === 'line' ? [[e.x1, e.y1, 'end'], [e.x2, e.y2, 'end']]
        : e.t === 'arc' ? [[arcPt(e, e.a1).x, arcPt(e, e.a1).y, 'end'], [arcPt(e, e.a2).x, arcPt(e, e.a2).y, 'end'], [e.cx, e.cy, 'cen']] : [[e.cx, e.cy, 'cen']];
      for (const [px, py, type] of tp) {
        if (Math.abs((px - base.x) * dy - (py - base.y) * dx) < 1e-7) { cand((px - base.x) * dx + (py - base.y) * dy, type); continue; }
        if (Math.abs(dx) > 1e-9) cand((px - base.x) / dx, 'track', px, py);   // fluchtet senkrecht mit dem Punkt
        if (Math.abs(dy) > 1e-9) cand((py - base.y) / dy, 'track', px, py);   // fluchtet waagerecht mit dem Punkt
      }
    }
    if (best) { t = best.t; res.snap = best.type; res.gx = best.gx; res.gy = best.gy; }
    else if (g) t = deg % 90 !== 0 && deg % 45 === 0 ? Math.round(t * Math.SQRT1_2 / g) * g / Math.SQRT1_2 : Math.round(t / g) * g;
    res.x = base.x + t * dx; res.y = base.y + t * dy;
  }
  else if (g) { res.x = Math.round(w.x / g) * g; res.y = Math.round(w.y / g) * g; }
  return res;
}

// ---------- Eingabe von Werten ----------
function typedPoint(s) {                     // getippten Text in einen Punkt umrechnen (oder null)
  if (freePick()) return null;
  const ray = rayBase(), base = ray || pts[pts.length - 1];
  const w = s2w(mouse.x, mouse.y), placing = tool === 'dim' && pts.length === 2;
  const rel = s[0] === '@';
  if (rel) s = s.slice(1);
  if (s.includes(';')) {                     // x;y  bzw.  @dx;dy  bzw.  Breite;Höhe
    const [a, b, more] = s.split(';').map(num);
    if (isNaN(a) || isNaN(b) || more !== undefined || placing) return null;
    if ((tool === 'rect' || tool === 'ellipse') && base && !rel && !grip) {
      const f = tool === 'ellipse' ? 0.5 : 1;
      return { x: base.x + Math.abs(a) * f * (w.x < base.x ? -1 : 1), y: base.y + Math.abs(b) * f * (w.y < base.y ? -1 : 1) };
    }
    if (rel) return base ? { x: base.x + a, y: base.y + b } : null;
    return { x: a, y: b };
  }
  if (rel || !base) return null;
  if (s.includes('<')) {                     // Länge<Winkel
    const [l, a, more] = s.split('<').map(num);
    if (!ray || isNaN(l) || isNaN(a) || more !== undefined || !l) return null;
    const [dx, dy] = dirVec(a);
    return { x: base.x + l * dx, y: base.y + l * dy };
  }
  const l = num(s);
  if (isNaN(l) || !l) return null;
  if (grip) {
    const e = byId(grip.refs[0].id);
    if (grip.kind === 'dl') return e ? offsetPoint({ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }, e.mode, w, Math.abs(l)) : null;   // Maßlinie: Abstand
    if (grip.kind === 'cr' && e) {           // Radius direkt tippen
      const L = Math.hypot(w.x - e.cx, w.y - e.cy) || 1;
      return { x: e.cx + (w.x - e.cx) / L * Math.abs(l), y: e.cy + (w.y - e.cy) / L * Math.abs(l) };
    }
    if (grip.kind === 'ea' && e) {           // Halbachse einer Ellipse direkt tippen
      const a = rad(e.rot), k = grip.refs[0].k, ux = k === 'rx' ? Math.cos(a) : -Math.sin(a), uy = k === 'rx' ? Math.sin(a) : Math.cos(a);
      return { x: e.cx + ux * Math.abs(l), y: e.cy + uy * Math.abs(l) };
    }
  }
  if (ray) { const [dx, dy] = dirVec(curDir(base)); return { x: base.x + l * dx, y: base.y + l * dy }; }
  if (tool === 'rect') return { x: base.x + Math.abs(l) * (w.x < base.x ? -1 : 1), y: base.y + Math.abs(l) * (w.y < base.y ? -1 : 1) };
  if (tool === 'circle') {                   // Radius bzw. Durchmesser, Richtung zum Zeiger
    const r = opt.dia ? Math.abs(l) / 2 : Math.abs(l), L = Math.hypot(w.x - base.x, w.y - base.y);
    return L > 1e-9 ? { x: base.x + (w.x - base.x) / L * r, y: base.y + (w.y - base.y) / L * r } : { x: base.x + r, y: base.y };
  }
  if (placing) {                             // Abstand der Maßlinie
    const [a, b] = pts, mode = dimMode(a, b, w);
    return { mode, ...offsetPoint(a, b, mode, w, Math.abs(l)) };
  }
  return null;
}
function offsetPoint(a, b, mode, w, d) {     // Lage der Maßlinie im Abstand d von den Messpunkten, auf der Seite des Zeigers
  if (mode === 'h') return { x: w.x, y: w.y >= (a.y + b.y) / 2 ? Math.max(a.y, b.y) + d : Math.min(a.y, b.y) - d };
  if (mode === 'v') return { y: w.y, x: w.x >= (a.x + b.x) / 2 ? Math.max(a.x, b.x) + d : Math.min(a.x, b.x) - d };
  const L = dist(a, b), nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L, side = (w.x - a.x) * nx + (w.y - a.y) * ny < 0 ? -1 : 1;
  return { x: a.x + nx * d * side, y: a.y + ny * d * side };
}
function target() {                          // der Punkt, der bei Klick/Enter gesetzt wird
  const s = cmd.value.trim();
  return (s && typedPoint(s)) || cur;
}
function applyTyped() {
  const s = cmd.value.trim();
  if (!s) return finish();
  if (tool === 'offset') {                   // Abstand für das Versetzen
    const d = num(s);
    if (!(d > 0)) return flash('Bitte einen Abstand größer 0 tippen.');
    offDist = d; cmd.value = '';
    if (first) doOffset();
    return refresh();
  }
  if (tool === 'fillet') {                   // Radius für das Abrunden
    const r = num(s);
    if (!(r >= 0)) return flash('Bitte einen Radius tippen, z. B. 10.');
    opt.radius = r; cmd.value = ''; save();
    return refresh();
  }
  if (tool === 'chamfer') {                  // Fase: d oder d1;d2
    const [a, b, more] = s.split(';').map(num), d2 = b === undefined ? a : b;
    if (!(a >= 0) || !(d2 >= 0) || more !== undefined) return flash('Bitte die Fase tippen, z. B. 10 oder 10;20.');
    opt.cham = [a, d2]; cmd.value = ''; save();
    return refresh();
  }
  const p = typedPoint(s);
  if (!p) return flash(tool === 'ellipse' && pts.length ? 'Breite;Höhe tippen, z. B. 600;400.' : 'Eingabe „' + s + '“ passt hier nicht.');
  cmd.value = '';
  pick(p, p.mode);
  dirHold = { x: mouse.x, y: mouse.y };
  refresh();
}

// ---------- Zeichnen (Befehle) ----------
function addEnt(e) {                         // neues Element; ein ausgeblendeter Ziel-Layer wird wieder eingeblendet
  const l = layerById(e.l);
  if (l && !l.on) { l.on = true; flash('Layer „' + l.name + '“ war ausgeblendet und wird wieder angezeigt.'); }
  const c = { ...e, id: nextId++ };
  ents.push(c);
  return c;
}
const addLine = (a, b) => addEnt({ t: 'line', l: curLayer, x1: a.x, y1: a.y, x2: b.x, y2: b.y });

function dimMode(a, b, p) {                  // Art des Maßes je nach Lage des Zeigers
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  if (y1 - y0 < 1e-7) return 'h';            // waagerechte Strecke: bleibt beim späteren Ändern ein waagerechtes Maß
  if (x1 - x0 < 1e-7) return 'v';
  const inX = p.x >= x0 && p.x <= x1, inY = p.y >= y0 && p.y <= y1;
  return inX && !inY ? 'h' : inY && !inX ? 'v' : 'a';
}
function dimEnt(p, mode) {
  const [a, b] = pts;
  return { t: 'dim', l: dimLayer().id, x1: a.x, y1: a.y, x2: b.x, y2: b.y, px: p.x, py: p.y, mode: mode || dimMode(a, b, p) };
}
function insOpts() {                         // Drehung und Maßstab für einzufügende Blöcke
  const s = Math.abs(num($('bkScale').value)) || 1, rot = num($('bkRot').value) || 0;
  return { s: Math.max(0.0001, s), rot: n360(rot) };
}
function pick(p, mode) {                     // einen Punkt an den aktiven Befehl übergeben
  p = { x: R(p.x), y: R(p.y) };
  if (grip) return applyGrip(p);
  if (tool === 'line') {
    const a = chain[chain.length - 1];
    if (!a) { chain = [p]; return; }
    if (same(a, p)) return;
    change(() => addLine(a, p));
    lastDir = angleDeg(a, p);
    if (chain.length > 2 && same(p, chain[0])) chain = [];   // geschlossen -> Linienzug beenden
    else chain.push(p);
  } else if (tool === 'rect') {
    const a = pts[0];
    if (!a) { pts = [p]; return; }
    if (Math.abs(a.x - p.x) < 1e-7 || Math.abs(a.y - p.y) < 1e-7) return;
    const b = { x: p.x, y: a.y }, d = { x: a.x, y: p.y };
    change(() => { addLine(a, b); addLine(b, p); addLine(p, d); addLine(d, a); });
    pts = [];
  } else if (tool === 'circle') {
    const a = pts[0];
    if (!a) { pts = [p]; return; }
    const r = Math.hypot(p.x - a.x, p.y - a.y);
    if (r < 1e-7) return;
    change(() => addEnt({ t: 'circle', l: curLayer, cx: a.x, cy: a.y, r: R(r) }));
    pts = [];
  } else if (tool === 'ellipse') {
    const a = pts[0];
    if (!a) { pts = [p]; return; }
    const rx = Math.abs(p.x - a.x), ry = Math.abs(p.y - a.y);
    if (rx < 1e-7 || ry < 1e-7) return flash('Breite und Höhe der Ellipse müssen größer als 0 sein.');
    change(() => addEnt({ t: 'ellipse', l: curLayer, cx: a.x, cy: a.y, rx: R(rx), ry: R(ry), rot: 0 }));
    pts = [];
  } else if (tool === 'dim') {
    if (pts.length < 2) { if (!pts.length || !same(pts[0], p)) pts.push(p); return; }
    const e = dimEnt(p, mode);
    change(() => addEnt(e));
    pts = [];
  } else if (moving()) {
    const a = pts[0];
    if (!a) { pts = [p]; return; }                           // Ausgangspunkt
    if (same(a, p)) return;
    const { dx, dy } = moveDelta(p);
    lastDir = angleDeg(a, p);
    if (tool === 'copy') {
      const src = ents.filter(e => sel.has(e.id)), made = [];
      commitLive();
      copyHist.push({ ids: [...sel], base: a, depth: undoStack.length });
      change(() => { for (const e of src) { const c = shiftEnt({ ...e, id: nextId++ }, dx, dy); ents.push(c); made.push(c.id); } });
      sel.clear(); for (const id of made) sel.add(id);
      pts = [{ x: R(a.x + dx), y: R(a.y + dy) }];              // die nächste Kopie setzt an dieser an
    } else { change(() => { for (const e of ents) if (sel.has(e.id)) shiftEnt(e, dx, dy); }); setTool('select'); }
  } else if (tool === 'mirror') {
    const a = pts[0];
    if (!a) { pts = [p]; return; }                           // erster Punkt der Spiegelachse
    if (same(a, p)) return;
    const X = mirrorX(a, p), made = [];
    lastDir = angleDeg(a, p);
    change(() => {
      for (const e of ents.filter(e => sel.has(e.id))) {
        const c = roundEnt(xformEnt(e, X));
        if (opt.mirKeep) { c.id = nextId++; ents.push(c); made.push(c.id); }
        else { ents[ents.indexOf(e)] = c; made.push(c.id); }
      }
    });
    sel.clear(); for (const id of made) sel.add(id);
    setTool('select');
  } else if (tool === 'stretch') {
    const a = pts[0];
    if (!win) return;
    if (!a) { pts = [p]; return; }
    if (same(a, p)) return;
    const dx = p.x - a.x, dy = p.y - a.y;
    lastDir = angleDeg(a, p);
    change(() => { ents = ents.map(e => isOn(e) ? roundEnt(stretchEnt(e, win, dx, dy)) : e); });
    win = null; pts = []; sel.clear();
  } else if (tool === 'insert') {
    if (!blocks[insName]) return flash('Diesen Block gibt es nicht mehr.');
    const o = insOpts();
    change(() => addEnt({ t: 'insert', l: curLayer, name: insName, x: p.x, y: p.y, s: o.s, rot: o.rot, fx: false }));
  } else if (tool === 'blockbase') makeBlock(p);
}
function selExtent(ux, uy) {                 // Ausdehnung der Auswahl in Richtung (ux, uy); Maße zählen nur ohne andere Elemente
  const list = shown().filter(e => sel.has(e.id)), geo = list.filter(e => e.t !== 'dim'), use = geo.length ? geo : list, u = dimU(view);
  let lo = Infinity, hi = -Infinity;
  for (const e of use) for (const p of ptsOf(e, u)) { const q = p.x * ux + p.y * uy; lo = Math.min(lo, q); hi = Math.max(hi, q); }
  return use.length ? hi - lo : 0;
}
function moveDelta(T) {                      // Verschiebung zum Zielpunkt T; Kopieren mit „Abstand dazwischen“: Maß = Luft zwischen Original und Kopie
  const a = pts[0], dx = T.x - a.x, dy = T.y - a.y, L = Math.hypot(dx, dy);
  if (L < 1e-9) return { dx: 0, dy: 0, L: 0, gap: null };
  const ux = dx / L, uy = dy / L, ext = tool === 'copy' ? selExtent(ux, uy) : 0;
  if (tool === 'copy' && opt.gap) return { dx: dx + ext * ux, dy: dy + ext * uy, L: L + ext, gap: L };
  return { dx, dy, L, gap: ext > 1e-9 && L - ext >= -1e-9 ? L - ext : null };
}
function stretchEnt(e, W, dx, dy) {          // Strecken: Punkte im Fenster wandern, Kurven und Blöcke nur als Ganzes
  const inW = (x, y) => x >= W.x0 && x <= W.x1 && y >= W.y0 && y <= W.y1, c = { ...e };
  switch (e.t) {
    case 'line':
      if (inW(e.x1, e.y1)) { c.x1 += dx; c.y1 += dy; }
      if (inW(e.x2, e.y2)) { c.x2 += dx; c.y2 += dy; }
      break;
    case 'dim': {
      const a = inW(e.x1, e.y1), b = inW(e.x2, e.y2);
      if (a) { c.x1 += dx; c.y1 += dy; }
      if (b) { c.x2 += dx; c.y2 += dy; }
      if ((a && b) || inW(e.px, e.py)) { c.px += dx; c.py += dy; }
      break;
    }
    case 'arc': { const p = arcPt(e, e.a1), q = arcPt(e, e.a2); if (inW(p.x, p.y) && inW(q.x, q.y)) shiftEnt(c, dx, dy); break; }
    case 'insert': if (inW(e.x, e.y)) shiftEnt(c, dx, dy); break;
    default: if (inW(e.cx, e.cy)) shiftEnt(c, dx, dy);
  }
  return c;
}
const stretchTouches = (e, W) => JSON.stringify(stretchEnt(e, W, 1, 1)) !== JSON.stringify(e);
function makeBlock(p) {                      // Auswahl zum Block zusammenfassen und durch eine Einfügung ersetzen
  const src = ents.filter(e => sel.has(e.id));
  if (!src.length) { setTool('select'); return flash('Die Auswahl ist leer.'); }
  if (src.some(e => e.t === 'insert' && usesBlock(e.name, blockName))) return flash('Ein Block darf sich nicht selbst enthalten.');
  const defs = src.map(e => { const c = roundEnt(shiftEnt({ ...e }, -p.x, -p.y)); delete c.id; return c; }), existed = !!blocks[blockName];
  let made = null;
  change(() => {
    blocks[blockName] = { ents: defs };
    ents = ents.filter(e => !sel.has(e.id));
    made = addEnt({ t: 'insert', l: curLayer, name: blockName, x: p.x, y: p.y, s: 1, rot: 0, fx: false });
  });
  sel.clear(); sel.add(made.id);
  setTool('select');
  flash('Block „' + blockName + '“ ' + (existed ? 'neu definiert – alle Einfügungen sind aktualisiert.' : 'gebildet. Einfügen über „Einfügen…“.'));
}
function explodeSel() {                      // ausgewählte Blöcke in ihre Teile auflösen
  const ins = ents.filter(e => sel.has(e.id) && e.t === 'insert');
  if (!ins.length) return flash('Erst einen eingefügten Block auswählen.');
  const made = [];
  change(() => {
    for (const e of ins) {
      const b = blocks[e.name];
      if (!b) continue;
      const X = insertX(e), parts = b.ents.map(be => { const c = roundEnt(xformEnt(be, X)); c.id = nextId++; made.push(c.id); return c; });
      ents.splice(ents.indexOf(e), 1, ...parts);
    }
  });
  setTool('select');
  for (const id of made) sel.add(id);
  flash(ins.length + (ins.length === 1 ? ' Block' : ' Blöcke') + ' aufgelöst.');
  refresh();
}

// ---------- Griffe ----------
function gripsOf(e) {                        // [Art, x, y]: Linienenden, Messpunkte/Maßlinie, Zentrum, Radius, Bogenenden, Achsen
  switch (e.t) {
    case 'line': return [['p1', e.x1, e.y1], ['p2', e.x2, e.y2]];
    case 'dim': { const g = dimGeom(e, dimU(view)); return [['p1', e.x1, e.y1], ['p2', e.x2, e.y2], ['dl', (g.p1[0] + g.p2[0]) / 2, (g.p1[1] + g.p2[1]) / 2]]; }
    case 'circle': return [['c', e.cx, e.cy], ...[0, 90, 180, 270].map(a => { const p = arcPt(e, a); return ['r', p.x, p.y]; })];
    case 'arc': { const p = arcPt(e, e.a1), q = arcPt(e, e.a2), m = arcPt(e, e.a1 + sweepOf(e) / 2); return [['c', e.cx, e.cy], ['a1', p.x, p.y], ['a2', q.x, q.y], ['r', m.x, m.y]]; }
    case 'ellipse': { const p = ellPt(e, 0), q = ellPt(e, Math.PI / 2); return [['c', e.cx, e.cy], ['rx', p.x, p.y], ['ry', q.x, q.y]]; }
    case 'insert': return [['c', e.x, e.y]];
  }
  return [];
}
const GRIP_KIND = { dl: 'dl', c: 'cc', r: 'cr', a1: 'ca', a2: 'ca', rx: 'ea', ry: 'ea' };
function gripAt(sx, sy, rad) {               // Griff eines ausgewählten Elements unter dem Zeiger
  if (tool !== 'select' || !sel.size || sel.size > 400) return null;
  const list = shown().filter(e => sel.has(e.id));
  let best = null, bd = rad;
  for (const e of list) for (const [k, x, y] of gripsOf(e)) {
    const [gx, gy] = w2s(x, y), d = Math.hypot(gx - sx, gy - sy);
    if (d <= bd) { bd = d; best = { e, k, x, y }; }
  }
  if (!best) return null;
  const from = { x: best.x, y: best.y }, refs = [];
  if (best.k !== 'p1' && best.k !== 'p2') refs.push({ id: best.e.id, k: best.k });
  else for (const e of list) for (const [k, x, y] of gripsOf(e)) if ((k === 'p1' || k === 'p2') && same({ x, y }, from)) refs.push({ id: e.id, k });   // aufeinanderliegende Enden wandern gemeinsam
  const kind = GRIP_KIND[best.k] || (refs.some(r => byId(r.id).t === 'line') ? 'lp' : 'dp');
  return { refs, from, kind };
}
function startGrip(g) { grip = { ...g, held: true, sx: mouse.x, sy: mouse.y }; cmd.value = ''; }
function withGrip(e, k, q) {
  const c = { ...e };
  if (c.t === 'dim' && c.mode === 'a' && k !== 'dl') {       // waagerecht/senkrecht liegendes Maß bleibt waagerecht/senkrecht
    if (Math.abs(e.y1 - e.y2) < 1e-7) c.mode = 'h'; else if (Math.abs(e.x1 - e.x2) < 1e-7) c.mode = 'v';
  }
  switch (k) {
    case 'p1': c.x1 = q.x; c.y1 = q.y; break;
    case 'p2': c.x2 = q.x; c.y2 = q.y; break;
    case 'dl': c.px = q.x; c.py = q.y; break;
    case 'c': if (e.t === 'insert') { c.x = q.x; c.y = q.y; } else { c.cx = q.x; c.cy = q.y; } break;
    case 'r': c.r = R(Math.hypot(q.x - e.cx, q.y - e.cy)); break;
    case 'a1': c.a1 = R(angOf(e.cx, e.cy, q.x, q.y)); break;
    case 'a2': c.a2 = R(angOf(e.cx, e.cy, q.x, q.y)); break;
    case 'rx': c.rx = R(Math.hypot(q.x - e.cx, q.y - e.cy)); c.rot = R(angOf(e.cx, e.cy, q.x, q.y)); break;
    case 'ry': { const a = rad(e.rot); c.ry = R(Math.abs(-(q.x - e.cx) * Math.sin(a) + (q.y - e.cy) * Math.cos(a))); break; }
  }
  return c;
}
function gripResult(q) { return grip.refs.map(r => { const e = byId(r.id); return e && withGrip(e, r.k, q); }).filter(Boolean); }
function measured(e) {                       // Länge/Größe, die nicht 0 werden darf
  switch (e.t) {
    case 'dim': return e.mode === 'h' ? Math.abs(e.x2 - e.x1) : e.mode === 'v' ? Math.abs(e.y2 - e.y1) : Math.hypot(e.x2 - e.x1, e.y2 - e.y1);
    case 'line': return Math.hypot(e.x2 - e.x1, e.y2 - e.y1);
    case 'circle': return e.r;
    case 'arc': return n360(e.a2 - e.a1) < 1e-7 ? 0 : e.r;
    case 'ellipse': return Math.min(e.rx, e.ry);
  }
  return 1;
}
function dimOffset(e) {                      // Abstand der Maßlinie von den Messpunkten
  if (e.mode === 'h') { const hi = Math.max(e.y1, e.y2), lo = Math.min(e.y1, e.y2); return e.py > hi ? e.py - hi : e.py < lo ? lo - e.py : 0; }
  if (e.mode === 'v') { const hi = Math.max(e.x1, e.x2), lo = Math.min(e.x1, e.x2); return e.px > hi ? e.px - hi : e.px < lo ? lo - e.px : 0; }
  const L = Math.hypot(e.x2 - e.x1, e.y2 - e.y1) || 1;
  return Math.abs(-(e.px - e.x1) * (e.y2 - e.y1) / L + (e.py - e.y1) * (e.x2 - e.x1) / L);
}
function applyGrip(q) {
  if (same(q, grip.from)) return;                            // gleiche Stelle: Griff bleibt aktiv
  const res = gripResult(q);
  if (res.some(e => measured(e) < 1e-7)) return flash('An dieser Stelle hätte das Element keine Länge bzw. Größe mehr.');
  change(() => { for (const c of res) ents[ents.findIndex(e => e.id === c.id)] = c; });
  grip = null;
}
function drawGrips() {
  if (tool !== 'select' || !sel.size || sel.size > 400) return;
  const hot = grip ? null : mouse.in && !drag && !gesture && gripAt(mouse.x, mouse.y, 7);
  for (const e of shown()) {
    if (!sel.has(e.id)) continue;
    for (const [k, x, y] of gripsOf(e)) {
      const [sx, sy] = w2s(x, y), on = (grip || hot) && (grip || hot).refs.some(r => r.id === e.id && r.k === k);
      ctx.fillStyle = on ? C.snap : C.prev;
      ctx.fillRect(Math.round(sx) - 4, Math.round(sy) - 4, 8, 8);
    }
  }
}

// ---------- Ändern: Versetzen, Stutzen, Dehnen, Ecke, Fase, Abrunden ----------
function offsetEnt() {                       // Parallele bzw. konzentrische Kopie auf der Seite des Zeigers (oder null)
  const e = first && byId(first.id), typed = num(cmd.value), d = typed > 0 ? typed : offDist;
  if (!e || !(d > 0)) return null;
  const w = s2w(mouse.x, mouse.y);
  if (e.t === 'circle' || e.t === 'arc') {
    const r = Math.hypot(w.x - e.cx, w.y - e.cy) < e.r ? e.r - d : e.r + d;
    if (r <= 1e-7) return null;
    const { id, ...rest } = e;
    return { d, ent: { ...rest, r: R(r) } };
  }
  const L = Math.hypot(e.x2 - e.x1, e.y2 - e.y1), nx = -(e.y2 - e.y1) / L, ny = (e.x2 - e.x1) / L;
  const s = (w.x - e.x1) * nx + (w.y - e.y1) * ny < 0 ? -d : d;
  return { d, ent: { t: 'line', l: e.l, x1: R(e.x1 + nx * s), y1: R(e.y1 + ny * s), x2: R(e.x2 + nx * s), y2: R(e.y2 + ny * s) } };
}
function doOffset() {
  const o = offsetEnt();
  if (!o) return flash(num(cmd.value) > 0 || offDist ? 'Der Abstand ist größer als der Radius.' : 'Erst den Abstand in mm tippen und Enter drücken.');
  change(() => addEnt(o.ent));
  offDist = o.d; cmd.value = ''; first = null;
}
function cutsOf(e) {                         // Schnittpunkte von e mit allen anderen sichtbaren Elementen
  const out = [];
  for (const o of prims(shown())) if (o !== e && o.t !== 'dim' && isOn(o)) out.push(...intersect(e, o));
  return out;
}
function trimPart(e, w) {                    // Stück von e am Punkt w zwischen den nächsten Schnittpunkten: {rm, keep} oder null
  const cuts = cutsOf(e);
  if (e.t === 'line') {
    const dx = e.x2 - e.x1, dy = e.y2 - e.y1, L2 = dx * dx + dy * dy, eps = 1e-7 / Math.sqrt(L2);
    const t0 = ((w.x - e.x1) * dx + (w.y - e.y1) * dy) / L2;
    let lo = 0, hi = 1;
    for (const p of cuts) {
      const t = ((p.x - e.x1) * dx + (p.y - e.y1) * dy) / L2;
      if (t < eps || t > 1 - eps) continue;                  // Berührung am Linienende zählt nicht
      if (t < t0) lo = Math.max(lo, t); else hi = Math.min(hi, t);
    }
    if (!lo && hi === 1) return null;
    const P = t => ({ x: R(e.x1 + t * dx), y: R(e.y1 + t * dy) }), A = P(lo), B = P(hi), keep = [];
    if (lo) keep.push({ ...e, x2: A.x, y2: A.y });
    if (hi < 1) keep.push({ ...e, x1: B.x, y1: B.y });
    return { rm: { t: 'line', x1: A.x, y1: A.y, x2: B.x, y2: B.y }, keep };
  }
  const a0 = angOf(e.cx, e.cy, w.x, w.y), angs = cuts.map(p => angOf(e.cx, e.cy, p.x, p.y));
  if (e.t === 'arc') {
    const sw = sweepOf(e), s0 = n360(a0 - e.a1);
    let lo = 0, hi = sw;
    for (const a of angs) {
      const s = n360(a - e.a1);
      if (s < 1e-6 || s > sw - 1e-6) continue;
      if (s < s0) lo = Math.max(lo, s); else hi = Math.min(hi, s);
    }
    if (!lo && hi === sw) return null;
    const keep = [];
    if (lo) keep.push({ ...e, a2: R(n360(e.a1 + lo)) });
    if (hi < sw) keep.push({ ...e, a1: R(n360(e.a1 + hi)) });
    return { rm: { t: 'arc', cx: e.cx, cy: e.cy, r: e.r, a1: n360(e.a1 + lo), a2: n360(e.a1 + hi) }, keep };
  }
  const u = [...new Set(angs.map(a => Math.round(n360(a) * 1e6) / 1e6))].sort((x, y) => x - y);   // Kreis: braucht zwei Schnittpunkte
  if (u.length < 2) return null;
  let lo = u[u.length - 1], hi = u[0];
  for (let i = 0; i < u.length - 1; i++) if (a0 >= u[i] && a0 < u[i + 1]) { lo = u[i]; hi = u[i + 1]; }
  return { rm: { t: 'arc', cx: e.cx, cy: e.cy, r: e.r, a1: lo, a2: hi }, keep: [{ id: e.id, t: 'arc', l: e.l, cx: e.cx, cy: e.cy, r: e.r, a1: R(hi), a2: R(lo) }] };
}
function doTrim(e, w) {
  const r = trimPart(e, w);
  if (!r) return flash(e.t === 'circle' ? 'Ein Kreis braucht zwei Schnittpunkte zum Stutzen.' : 'Hier gibt es keinen Schnittpunkt – löschen geht mit Auswahl + Entf.');
  change(() => {
    const keep = r.keep.map((k, i) => ({ ...k, id: i ? nextId++ : e.id }));
    ents.splice(ents.indexOf(e), 1, ...keep);
  });
}
function extendInfo(e, w) {                  // Linie oder Bogen am nahen Ende bis zur nächsten Grenze verlängern
  const others = prims(shown()).filter(o => o !== e && o.t !== 'dim' && isOn(o));
  if (e.t === 'line') {
    const at2 = Math.hypot(w.x - e.x2, w.y - e.y2) <= Math.hypot(w.x - e.x1, w.y - e.y1);
    const p = at2 ? { x: e.x1, y: e.y1 } : { x: e.x2, y: e.y2 }, q = at2 ? { x: e.x2, y: e.y2 } : { x: e.x1, y: e.y1 };
    const L = dist(p, q), dx = (q.x - p.x) / L, dy = (q.y - p.y) / L;
    const t = Math.min(...others.flatMap(o => rayHits(p.x, p.y, dx, dy, o)).filter(t => t > L + 1e-6));
    if (!isFinite(t)) return null;
    const n = { x: R(p.x + t * dx), y: R(p.y + t * dy) };
    return { ent: at2 ? { ...e, x2: n.x, y2: n.y } : { ...e, x1: n.x, y1: n.y }, add: { t: 'line', x1: q.x, y1: q.y, x2: n.x, y2: n.y } };
  }
  if (e.t === 'arc') {
    const p1 = arcPt(e, e.a1), p2 = arcPt(e, e.a2), at2 = Math.hypot(w.x - p2.x, w.y - p2.y) <= Math.hypot(w.x - p1.x, w.y - p1.y);
    const full = { t: 'circle', cx: e.cx, cy: e.cy, r: e.r }, room = 360 - sweepOf(e);
    let best = Infinity;
    for (const o of others) for (const p of intersect(full, o)) {
      const a = angOf(e.cx, e.cy, p.x, p.y), d = at2 ? n360(a - e.a2) : n360(e.a1 - a);
      if (d > 1e-6 && d < room - 1e-6 && d < best) best = d;
    }
    if (!isFinite(best)) return null;
    return at2 ? { ent: { ...e, a2: R(n360(e.a2 + best)) }, add: { t: 'arc', cx: e.cx, cy: e.cy, r: e.r, a1: e.a2, a2: n360(e.a2 + best) } }
      : { ent: { ...e, a1: R(n360(e.a1 - best)) }, add: { t: 'arc', cx: e.cx, cy: e.cy, r: e.r, a1: n360(e.a1 - best), a2: e.a1 } };
  }
  return null;
}
function doExtend(e, w) {
  const r = extendInfo(e, w);
  if (!r) return flash('In dieser Richtung gibt es keine Grenze, an der die Linie enden könnte.');
  change(() => { ents[ents.indexOf(e)] = r.ent; });
}
function cornerGeo(a, pa, b, pb) {           // Ecke zweier Linien: Schnittpunkt und Richtungen zu den angeklickten (bleibenden) Teilen
  const ax = a.x2 - a.x1, ay = a.y2 - a.y1, bx = b.x2 - b.x1, by = b.y2 - b.y1, den = ax * by - ay * bx;
  if (Math.abs(den) <= 1e-10 * Math.hypot(ax, ay) * Math.hypot(bx, by)) return null;      // parallel
  const t = ((b.x1 - a.x1) * by - (b.y1 - a.y1) * bx) / den, u = ((b.x1 - a.x1) * ay - (b.y1 - a.y1) * ax) / den;
  const I = { x: a.x1 + t * ax, y: a.y1 + t * ay };
  const side = (e, tt, p) => {               // tt = Lage des Schnittpunkts auf e; der angeklickte Teil bleibt
    const dx = e.x2 - e.x1, dy = e.y2 - e.y1, tc = ((p.x - e.x1) * dx + (p.y - e.y1) * dy) / (dx * dx + dy * dy);
    const repl = tt <= 1e-9 || (tt < 1 - 1e-9 && tc >= tt) ? 1 : 2;
    const K = repl === 1 ? { x: e.x2, y: e.y2 } : { x: e.x1, y: e.y1 }, L = dist(I, K);
    return { repl, L, d: L > 1e-12 ? { x: (K.x - I.x) / L, y: (K.y - I.y) / L } : null };
  };
  return { I, A: side(a, t, pa), B: side(b, u, pb) };
}
const setEnd = (e, which, p) => which === 1 ? { ...e, x1: R(p.x), y1: R(p.y) } : { ...e, x2: R(p.x), y2: R(p.y) };
function filletResult(a, pa, b, pb, r) {     // Abrunden mit Radius r (r = 0: saubere Ecke)
  const g = cornerGeo(a, pa, b, pb);
  if (!g) return { err: 'Parallele Linien haben keine gemeinsame Ecke.' };
  const A = g.A, B = g.B;
  if (r < 1e-9) return { a: setEnd(a, A.repl, g.I), b: setEnd(b, B.repl, g.I) };
  if (!A.d || !B.d) return { err: 'Bitte jeweils auf den Teil der Linie klicken, der bleiben soll.' };
  const phi = Math.acos(Math.max(-1, Math.min(1, A.d.x * B.d.x + A.d.y * B.d.y)));
  if (phi < 1e-6 || phi > Math.PI - 1e-6) return { err: 'Diese Linien lassen sich nicht abrunden.' };
  const tl = r / Math.tan(phi / 2);
  if (tl > A.L + 1e-7 || tl > B.L + 1e-7) return { err: 'Der Radius ist zu groß für diese Linien.' };
  const TA = { x: g.I.x + A.d.x * tl, y: g.I.y + A.d.y * tl }, TB = { x: g.I.x + B.d.x * tl, y: g.I.y + B.d.y * tl };
  const bx = A.d.x + B.d.x, by = A.d.y + B.d.y, bl = Math.hypot(bx, by), dc = r / Math.sin(phi / 2);
  const Cc = { x: g.I.x + bx / bl * dc, y: g.I.y + by / bl * dc };
  let a1 = angOf(Cc.x, Cc.y, TA.x, TA.y), a2 = angOf(Cc.x, Cc.y, TB.x, TB.y);
  if (n360(a2 - a1) > 180) [a1, a2] = [a2, a1];
  return { a: tl < A.L - 1e-7 ? setEnd(a, A.repl, TA) : null, b: tl < B.L - 1e-7 ? setEnd(b, B.repl, TB) : null,
           add: { t: 'arc', l: a.l, cx: R(Cc.x), cy: R(Cc.y), r: R(r), a1: R(a1), a2: R(a2) } };
}
function chamferResult(a, pa, b, pb, d1, d2) {   // Fase: d1 auf der ersten, d2 auf der zweiten Linie
  const g = cornerGeo(a, pa, b, pb);
  if (!g) return { err: 'Parallele Linien haben keine gemeinsame Ecke.' };
  const A = g.A, B = g.B;
  if (d1 < 1e-9 && d2 < 1e-9) return { a: setEnd(a, A.repl, g.I), b: setEnd(b, B.repl, g.I) };
  if (!A.d || !B.d) return { err: 'Bitte jeweils auf den Teil der Linie klicken, der bleiben soll.' };
  if (d1 > A.L + 1e-7 || d2 > B.L + 1e-7) return { err: 'Die Fase ist zu groß für diese Linien.' };
  const PA = { x: R(g.I.x + A.d.x * d1), y: R(g.I.y + A.d.y * d1) }, PB = { x: R(g.I.x + B.d.x * d2), y: R(g.I.y + B.d.y * d2) };
  return { a: d1 < A.L - 1e-7 ? setEnd(a, A.repl, PA) : null, b: d2 < B.L - 1e-7 ? setEnd(b, B.repl, PB) : null,
           add: same(PA, PB) ? null : { t: 'line', l: a.l, x1: PA.x, y1: PA.y, x2: PB.x, y2: PB.y } };
}
function roundRes(a, pa, b, pb) {            // Ergebnis von Ecke, Fase oder Abrunden
  if (tool === 'chamfer') return chamferResult(a, pa, b, pb, opt.cham[0], opt.cham[1]);
  return filletResult(a, pa, b, pb, tool === 'fillet' ? opt.radius : 0);
}
function doRound(b, pb) {
  const a = byId(first.id), r = a && roundRes(a, first, b, pb);
  first = null;
  if (!r) return;
  if (r.err) return flash(r.err);
  change(() => {
    ents[ents.indexOf(a)] = r.a; ents[ents.indexOf(b)] = r.b;
    ents = ents.filter(Boolean);
    if (r.add) addEnt(r.add);
  });
}

function click() {
  cur = resolve();
  const w = s2w(mouse.x, mouse.y);
  if (tool === 'trim') { const e = hit(mouse.x, mouse.y, trimable); if (e) doTrim(e, w); return; }
  if (tool === 'extend') { const e = hit(mouse.x, mouse.y, e => e.t === 'line' || e.t === 'arc'); if (e) doExtend(e, w); return; }
  if (tool === 'offset' && first) return doOffset();
  if (['offset', 'corner', 'chamfer', 'fillet'].includes(tool)) {
    const e = hit(mouse.x, mouse.y, tool === 'offset' ? e => e.t === 'line' || e.t === 'circle' || e.t === 'arc' : isLine, first && first.id);
    if (!e) return;
    if (!first) { if (tool === 'offset' && e.t === 'ellipse') return; first = { id: e.id, x: w.x, y: w.y }; }
    else doRound(e, w);
    return;
  }
  if (tool === 'dim' && !pts.length && !cur.snap) {          // Linie direkt anklicken = beide Endpunkte
    const e = hit(mouse.x, mouse.y, isLine);
    if (e) { pts = [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }]; return; }
  }
  const p = target();
  cmd.value = '';
  pick(p, p.mode);
}
const endsCommand = () => moving() || tool === 'mirror' || tool === 'insert' || tool === 'blockbase';
function finish() {                          // Enter / Rechtsklick
  if (grip) grip = null;
  else if (selecting) { if (sel.size) selecting = false; else flash('Erst Elemente anklicken oder ein Fenster aufziehen.'); }
  else if (endsCommand()) return setTool('select');
  else { chain = []; pts = []; first = null; if (tool === 'stretch') { win = null; sel.clear(); } }
  refresh();
}
function escape() {
  if (cmd.value) cmd.value = '';
  else if (grip) grip = null;
  else if (endsCommand()) return setTool('select');
  else if (tool === 'stretch' && (win || pts.length)) { win = null; pts = []; sel.clear(); }
  else if (chain.length || pts.length || first) { chain = []; pts = []; first = null; }
  else if (sel.size) sel.clear();
  else if (!$('dlg').hidden) closeDialog(null);
  else if (openPanel()) openPanel().hidden = true;
  else return setTool('select');
  refresh();
}
const openPanel = () => ['layers', 'help', 'sheet', 'blocks'].map($).find(p => !p.hidden);
function setTool(t) {
  const one = t === 'offset' && sel.size === 1 && ents.find(e => sel.has(e.id) && (e.t === 'line' || e.t === 'circle' || e.t === 'arc'));   // vorgewählte Linie übernehmen
  tool = t; chain = []; pts = []; cmd.value = ''; grip = null; copyHist = []; dirHold = null; win = null;
  if (t !== 'select' && t !== 'blockbase' && !needsSel()) sel.clear();
  selecting = needsSel() && !sel.size;
  first = one ? { id: one.id } : null;
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  refresh();
}

// ---------- Auswahl ----------
function hit(sx, sy, only, skip) {           // Element unter dem Zeiger (only: Prüffunktion)
  const w = s2w(sx, sy), k = 1 / view.s, u = dimU(view);
  let best = null, bd = Infinity;
  for (const e of shown()) {
    if ((only && !only(e)) || e.id === skip) continue;
    const d = distTo(e, w, u), tol = (6 + (e.t === 'dim' || e.t === 'insert' ? 0 : lay(e).width / 2)) * k;
    if (d <= tol && d <= bd) { bd = d; best = e; }
  }
  return best;
}
function endBox() {
  const { x0, y0, add } = drag, x1 = mouse.x, y1 = mouse.y;
  const a = s2w(Math.min(x0, x1), Math.max(y0, y1)), b = s2w(Math.max(x0, x1), Math.min(y0, y1)), small = Math.abs(x1 - x0) < 4 && Math.abs(y1 - y0) < 4;
  if (tool === 'stretch') {                  // Strecken: Fenster merken, betroffene Elemente hervorheben
    if (small) return flash('Ein Fenster über die Punkte ziehen, die wandern sollen.');
    win = { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
    sel.clear();
    for (const e of shown()) if (stretchTouches(e, win)) sel.add(e.id);
    if (!sel.size) { win = null; flash('Im Fenster liegt kein Punkt, der wandern könnte.'); }
    return;
  }
  if (!add) sel.clear();
  if (small) {                               // einfacher Klick
    const e = hit(x1, y1);
    if (e) { if (add && sel.has(e.id)) sel.delete(e.id); else sel.add(e.id); }
    return;
  }
  const inside = (x, y) => x >= a.x && x <= b.x && y >= a.y && y <= b.y, crossing = x1 < x0, u = dimU(view);
  const edges = [[a.x, a.y, b.x, a.y], [b.x, a.y, b.x, b.y], [b.x, b.y, a.x, b.y], [a.x, b.y, a.x, a.y]].map(([x1, y1, x2, y2]) => ({ x1, y1, x2, y2 }));
  for (const e of shown()) {
    const P = ptsOf(e, u), ins = P.map(p => inside(p.x, p.y));
    const segs = e.t === 'dim' ? [{ x1: P[0].x, y1: P[0].y, x2: P[1].x, y2: P[1].y }] : flat(e).flatMap(p => p.t === 'dim' ? [] : segsOf(p));
    if (crossing ? ins.some(Boolean) || segs.some(s => edges.some(ed => segInt(s, ed))) : ins.length && ins.every(Boolean)) sel.add(e.id);
  }
}

// ---------- Darstellung ----------
function dimGeom(e, k) {                     // Geometrie eines Maßes in mm; k = mm je Maßeinheit
  const ax = e.x1, ay = e.y1, bx = e.x2, by = e.y2;
  let p1, p2;                                // Enden der Maßlinie
  if (e.mode === 'h') { p1 = [ax, e.py]; p2 = [bx, e.py]; }
  else if (e.mode === 'v') { p1 = [e.px, ay]; p2 = [e.px, by]; }
  else {
    const L = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / L, ny = (bx - ax) / L;
    const off = (e.px - ax) * nx + (e.py - ay) * ny;
    p1 = [ax + nx * off, ay + ny * off]; p2 = [bx + nx * off, by + ny * off];
  }
  const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) || 1e-9;
  const ux = (p2[0] - p1[0]) / len, uy = (p2[1] - p1[1]) / len, lines = [], tris = [];
  for (const [q, p] of [[[ax, ay], p1], [[bx, by], p2]]) {   // Maßhilfslinien
    const l = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (l < 1e-9) continue;
    const ex = (p[0] - q[0]) / l, ey = (p[1] - q[1]) / l, g = Math.min(DIM.gap * k, l / 2);
    lines.push([q[0] + ex * g, q[1] + ey * g, p[0] + ex * DIM.over * k, p[1] + ey * DIM.over * k]);
  }
  const A = DIM.arrow * k, o = len < 3.5 * A ? -1 : 1;       // Pfeile außen, wenn es innen zu eng ist
  const t = o < 0 ? 2 * A : 0;
  lines.push([p1[0] - ux * t, p1[1] - uy * t, p2[0] + ux * t, p2[1] + uy * t]);   // Maßlinie
  for (const [p, d] of [[p1, o], [p2, -o]]) {
    const cx = p[0] + ux * A * d, cy = p[1] + uy * A * d, w = A * 0.17;
    tris.push([p, [cx - uy * w, cy + ux * w], [cx + uy * w, cy - ux * w]]);
  }
  let deg = Math.atan2(uy, ux) * 180 / Math.PI;              // Text immer lesbar (von unten bzw. von rechts)
  if (deg > 90 + 1e-6 || deg <= -90 + 1e-6) deg += 180;
  const ang = deg * Math.PI / 180;
  return { p1, p2, lines, tris, ang, deg: ((deg % 360) + 360) % 360, text: fmt(len),
           tx: (p1[0] + p2[0]) / 2 - Math.sin(ang) * DIM.textGap * k, ty: (p1[1] + p2[1]) / 2 + Math.cos(ang) * DIM.textGap * k };
}
function drawDim(c, v, e, color, u = dimU(v)) {
  const g = dimGeom(e, u);
  c.strokeStyle = c.fillStyle = color; c.lineWidth = Math.max(1, (v.pen || 0) * 0.18); c.setLineDash([]);
  c.beginPath();
  for (const [x1, y1, x2, y2] of g.lines) { c.moveTo(...w2s(x1, y1, v)); c.lineTo(...w2s(x2, y2, v)); }
  c.stroke();
  for (const t of g.tris) {
    c.beginPath();
    t.forEach(([x, y], i) => i ? c.lineTo(...w2s(x, y, v)) : c.moveTo(...w2s(x, y, v)));
    c.closePath(); c.fill();
  }
  c.save();
  c.translate(...w2s(g.tx, g.ty, v)); c.rotate(-g.ang);
  c.font = (DIM.text * u * v.s) + 'px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  c.fillText(g.text, 0, 0);
  c.restore();
}
function lineStyle(c, l, color, pen) {       // pen: Pixel je mm (Blatt) – sonst Bildschirm
  c.strokeStyle = color;
  if (pen) { c.lineWidth = (PEN[l.width] || 0.25) * pen; c.setLineDash(LTYPES[l.type].dash.map(d => d * 0.3 * pen * Math.max(1, l.width / 1.5))); }
  else { c.lineWidth = l.width; c.setLineDash(dashFor(l)); }
}
function pathEnt(c, v, e) {                  // Pfad einer Linie oder Kurve in Bildschirmkoordinaten
  const P = (x, y) => w2s(x, y, v);
  if (e.t === 'line') { c.moveTo(...P(e.x1, e.y1)); c.lineTo(...P(e.x2, e.y2)); return; }
  const [x, y] = P(e.cx, e.cy);
  if (e.t === 'circle') { c.moveTo(x + e.r * v.s, y); c.arc(x, y, e.r * v.s, 0, 2 * Math.PI); }
  else if (e.t === 'arc') { c.moveTo(...P(arcPt(e, e.a1).x, arcPt(e, e.a1).y)); c.arc(x, y, e.r * v.s, -rad(e.a1), -rad(e.a1 + sweepOf(e)), true); }
  else if (e.t === 'ellipse') { const p = ellPt(e, 0); c.moveTo(...P(p.x, p.y)); c.ellipse(x, y, e.rx * v.s, e.ry * v.s, -rad(e.rot), 0, 2 * Math.PI); }
}
function drawEnts(c, v, bg, fg, live, u = dimU(v)) {   // live = Bildschirm mit Auswahl; sonst Export (v.pen = Pixel je mm)
  const list = shown(), geo = [], dims = [];
  for (const e of list) for (const p of flat(e)) (p.t === 'dim' ? dims : geo).push([p, e]);
  c.lineCap = 'round'; c.lineJoin = 'round';
  if (live) {                                // Saum unter ausgewählten Elementen und dem Element unter dem Zeiger
    c.save(); c.setLineDash([]);
    for (const [p, e] of geo) {
      if (!(sel.has(e.id) || e.id === hoverId)) continue;
      const s = sel.has(e.id);
      c.strokeStyle = s ? C.sel : C.prev; c.globalAlpha = s ? 0.35 : 0.25; c.lineWidth = lay(p).width + 7;
      c.beginPath(); pathEnt(c, v, p); c.stroke();
    }
    c.restore();
  }
  for (const [p] of geo) {
    const l = lay(p);
    if (!l.on) continue;                     // Teil eines Blocks auf ausgeblendetem Layer
    lineStyle(c, l, ink(l.color, bg, fg), v.pen);
    c.beginPath(); pathEnt(c, v, p); c.stroke();
  }
  c.setLineDash([]);
  for (const [d, e] of dims) {
    if (!lay(d).on) continue;
    const col = live && sel.has(e.id) ? C.sel : live && e.id === hoverId ? C.prev : ink(lay(d).color, bg, fg);
    drawDim(c, v, d, col, u);
  }
}
function drawGrid(W, H) {
  const m = gridUnit(), a = s2w(0, H), b = s2w(W, 0);
  ctx.lineWidth = 1;
  for (const [step, col] of [[m, C.grid], [m * 10, C.grid2]]) {
    ctx.strokeStyle = col; ctx.beginPath();
    for (let i = Math.ceil(a.x / step); i * step <= b.x; i++) { const x = Math.round(view.ox + i * step * view.s) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let i = Math.ceil(a.y / step); i * step <= b.y; i++) { const y = Math.round(view.oy - i * step * view.s) + 0.5; ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
  }
  ctx.strokeStyle = C.axis; ctx.beginPath();                 // Achsen durch den Nullpunkt
  const x0 = Math.round(view.ox) + 0.5, y0 = Math.round(view.oy) + 0.5;
  ctx.moveTo(x0, 0); ctx.lineTo(x0, H); ctx.moveTo(0, y0); ctx.lineTo(W, y0);
  ctx.stroke();
}
function label(text) {                       // kleines Infofeld am Zeiger
  ctx.font = '12px system-ui, sans-serif';
  const w = ctx.measureText(text).width + 12, h = 20;
  const x = Math.round(Math.min(mouse.x + 16, cv.clientWidth - w - 4)), y = Math.round(Math.min(mouse.y + 18, cv.clientHeight - h - 4));
  ctx.setLineDash([]); ctx.globalAlpha = 0.9; ctx.fillStyle = C.bg; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1;
  ctx.strokeStyle = C.prev; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  ctx.fillStyle = C.prev; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 6, y + h / 2 + 1);
}
function strokeLine(e, color, width, dash) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash || []);
  ctx.beginPath(); ctx.moveTo(...w2s(e.x1, e.y1)); ctx.lineTo(...w2s(e.x2, e.y2)); ctx.stroke();
  ctx.setLineDash([]);
}
function outline(e, color, width, dash) {    // Element (auch Kurve oder Block) in einer Farbe hervorheben
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash || []);
  ctx.beginPath(); for (const p of flat(e)) if (p.t !== 'dim') pathEnt(ctx, view, p); ctx.stroke();
  ctx.setLineDash([]);
}
function ghost(e, alpha) {                   // Vorschau eines Elements in der Linienart seines Layers
  const u = dimU(view);
  ctx.save(); if (alpha) ctx.globalAlpha = alpha;
  for (const p of flat(e)) {
    const l = lay(p), col = ink(l.color, C.bg, C.line);
    if (p.t === 'dim') drawDim(ctx, view, p, col, u);
    else { lineStyle(ctx, l, col); ctx.beginPath(); pathEnt(ctx, view, p); ctx.stroke(); }
  }
  ctx.restore(); ctx.setLineDash([]);
}
function drawPreview() {
  const T = target(), [tx, ty] = w2s(T.x, T.y), w = s2w(mouse.x, mouse.y), L = curLayer;
  ctx.strokeStyle = C.prev; ctx.lineWidth = 1.5; ctx.setLineDash([]);
  const selected = () => shown().filter(e => sel.has(e.id));
  if (tool === 'line' && chain.length) {                     // Vorschau in der Linienart des aktuellen Layers
    const a = chain[chain.length - 1];
    ghost({ t: 'line', l: L, x1: a.x, y1: a.y, x2: T.x, y2: T.y });
    if (dist(a, T) > 1e-9) label(fmt(dist(a, T)) + ' mm   ' + fmt(angleDeg(a, T), 1) + '°');
  } else if (tool === 'rect' && pts.length) {
    const a = pts[0], c = [a, { x: T.x, y: a.y }, T, { x: a.x, y: T.y }];
    for (let i = 0; i < 4; i++) ghost({ t: 'line', l: L, x1: c[i].x, y1: c[i].y, x2: c[(i + 1) % 4].x, y2: c[(i + 1) % 4].y });
    label(fmt(Math.abs(T.x - a.x)) + ' × ' + fmt(Math.abs(T.y - a.y)) + ' mm');
  } else if (tool === 'circle' && pts.length) {
    const a = pts[0], r = dist(a, T);
    if (r > 1e-9) { ghost({ t: 'circle', l: L, cx: a.x, cy: a.y, r }); label('R ' + fmt(r) + ' mm   Ø ' + fmt(2 * r) + ' mm'); }
    strokeLine({ x1: a.x, y1: a.y, x2: T.x, y2: T.y }, C.prev, 1, [4, 4]);
  } else if (tool === 'ellipse' && pts.length) {
    const a = pts[0], rx = Math.abs(T.x - a.x), ry = Math.abs(T.y - a.y), [ax, ay] = w2s(a.x - rx, a.y + ry);
    ctx.setLineDash([4, 4]); ctx.lineWidth = 1; ctx.strokeRect(ax, ay, 2 * rx * view.s, 2 * ry * view.s); ctx.setLineDash([]);
    if (rx > 1e-9 && ry > 1e-9) { ghost({ t: 'ellipse', l: L, cx: a.x, cy: a.y, rx, ry, rot: 0 }); label(fmt(2 * rx) + ' × ' + fmt(2 * ry) + ' mm'); }
  } else if (tool === 'dim' && pts.length === 1) {
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(...w2s(pts[0].x, pts[0].y)); ctx.lineTo(tx, ty); ctx.stroke();
  } else if (tool === 'dim' && pts.length === 2) ghost(dimEnt(T, T.mode));
  else if (grip) {                                           // Griff: Ergebnis zeigen
    const res = gripResult(T), one = res.length === 1 ? res[0] : null;
    for (const c of res) ghost(c);
    strokeLine({ x1: grip.from.x, y1: grip.from.y, x2: T.x, y2: T.y }, C.prev, 1, [4, 4]);
    if (one && one.t === 'line') label('Länge ' + fmt(measured(one)) + ' mm   ' + fmt(angleDeg({ x: one.x1, y: one.y1 }, { x: one.x2, y: one.y2 }), 1) + '°');
    else if (one && grip.kind === 'dl') label('Abstand ' + fmt(dimOffset(one)) + ' mm');
    else if (one && one.t === 'dim') label('Maß ' + fmt(measured(one)) + ' mm');
    else if (one && (one.t === 'circle' || one.t === 'arc') && grip.kind === 'cr') label('R ' + fmt(one.r) + ' mm   Ø ' + fmt(2 * one.r) + ' mm');
    else if (one && one.t === 'ellipse' && grip.kind === 'ea') label(fmt(2 * one.rx) + ' × ' + fmt(2 * one.ry) + ' mm');
    else if (dist(grip.from, T) > 1e-9) label(fmt(dist(grip.from, T)) + ' mm   ' + fmt(angleDeg(grip.from, T), 1) + '°');
  }
  else if (moving() && pts.length) {                         // Auswahl an der neuen Stelle
    const a = pts[0], md = moveDelta(T);
    for (const e of selected()) ghost(shiftEnt({ ...e }, md.dx, md.dy), 0.7);
    strokeLine({ x1: a.x, y1: a.y, x2: T.x, y2: T.y }, C.prev, 1, [4, 4]);
    if (md.L > 1e-9) {
      const ang = fmt(angleDeg(a, T), 1) + '°', differs = md.gap != null && Math.abs(md.gap - md.L) > 1e-9;
      label(tool === 'copy' && opt.gap ? 'Abstand dazwischen ' + fmt(md.gap) + ' mm   ' + ang + (differs ? '   · Verschiebung ' + fmt(md.L) + ' mm' : '')
        : fmt(md.L) + ' mm   ' + ang + (differs ? '   · Abstand dazwischen ' + fmt(md.gap) + ' mm' : ''));
    }
  } else if (tool === 'mirror' && pts.length) {              // Spiegelachse und gespiegelte Auswahl
    const a = pts[0];
    if (!same(a, T)) {
      const X = mirrorX(a, T), d = dist(a, T), k = 1e5 / d;
      for (const e of selected()) ghost(xformEnt(e, X), 0.7);
      strokeLine({ x1: a.x - (T.x - a.x) * k, y1: a.y - (T.y - a.y) * k, x2: a.x + (T.x - a.x) * k, y2: a.y + (T.y - a.y) * k }, C.prev, 1, [8, 4, 2, 4]);
      label('Spiegelachse ' + fmt(angleDeg(a, T) % 180, 1) + '°');
    }
  } else if (tool === 'stretch' && win) {                    // Fenster und gestreckte Elemente
    const [ax, ay] = w2s(win.x0, win.y1), [bx, by] = w2s(win.x1, win.y0);
    ctx.setLineDash([5, 4]); ctx.lineWidth = 1; ctx.strokeStyle = C.prev; ctx.strokeRect(ax + 0.5, ay + 0.5, bx - ax, by - ay); ctx.setLineDash([]);
    if (pts.length) {
      const a = pts[0], dx = T.x - a.x, dy = T.y - a.y;
      for (const e of selected()) ghost(stretchEnt(e, win, dx, dy), 0.7);
      strokeLine({ x1: a.x, y1: a.y, x2: T.x, y2: T.y }, C.prev, 1, [4, 4]);
      if (dist(a, T) > 1e-9) label(fmt(dist(a, T)) + ' mm   ' + fmt(angleDeg(a, T), 1) + '°');
    }
  } else if (tool === 'insert' && blocks[insName]) {
    const o = insOpts();
    ghost({ t: 'insert', l: L, name: insName, x: T.x, y: T.y, s: o.s, rot: o.rot, fx: false }, 0.75);
  } else if (tool === 'trim') {                              // Teilstück, das entfernt würde
    const e = hit(mouse.x, mouse.y, trimable), r = e && trimPart(e, w);
    if (r) outline(r.rm, C.sel, 3, [6, 5]);
  } else if (tool === 'extend') {
    const e = hit(mouse.x, mouse.y, e => e.t === 'line' || e.t === 'arc'), r = e && extendInfo(e, w);
    if (r) outline(r.add, C.prev, 2, [6, 4]);
  } else if (['offset', 'corner', 'chamfer', 'fillet'].includes(tool)) {
    const f = first && byId(first.id), e = hit(mouse.x, mouse.y, tool === 'offset' ? e => e.t === 'line' || e.t === 'circle' || e.t === 'arc' : isLine, f && f.id);
    const o = tool === 'offset' && f && offsetEnt(), r = tool !== 'offset' && f && e && roundRes(f, first, e, w);
    if (r && !r.err) { for (const x of [r.a, r.b, r.add]) if (x) outline(x, C.prev, 2.5); }
    else if (f) outline(f, C.prev, 2.5);
    else if (e) outline(e, C.prev, 2.5);
    if (r && r.err) label(r.err);
    if (o) { ghost(o.ent); label('Abstand ' + fmt(o.d) + ' mm'); }
  }
  if (drag && drag.type === 'box') {                         // Auswahlfenster
    ctx.strokeStyle = C.prev; ctx.setLineDash(mouse.x < drag.x0 || tool === 'stretch' ? [5, 4] : []); ctx.lineWidth = 1;
    ctx.strokeRect(drag.x0 + 0.5, drag.y0 + 0.5, mouse.x - drag.x0, mouse.y - drag.y0);
    ctx.setLineDash([]);
  }
  if (freePick() || T !== cur) return;
  const m = 6;                               // Fangmarker
  ctx.setLineDash([]); ctx.lineWidth = 1.5; ctx.strokeStyle = cur.snap ? C.snap : C.prev;
  ctx.beginPath();
  if (cur.snap === 'end' || cur.snap === 'ins') ctx.rect(tx - m, ty - m, 2 * m, 2 * m);
  else if (cur.snap === 'mid') { ctx.moveTo(tx, ty - m); ctx.lineTo(tx + m, ty + m); ctx.lineTo(tx - m, ty + m); ctx.closePath(); }
  else if (cur.snap === 'cen') { ctx.moveTo(tx + m, ty); ctx.arc(tx, ty, m, 0, 2 * Math.PI); }
  else if (cur.snap === 'quad') { ctx.moveTo(tx, ty - m); ctx.lineTo(tx + m, ty); ctx.lineTo(tx, ty + m); ctx.lineTo(tx - m, ty); ctx.closePath(); }
  else if (cur.snap === 'int' || cur.snap === 'track') { ctx.moveTo(tx - m, ty - m); ctx.lineTo(tx + m, ty + m); ctx.moveTo(tx + m, ty - m); ctx.lineTo(tx - m, ty + m); }
  else { ctx.moveTo(tx - 5, ty); ctx.lineTo(tx + 5, ty); ctx.moveTo(tx, ty - 5); ctx.lineTo(tx, ty + 5); }
  ctx.stroke();
  if (cur.snap === 'track') {                                // Fluchtlinie zum Punkt
    ctx.setLineDash([2, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(...w2s(cur.gx, cur.gy)); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.setLineDash([]);
  }
}
function draw() {
  if (mode3d) return;
  const W = cv.clientWidth, H = cv.clientHeight, dpr = window.devicePixelRatio || 1;
  const h = mouse.in && boxMode() && !drag && !gesture && hit(mouse.x, mouse.y);
  hoverId = h ? h.id : 0;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  drawGrid(W, H);
  drawEnts(ctx, view, C.bg, C.line, true);
  drawGrips();
  drawPreview();
}
const NAMES = { line: 'Linie', circle: 'Kreis', arc: 'Bogen', ellipse: 'Ellipse', insert: 'Block', dim: 'Maß' };
function status() {
  let p;
  const cnt = sel.size + (sel.size === 1 ? ' Element' : ' Elemente');
  if (flashMsg) p = flashMsg;
  else if (mode3d) p = status3d();
  else if (grip) p = {
    dl: 'MASSLINIE VERSCHIEBEN: neue Lage anklicken oder Abstand zu den Messpunkten tippen + Enter',
    dp: 'MESSPUNKT VERSCHIEBEN: neuen Punkt anklicken oder Weg in mm tippen + Enter',
    cc: 'VERSCHIEBEN: neue Lage des Zentrums bzw. Einfügepunkts anklicken oder Weg tippen + Enter',
    cr: 'RADIUS ÄNDERN: neuen Punkt anklicken oder Radius tippen + Enter',
    ca: 'BOGENENDE VERSCHIEBEN: neue Lage anklicken',
    ea: 'HALBACHSE ÄNDERN: neuen Punkt anklicken oder Länge der Halbachse tippen + Enter',
  }[grip.kind] || 'ENDPUNKT VERSCHIEBEN: neue Lage anklicken oder Weg in mm tippen + Enter' + (grip.refs.length > 1 ? ' (' + grip.refs.length + ' Enden gemeinsam)' : '');
  else if (tool === 'select') {
    const one = sel.size === 1 && ents.find(e => sel.has(e.id));
    if (one && one.t === 'line') {
      const a = { x: one.x1, y: one.y1 }, b = { x: one.x2, y: one.y2 };
      p = 'Linie auf „' + lay(one).name + '“: Länge ' + fmt(dist(a, b)) + ' mm, Winkel ' + fmt(angleDeg(a, b), 1) + '° · Griffe an den Enden ziehen ändert · Entf löscht';
    } else if (one && one.t === 'dim') p = 'Maß ' + fmt(measured(one)) + ' mm: Griffe an den Messpunkten oder an der Maßlinie anklicken, um sie zu versetzen · Entf löscht';
    else if (one && (one.t === 'circle' || one.t === 'arc')) p = NAMES[one.t] + ' R ' + fmt(one.r) + ' mm (Ø ' + fmt(2 * one.r) + ')' + (one.t === 'arc' ? ', ' + fmt(sweepOf(one), 1) + '°' : '') + ' · Griffe ziehen ändert · Entf löscht';
    else if (one && one.t === 'ellipse') p = 'Ellipse ' + fmt(2 * one.rx) + ' × ' + fmt(2 * one.ry) + ' mm · Griffe ziehen ändert · Entf löscht';
    else if (one && one.t === 'insert') p = 'Block „' + one.name + '“ · Griff am Einfügepunkt verschiebt · „Auflösen“ macht ihn wieder zu einzelnen Elementen';
    else p = sel.size ? cnt + ' ausgewählt · Griffe ziehen ändert · oben anderen Layer wählen · M verschieben · K kopieren · Entf löscht'
      : 'AUSWAHL: Element anklicken oder Fenster aufziehen';
  }
  else if (moving() || tool === 'mirror') {
    const n = { move: 'VERSCHIEBEN: ', copy: 'KOPIEREN: ', mirror: 'SPIEGELN: ' }[tool];
    p = n + (selecting ? 'Elemente anklicken oder Fenster aufziehen, dann Enter oder Rechtsklick' + (sel.size ? ' (' + cnt + ' gewählt)' : '')
      : tool === 'mirror' ? (!pts.length ? 'ersten Punkt der Spiegelachse anklicken (' + cnt + ')' : 'zweiten Punkt der Spiegelachse anklicken · Esc beendet')
      : !pts.length ? 'Ausgangspunkt anklicken (' + cnt + ')'
      : tool === 'copy' && opt.gap ? 'Abstand zwischen Original und Kopie in mm tippen + Enter (Richtung = Lage des Zeigers) · Esc beendet'
      : 'Zielpunkt anklicken oder Maß in mm tippen + Enter (Richtung = Lage des Zeigers)' + (tool === 'copy' ? ' · Esc beendet' : ''));
  }
  else if (tool === 'stretch') p = !win ? 'STRECKEN: Fenster über die Punkte aufziehen, die wandern sollen'
    : !pts.length ? 'STRECKEN: Ausgangspunkt anklicken (' + cnt + ' betroffen)' : 'STRECKEN: Zielpunkt anklicken oder Weg in mm tippen + Enter';
  else if (tool === 'offset') p = !first ? 'VERSETZEN: Linie, Kreis oder Bogen anklicken'
    : offDist ? 'VERSETZEN: Seite anklicken (Abstand ' + fmt(offDist) + ' mm) oder neuen Abstand tippen + Enter'
    : 'VERSETZEN: Abstand in mm tippen + Enter – die Lage des Zeigers bestimmt die Seite';
  else if (tool === 'trim') p = 'STUTZEN: den Überstand anklicken, der entfernt werden soll (Linien, Bögen, Kreise)';
  else if (tool === 'extend') p = 'DEHNEN: Linie oder Bogen nahe dem Ende anklicken, das bis zur nächsten Kante verlängert werden soll';
  else if (tool === 'corner') p = first ? 'ECKE: zweite Linie anklicken' : 'ECKE: erste Linie anklicken – jeweils auf dem Teil, der bleiben soll';
  else if (tool === 'chamfer') p = 'FASE ' + fmt(opt.cham[0]) + (opt.cham[1] !== opt.cham[0] ? ' × ' + fmt(opt.cham[1]) : '') + ' mm: ' + (first ? 'zweite Linie anklicken' : 'erste Linie anklicken') + ' · andere Fase tippen, z. B. 10 oder 10;20';
  else if (tool === 'fillet') p = 'ABRUNDEN R ' + fmt(opt.radius) + ' mm: ' + (first ? 'zweite Linie anklicken' : 'erste Linie anklicken') + ' · anderen Radius tippen + Enter';
  else if (tool === 'line') p = 'LINIE auf ' + curName() + ': ' + (chain.length ? 'Länge in mm tippen + Enter (Richtung = Lage des Zeigers) oder nächsten Punkt anklicken · Esc beendet' : 'Startpunkt anklicken');
  else if (tool === 'rect') p = 'RECHTECK auf ' + curName() + ': ' + (pts.length ? 'Breite;Höhe tippen + Enter oder zweite Ecke anklicken' : 'erste Ecke anklicken');
  else if (tool === 'circle') p = 'KREIS auf ' + curName() + ': ' + (pts.length ? (opt.dia ? 'Durchmesser' : 'Radius') + ' tippen + Enter oder Punkt auf dem Kreis anklicken' : 'Mittelpunkt anklicken');
  else if (tool === 'ellipse') p = 'ELLIPSE auf ' + curName() + ': ' + (pts.length ? 'Breite;Höhe tippen + Enter (z. B. 600;400) oder Ecke anklicken' : 'Mittelpunkt anklicken');
  else if (tool === 'insert') p = 'BLOCK „' + insName + '“ EINFÜGEN: Einfügepunkt anklicken oder x;y tippen · Esc beendet';
  else if (tool === 'blockbase') p = 'BLOCK „' + blockName + '“: Basispunkt anklicken (' + cnt + ')';
  else p = ['BEMASSUNG: ersten Messpunkt oder direkt eine Linie anklicken', 'BEMASSUNG: zweiten Messpunkt anklicken', 'BEMASSUNG: Lage der Maßlinie anklicken (oder Abstand tippen + Enter)'][pts.length];
  $('prompt').textContent = p;
  $('coords').textContent = mode3d ? coords3d() : 'X ' + fmt(cur.x) + '   Y ' + fmt(cur.y) + '   ·   Gitter ' + fmt(gridUnit(), 3) + ' mm';
  $('mvMode').hidden = mode3d || !(tool === 'copy' && !selecting);
  $('circMode').hidden = mode3d || tool !== 'circle';
  $('mirMode').hidden = mode3d || !(tool === 'mirror' && !selecting);
  for (const [id, on] of [['mvShift', !opt.gap], ['mvGap', !!opt.gap], ['cmR', !opt.dia], ['cmD', !!opt.dia], ['mmKeep', !!opt.mirKeep], ['mmDel', !opt.mirKeep]]) {
    $(id).classList.toggle('on', on); $(id).setAttribute('aria-pressed', String(on));
  }
}
function refresh() {
  if (needsSel() && !sel.size && !selecting) { selecting = true; pts = []; }   // Auswahl ging verloren (z. B. Rückgängig)
  cur = mode3d ? cur : resolve();
  status();
  syncLayerUI();
  if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (mode3d) draw3d(); else draw(); });
}

// ---------- Ansicht ----------
function zoomAt(sx, sy, f) {
  const s = Math.min(5000, Math.max(0.002, view.s * f));
  view.ox = sx - (sx - view.ox) * s / view.s; view.oy = sy - (sy - view.oy) * s / view.s; view.s = s;
}
function extents(list, u = dimU(view)) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of list) {
    const b = bboxOf(e, u);
    x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]);
  }
  return isFinite(x0) ? { x0, y0, x1, y1 } : null;
}
function zoomFit() {
  if (mode3d) return fit3d();
  const b = extents(shown(), 0), W = cv.clientWidth, H = cv.clientHeight, m = 60;
  if (!b) view = { s: 3, ox: 80, oy: H - 80 };
  else {
    const s = Math.max(0.002, Math.min(50, (W - 2 * m) / Math.max(b.x1 - b.x0, 1e-6), (H - 2 * m) / Math.max(b.y1 - b.y0, 1e-6)));
    view = { s, ox: W / 2 - (b.x0 + b.x1) / 2 * s, oy: H / 2 + (b.y0 + b.y1) / 2 * s };
  }
  refresh();
}
