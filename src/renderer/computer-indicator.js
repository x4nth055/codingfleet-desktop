'use strict';
// The pill's only logic: show what the agent is doing, and send Stop.
const pill = document.getElementById('pill');
const title = document.getElementById('title');
const doing = document.getElementById('doing');
const open = document.getElementById('open');

document.getElementById('stop').addEventListener('click', () => window.indicator.stop());
open.addEventListener('click', () => window.indicator.open());

window.indicator.onState((state) => {
  document.getElementById('shortcut').textContent = state.shortcut || '';
  const waiting = Boolean(state.waiting);
  pill.classList.toggle('waiting', waiting);
  title.textContent = waiting ? 'CodingFleet is waiting for your approval' : 'CodingFleet is using your computer';
  doing.textContent = waiting ? '' : (state.doing || '');
  open.hidden = !waiting;
});
