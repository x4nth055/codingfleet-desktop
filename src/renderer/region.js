'use strict';
// The drag on one screen's frozen picture. The rectangle goes back in this
// page's own pixels; the main process scales it to the capture it cuts.
(function () {
  const shot = document.getElementById('shot');
  const dim = document.getElementById('dim');
  const box = document.getElementById('box');
  const size = document.getElementById('size');
  const hint = document.getElementById('hint');

  let start = null;
  // With one screen the overlay gives up as soon as it loses focus. With
  // several, each one but the front loses focus the moment the next opens.
  let alone = false;

  window.region.onImage((data) => {
    alone = Boolean(data.alone);
    if (data.url) shot.src = `data:image/jpeg;base64,${data.url}`;
  });

  const rectOf = (event) => {
    const x = Math.min(start.x, event.clientX);
    const y = Math.min(start.y, event.clientY);
    return { x, y, width: Math.abs(event.clientX - start.x), height: Math.abs(event.clientY - start.y) };
  };

  const draw = (rect) => {
    box.hidden = false;
    dim.hidden = true;
    box.style.left = `${rect.x}px`;
    box.style.top = `${rect.y}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
    size.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
  };

  window.addEventListener('mousedown', (event) => {
    if (event.button !== 0) {
      window.region.cancel();
      return;
    }
    start = { x: event.clientX, y: event.clientY };
    hint.classList.add('away');
    draw(rectOf(event));
  });

  window.addEventListener('mousemove', (event) => {
    if (start) draw(rectOf(event));
  });

  window.addEventListener('mouseup', (event) => {
    if (!start) return;
    const rect = rectOf(event);
    start = null;
    window.region.done(rect);
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') window.region.cancel();
  });

  // The overlay lost focus, so the user went elsewhere: give the screen back.
  window.addEventListener('blur', () => {
    if (!start && alone) window.region.cancel();
  });
}());
