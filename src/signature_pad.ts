/**
 * The main idea and some parts of the code (e.g. drawing variable width Bézier curve) are taken from:
 * http://corner.squareup.com/2012/07/smoother-signatures.html
 *
 * Implementation of interpolation using cubic Bézier curves is taken from:
 * https://web.archive.org/web/20160323213433/http://www.benknowscode.com/2012/09/path-interpolation-using-cubic-bezier_9742.html
 *
 * Algorithm for approximated length of a Bézier curve is taken from:
 * http://www.lemoda.net/maths/bezier-length/index.html
 */

import { Bezier } from './bezier.js';
import { BasicPoint, Point } from './point.js';
import { SignatureEventTarget } from './signature_event_target.js';
import { throttle } from './throttle.js';
import { InkPreview } from './ink_preview.js';

export { BasicPoint } from './point.js';

export interface SignatureEvent {
  event: MouseEvent | TouchEvent | PointerEvent;
  type: string;
  x: number;
  y: number;
  pressure: number;
}

export interface FromDataOptions {
  clear?: boolean;
}

export interface FromDataUrlOptions {
  ratio?: number;
  width?: number;
  height?: number;
  xOffset?: number;
  yOffset?: number;
}

export interface ToSVGOptions {
  includeBackgroundColor?: boolean;
  includeDataUrl?: boolean;
}

export interface PointGroupOptions {
  pressureWeight?: number;
  pressureGamma?: number;
  dotSize: number;
  minWidth: number;
  maxWidth: number;
  penColor: string;
  velocityFilterWeight: number;
  /**
   * This is the globalCompositeOperation for the line.
   * *default: 'source-over'*
   * @see https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/globalCompositeOperation
   */
  compositeOperation: GlobalCompositeOperation;
}

export interface Options extends Partial<PointGroupOptions> {
  lowLatency?: boolean;
  minDistance?: number;
  backgroundColor?: string;
  throttle?: number;
  canvasContextOptions?: CanvasRenderingContext2DSettings;
}

export interface PointGroup extends PointGroupOptions {
  points: BasicPoint[];
  /** Flush the final real segment on replay (opt-in strokes only). */
  complete?: boolean;
}

export default class SignaturePad extends SignatureEventTarget {
  // Public stuff
  public pressureWeight: number;
  public pressureGamma: number;
  public readonly lowLatency: boolean;
  public dotSize: number;
  public minWidth: number;
  public maxWidth: number;
  public penColor: string;
  public minDistance: number;
  public velocityFilterWeight: number;
  public compositeOperation: GlobalCompositeOperation;
  public backgroundColor: string;
  public throttle: number;
  public canvasContextOptions: CanvasRenderingContext2DSettings;

  // Private stuff
  /* tslint:disable: variable-name */
  private _preview?: InkPreview;
  private _sampleRect?: DOMRect;
  private _pressureObserved = false;
  private _ctx: CanvasRenderingContext2D;
  private _drawingStroke = false;
  private _isEmpty = true;
  private _dataUrl: string | undefined;
  private _dataUrlOptions: FromDataUrlOptions | undefined;
  private _lastPoints: Point[] = []; // Stores up to 4 most recent points; used to generate a new curve
  private _data: PointGroup[] = []; // Stores all points in groups (one group per line or dot)
  private _lastVelocity = 0;
  private _lastWidth = 0;
  private _strokeMoveUpdate: (event: SignatureEvent) => void;
  private _strokePointerId: number | undefined;
  /* tslint:enable: variable-name */

  constructor(
    private canvas: HTMLCanvasElement,
    options: Options = {},
  ) {
    super();
    this.pressureWeight = Number.isFinite(options.pressureWeight)
      ? Math.max(0, Math.min(1, options.pressureWeight!))
      : 0;
    this.pressureGamma =
      Number.isFinite(options.pressureGamma) && options.pressureGamma! > 0
        ? options.pressureGamma!
        : 1;
    this.lowLatency = options.lowLatency ?? false;
    this.velocityFilterWeight = options.velocityFilterWeight || 0.7;
    this.minWidth = options.minWidth || 0.5;
    this.maxWidth = options.maxWidth || 2.5;

    // We need to handle 0 value, so use `??` instead of `||`
    this.throttle = this.lowLatency ? 0 : (options.throttle ?? 16); // in milliseconds
    this.minDistance = options.minDistance ?? (this.lowLatency ? 0 : 5); // in pixels
    this.dotSize = options.dotSize || 0;
    this.penColor = options.penColor || 'black';
    this.backgroundColor = options.backgroundColor || 'rgba(0,0,0,0)';
    this.compositeOperation = options.compositeOperation || 'source-over';
    this.canvasContextOptions = options.canvasContextOptions ?? {};

    this._strokeMoveUpdate = this.throttle
      ? throttle(SignaturePad.prototype._strokeUpdate, this.throttle)
      : SignaturePad.prototype._strokeUpdate;

    this._handleMouseDown = this._handleMouseDown.bind(this);
    this._handleMouseMove = this._handleMouseMove.bind(this);
    this._handleMouseUp = this._handleMouseUp.bind(this);
    this._handleTouchStart = this._handleTouchStart.bind(this);
    this._handleTouchMove = this._handleTouchMove.bind(this);
    this._handleTouchEnd = this._handleTouchEnd.bind(this);
    this._handlePointerDown = this._handlePointerDown.bind(this);
    this._handlePointerMove = this._handlePointerMove.bind(this);
    this._handlePointerUp = this._handlePointerUp.bind(this);
    this._handlePointerCancel = this._handlePointerCancel.bind(this);
    this._handleTouchCancel = this._handleTouchCancel.bind(this);

    this._ctx = canvas.getContext(
      '2d',
      this.canvasContextOptions,
    ) as CanvasRenderingContext2D;

    this.clear();

    // Enable mouse and touch event handlers
    this.on();
  }

  public clear(): void {
    this._preview?.remove();
    this._preview = undefined;
    if (this.lowLatency) {
      this._drawingStroke = false;
      this._removeMoveUpEventListeners();
    }
    const { _ctx: ctx, canvas } = this;

    // Clear canvas using background color
    ctx.fillStyle = this.backgroundColor;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    this._data = [];
    this._reset(this._getPointGroupOptions());
    this._isEmpty = true;
    this._dataUrl = undefined;
    this._dataUrlOptions = undefined;
    this._strokePointerId = undefined;
  }

  public redraw(): void {
    const data = this._data;
    const dataUrl = this._dataUrl;
    const dataUrlOptions = this._dataUrlOptions;

    this.clear();
    if (dataUrl) {
      this.fromDataURL(dataUrl, dataUrlOptions);
    }
    this.fromData(data, { clear: false });
  }

  public fromDataURL(
    dataUrl: string,
    options: FromDataUrlOptions = {},
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const ratio = options.ratio || window.devicePixelRatio || 1;
      const width = options.width || this.canvas.width / ratio;
      const height = options.height || this.canvas.height / ratio;
      const xOffset = options.xOffset || 0;
      const yOffset = options.yOffset || 0;

      this._reset(this._getPointGroupOptions());

      image.onload = (): void => {
        this._ctx.drawImage(image, xOffset, yOffset, width, height);
        resolve();
      };
      image.onerror = (error): void => {
        reject(error);
      };
      image.crossOrigin = 'anonymous';
      image.src = dataUrl;

      this._isEmpty = false;
      this._dataUrl = dataUrl;
      this._dataUrlOptions = { ...options };
    });
  }

  public toDataURL(
    type: 'image/svg+xml',
    encoderOptions?: ToSVGOptions,
  ): string;
  public toDataURL(type?: string, encoderOptions?: number): string;
  public toDataURL(
    type = 'image/png',
    encoderOptions?: number | ToSVGOptions | undefined,
  ): string {
    switch (type) {
      case 'image/svg+xml':
        if (typeof encoderOptions !== 'object') {
          encoderOptions = undefined;
        }
        return `data:image/svg+xml;base64,${btoa(
          this.toSVG(encoderOptions as ToSVGOptions),
        )}`;
      default:
        if (typeof encoderOptions !== 'number') {
          encoderOptions = undefined;
        }
        return this.canvas.toDataURL(type, encoderOptions as number);
    }
  }

  public on(): void {
    // Disable panning/zooming when touching canvas element
    this.canvas.style.touchAction = 'none';
    (
      this.canvas.style as CSSStyleDeclaration & {
        msTouchAction: string | null;
      }
    ).msTouchAction = 'none';
    this.canvas.style.userSelect = 'none';
    // Safari does not support userSelect property without a prefix even as of iOS 26
    // https://caniuse.com/?search=user-select
    this.canvas.style.webkitUserSelect = 'none';

    const isIOS =
      /Macintosh/.test(navigator.userAgent) && 'ontouchstart' in document;

    // The "Scribble" feature of iOS intercepts point events. So that we can
    // lose some of them when tapping rapidly. Use touch events for iOS
    // platforms to prevent it. See
    // https://developer.apple.com/forums/thread/664108 for more information.
    if (window.PointerEvent && (!isIOS || this.lowLatency)) {
      this._handlePointerEvents();
    } else {
      this._handleMouseEvents();

      if ('ontouchstart' in window) {
        this._handleTouchEvents();
      }
    }
  }

  public off(): void {
    if (this.lowLatency) this._drawingStroke = false;
    this._preview?.remove();
    this._preview = undefined;
    // Enable panning/zooming when touching canvas element
    this.canvas.style.touchAction = 'auto';
    (
      this.canvas.style as CSSStyleDeclaration & {
        msTouchAction: string | null;
      }
    ).msTouchAction = 'auto';
    this.canvas.style.userSelect = 'auto';
    this.canvas.style.webkitUserSelect = 'auto';

    this.canvas.removeEventListener('pointerdown', this._handlePointerDown);
    this.canvas.removeEventListener('mousedown', this._handleMouseDown);
    this.canvas.removeEventListener('touchstart', this._handleTouchStart);

    this._removeMoveUpEventListeners();
  }

  private _getListenerFunctions() {
    const canvasWindow =
      window.document === this.canvas.ownerDocument
        ? window
        : (this.canvas.ownerDocument.defaultView ?? this.canvas.ownerDocument);

    return {
      addEventListener: canvasWindow.addEventListener.bind(
        canvasWindow,
      ) as typeof window.addEventListener,
      removeEventListener: canvasWindow.removeEventListener.bind(
        canvasWindow,
      ) as typeof window.removeEventListener,
    };
  }

  private _removeMoveUpEventListeners(): void {
    const { removeEventListener } = this._getListenerFunctions();
    removeEventListener('pointermove', this._handlePointerMove);
    removeEventListener('pointerup', this._handlePointerUp);
    removeEventListener('pointercancel', this._handlePointerCancel);

    removeEventListener('mousemove', this._handleMouseMove);
    removeEventListener('mouseup', this._handleMouseUp);

    removeEventListener('touchmove', this._handleTouchMove);
    removeEventListener('touchend', this._handleTouchEnd);
    removeEventListener('touchcancel', this._handleTouchCancel);
  }

  public isEmpty(): boolean {
    return this._isEmpty;
  }

  public fromData(
    pointGroups: PointGroup[],
    { clear = true }: FromDataOptions = {},
  ): void {
    if (clear) {
      this.clear();
    }

    this._fromData(
      pointGroups,
      this._drawCurve.bind(this),
      this._drawDot.bind(this),
      this._drawLine.bind(this),
    );

    this._data = this._data.concat(pointGroups);
  }

  public toData(): PointGroup[] {
    return this._data;
  }

  private _isLeftButtonPressed(event: MouseEvent, only?: boolean): boolean {
    if (only) {
      return event.buttons === 1;
    }

    return (event.buttons & 1) === 1;
  }
  private _pointerEventToSignatureEvent(
    event: MouseEvent | PointerEvent,
  ): SignatureEvent {
    return {
      event: event,
      type: event.type,
      x: event.clientX,
      y: event.clientY,
      pressure: 'pressure' in event ? event.pressure : 0,
    };
  }

  private _touchEventToSignatureEvent(event: TouchEvent): SignatureEvent {
    const touch = event.changedTouches[0];
    return {
      event: event,
      type: event.type,
      x: touch.clientX,
      y: touch.clientY,
      pressure: touch.force,
    };
  }

  // Event handlers
  private _handleMouseDown(event: MouseEvent): void {
    if (!this._isLeftButtonPressed(event, true) || this._drawingStroke) {
      return;
    }
    this._strokeBegin(this._pointerEventToSignatureEvent(event));
  }

  private _handleMouseMove(event: MouseEvent): void {
    if (!this._isLeftButtonPressed(event, true) || !this._drawingStroke) {
      // Stop when not pressing primary button or pressing multiple buttons
      this._strokeEnd(this._pointerEventToSignatureEvent(event), false);
      return;
    }

    this._strokeMoveUpdate(this._pointerEventToSignatureEvent(event));
  }

  private _handleMouseUp(event: MouseEvent): void {
    if (this._isLeftButtonPressed(event)) {
      return;
    }

    this._strokeEnd(this._pointerEventToSignatureEvent(event));
  }

  private _handleTouchStart(event: TouchEvent): void {
    if (event.targetTouches.length !== 1 || this._drawingStroke) {
      return;
    }

    // Prevent scrolling.
    if (event.cancelable) {
      event.preventDefault();
    }

    this._strokeBegin(this._touchEventToSignatureEvent(event));
  }

  private _handleTouchMove(event: TouchEvent): void {
    if (event.targetTouches.length !== 1) {
      return;
    }

    // Prevent scrolling.
    if (event.cancelable) {
      event.preventDefault();
    }

    if (!this._drawingStroke) {
      this._strokeEnd(this._touchEventToSignatureEvent(event), false);
      return;
    }

    this._strokeMoveUpdate(this._touchEventToSignatureEvent(event));
  }

  private _handleTouchEnd(event: TouchEvent): void {
    if (event.targetTouches.length !== 0) {
      return;
    }

    if (event.cancelable) {
      event.preventDefault();
    }

    this._strokeEnd(this._touchEventToSignatureEvent(event));
  }

  private _handlePointerCancel(event: PointerEvent): void {
    if (!this._allowPointerId(event)) {
      return;
    }

    event.preventDefault();
    this._strokeEnd(this._pointerEventToSignatureEvent(event), false);
  }

  private _handleTouchCancel(event: TouchEvent): void {
    if (event.cancelable) {
      event.preventDefault();
    }

    this._strokeEnd(this._touchEventToSignatureEvent(event), false);
  }

  private _getPointerId(event: PointerEvent) {
    // @ts-expect-error persistentDeviceId is not available yet but we want to use it when it is available
    return event.persistentDeviceId || event.pointerId;
  }

  private _allowPointerId(
    event: PointerEvent,
    allowUndefined = false,
  ): boolean {
    if (typeof this._strokePointerId === 'undefined') {
      return allowUndefined;
    }

    return this._getPointerId(event) === this._strokePointerId;
  }

  private _handlePointerDown(event: PointerEvent): void {
    if (
      this._drawingStroke ||
      !this._isLeftButtonPressed(event) ||
      !this._allowPointerId(event, true)
    ) {
      return;
    }

    this._strokePointerId = this._getPointerId(event);

    event.preventDefault();

    this._strokeBegin(this._pointerEventToSignatureEvent(event));
  }

  private _handlePointerMove(event: PointerEvent): void {
    if (!this._allowPointerId(event)) {
      return;
    }
    if (!this._isLeftButtonPressed(event, true) || !this._drawingStroke) {
      // Stop when primary button not pressed or multiple buttons pressed
      this._strokeEnd(this._pointerEventToSignatureEvent(event), false);
      return;
    }

    event.preventDefault();
    if (!this.lowLatency) {
      this._strokeMoveUpdate(this._pointerEventToSignatureEvent(event));
      return;
    }
    this._sampleRect = this.canvas.getBoundingClientRect();
    this._preview?.clear();
    const samples = event.getCoalescedEvents?.();
    try {
      // Parent is a summary of the list. Never append it to a nonempty list.
      for (const sample of samples?.length ? samples : [event]) {
        if (
          Number.isFinite(sample.clientX) &&
          Number.isFinite(sample.clientY) &&
          Number.isFinite(sample.timeStamp)
        ) {
          this._strokeUpdate(this._pointerEventToSignatureEvent(sample));
        }
      }
      this._drawPreview(event.getPredictedEvents?.() ?? [], event.timeStamp);
    } finally {
      this._sampleRect = undefined;
    }
  }

  private _handlePointerUp(event: PointerEvent): void {
    if (this._isLeftButtonPressed(event) || !this._allowPointerId(event)) {
      return;
    }

    event.preventDefault();
    this._strokeEnd(this._pointerEventToSignatureEvent(event));
  }

  private _getPointGroupOptions(group?: PointGroup): PointGroupOptions {
    return {
      ...((group ? group.pressureWeight : this.pressureWeight)
        ? {
            pressureWeight: group ? group.pressureWeight : this.pressureWeight,
            pressureGamma: group
              ? (group.pressureGamma ?? 1)
              : this.pressureGamma,
          }
        : {}),
      penColor: group && 'penColor' in group ? group.penColor : this.penColor,
      dotSize: group && 'dotSize' in group ? group.dotSize : this.dotSize,
      minWidth: group && 'minWidth' in group ? group.minWidth : this.minWidth,
      maxWidth: group && 'maxWidth' in group ? group.maxWidth : this.maxWidth,
      velocityFilterWeight:
        group && 'velocityFilterWeight' in group
          ? group.velocityFilterWeight
          : this.velocityFilterWeight,
      compositeOperation:
        group && 'compositeOperation' in group
          ? group.compositeOperation
          : this.compositeOperation,
    };
  }

  // Private methods
  private _strokeBegin(event: SignatureEvent): void {
    const cancelled = !this.dispatchEvent(
      new CustomEvent('beginStroke', { detail: event, cancelable: true }),
    );
    if (cancelled) {
      return;
    }

    const { addEventListener } = this._getListenerFunctions();
    switch (event.event.type) {
      case 'mousedown':
        addEventListener('mousemove', this._handleMouseMove, {
          passive: false,
        });
        addEventListener('mouseup', this._handleMouseUp, { passive: false });
        break;
      case 'touchstart':
        addEventListener('touchmove', this._handleTouchMove, {
          passive: false,
        });
        addEventListener('touchend', this._handleTouchEnd, { passive: false });
        addEventListener('touchcancel', this._handleTouchCancel, {
          passive: false,
        });
        break;
      case 'pointerdown':
        addEventListener('pointermove', this._handlePointerMove, {
          passive: false,
        });
        addEventListener('pointerup', this._handlePointerUp, {
          passive: false,
        });
        addEventListener('pointercancel', this._handlePointerCancel, {
          passive: false,
        });
        break;
      default:
      // do nothing
    }

    this._drawingStroke = true;
    this._pressureObserved = false;

    const pointGroupOptions = this._getPointGroupOptions();

    const newPointGroup: PointGroup = {
      ...pointGroupOptions,
      points: [],
    };

    this._data.push(newPointGroup);
    this._reset(pointGroupOptions);
    if (this.lowLatency && this.compositeOperation === 'source-over') {
      this._preview ??= new InkPreview(this.canvas);
      this._preview.begin(this._ctx);
    }
    this._strokeUpdate(event);
  }

  private _strokeUpdate(event: SignatureEvent): void {
    if (!this._drawingStroke) {
      return;
    }

    if (this._data.length === 0) {
      // This can happen if clear() was called while a signature is still in progress,
      // or if there is a race condition between start/update events.
      this._strokeBegin(event);
      return;
    }

    this.dispatchEvent(
      new CustomEvent('beforeUpdateStroke', { detail: event }),
    );

    const point = this._createPoint(
      event.x,
      event.y,
      event.pressure,
      this.lowLatency
        ? performance.timeOrigin + event.event.timeStamp
        : undefined,
    );
    if (this.pressureWeight > 0) {
      const source = event.event;
      const stylus =
        'pointerType' in source
          ? source.pointerType === 'pen'
          : 'changedTouches' in source &&
            (source.changedTouches[0] as Touch & { touchType?: string })
              .touchType === 'stylus';
      // A constant 0.5 is the Pointer Events fallback, not evidence of a sensor.
      this._pressureObserved ||=
        !!stylus &&
        Number.isFinite(point.pressure) &&
        point.pressure > 0 &&
        point.pressure !== 0.5;
      point.pressureSupported = this._pressureObserved;
    }
    const lastPointGroup = this._data[this._data.length - 1];
    const lastPoints = lastPointGroup.points;
    const lastPoint =
      lastPoints.length > 0 && lastPoints[lastPoints.length - 1];
    const isLastPointTooClose = lastPoint
      ? point.distanceTo(lastPoint) <= this.minDistance
      : false;
    const pointGroupOptions = this._getPointGroupOptions(lastPointGroup);

    // Repeated/overlapping coalesced batches must not rewind the stroke.
    // Keep distinct samples with equal timestamps (browser clock precision).
    const stale = this.lowLatency && lastPoint && point.time < lastPoint.time;
    // Low-latency mode retains stationary pressure/time samples, but not duplicates.
    const duplicate = lastPoint && point.equals(lastPoint);
    if (
      !lastPoint ||
      (!stale &&
        !duplicate &&
        ((this.lowLatency && this.minDistance === 0) || !isLastPointTooClose))
    ) {
      const curve = this._addPoint(point, pointGroupOptions);

      if (!lastPoint) {
        this._drawDot(point, pointGroupOptions);
      } else if (curve) {
        this._drawCurve(curve, pointGroupOptions);
      }

      lastPoints.push({
        time: point.time,
        x: point.x,
        y: point.y,
        pressure: point.pressure,
        ...(point.pressureSupported !== undefined
          ? { pressureSupported: point.pressureSupported }
          : {}),
      });
    }

    if (this.lowLatency && !this._sampleRect)
      this._drawPreview([], event.event.timeStamp);
    this.dispatchEvent(new CustomEvent('afterUpdateStroke', { detail: event }));
  }

  private _strokeEnd(event: SignatureEvent, shouldUpdate = true): void {
    this._removeMoveUpEventListeners();

    if (!this._drawingStroke) {
      return;
    }

    if (shouldUpdate) {
      this._strokeUpdate(event);
    }

    if (this.lowLatency || this.pressureWeight > 0) {
      const group = this._data[this._data.length - 1];
      if (group?.points.length) {
        group.complete = true;
        this._finishCurve(
          group,
          this._drawCurve.bind(this),
          this._drawLine.bind(this),
        );
      }
      this._preview?.remove();
      this._preview = undefined;
    }
    this._drawingStroke = false;
    this._strokePointerId = undefined;
    this.dispatchEvent(new CustomEvent('endStroke', { detail: event }));
  }

  private _drawPreview(predicted: PointerEvent[], time: number): void {
    const group = this._data[this._data.length - 1];
    if (!this._drawingStroke || !group?.points.length) return;
    const points = group.points;
    const last = points[points.length - 1];
    const start = points.length > 1 ? points[points.length - 2] : last;
    const options = this._getPointGroupOptions(group);
    this._preview?.draw(
      start,
      last,
      predicted,
      time,
      this._pressureWidth(this._lastWidth, last, options),
      options.penColor,
      this._sampleRect ?? this.canvas.getBoundingClientRect(),
    );
  }

  private _finishCurve(
    group: PointGroup,
    drawCurve: SignaturePad['_drawCurve'],
    drawLine: SignaturePad['_drawLine'],
  ): void {
    const { points } = group;
    const options = this._getPointGroupOptions(group);
    if (points.length === 2) {
      drawLine(points[0], points[1], options);
    } else if (points.length > 2) {
      const last = points[points.length - 1];
      const curve = this._addPoint(
        new Point(
          last.x,
          last.y,
          last.pressure,
          last.time,
          last.pressureSupported,
        ),
        options,
      );
      if (curve) drawCurve(curve, options);
    }
  }

  private _handlePointerEvents(): void {
    this._drawingStroke = false;

    this.canvas.addEventListener('pointerdown', this._handlePointerDown, {
      passive: false,
    });
  }

  private _handleMouseEvents(): void {
    this._drawingStroke = false;

    this.canvas.addEventListener('mousedown', this._handleMouseDown, {
      passive: false,
    });
  }

  private _handleTouchEvents(): void {
    this.canvas.addEventListener('touchstart', this._handleTouchStart, {
      passive: false,
    });
  }

  // Called when a new line is started
  private _reset(options: PointGroupOptions): void {
    this._lastPoints = [];
    this._lastVelocity = 0;
    this._lastWidth = (options.minWidth + options.maxWidth) / 2;
    this._ctx.fillStyle = options.penColor;
    this._ctx.globalCompositeOperation = options.compositeOperation;
  }

  private _createPoint(
    x: number,
    y: number,
    pressure: number,
    time?: number,
  ): Point {
    const rect = this._sampleRect ?? this.canvas.getBoundingClientRect();

    return new Point(
      x - rect.left,
      y - rect.top,
      pressure,
      time ?? new Date().getTime(),
    );
  }

  // Add point to _lastPoints array and generate a new curve if there are enough points (i.e. 3)
  private _addPoint(point: Point, options: PointGroupOptions): Bezier | null {
    const { _lastPoints } = this;

    if (!_lastPoints.length) {
      this._lastWidth = this._pressureWidth(this._lastWidth, point, options);
    }
    _lastPoints.push(point);

    if (_lastPoints.length > 2) {
      // To reduce the initial lag make it work with 3 points
      // by copying the first point to the beginning.
      if (_lastPoints.length === 3) {
        _lastPoints.unshift(_lastPoints[0]);
      }

      // _points array will always have 4 points here.
      const widths = this._calculateCurveWidths(
        _lastPoints[1],
        _lastPoints[2],
        options,
      );
      const curve = Bezier.fromPoints(_lastPoints, widths);

      // Remove the first element from the list, so that there are no more than 4 points at any time.
      _lastPoints.shift();

      return curve;
    }

    return null;
  }

  private _calculateCurveWidths(
    startPoint: Point,
    endPoint: Point,
    options: PointGroupOptions,
  ): { start: number; end: number } {
    const velocity =
      options.velocityFilterWeight * endPoint.velocityFrom(startPoint) +
      (1 - options.velocityFilterWeight) * this._lastVelocity;

    const newWidth = this._pressureWidth(
      this._strokeWidth(velocity, options),
      endPoint,
      options,
    );

    const widths = {
      end: newWidth,
      start: this._lastWidth,
    };

    this._lastVelocity = velocity;
    this._lastWidth = newWidth;

    return widths;
  }

  private _strokeWidth(velocity: number, options: PointGroupOptions): number {
    return Math.max(options.maxWidth / (velocity + 1), options.minWidth);
  }

  private _pressureWidth(
    velocityWidth: number,
    point: BasicPoint,
    options: PointGroupOptions,
  ): number {
    const weight = Number.isFinite(options.pressureWeight)
      ? Math.max(0, Math.min(1, options.pressureWeight!))
      : 0;
    if (
      !weight ||
      point.pressureSupported === false ||
      !Number.isFinite(point.pressure)
    ) {
      return velocityWidth;
    }
    const gamma =
      Number.isFinite(options.pressureGamma) && options.pressureGamma! > 0
        ? options.pressureGamma!
        : 1;
    const pressure = Math.pow(Math.max(0, Math.min(1, point.pressure)), gamma);
    const width =
      options.minWidth + pressure * (options.maxWidth - options.minWidth);
    return Math.max(
      options.minWidth,
      Math.min(options.maxWidth, velocityWidth * (1 - weight) + width * weight),
    );
  }

  private _drawCurveSegment(x: number, y: number, width: number): void {
    const ctx = this._ctx;

    ctx.moveTo(x, y);
    ctx.arc(x, y, width, 0, 2 * Math.PI, false);
    this._isEmpty = false;
  }

  private _drawCurve(curve: Bezier, options: PointGroupOptions): void {
    const ctx = this._ctx;
    const widthDelta = curve.endWidth - curve.startWidth;
    // '2' is just an arbitrary number here. If only length is used, then
    // there are gaps between curve segments :/
    const drawSteps = Math.ceil(curve.length()) * 2;

    ctx.beginPath();
    ctx.fillStyle = options.penColor;

    for (let i = 0; i < drawSteps; i += 1) {
      // Calculate the Bezier (x, y) coordinate for this step.
      const t = i / drawSteps;
      const tt = t * t;
      const ttt = tt * t;
      const u = 1 - t;
      const uu = u * u;
      const uuu = uu * u;

      let x = uuu * curve.startPoint.x;
      x += 3 * uu * t * curve.control1.x;
      x += 3 * u * tt * curve.control2.x;
      x += ttt * curve.endPoint.x;

      let y = uuu * curve.startPoint.y;
      y += 3 * uu * t * curve.control1.y;
      y += 3 * u * tt * curve.control2.y;
      y += ttt * curve.endPoint.y;

      const width = Math.min(
        curve.startWidth + ttt * widthDelta,
        options.maxWidth,
      );
      this._drawCurveSegment(x, y, width);
    }

    ctx.closePath();
    ctx.fill();
  }

  private _getDotSize(options: PointGroupOptions): number {
    return options.dotSize > 0
      ? options.dotSize
      : (options.minWidth + options.maxWidth) / 2;
  }

  private _drawDot(point: BasicPoint, options: PointGroupOptions): void {
    const ctx = this._ctx;
    const width =
      options.dotSize > 0
        ? options.dotSize
        : this._pressureWidth(this._getDotSize(options), point, options);

    ctx.beginPath();
    this._drawCurveSegment(point.x, point.y, width);
    ctx.closePath();
    ctx.fillStyle = options.penColor;
    ctx.fill();
  }

  private _drawLine(
    startPoint: BasicPoint,
    endPoint: BasicPoint,
    options: PointGroupOptions,
  ): void {
    const ctx = this._ctx;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(startPoint.x, startPoint.y);
    ctx.lineTo(endPoint.x, endPoint.y);
    ctx.lineWidth =
      this._pressureWidth(this._getDotSize(options), endPoint, options) * 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = options.penColor;
    ctx.stroke();
    ctx.restore();

    this._isEmpty = false;
  }

  private _fromData(
    pointGroups: PointGroup[],
    drawCurve: SignaturePad['_drawCurve'],
    drawDot: SignaturePad['_drawDot'],
    drawLine: SignaturePad['_drawLine'],
  ): void {
    for (const group of pointGroups) {
      const { points } = group;
      if (!points.length) continue;
      const pointGroupOptions = this._getPointGroupOptions(group);

      if (points.length > 2) {
        for (let j = 0; j < points.length; j += 1) {
          const basicPoint = points[j];
          const point = new Point(
            basicPoint.x,
            basicPoint.y,
            basicPoint.pressure,
            basicPoint.time,
            basicPoint.pressureSupported,
          );

          if (j === 0) {
            this._reset(pointGroupOptions);
            if (group.complete || group.pressureWeight)
              drawDot(point, pointGroupOptions);
          }

          const curve = this._addPoint(point, pointGroupOptions);

          if (curve) {
            drawCurve(curve, pointGroupOptions);
          }
        }
        if (group.complete) this._finishCurve(group, drawCurve, drawLine);
      } else if (points.length === 2) {
        this._reset(pointGroupOptions);

        if (group.complete || group.pressureWeight)
          drawDot(points[0], pointGroupOptions);
        drawLine(points[0], points[1], pointGroupOptions);
      } else {
        this._reset(pointGroupOptions);

        drawDot(points[0], pointGroupOptions);
      }
    }
  }

  public toSVG({
    includeBackgroundColor = false,
    includeDataUrl = false,
  }: ToSVGOptions = {}): string {
    const state = [
      this._lastPoints,
      this._lastVelocity,
      this._lastWidth,
      this._isEmpty,
    ] as const;
    const pointGroups = this._data;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const minX = 0;
    const minY = 0;
    const maxX = this.canvas.width / ratio;
    const maxY = this.canvas.height / ratio;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    svg.setAttribute('viewBox', `${minX} ${minY} ${maxX} ${maxY}`);
    svg.setAttribute('width', maxX.toString());
    svg.setAttribute('height', maxY.toString());

    if (includeBackgroundColor && this.backgroundColor) {
      const rect = document.createElement('rect');
      rect.setAttribute('width', '100%');
      rect.setAttribute('height', '100%');
      rect.setAttribute('fill', this.backgroundColor);

      svg.appendChild(rect);
    }

    if (includeDataUrl && this._dataUrl) {
      const ratio = this._dataUrlOptions?.ratio || window.devicePixelRatio || 1;
      const width = this._dataUrlOptions?.width || this.canvas.width / ratio;
      const height = this._dataUrlOptions?.height || this.canvas.height / ratio;
      const xOffset = this._dataUrlOptions?.xOffset || 0;
      const yOffset = this._dataUrlOptions?.yOffset || 0;

      const image = document.createElement('image');
      image.setAttribute('x', xOffset.toString());
      image.setAttribute('y', yOffset.toString());
      image.setAttribute('width', width.toString());
      image.setAttribute('height', height.toString());
      image.setAttribute('preserveAspectRatio', 'none');
      image.setAttribute('href', this._dataUrl);

      svg.appendChild(image);
    }

    this._fromData(
      pointGroups,

      (curve, { penColor }) => {
        const path = document.createElement('path');

        // Need to check curve for NaN values, these pop up when drawing
        // lines on the canvas that are not continuous. E.g. Sharp corners
        // or stopping mid-stroke and than continuing without lifting mouse.
        if (
          !isNaN(curve.control1.x) &&
          !isNaN(curve.control1.y) &&
          !isNaN(curve.control2.x) &&
          !isNaN(curve.control2.y)
        ) {
          const attr =
            `M ${curve.startPoint.x.toFixed(3)},${curve.startPoint.y.toFixed(
              3,
            )} ` +
            `C ${curve.control1.x.toFixed(3)},${curve.control1.y.toFixed(3)} ` +
            `${curve.control2.x.toFixed(3)},${curve.control2.y.toFixed(3)} ` +
            `${curve.endPoint.x.toFixed(3)},${curve.endPoint.y.toFixed(3)}`;
          path.setAttribute('d', attr);
          path.setAttribute('stroke-width', (curve.endWidth * 2.25).toFixed(3));
          path.setAttribute('stroke', penColor);
          path.setAttribute('fill', 'none');
          path.setAttribute('stroke-linecap', 'round');

          svg.appendChild(path);
        }
      },

      (point, options) => {
        const { penColor, dotSize, minWidth, maxWidth } = options;
        const circle = document.createElement('circle');
        const size =
          dotSize > 0
            ? dotSize
            : this._pressureWidth((minWidth + maxWidth) / 2, point, options);
        circle.setAttribute('r', size.toString());
        circle.setAttribute('cx', point.x.toString());
        circle.setAttribute('cy', point.y.toString());
        circle.setAttribute('fill', penColor);

        svg.appendChild(circle);
      },

      (startPoint, endPoint, options) => {
        const line = document.createElement('line');

        line.setAttribute('x1', startPoint.x.toString());
        line.setAttribute('y1', startPoint.y.toString());
        line.setAttribute('x2', endPoint.x.toString());
        line.setAttribute('y2', endPoint.y.toString());
        line.setAttribute('stroke', options.penColor);
        line.setAttribute(
          'stroke-width',
          (
            this._pressureWidth(this._getDotSize(options), endPoint, options) *
            2
          ).toString(),
        );
        line.setAttribute('stroke-linecap', 'round');

        svg.appendChild(line);
      },
    );

    [this._lastPoints, this._lastVelocity, this._lastWidth, this._isEmpty] =
      state;
    return svg.outerHTML;
  }
}
