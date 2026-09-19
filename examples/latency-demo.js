import Upstream from './upstream-5.1.4.js';
import Fork from '../dist/signature_pad.js';
const $ = (id) => document.getElementById(id);
const panels = [];
let frame = 0,
  previousFrame = performance.now(),
  longTasks = 0;
function tick(now) {
  frame = now - previousFrame;
  previousFrame = now;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
try {
  new PerformanceObserver((list) => {
    longTasks += list.getEntries().length;
  }).observe({ type: 'longtask', buffered: true });
} catch {
  /* Optional browser metric. */
}
for (const [title, Class] of [
  ['Upstream 5.1.4', Upstream],
  ['Fork · opcions originals', Fork],
  ['Fork · Apple Pencil', Fork],
]) {
  const article = document.createElement('article');
  article.innerHTML = `<h2>${title}</h2><div class="surface"><canvas aria-label="${title}"></canvas><canvas class="debug" aria-hidden="true"></canvas></div><pre></pre>`;
  $('panels').append(article);
  const canvas = article.querySelector('canvas');
  const debug = article.querySelector('.debug');
  panels.push({
    canvas,
    debug,
    Class,
    output: article.querySelector('pre'),
    stats: {},
    samples: [],
  });
}
function reset() {
  panels.forEach((p, index) => {
    p.pad?.off();
    const ratio = Math.max(devicePixelRatio || 1, 1);
    for (const c of [p.canvas, p.debug]) {
      c.width = Math.round(c.clientWidth * ratio);
      c.height = Math.round(c.clientHeight * ratio);
      c.getContext('2d').scale(ratio, ratio);
    }
    p.pad = new p.Class(
      p.canvas,
      index === 2
        ? {
            minWidth: 0.4,
            maxWidth: 2.8,
            pressureWeight: $('pressure').checked ? 0.8 : 0,
            pressureGamma: 0.7,
            lowLatency: $('low').checked,
          }
        : {},
    );
    if (index === 2) {
      const draw = p.pad._drawPreview.bind(p.pad);
      p.pad._drawPreview = (predicted, time) => {
        if ($('preview').checked)
          draw($('predicted').checked ? predicted : [], time);
        else p.pad._preview?.clear();
      };
      if (!$('smoothing').checked)
        p.pad._drawCurve = (curve, options) =>
          p.pad._drawLine(curve.startPoint, curve.endPoint, options);
    }
    // Demo-only timing wraps the existing event handler; no instrumentation ships in the library.
    const update = p.pad._strokeUpdate.bind(p.pad);
    p.pad._strokeUpdate = (e) => {
      const start = performance.now();
      update(e);
      const end = performance.now();
      p.stats.render = end - start;
      p.stats.inputToSubmit = end - e.event.timeStamp;
    };
    // Constructor stores a prototype method for normal throttling. Observe its public boundaries too.
    let start = 0;
    p.pad.addEventListener('beforeUpdateStroke', () => {
      start = performance.now();
    });
    p.pad.addEventListener('afterUpdateStroke', (e) => {
      const end = performance.now();
      p.stats.render = end - start;
      p.stats.inputToSubmit = end - e.detail.event.timeStamp;
    });
    p.stats = { count: 0, coalesced: 0, started: performance.now() };
    p.samples = [];
  });
  renderStats();
}
for (const [index, p] of panels.entries()) {
  const observe = (e) => {
    if (e.type !== 'pointerdown' && !p.pad._drawingStroke) return;
    if (e.pointerId !== p.active && e.type !== 'pointerdown') return;
    if (e.type === 'pointerdown') p.active = e.pointerId;
    const now = performance.now(),
      c = e.getCoalescedEvents?.() ?? [],
      predicted = e.getPredictedEvents?.() ?? [];
    Object.assign(p.stats, {
      type: e.pointerType,
      pressure: e.pressure,
      x: e.clientX,
      y: e.clientY,
      timestamp: e.timeStamp,
      now,
      jsDelay: now - e.timeStamp,
      predicted: predicted.length,
      perEvent: c.length,
    });
    if (index === 2) {
      if (e.type === 'pointerdown') p.samples = [];
      const sample = (point) => ({
        x: point.clientX, y: point.clientY, pressure: point.pressure,
        time: point.timeStamp, pointerType: point.pointerType,
      });
      p.samples.push({ event: sample(e), coalesced: c.map(sample) });
    }
    p.stats.count++;
    p.stats.coalesced += c.length;
    if ($('debug').checked) {
      const ctx = p.debug.getContext('2d'),
        rect = p.canvas.getBoundingClientRect();
      for (const [samples, color] of [
        [[e], '#2563eb'],
        [c, '#d97706'],
        [predicted, '#be185d'],
      ]) {
        ctx.fillStyle = color;
        for (const s of samples) {
          ctx.beginPath();
          ctx.arc(
            s.clientX - rect.left,
            s.clientY - rect.top,
            2,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
      }
    }
    if (index === 2) {
      if (!$('coalesced').checked)
        Object.defineProperty(e, 'getCoalescedEvents', { value: () => [] });
      if (!$('predicted').checked)
        Object.defineProperty(e, 'getPredictedEvents', { value: () => [] });
    }
  };
  p.canvas.addEventListener('pointerdown', observe, true);
  window.addEventListener('pointermove', observe, true);
}
function renderStats() {
  for (const p of panels) {
    const s = p.stats,
      seconds = (performance.now() - s.started) / 1000;
    const n = (value) => (Number.isFinite(value) ? value.toFixed(2) : '—');
    p.output.textContent = `Pointer: ${s.type ?? '—'} · pressió ${n(s.pressure)}\nx / y: ${n(s.x)} / ${n(s.y)}\nEvent timestamp: ${n(s.timestamp)} ms\nperformance.now: ${n(s.now)} ms\nEvent → JS: ${n(s.jsDelay)} ms\nEvents/s (mitjana): ${n(s.count / seconds)}\nCoalesced/s: ${n(s.coalesced / seconds)}\nCoalesced/event: ${s.perEvent ?? 0}\nPrediccions/event: ${s.predicted ?? 0}\nHandler/dibuix CPU: ${n(s.render)} ms\nEvent → ordres Canvas: ${n(s.inputToSubmit)} ms\nInterval rAF: ${n(frame)} ms\nLong tasks: ${longTasks}\nAPIs: coalesced=${typeof window.PointerEvent?.prototype.getCoalescedEvents === 'function'}, predicted=${typeof window.PointerEvent?.prototype.getPredictedEvents === 'function'}, raw=${'onpointerrawupdate' in p.canvas}`;
  }
}
setInterval(renderStats, 250);
$('controls').addEventListener('change', reset);
$('clear').onclick = reset;
$('export').onclick = () => {
  const output = {
    userAgent: navigator.userAgent,
    dpr: devicePixelRatio,
    controls: Object.fromEntries(
      [...document.querySelectorAll('#controls input')].map((input) => [input.id, input.checked]),
    ),
    groups: panels[2].pad.toData(),
    lastStrokeEvents: panels[2].samples,
  };
  const text = JSON.stringify(output, null, 2);
  $('diagnostic-text').value = text;
  const link = $('download-diagnostic');
  if (link.hasAttribute('href')) URL.revokeObjectURL(link.href);
  link.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  $('diagnostic-status').textContent = output.groups.length
    ? 'Dades preparades. Copia-les o descarrega el fitxer.'
    : 'No hi ha cap traç al tercer quadre. Dibuixa-hi i torna a mostrar el diagnòstic.';
  $('diagnostic').hidden = false;
  $('diagnostic').scrollIntoView({ block: 'center' });
};
$('copy-diagnostic').onclick = async () => {
  const text = $('diagnostic-text');
  try {
    await navigator.clipboard.writeText(text.value);
    $('diagnostic-status').textContent = 'Dades copiades. Ja les pots enganxar al xat.';
  } catch {
    text.focus();
    text.select();
    text.setSelectionRange(0, text.value.length);
    $('diagnostic-status').textContent = 'Mantén premut el text i tria «Copia» per copiar les dades manualment.';
  }
};
window.addEventListener('resize', () => {
  // Safari's browser bars can resize the viewport while scrolling to the controls.
  // Keep the strokes and input diagnostics instead of resetting the demo.
  const ratio = Math.max(devicePixelRatio || 1, 1);
  for (const p of panels) {
    for (const c of [p.canvas, p.debug]) {
      const width = Math.round(c.clientWidth * ratio);
      const height = Math.round(c.clientHeight * ratio);
      if (c.width === width && c.height === height) continue;
      c.width = width;
      c.height = height;
      c.getContext('2d').scale(ratio, ratio);
      if (c === p.canvas) p.pad.redraw();
    }
  }
});
reset();

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * p)];
}
window.runBenchmark = async function () {
  const results = [];
  for (const pointerType of ['mouse', 'touch', 'pen']) {
    for (const [index, p] of panels.entries()) {
      p.pad.clear();
      const durations = [],
        rect = p.canvas.getBoundingClientRect();
      const make = (type, i) =>
        new PointerEvent(type, {
          pointerId: 77,
          pointerType,
          buttons: type === 'pointerup' ? 0 : 1,
          clientX: rect.left + 10 + (i % 100) * 2,
          clientY: rect.top + 70 + Math.sin(i / 8) * 30,
          pressure: pointerType === 'pen' ? 0.2 + (i % 20) / 30 : 0.5,
        });
      p.canvas.dispatchEvent(make('pointerdown', 0));
      for (let i = 1; i <= 300; i++) {
        const e = make('pointermove', i),
          start = performance.now();
        window.dispatchEvent(e);
        durations.push(performance.now() - start);
        if (i % 30 === 0) await new Promise(requestAnimationFrame);
      }
      window.dispatchEvent(make('pointerup', 301));
      results.push({
        mode: index,
        pointerType,
        handlerMedianMs: percentile(durations, 0.5),
        handlerP95Ms: percentile(durations, 0.95),
        points: p.pad.toData()[0]?.points.length,
      });
    }
  }
  const waits = [];
  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 3));
    const start = performance.now();
    await new Promise(requestAnimationFrame);
    waits.push(performance.now() - start);
  }
  const { comparePreviewStrategies } = await import('./render-benchmark.js');
  const output = {
    previewStrategies: comparePreviewStrategies(),
    userAgent: navigator.userAgent,
    dpr: devicePixelRatio,
    note: 'Synthetic event dispatch/Canvas submission CPU; not hardware latency. Normal mode throttles and retains fewer points.',
    results,
    rafAddedWaitMedianMs: percentile(waits, 0.5),
    rafAddedWaitP95Ms: percentile(waits, 0.95),
  };
  $('results').textContent = JSON.stringify(output, null, 2);
  return output;
};
$('bench').onclick = async () => {
  $('bench').disabled = true;
  try {
    await window.runBenchmark();
  } finally {
    $('bench').disabled = false;
  }
};
