import SignaturePad from '../src/signature_pad';
import { Point } from '../src/point';
import { face } from './fixtures/face';
import './utils/pointer-event-polyfill';

let canvas: HTMLCanvasElement;
let pad: SignaturePad;
const options = {
  minWidth: 0.5,
  maxWidth: 3,
  pressureWeight: 1,
  pressureGamma: 1,
  penColor: 'black',
  dotSize: 0,
  velocityFilterWeight: 0.7,
  compositeOperation: 'source-over' as const,
};
function event(type: string, x = 10, pressure = 0.3, time = x): PointerEvent {
  const e = new PointerEvent(type, {
    pointerId: 1,
    pointerType: 'pen',
    clientX: x,
    clientY: 20,
    pressure,
    buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
  });
  Object.defineProperty(e, 'timeStamp', { value: time });
  return e;
}
function send(e: PointerEvent) {
  (e.type === 'pointerdown' ? canvas : window).dispatchEvent(e);
}
function stroke() {
  send(event('pointerdown'));
  send(event('pointermove', 30, 0.7));
  send(event('pointermove', 50, 0.9));
  send(event('pointerup', 60, 0));
}
beforeEach(() => {
  canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
});
afterEach(() => {
  pad?.off();
  document.body.replaceChildren();
  jest.useRealTimers();
});

describe('pressure', () => {
  it.each([undefined, 0])(
    'preserves legacy replay at weight %s',
    (pressureWeight) => {
      pad = new SignaturePad(canvas, { pressureWeight });
      pad.fromData(face);
      const svg = pad.toSVG();
      pad.off();
      pad = new SignaturePad(canvas);
      pad.fromData(face);
      expect(pad.toSVG()).toBe(svg);
      expect(pad.throttle).toBe(16);
      expect(pad.minDistance).toBe(5);
    },
  );
  it.each([
    [0, 0.5],
    [0.2, 1],
    [1, 3],
    [-1, 0.5],
    [2, 3],
  ])('maps pressure %s to radius %s', (p, expected) => {
    pad = new SignaturePad(canvas);
    expect(pad['_pressureWidth'](2, new Point(1, 1, p), options)).toBeCloseTo(
      expected,
    );
  });
  it.each([0, 0.1, 0.25, 0.5, 0.8])(
    'normalizes pressure %s before gamma and velocity blending',
    (pressure) => {
      pad = new SignaturePad(canvas);
      const settings = { ...options, pressureWeight: 0.8, pressureGamma: 0.7 };
      expect(
        pad['_pressureWidth'](2, new Point(1, 1, pressure), {
          ...settings,
          pressureMax: 0.5,
        }),
      ).toBe(
        pad['_pressureWidth'](
          2,
          new Point(1, 1, Math.min(1, pressure * 2)),
          settings,
        ),
      );
    },
  );
  it.each([0, -1, NaN, Infinity])(
    'ignores invalid pressureMax %s',
    (pressureMax) => {
      pad = new SignaturePad(canvas, { pressureMax });
      expect(pad.pressureMax).toBe(1);
      expect(
        pad['_pressureWidth'](2, new Point(1, 1, 0.25), {
          ...options,
          pressureMax,
        }),
      ).toBe(pad['_pressureWidth'](2, new Point(1, 1, 0.25), options));
    },
  );
  it('blends velocity and pressure', () => {
    pad = new SignaturePad(canvas);
    expect(
      pad['_pressureWidth'](2, new Point(1, 1, 0.2), {
        ...options,
        pressureWeight: 0.5,
      }),
    ).toBe(1.5);
  });
  it('applies gamma and rejects invalid configuration', () => {
    pad = new SignaturePad(canvas, {
      pressureWeight: Infinity,
      pressureGamma: -1,
    });
    expect(pad.pressureWeight).toBe(0);
    expect(pad.pressureGamma).toBe(1);
    expect(
      pad['_pressureWidth'](2, new Point(1, 1, 0.25), {
        ...options,
        pressureGamma: 0.5,
      }),
    ).toBe(1.75);
  });
  it.each([
    [-1, 0],
    [2, 1],
  ])('clamps weight %s', (input, expected) => {
    pad = new SignaturePad(canvas, { pressureWeight: input });
    expect(pad.pressureWeight).toBe(expected);
  });
  it.each(['mouse', 'touch', 'pen'])(
    'does not mistake default 0.5 for pressure (%s)',
    (pointerType) => {
      pad = new SignaturePad(canvas, { pressureWeight: 1, throttle: 0 });
      const e = event('pointerdown', 10, 0.5);
      Object.defineProperty(e, 'pointerType', { value: pointerType });
      send(e);
      expect(pad.toData()[0].points[0].pressureSupported).toBe(false);
    },
  );
  it('preserves pressure and replay metadata through JSON/fromData/redraw', () => {
    pad = new SignaturePad(canvas, {
      pressureWeight: 0.8,
      pressureMax: 0.5,
      lowLatency: true,
    });
    stroke();
    const data = JSON.parse(JSON.stringify(pad.toData()));
    const svg = pad.toSVG();
    expect(data[0].points.map((p: Point) => p.pressure)).toEqual([
      0.3, 0.7, 0.9, 0,
    ]);
    pad.clear();
    pad.pressureWeight = 0;
    pad.pressureMax = 1;
    expect(data[0].pressureMax).toBe(0.5);
    pad.fromData(data);
    expect(pad.toSVG()).toBe(svg);
    pad.redraw();
    expect(pad.toSVG()).toBe(svg);
    expect(pad.toData()).toEqual(data);
  });
  it('does not apply current pressure settings to legacy groups', () => {
    pad = new SignaturePad(canvas);
    pad.fromData(face);
    const svg = pad.toSVG();
    pad.pressureWeight = 1;
    pad.redraw();
    expect(pad.toSVG()).toBe(svg);
  });
});

describe('low-latency samples and preview isolation', () => {
  beforeEach(() => {
    pad = new SignaturePad(canvas, { lowLatency: true, pressureWeight: 0.8 });
  });
  it('disables throttling even if requested and defaults to no distance filter', () => {
    pad.off();
    pad = new SignaturePad(canvas, { lowLatency: true, throttle: 100 });
    expect(pad.throttle).toBe(0);
    expect(pad.minDistance).toBe(0);
  });
  it('retains each coalesced sample timestamp/pressure without parent or duplicate', () => {
    send(event('pointerdown'));
    const e = event('pointermove', 99);
    const a = event('pointermove', 20.25, 0.2, 20),
      b = event('pointermove', 40.5, 0.8, 24);
    Object.defineProperty(e, 'getCoalescedEvents', { value: () => [a, a, b] });
    send(e);
    const points = pad.toData()[0].points;
    expect(points.map((p) => p.x)).toEqual([10, 20.25, 40.5]);
    expect(points.map((p) => p.pressure)).toEqual([0.3, 0.2, 0.8]);
    expect(points[2].time - points[1].time).toBe(4);
  });
  it('renders repeated and overlapping iPad batches only once', () => {
    // First samples from the iPad diagnostic, translated to a local origin.
    const batches = [
      [
        [11, 105],
        [12, 109],
        [13, 113],
      ],
      [
        [14, 117],
        [15, 121],
        [16.5, 125],
        [18, 130],
      ],
    ];
    const draw = (repeat: boolean) => {
      pad.clear();
      const ctx = canvas.getContext('2d')!;
      const arc = jest.spyOn(ctx, 'arc').mockClear();
      send(event('pointerdown', 10, 0.08, 100));
      for (const batch of batches) {
        const samples = batch.map(([x, time]) =>
          event('pointermove', x, 0.08, time),
        );
        const e = samples[samples.length - 1];
        Object.defineProperty(e, 'getCoalescedEvents', {
          value: () => samples,
        });
        send(e);
        if (repeat) send(e);
      }
      // An overlapping batch must retain its new tail.
      const tail = event('pointermove', 20, 0.08, 134);
      Object.defineProperty(tail, 'getCoalescedEvents', {
        value: () =>
          repeat
            ? [
                event('pointermove', 16.5, 0.08, 125),
                event('pointermove', 18, 0.08, 130),
                tail,
              ]
            : [tail],
      });
      send(tail);
      send(event('pointerup', 22, 0, 138));
      const data = JSON.stringify(pad.toData());
      const drawing = arc.mock.calls.map((call) => [...call]);
      arc.mockRestore();
      return { data, drawing, svg: pad.toSVG() };
    };
    expect(draw(true)).toEqual(draw(false));
  });
  it.each([undefined, () => []])(
    'falls back on absent/empty coalescing',
    (getCoalescedEvents) => {
      send(event('pointerdown'));
      const e = event('pointermove', 30);
      Object.defineProperty(e, 'getCoalescedEvents', {
        value: getCoalescedEvents,
      });
      send(e);
      expect(pad.toData()[0].points).toHaveLength(2);
    },
  );
  it('keeps stationary real pressure samples', () => {
    send(event('pointerdown'));
    send(event('pointermove', 10, 0.9, 20));
    expect(pad.toData()[0].points).toHaveLength(2);
  });
  it('rejects non-finite coalesced coordinates', () => {
    send(event('pointerdown'));
    const e = event('pointermove', 30);
    const bad = event('pointermove', 20);
    Object.defineProperty(bad, 'clientX', { value: NaN });
    Object.defineProperty(e, 'getCoalescedEvents', {
      value: () => [bad, event('pointermove', 30)],
    });
    send(e);
    expect(pad.toData()[0].points.map((p) => p.x)).toEqual([10, 30]);
  });
  function predict() {
    send(event('pointerdown'));
    const e = event('pointermove', 30, 0.5, 30);
    Object.defineProperty(e, 'getPredictedEvents', {
      value: () => [event('pointermove', 999, 1, 40)],
    });
    send(e);
    return document.querySelector('canvas[aria-hidden]') as HTMLCanvasElement;
  }
  it('never exports prediction coordinates and clears old predictions on real input', () => {
    const preview = predict();
    expect(preview).not.toBeNull();
    expect(JSON.stringify(pad.toData())).not.toContain('999');
    expect(pad.toSVG()).not.toMatch(/(?:cx|x1|x2)="999"/);
    expect(pad.toDataURL()).toMatch(/^data:image\/png/);
    const ctx = preview.getContext('2d')!;
    const clear = jest.spyOn(ctx, 'clearRect');
    send(event('pointermove', 50));
    expect(clear).toHaveBeenCalled();
    expect(pad.toData()[0].points.map((p) => p.x)).toEqual([10, 30, 50]);
  });
  it.each(['pointerup', 'pointercancel'])('removes preview on %s', (type) => {
    predict();
    send(event(type, 40));
    expect(document.querySelector('canvas[aria-hidden]')).toBeNull();
    expect(pad.toData()[0].points.every((p) => p.x !== 999)).toBe(true);
  });
  it('expires stale predictions without altering data', () => {
    jest.useFakeTimers();
    const preview = predict();
    const data = JSON.stringify(pad.toData());
    const ctx = preview.getContext('2d')!;
    const line = jest.spyOn(ctx, 'lineTo');
    jest.advanceTimersByTime(41);
    expect(line).toHaveBeenLastCalledWith(30, 20);
    expect(JSON.stringify(pad.toData())).toBe(data);
  });
  it('cleans preview on clear/off and ignores other pointers', () => {
    predict();
    const before = pad.toData()[0].points.length;
    const other = event('pointermove', 60);
    Object.defineProperty(other, 'pointerId', { value: 2 });
    send(other);
    expect(pad.toData()[0].points).toHaveLength(before);
    pad.clear();
    expect(pad.toData()).toEqual([]);
    pad.off();
    expect(document.querySelector('canvas[aria-hidden]')).toBeNull();
  });
  it('does not create overlay for eraser compositing', () => {
    pad.compositeOperation = 'destination-out';
    send(event('pointerdown'));
    expect(document.querySelector('canvas[aria-hidden]')).toBeNull();
  });
  it('SVG export during input preserves live curve state', () => {
    send(event('pointerdown'));
    send(event('pointermove', 30));
    const points = pad['_lastPoints'];
    const width = pad['_lastWidth'];
    pad.toSVG();
    expect(pad['_lastPoints']).toBe(points);
    expect(pad['_lastWidth']).toBe(width);
  });
  it('uses Pointer Events on iPad only when opted in', () => {
    const agent = jest
      .spyOn(navigator, 'userAgent', 'get')
      .mockReturnValue('Macintosh');
    const pointer = jest.spyOn(canvas, 'addEventListener');
    pad.off();
    pad.on();
    expect(pointer).toHaveBeenCalledWith('pointerdown', expect.any(Function), {
      passive: false,
    });
    agent.mockRestore();
  });
  it('handles mouse fallback without PointerEvent', () => {
    pad.off();
    const original = window.PointerEvent;
    Object.defineProperty(window, 'PointerEvent', {
      configurable: true,
      value: undefined,
      writable: true,
    });
    try {
      pad = new SignaturePad(canvas, { lowLatency: true, pressureWeight: 1 });
      canvas.dispatchEvent(
        new MouseEvent('mousedown', { buttons: 1, clientX: 10 }),
      );
      window.dispatchEvent(
        new MouseEvent('mousemove', { buttons: 1, clientX: 30 }),
      );
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: 40 }));
      expect(pad.toData()[0].points).toHaveLength(3);
      expect(pad.toData()[0].points[0].pressureSupported).toBe(false);
    } finally {
      window.PointerEvent = original;
    }
  });
});

describe('legacy touch and preview lifecycle', () => {
  it('captures stylus TouchEvent force and keeps finger input on velocity', () => {
    pad = new SignaturePad(canvas, { lowLatency: true, pressureWeight: 1 });
    pad.off();
    pad['_handleTouchEvents']();
    for (const touchType of ['direct', 'stylus']) {
      const touch = {
        clientX: 10,
        clientY: 20,
        force: 0.8,
        touchType,
      } as unknown as Touch;
      canvas.dispatchEvent(
        new TouchEvent('touchstart', {
          changedTouches: [touch],
          targetTouches: [touch],
        }),
      );
      window.dispatchEvent(
        new TouchEvent('touchend', {
          changedTouches: [touch],
          targetTouches: [],
        }),
      );
    }
    expect(pad.toData()[0].points[0].pressureSupported).toBe(false);
    expect(pad.toData()[1].points[0].pressureSupported).toBe(true);
  });
  it('clear aborts an active low-latency stroke and removes its overlay', () => {
    pad = new SignaturePad(canvas, { lowLatency: true });
    send(event('pointerdown'));
    pad.clear();
    send(event('pointermove', 30));
    expect(pad.toData()).toEqual([]);
    expect(document.querySelector('canvas[aria-hidden]')).toBeNull();
  });
  it('suppresses stale overlay after scrolling until the next stroke', () => {
    pad = new SignaturePad(canvas, { lowLatency: true });
    send(event('pointerdown'));
    const ctx = document
      .querySelector<HTMLCanvasElement>('canvas[aria-hidden]')!
      .getContext('2d')!;
    const stroke = jest.spyOn(ctx, 'stroke').mockClear();
    document.dispatchEvent(new Event('scroll'));
    send(event('pointermove', 30));
    expect(stroke).not.toHaveBeenCalled();
  });
});

describe('canvas browser gestures', () => {
  it.each([
    'touchstart',
    'touchmove',
    'touchend',
    'gesturestart',
    'gesturechange',
    'gestureend',
    'selectstart',
    'dragstart',
    'contextmenu',
    'click',
    'dblclick',
    'wheel',
  ])('blocks %s only on the active canvas and releases it on off()', (type) => {
    pad = new SignaturePad(canvas, { lowLatency: true });
    const gesture = () => new Event(type, { cancelable: true, bubbles: true });
    const inside = gesture();
    canvas.dispatchEvent(inside);
    expect(inside.defaultPrevented).toBe(true);
    const outside = gesture();
    document.body.dispatchEvent(outside);
    expect(outside.defaultPrevented).toBe(false);
    pad.off();
    const disabled = gesture();
    canvas.dispatchEvent(disabled);
    expect(disabled.defaultPrevented).toBe(false);
    pad.on();
    const enabled = gesture();
    canvas.dispatchEvent(enabled);
    expect(enabled.defaultPrevented).toBe(true);
  });
  it('prevents a canvas click from triggering an enclosing control', () => {
    pad = new SignaturePad(canvas);
    const click = jest.fn();
    document.body.addEventListener('click', click, { once: true });
    canvas.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    expect(click).not.toHaveBeenCalled();
    document.body.removeEventListener('click', click);
  });
});
