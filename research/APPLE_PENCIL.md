# Apple Pencil engineering notes

Research and local measurements: 2026-09-19. Based on **signature_pad 5.1.4**, tag
`v5.1.4`, commit `769b6438572ea927d57eddd960795843381701fe`. Runtime changes are
opt-in. No runtime dependencies were added. MIT and Szymon Nowak's attribution
are retained. This is an independent fork, not an upstream release.

## Findings before implementation

Upstream already records pressure, but computes width only from velocity. It
throttles moves with a trailing timeout (16 ms by default), rejects points within
5 CSS pixels, uses dispatch-time `Date` timestamps, and waits for the next point
to draw a cubic segment. It neither processes coalesced samples nor draws a
provisional tip. It also routes desktop-identifying iPads through Touch Events
because of an older Scribble workaround. Enabling low latency opts into Pointer
Events on those iPads; normal mode preserves the workaround.

Sources inspected:

- [Upstream 5.1.4](https://github.com/szimek/signature_pad/tree/v5.1.4), including
  event dispatch, Point, Bezier, throttle, SVG, replay and all callers.
- [Pressure issue #704](https://github.com/szimek/signature_pad/issues/704),
  [original capture PR #566](https://github.com/szimek/signature_pad/pull/566),
  [pressure detection PR #880](https://github.com/szimek/signature_pad/pull/880)
  and its `xtruhlar/signature_pad` fork. #880 does not implement pressure widths
  or low-latency rendering; nonzero touch pressure alone is not proof of a sensor.
- Searches for upstream latency, Apple Pencil, pressure, coalesced and predicted
  issues/PRs; the coalesced search returned no matches. Search also found
  [react-pressure-signature](https://github.com/lawreenas/react-pressure-signature),
  which adds a framework/PressureJS layer rather than a compatible vanilla patch.
  No code from these implementations was copied.
- [Pointer Events specification](https://www.w3.org/TR/pointerevents3/): coalesced
  children OR their parent, not both; pressure 0.5 may be synthetic; predictions
  are estimates and not confirmed input.
- [MDN coalescing](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getCoalescedEvents),
  [prediction](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getPredictedEvents)
  and [raw input](https://developer.mozilla.org/en-US/docs/Web/API/Element/pointerrawupdate_event).
- [Safari 18.2](https://webkit.org/blog/16301/webkit-features-in-safari-18-2/)
  introduced coalescing, prediction and stylus angles.
  [Safari 18.3](https://webkit.org/blog/16439/webkit-features-in-safari-18-3/)
  fixed identifiers in coalesced/predicted children. The fork validates the parent
  pointer and does not reject children on the older identifier bug.
- [WebKit #277185](https://bugs.webkit.org/show_bug.cgi?id=277185) (coalescing,
  fixed), [#264002](https://bugs.webkit.org/show_bug.cgi?id=264002) (prediction),
  [#210454](https://bugs.webkit.org/show_bug.cgi?id=210454) (rAF alignment,
  still NEW when researched). API availability does not establish event frequency.
- [Canvas desynchronized hint](https://developer.chrome.com/blog/desynchronized)
  and [HTML Canvas standard](https://html.spec.whatwg.org/multipage/canvas.html).
  This is an implementation hint, potentially with tearing; an overlay can negate
  front-buffer benefits. Existing `canvasContextOptions` already exposes it.

## Chosen implementation

`lowLatency: true` overrides throttle to zero, defaults minDistance to zero,
processes real coalesced samples immediately, keeps fractional coordinates and
uses each sample's `timeStamp` plus `performance.timeOrigin` (epoch milliseconds).
An explicit minDistance remains respected. Invalid coordinates are skipped;
identical adjacent samples are not duplicated. Stationary pressure samples remain
available. Tilt/angles remain on the original event in stroke callbacks; they are
not added to the serialized data format without a consumer requirement.

A separate transparent canvas displays the last real segment and at most 32 ms
of browser predictions. It is cleared on new input and removed on up/cancel,
clear and off. Predictions expire after 40 ms without input. No prediction enters
`_data`, the Bezier point history, PNG/JPEG/SVG exports, or the primary canvas.
The overlay copies the existing canvas transform, including the application's
HiDPI scaling. Main-canvas drawing remains incremental. No production DOM writes
occur per sample; overlay positioning happens at stroke start only.

On completion the last *real* point is reused as a Bezier control endpoint,
without appending a synthetic point to `toData()`. A `complete: true` group flag
makes `fromData()`/`redraw()` repeat that final rendering. Pressure settings are
stored per group. Optional per-point `pressureSupported` records the detection
state, so replay never has to guess input-device capabilities. Legacy data without
new settings continues to use velocity even on an instance configured for pressure.

Pressure uses the specified clamped weighted blend and gamma. Mouse and finger
input use velocity. Stylus input starts conservatively: pressure must be finite,
positive, and different from the specified synthetic 0.5 before pressure rendering
is enabled for subsequent samples in that stroke. A pen held at exactly 0.5 for
its whole stroke remains on velocity; the platform exposes no universal hardware
pressure-capability flag. Legacy Touch Events require `touchType === 'stylus'`.
Unknown touch types retain raw force but use velocity. This intentionally favors
compatibility over guessing. Explicit dotSize continues to override dot size.

## Alternatives evaluated

| Technique | Decision and evidence |
| --- | --- |
| Immediate event rendering | Used: no library frame wait; sustainable in local command-submission measurements. |
| Batch + requestAnimationFrame | Not used: measured extra scheduling wait around 13–14 ms in this setup. Coalescing already provides batches without an additional queue. |
| pointerrawupdate | Not enabled. Detected in Chromium, absent in tested WebKit 26.6. No Pencil hardware evidence that extra dispatch cost would improve this fork; demo reports support. Listening to raw and move together would duplicate samples. |
| Native prediction | Used visually, with a short horizon and expiration. Empty/missing APIs fall back to the real tip. |
| Custom extrapolation | Not added: extra overshoot/tuning risk; WebKit has access to platform input unavailable to JS. |
| Overlay vs readback/partial restoration | Overlay selected. Measured CPU submission/readback microbenchmark below; primary canvas never needs readback or restoration. |
| Redraw full history | Rejected: work increases with signature length. Only the provisional canvas is cleared. |
| Path2D | Compared for a fixed test path. It does not remove future-sample delay, and moving pressure curves invalidate reuse. No production rewrite justified. |
| OffscreenCanvas / worker | Not implemented or claimed faster: cross-thread messaging and presentation add boundaries; local JS is not the bottleneck demonstrated here. Requires device evidence before adding architecture. |
| WASM | Not implemented: no evidence that these small geometric functions justify a new runtime/boundary. |
| desynchronized canvas | Existing context option retained; not automatically enabled because of browser-dependent tearing/compositing behavior. |
| will-change / transforms / contain / isolation | No speculative compositor hacks. No device evidence of lower display latency. |
| Passive listeners / touch-action | Existing touch-action:none and cancellation behavior retained. Changing cancellation would risk gestures/Scribble; move handlers must still be able to prevent defaults. |
| Pointer capture | Existing window/ownerDocument listeners retained, plus the browser's implicit touch capture. No additional capture state or iOS behavior change was necessary. |
| Allocation / GC | One rect read per dispatched coalesced batch; no per-sample DOM writes. Keep readable upstream Point/Bezier allocations. Profile did not justify pooling. |
| DPR / coordinate conversion | No quality reduction. Preserve floats and caller transform. Do not cache rect across an entire moving layout; one rect per pointer batch is safe. |
| Ultra mode | No extra production mode: one opt-in boolean is sufficient. Demo controls are instrumentation only. |

## Measurements and limits

Raw reports: `benchmark-chromium.json`, `benchmark-webkit.json`. macOS, DPR 2,
headless Chromium 153 and Playwright WebKit 26.6. These are synthetic pointer
streams with mouse/touch/pen labels, **not physical hardware**. Three modes,
300 moves plus down/up, bursts of 30 with a frame yield; normal modes deliberately
retain fewer samples due to throttling. This is a stress/CPU comparison, not a
claim that low mode is faster per event.

| Measurement | Chromium | WebKit |
| --- | --- | --- |
| Low mode recorded real samples | 302 | 302 |
| Default modes recorded samples | 9–11 | 11 |
| Low mode handler p95 | 0.1–0.2 ms | Below 1 ms timer granularity in this run |
| Added rAF wait, median / p95 | 13.2 / 14 ms | 13 / 14 ms |
| Coalesced / predicted methods | Yes / yes | Yes / yes |
| raw-update feature detection | Yes | No |

Canvas strategy test: 1024 × 512 backing pixels, 700 operations each, median of
seven 100-operation batches. Overlay clear + short line: approximately 0.001 ms
Chromium and below timer resolution WebKit. Partial 100 × 50 image readback +
restore: 0.029 ms Chromium / 0.75 ms WebKit. Redraw 300 historical segments:
0.038 / 0.04 ms. Cached Path2D overlay was below timer resolution. These operations
have different GPU synchronization costs: **they do not measure GPU completion
or establish end-to-end latency ratios**. Zero readings mean below timer resolution.

Chromium DevTools trace over the instrumented A/B run: 15 Layout events totaling
23.84 ms, 15 style updates totaling 0.56 ms, eight minor collections totaling
4.37 ms, no major collections, and 25 paints totaling 3.78 ms. This includes demo
metrics updates and setup; it does not attribute those totals to the core library.
The demo reports long tasks when supported. No allocation/layout redesign was
justified by this coarse profile.

The biggest controllable improvements are removal of the 16 ms throttle,
removal of the default 5 px sampling gap, and a provisional tip covering the
Bezier lookahead. Coalescing improves sample fidelity; it does not recover time
already spent inside OS/browser dispatch. Predictions may reduce the visible
pen-to-ink gap, but no physical improvement in milliseconds is asserted.

## Compatibility / physical validation still needed

- Tested with Chromium and WebKit engines on macOS, including PNG replay and
  live SVG state preservation. WebKit automation is not an iPad/Safari/Pencil test.
- Use Safari/iPadOS 18.3+ where possible. Methods can exist but return no samples;
  HTTPS is needed for some input APIs. Older browsers retain ordinary input.
- Test rapid dots with Scribble enabled and disabled: low mode opts out of
  upstream's Touch Event workaround. Disable lowLatency if the device loses taps.
- The overlay assumes an untransformed, stationary canvas box, standard scaling
  via the 2D context, no CSS padding, and ordinary document stacking. CSS rotation,
  zoom, top-layer dialogs, complex clipping, canvas opacity/filters and transparent
  colors may cause preview misalignment or overlap artifacts. Scroll/resize hides
  the preview until a new stroke. The real canvas and exports remain authoritative.
- Preview is disabled for non-source-over compositing (e.g. erasers). Canvas alpha
  overlap and approximate SVG stroke widths remain upstream limitations.
- The straight provisional tail can adjust when the real Bezier replaces it.
  Prediction horizon and expiry bound, but cannot eliminate, directional overshoot.
- No browser API exposes full input-to-photon timing. A high-speed camera and
  physical iPad/Pencil are required to compare display latency with PencilKit.

## Reproduce

```sh
npm ci
npm test -- --runInBand
npm run build
npx serve .
```

Open `examples/apple-pencil-latency.html` over HTTPS on the iPad. Draw the same
loops, corners, slow pressure ramps and rapid dots in all three panes. Compare
with coalescing, predictions, preview and smoothing individually disabled. Keep
DPR native and record device, OS, refresh rate and power mode. The benchmark button
also runs the immediate/rAF and canvas-strategy comparisons. Debug sample colors
are separate and are never included in exported signature data.

## Final validation and size

`npm ci`, `npm test -- --runInBand` (96 tests, 11 original snapshots), lint,
TypeScript declarations, four bundle builds and `npm pack --dry-run` passed.
Chromium and WebKit checks compared rendered PNGs before/after replay for 2, 3
and 7-point strokes, tested ordinary mouse drawing, and compared default-mode
pixels against upstream with the same clock. Separate paired strokes with and
without predicted input produced identical PNG, SVG and JSON, with nonempty ink.
Desktop (1400/1440 px) and tablet-width (820 px) layouts were inspected. Browser
plugin was not available; local Playwright was used, outside runtime dependencies.

| Bundle | Upstream bytes / gzip | Fork bytes / gzip |
| --- | ---: | ---: |
| ESM minified | 15,598 / 4,660 | 21,017 / 6,095 |
| UMD minified | 16,703 / 5,129 | 22,152 / 6,568 |

Gzip measured with Python gzip, mtime 0. ESM overhead is 5,419 bytes raw / 1,435
bytes gzip. Reports exclude source maps; package contents retain upstream's maps
and docs. No new runtime dependencies. Further microbenchmark repetitions varied
(partial readback 0.75–0.94 ms on WebKit, low-mode p95 0–1 ms at its clock
resolution); the committed JSON files are one explicitly identified run, not a
statistically rigorous device study.
