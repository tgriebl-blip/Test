// ---------- Start ----------
function readColors() {
  const cs = getComputedStyle(document.documentElement);
  for (const k of ['bg', 'grid', 'grid2', 'axis', 'line', 'sel', 'snap', 'prev']) C[k] = cs.getPropertyValue('--cv-' + k).trim();
  C.ui = cs.getPropertyValue('--ui-bg').trim();
  for (const k of ['bg', 'line', 'ui']) if (!/^#[0-9a-f]{6}$/i.test(C[k])) C[k] = k === 'line' ? '#14171a' : '#ffffff';
}
const onTheme = () => { readColors(); refresh(); };
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', onTheme);
new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
readColors();

try {                                        // letzte Zeichnung aus dem Browser-Speicher holen
  const d = JSON.parse(localStorage.getItem(KEY));
  if (d && typeof d === 'object') {
    layers = cleanLayers(d.layers) || defaultLayers();
    blocks = cleanBlocks(d.blocks, layers);
    setEnts(cleanEnts(d.ents, layers));
    if (d.model) model = cleanModel(d.model);
    applySheet(d.sheet);
    curLayer = layerById(d.curLayer) ? d.curLayer : baseLayer().id;
    const o = d.opt || {};
    for (const k of ['ang', 'osnap', 'grid', 'gap', 'dia', 'mirKeep']) if (typeof o[k] === 'boolean') opt[k] = o[k];
    if (o.radius >= 0) opt.radius = o.radius;
    if (Array.isArray(o.cham) && o.cham.length === 2 && o.cham.every(v => v >= 0)) opt.cham = o.cham;
    if ([15, 30, 45, 90].includes(o.step)) opt.step = o.step;
    if (o.gridStep > 0) opt.gridStep = o.gridStep;
  }
} catch (e) { /* nichts gespeichert */ }
if (!layers.length) { loadSample(); $('note').hidden = false; }   // erster Start: Beispielzeichnung

$('oAng').checked = opt.ang; $('oSnap').checked = opt.osnap; $('oGrid').checked = opt.grid;
$('oStep').value = opt.step; $('oGridStep').value = opt.gridStep;

if (inViewer) {                              // claude.ai: kein Druckdialog, Dateien über die Download-Funktion
  $('print').hidden = true;
  const btns = ['save', 'png', 'dxf', 'pdf'].map($);
  for (const b of btns) b.disabled = true;
  Promise.resolve().then(() => window.claude.use('downloads')).then(d => { saver = d; }, () => { saver = null; }).then(() => {
    for (const b of btns) { b.disabled = !saver; b.hidden = !saver; }
    if (saver) $('dxf').title = 'Für AutoCAD & Co. exportieren (ZIP mit der DXF-Datei)';
  });
}

let started = false;
new ResizeObserver(() => {
  const d = window.devicePixelRatio || 1;
  cv.width = Math.round(cv.clientWidth * d); cv.height = Math.round(cv.clientHeight * d);
  if (!cv.clientWidth) return;               // 3D-Modus: Zeichenfläche verborgen
  if (!started) {
    started = true;
    mouse.x = cv.clientWidth / 2; mouse.y = cv.clientHeight / 2;
    setTool('line');
    zoomFit();
  }
  draw();
}).observe(cv);
