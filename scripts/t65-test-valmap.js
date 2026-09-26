(async () => {
  const svg = document.querySelector('svg[viewBox]');
  if (!svg) return 'NO SVG';
  const ticksBefore = [...svg.querySelectorAll('text')].map(t => t.textContent.trim()).filter(t => /x$/.test(t)).slice(0, 8);
  const gBefore = svg.querySelector('g[transform]')?.getAttribute('transform');
  const rect = svg.getBoundingClientRect();
  for (let i = 0; i < 2; i++) {
    svg.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -240, clientX: rect.left + rect.width * 0.7, clientY: rect.top + rect.height * 0.5 }));
    await new Promise(r => setTimeout(r, 300));
  }
  const g = svg.querySelector('g[transform]');
  const ticksAfter = [...svg.querySelectorAll('text')].map(t => t.textContent.trim()).filter(t => /x$/.test(t)).slice(0, 10);
  // pan via pointer drag
  svg.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: rect.left + rect.width * 0.5, clientY: rect.top + rect.height * 0.5, pointerId: 1 }));
  svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: rect.left + rect.width * 0.5 - 60, clientY: rect.top + rect.height * 0.5 + 20, pointerId: 1 }));
  svg.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
  await new Promise(r => setTimeout(r, 250));
  const transformAfterPan = svg.querySelector('g[transform]')?.getAttribute('transform');
  const ticksAfterPan = [...svg.querySelectorAll('text')].map(t => t.textContent.trim()).filter(t => /x$/.test(t)).slice(0, 10);
  return JSON.stringify({ gBefore, transformAfterZoom: g?.getAttribute('transform'), ticksBefore, ticksAfter, transformAfterPan, ticksAfterPan, bubbles: svg.querySelectorAll('circle').length }, null, 1);
})()
