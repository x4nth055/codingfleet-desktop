'use strict';
// What the page saw, for test/e2e-computer.cjs to read back.
window.seen = { go: 0, dbl: 0, ctx: 0, hover: 0, down: null, up: null, keys: [] };
const $ = (id) => document.getElementById(id);
$('go').addEventListener('click', () => { window.seen.go++; });
$('dbl').addEventListener('dblclick', () => { window.seen.dbl++; });
$('ctx').addEventListener('contextmenu', (event) => { event.preventDefault(); window.seen.ctx++; });
$('hover').addEventListener('mouseenter', () => { window.seen.hover++; });
document.addEventListener('mousedown', (event) => { window.seen.down = event.target.id || event.target.tagName; });
document.addEventListener('mouseup', (event) => { window.seen.up = event.target.id || event.target.tagName; });
document.addEventListener('keydown', (event) => { window.seen.keys.push(`${event.ctrlKey ? 'ctrl+' : ''}${event.key}`); });
