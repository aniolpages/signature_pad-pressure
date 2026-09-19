/** Canvas command-submission microbenchmark; deliberately excludes photon latency. */
export function comparePreviewStrategies() {
  const main = document.createElement('canvas'),
    overlay = document.createElement('canvas');
  main.width = overlay.width = 1024;
  main.height = overlay.height = 512;
  const ctx = main.getContext('2d'),
    top = overlay.getContext('2d');
  function segment(c, x = 10, y = 10) {
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + 64, y + 16);
    c.lineWidth = 3;
    c.stroke();
  }
  function history() {
    for (let i = 0; i < 300; i++) segment(ctx, (i * 31) % 950, (i * 17) % 480);
  }
  history();
  const path = new Path2D();
  path.moveTo(10, 10);
  path.lineTo(74, 26);
  const operations = {
    overlay: () => {
      top.clearRect(0, 0, 1024, 512);
      segment(top);
    },
    partialReadback: () => {
      const saved = ctx.getImageData(0, 0, 100, 50);
      segment(ctx);
      ctx.putImageData(saved, 0, 0);
    },
    redrawHistory: () => {
      ctx.clearRect(0, 0, 1024, 512);
      history();
      segment(ctx);
    },
    path2dOverlay: () => {
      top.clearRect(0, 0, 1024, 512);
      top.stroke(path);
    },
  };
  const results = {};
  for (const [name, run] of Object.entries(operations)) {
    const timings = [];
    for (let batch = 0; batch < 7; batch++) {
      const start = performance.now();
      for (let i = 0; i < 100; i++) run();
      timings.push((performance.now() - start) / 100);
    }
    timings.sort((a, b) => a - b);
    results[name] = timings[3];
  }
  return {
    backingPixels: '1024 × 512',
    iterations: 700,
    medianBatchMsPerOperation: results,
    caveat:
      'Command submission CPU only. Partial readback forces synchronization; other paths may defer rasterization. Path2D reuses a constant path unlike moving ink. No display-latency conclusion.',
  };
}
