#!/usr/bin/env python3
"""Baut mini-cad.html aus den Teilen in src/ (eine einzige HTML-Datei ohne Abhängigkeiten).
Aufruf: python3 build.py"""
import pathlib
root = pathlib.Path(__file__).resolve().parent
src = root / 'src'
order = ['core', 'draw2d', 'app', 'export', 'model3d', 'start']
js = ''.join((src / f'{n}.js').read_text(encoding='utf-8') for n in order if (src / f'{n}.js').exists())
page = (src / 'page.html').read_text(encoding='utf-8')
(root / 'mini-cad.html').write_text(page.replace('/*@@SCRIPT@@*/\n', js), encoding='utf-8')
print('mini-cad.html:', len(page) + len(js), 'Zeichen')
