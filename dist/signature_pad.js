/*!
 * Signature Pad v5.1.4-pressure.3 | https://github.com/aniolpages/signature_pad-pressure
 * (c) 2026 Szymon Nowak | Released under the MIT license
 */


// src/point.ts
var Point = class {
  constructor(x, y, pressure, time, pressureSupported) {
    this.pressureSupported = pressureSupported;
    if (isNaN(x) || isNaN(y)) {
      throw new Error(`Point is invalid: (${x}, ${y})`);
    }
    this.x = +x;
    this.y = +y;
    this.pressure = pressure || 0;
    this.time = time || Date.now();
  }
  pressureSupported;
  x;
  y;
  pressure;
  time;
  distanceTo(start) {
    return Math.sqrt(
      Math.pow(this.x - start.x, 2) + Math.pow(this.y - start.y, 2)
    );
  }
  equals(other) {
    return this.x === other.x && this.y === other.y && this.pressure === other.pressure && this.time === other.time;
  }
  velocityFrom(start) {
    return this.time !== start.time ? this.distanceTo(start) / (this.time - start.time) : 0;
  }
};

// src/bezier.ts
var Bezier = class _Bezier {
  constructor(startPoint, control2, control1, endPoint, startWidth, endWidth) {
    this.startPoint = startPoint;
    this.control2 = control2;
    this.control1 = control1;
    this.endPoint = endPoint;
    this.startWidth = startWidth;
    this.endWidth = endWidth;
  }
  startPoint;
  control2;
  control1;
  endPoint;
  startWidth;
  endWidth;
  static fromPoints(points, widths) {
    const c2 = this.calculateControlPoints(points[0], points[1], points[2]).c2;
    const c3 = this.calculateControlPoints(points[1], points[2], points[3]).c1;
    return new _Bezier(points[1], c2, c3, points[2], widths.start, widths.end);
  }
  static calculateControlPoints(s1, s2, s3) {
    const dx1 = s1.x - s2.x;
    const dy1 = s1.y - s2.y;
    const dx2 = s2.x - s3.x;
    const dy2 = s2.y - s3.y;
    const m1 = { x: (s1.x + s2.x) / 2, y: (s1.y + s2.y) / 2 };
    const m2 = { x: (s2.x + s3.x) / 2, y: (s2.y + s3.y) / 2 };
    const l1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
    const l2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
    const dxm = m1.x - m2.x;
    const dym = m1.y - m2.y;
    const k = l1 + l2 == 0 ? 0 : l2 / (l1 + l2);
    const cm = { x: m2.x + dxm * k, y: m2.y + dym * k };
    const tx = s2.x - cm.x;
    const ty = s2.y - cm.y;
    return {
      c1: new Point(m1.x + tx, m1.y + ty),
      c2: new Point(m2.x + tx, m2.y + ty)
    };
  }
  // Returns approximated length. Code taken from https://www.lemoda.net/maths/bezier-length/index.html.
  length() {
    const steps = 10;
    let length = 0;
    let px;
    let py;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const cx = this.point(
        t,
        this.startPoint.x,
        this.control1.x,
        this.control2.x,
        this.endPoint.x
      );
      const cy = this.point(
        t,
        this.startPoint.y,
        this.control1.y,
        this.control2.y,
        this.endPoint.y
      );
      if (i > 0) {
        const xdiff = cx - px;
        const ydiff = cy - py;
        length += Math.sqrt(xdiff * xdiff + ydiff * ydiff);
      }
      px = cx;
      py = cy;
    }
    return length;
  }
  // Calculate parametric value of x or y given t and the four point coordinates of a cubic bezier curve.
  point(t, start, c1, c2, end) {
    return start * (1 - t) * (1 - t) * (1 - t) + 3 * c1 * (1 - t) * (1 - t) * t + 3 * c2 * (1 - t) * t * t + end * t * t * t;
  }
};

// src/signature_event_target.ts
var SignatureEventTarget = class {
  /* tslint:disable: variable-name */
  _et;
  /* tslint:enable: variable-name */
  constructor() {
    try {
      this._et = new EventTarget();
    } catch {
      this._et = document;
    }
  }
  addEventListener(type, listener, options) {
    this._et.addEventListener(type, listener, options);
  }
  dispatchEvent(event) {
    return this._et.dispatchEvent(event);
  }
  removeEventListener(type, callback, options) {
    this._et.removeEventListener(type, callback, options);
  }
};

// src/throttle.ts
function throttle(fn, wait = 250) {
  let previous = 0;
  let timeout = null;
  let result;
  let storedContext;
  let storedArgs;
  const later = () => {
    previous = Date.now();
    timeout = null;
    result = fn.apply(storedContext, storedArgs);
    if (!timeout) {
      storedContext = null;
      storedArgs = [];
    }
  };
  return function wrapper(...args) {
    const now = Date.now();
    const remaining = wait - (now - previous);
    storedContext = this;
    storedArgs = args;
    if (remaining <= 0 || remaining > wait) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      previous = now;
      result = fn.apply(storedContext, storedArgs);
      if (!timeout) {
        storedContext = null;
        storedArgs = [];
      }
    } else if (!timeout) {
      timeout = window.setTimeout(later, remaining);
    }
    return result;
  };
}

// src/ink_preview.ts
var InkPreview = class {
  constructor(source) {
    this.source = source;
    this.canvas = source.ownerDocument.createElement("canvas");
    this.canvas.setAttribute("aria-hidden", "true");
    this.canvas.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;";
    this.ctx = this.canvas.getContext("2d");
  }
  source;
  canvas;
  ctx;
  timer;
  active = false;
  hide = () => {
    this.active = false;
    this.clear();
  };
  begin(context) {
    if (typeof context.getTransform !== "function" || typeof this.ctx.setTransform !== "function")
      return;
    this.active = true;
    const rect = this.source.getBoundingClientRect();
    this.canvas.width = this.source.width;
    this.canvas.height = this.source.height;
    Object.assign(this.canvas.style, {
      left: `${rect.left + this.source.clientLeft}px`,
      top: `${rect.top + this.source.clientTop}px`,
      width: `${this.source.clientWidth || rect.width}px`,
      height: `${this.source.clientHeight || rect.height}px`
    });
    this.ctx.setTransform(context.getTransform());
    this.source.ownerDocument.body.appendChild(this.canvas);
    this.source.ownerDocument.addEventListener("scroll", this.hide, true);
    this.source.ownerDocument.defaultView?.addEventListener(
      "resize",
      this.hide
    );
  }
  clear() {
    clearTimeout(this.timer);
    this.ctx.save();
    this.ctx.resetTransform();
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();
  }
  remove() {
    this.clear();
    this.canvas.remove();
    this.source.ownerDocument.removeEventListener("scroll", this.hide, true);
    this.source.ownerDocument.defaultView?.removeEventListener(
      "resize",
      this.hide
    );
  }
  draw(start, last, predicted, time, radius, color, rect) {
    if (!this.active) return;
    this.clear();
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(last.x, last.y);
    for (const point of predicted) {
      if (point.timeStamp > time && point.timeStamp <= time + 32 && Number.isFinite(point.clientX) && Number.isFinite(point.clientY)) {
        ctx.lineTo(point.clientX - rect.left, point.clientY - rect.top);
      }
    }
    ctx.lineWidth = radius * 2;
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.strokeStyle = color;
    ctx.stroke();
    if (predicted.length) {
      this.timer = setTimeout(
        () => this.draw(start, last, [], time, radius, color, rect),
        40
      );
    }
  }
};

// src/signature_pad.ts
var SignaturePad = class _SignaturePad extends SignatureEventTarget {
  /* tslint:enable: variable-name */
  constructor(canvas, options = {}) {
    super();
    this.canvas = canvas;
    this.pressureWeight = Number.isFinite(options.pressureWeight) ? Math.max(0, Math.min(1, options.pressureWeight)) : 0;
    this.pressureGamma = Number.isFinite(options.pressureGamma) && options.pressureGamma > 0 ? options.pressureGamma : 1;
    this.lowLatency = options.lowLatency ?? false;
    this.velocityFilterWeight = options.velocityFilterWeight || 0.7;
    this.minWidth = options.minWidth || 0.5;
    this.maxWidth = options.maxWidth || 2.5;
    this.throttle = this.lowLatency ? 0 : options.throttle ?? 16;
    this.minDistance = options.minDistance ?? (this.lowLatency ? 0 : 5);
    this.dotSize = options.dotSize || 0;
    this.penColor = options.penColor || "black";
    this.backgroundColor = options.backgroundColor || "rgba(0,0,0,0)";
    this.compositeOperation = options.compositeOperation || "source-over";
    this.canvasContextOptions = options.canvasContextOptions ?? {};
    this._strokeMoveUpdate = this.throttle ? throttle(_SignaturePad.prototype._strokeUpdate, this.throttle) : _SignaturePad.prototype._strokeUpdate;
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
      "2d",
      this.canvasContextOptions
    );
    this.clear();
    this.on();
  }
  canvas;
  // Public stuff
  pressureWeight;
  pressureGamma;
  lowLatency;
  dotSize;
  minWidth;
  maxWidth;
  penColor;
  minDistance;
  velocityFilterWeight;
  compositeOperation;
  backgroundColor;
  throttle;
  canvasContextOptions;
  // Private stuff
  /* tslint:disable: variable-name */
  _preview;
  _sampleRect;
  _pressureObserved = false;
  _ctx;
  _drawingStroke = false;
  _isEmpty = true;
  _dataUrl;
  _dataUrlOptions;
  _lastPoints = [];
  // Stores up to 4 most recent points; used to generate a new curve
  _data = [];
  // Stores all points in groups (one group per line or dot)
  _lastVelocity = 0;
  _lastWidth = 0;
  _strokeMoveUpdate;
  _strokePointerId;
  clear() {
    this._preview?.remove();
    this._preview = void 0;
    if (this.lowLatency) {
      this._drawingStroke = false;
      this._removeMoveUpEventListeners();
    }
    const { _ctx: ctx, canvas } = this;
    ctx.fillStyle = this.backgroundColor;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this._data = [];
    this._reset(this._getPointGroupOptions());
    this._isEmpty = true;
    this._dataUrl = void 0;
    this._dataUrlOptions = void 0;
    this._strokePointerId = void 0;
  }
  redraw() {
    const data = this._data;
    const dataUrl = this._dataUrl;
    const dataUrlOptions = this._dataUrlOptions;
    this.clear();
    if (dataUrl) {
      this.fromDataURL(dataUrl, dataUrlOptions);
    }
    this.fromData(data, { clear: false });
  }
  fromDataURL(dataUrl, options = {}) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const ratio = options.ratio || window.devicePixelRatio || 1;
      const width = options.width || this.canvas.width / ratio;
      const height = options.height || this.canvas.height / ratio;
      const xOffset = options.xOffset || 0;
      const yOffset = options.yOffset || 0;
      this._reset(this._getPointGroupOptions());
      image.onload = () => {
        this._ctx.drawImage(image, xOffset, yOffset, width, height);
        resolve();
      };
      image.onerror = (error) => {
        reject(error);
      };
      image.crossOrigin = "anonymous";
      image.src = dataUrl;
      this._isEmpty = false;
      this._dataUrl = dataUrl;
      this._dataUrlOptions = { ...options };
    });
  }
  toDataURL(type = "image/png", encoderOptions) {
    switch (type) {
      case "image/svg+xml":
        if (typeof encoderOptions !== "object") {
          encoderOptions = void 0;
        }
        return `data:image/svg+xml;base64,${btoa(
          this.toSVG(encoderOptions)
        )}`;
      default:
        if (typeof encoderOptions !== "number") {
          encoderOptions = void 0;
        }
        return this.canvas.toDataURL(type, encoderOptions);
    }
  }
  on() {
    this.canvas.style.touchAction = "none";
    this.canvas.style.msTouchAction = "none";
    this.canvas.style.userSelect = "none";
    this.canvas.style.webkitUserSelect = "none";
    const isIOS = /Macintosh/.test(navigator.userAgent) && "ontouchstart" in document;
    if (window.PointerEvent && (!isIOS || this.lowLatency)) {
      this._handlePointerEvents();
    } else {
      this._handleMouseEvents();
      if ("ontouchstart" in window) {
        this._handleTouchEvents();
      }
    }
  }
  off() {
    if (this.lowLatency) this._drawingStroke = false;
    this._preview?.remove();
    this._preview = void 0;
    this.canvas.style.touchAction = "auto";
    this.canvas.style.msTouchAction = "auto";
    this.canvas.style.userSelect = "auto";
    this.canvas.style.webkitUserSelect = "auto";
    this.canvas.removeEventListener("pointerdown", this._handlePointerDown);
    this.canvas.removeEventListener("mousedown", this._handleMouseDown);
    this.canvas.removeEventListener("touchstart", this._handleTouchStart);
    this._removeMoveUpEventListeners();
  }
  _getListenerFunctions() {
    const canvasWindow = window.document === this.canvas.ownerDocument ? window : this.canvas.ownerDocument.defaultView ?? this.canvas.ownerDocument;
    return {
      addEventListener: canvasWindow.addEventListener.bind(
        canvasWindow
      ),
      removeEventListener: canvasWindow.removeEventListener.bind(
        canvasWindow
      )
    };
  }
  _removeMoveUpEventListeners() {
    const { removeEventListener } = this._getListenerFunctions();
    removeEventListener("pointermove", this._handlePointerMove);
    removeEventListener("pointerup", this._handlePointerUp);
    removeEventListener("pointercancel", this._handlePointerCancel);
    removeEventListener("mousemove", this._handleMouseMove);
    removeEventListener("mouseup", this._handleMouseUp);
    removeEventListener("touchmove", this._handleTouchMove);
    removeEventListener("touchend", this._handleTouchEnd);
    removeEventListener("touchcancel", this._handleTouchCancel);
  }
  isEmpty() {
    return this._isEmpty;
  }
  fromData(pointGroups, { clear = true } = {}) {
    if (clear) {
      this.clear();
    }
    this._fromData(
      pointGroups,
      this._drawCurve.bind(this),
      this._drawDot.bind(this),
      this._drawLine.bind(this)
    );
    this._data = this._data.concat(pointGroups);
  }
  toData() {
    return this._data;
  }
  _isLeftButtonPressed(event, only) {
    if (only) {
      return event.buttons === 1;
    }
    return (event.buttons & 1) === 1;
  }
  _pointerEventToSignatureEvent(event) {
    return {
      event,
      type: event.type,
      x: event.clientX,
      y: event.clientY,
      pressure: "pressure" in event ? event.pressure : 0
    };
  }
  _touchEventToSignatureEvent(event) {
    const touch = event.changedTouches[0];
    return {
      event,
      type: event.type,
      x: touch.clientX,
      y: touch.clientY,
      pressure: touch.force
    };
  }
  // Event handlers
  _handleMouseDown(event) {
    if (!this._isLeftButtonPressed(event, true) || this._drawingStroke) {
      return;
    }
    this._strokeBegin(this._pointerEventToSignatureEvent(event));
  }
  _handleMouseMove(event) {
    if (!this._isLeftButtonPressed(event, true) || !this._drawingStroke) {
      this._strokeEnd(this._pointerEventToSignatureEvent(event), false);
      return;
    }
    this._strokeMoveUpdate(this._pointerEventToSignatureEvent(event));
  }
  _handleMouseUp(event) {
    if (this._isLeftButtonPressed(event)) {
      return;
    }
    this._strokeEnd(this._pointerEventToSignatureEvent(event));
  }
  _handleTouchStart(event) {
    if (event.targetTouches.length !== 1 || this._drawingStroke) {
      return;
    }
    if (event.cancelable) {
      event.preventDefault();
    }
    this._strokeBegin(this._touchEventToSignatureEvent(event));
  }
  _handleTouchMove(event) {
    if (event.targetTouches.length !== 1) {
      return;
    }
    if (event.cancelable) {
      event.preventDefault();
    }
    if (!this._drawingStroke) {
      this._strokeEnd(this._touchEventToSignatureEvent(event), false);
      return;
    }
    this._strokeMoveUpdate(this._touchEventToSignatureEvent(event));
  }
  _handleTouchEnd(event) {
    if (event.targetTouches.length !== 0) {
      return;
    }
    if (event.cancelable) {
      event.preventDefault();
    }
    this._strokeEnd(this._touchEventToSignatureEvent(event));
  }
  _handlePointerCancel(event) {
    if (!this._allowPointerId(event)) {
      return;
    }
    event.preventDefault();
    this._strokeEnd(this._pointerEventToSignatureEvent(event), false);
  }
  _handleTouchCancel(event) {
    if (event.cancelable) {
      event.preventDefault();
    }
    this._strokeEnd(this._touchEventToSignatureEvent(event), false);
  }
  _getPointerId(event) {
    return event.persistentDeviceId || event.pointerId;
  }
  _allowPointerId(event, allowUndefined = false) {
    if (typeof this._strokePointerId === "undefined") {
      return allowUndefined;
    }
    return this._getPointerId(event) === this._strokePointerId;
  }
  _handlePointerDown(event) {
    if (this._drawingStroke || !this._isLeftButtonPressed(event) || !this._allowPointerId(event, true)) {
      return;
    }
    this._strokePointerId = this._getPointerId(event);
    event.preventDefault();
    this._strokeBegin(this._pointerEventToSignatureEvent(event));
  }
  _handlePointerMove(event) {
    if (!this._allowPointerId(event)) {
      return;
    }
    if (!this._isLeftButtonPressed(event, true) || !this._drawingStroke) {
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
      for (const sample of samples?.length ? samples : [event]) {
        if (Number.isFinite(sample.clientX) && Number.isFinite(sample.clientY) && Number.isFinite(sample.timeStamp)) {
          this._strokeUpdate(this._pointerEventToSignatureEvent(sample));
        }
      }
      this._drawPreview(event.getPredictedEvents?.() ?? [], event.timeStamp);
    } finally {
      this._sampleRect = void 0;
    }
  }
  _handlePointerUp(event) {
    if (this._isLeftButtonPressed(event) || !this._allowPointerId(event)) {
      return;
    }
    event.preventDefault();
    this._strokeEnd(this._pointerEventToSignatureEvent(event));
  }
  _getPointGroupOptions(group) {
    return {
      ...(group ? group.pressureWeight : this.pressureWeight) ? {
        pressureWeight: group ? group.pressureWeight : this.pressureWeight,
        pressureGamma: group ? group.pressureGamma ?? 1 : this.pressureGamma
      } : {},
      penColor: group && "penColor" in group ? group.penColor : this.penColor,
      dotSize: group && "dotSize" in group ? group.dotSize : this.dotSize,
      minWidth: group && "minWidth" in group ? group.minWidth : this.minWidth,
      maxWidth: group && "maxWidth" in group ? group.maxWidth : this.maxWidth,
      velocityFilterWeight: group && "velocityFilterWeight" in group ? group.velocityFilterWeight : this.velocityFilterWeight,
      compositeOperation: group && "compositeOperation" in group ? group.compositeOperation : this.compositeOperation
    };
  }
  // Private methods
  _strokeBegin(event) {
    const cancelled = !this.dispatchEvent(
      new CustomEvent("beginStroke", { detail: event, cancelable: true })
    );
    if (cancelled) {
      return;
    }
    const { addEventListener } = this._getListenerFunctions();
    switch (event.event.type) {
      case "mousedown":
        addEventListener("mousemove", this._handleMouseMove, {
          passive: false
        });
        addEventListener("mouseup", this._handleMouseUp, { passive: false });
        break;
      case "touchstart":
        addEventListener("touchmove", this._handleTouchMove, {
          passive: false
        });
        addEventListener("touchend", this._handleTouchEnd, { passive: false });
        addEventListener("touchcancel", this._handleTouchCancel, {
          passive: false
        });
        break;
      case "pointerdown":
        addEventListener("pointermove", this._handlePointerMove, {
          passive: false
        });
        addEventListener("pointerup", this._handlePointerUp, {
          passive: false
        });
        addEventListener("pointercancel", this._handlePointerCancel, {
          passive: false
        });
        break;
      default:
    }
    this._drawingStroke = true;
    this._pressureObserved = false;
    const pointGroupOptions = this._getPointGroupOptions();
    const newPointGroup = {
      ...pointGroupOptions,
      points: []
    };
    this._data.push(newPointGroup);
    this._reset(pointGroupOptions);
    if (this.lowLatency && this.compositeOperation === "source-over") {
      this._preview ??= new InkPreview(this.canvas);
      this._preview.begin(this._ctx);
    }
    this._strokeUpdate(event);
  }
  _strokeUpdate(event) {
    if (!this._drawingStroke) {
      return;
    }
    if (this._data.length === 0) {
      this._strokeBegin(event);
      return;
    }
    this.dispatchEvent(
      new CustomEvent("beforeUpdateStroke", { detail: event })
    );
    const point = this._createPoint(
      event.x,
      event.y,
      event.pressure,
      this.lowLatency ? performance.timeOrigin + event.event.timeStamp : void 0
    );
    if (this.pressureWeight > 0) {
      const source = event.event;
      const stylus = "pointerType" in source ? source.pointerType === "pen" : "changedTouches" in source && source.changedTouches[0].touchType === "stylus";
      this._pressureObserved ||= !!stylus && Number.isFinite(point.pressure) && point.pressure > 0 && point.pressure !== 0.5;
      point.pressureSupported = this._pressureObserved;
    }
    const lastPointGroup = this._data[this._data.length - 1];
    const lastPoints = lastPointGroup.points;
    const lastPoint = lastPoints.length > 0 && lastPoints[lastPoints.length - 1];
    const isLastPointTooClose = lastPoint ? point.distanceTo(lastPoint) <= this.minDistance : false;
    const pointGroupOptions = this._getPointGroupOptions(lastPointGroup);
    const stale = this.lowLatency && lastPoint && point.time < lastPoint.time;
    const duplicate = lastPoint && point.equals(lastPoint);
    if (!lastPoint || !stale && !duplicate && (this.lowLatency && this.minDistance === 0 || !isLastPointTooClose)) {
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
        ...point.pressureSupported !== void 0 ? { pressureSupported: point.pressureSupported } : {}
      });
    }
    if (this.lowLatency && !this._sampleRect)
      this._drawPreview([], event.event.timeStamp);
    this.dispatchEvent(new CustomEvent("afterUpdateStroke", { detail: event }));
  }
  _strokeEnd(event, shouldUpdate = true) {
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
          this._drawLine.bind(this)
        );
      }
      this._preview?.remove();
      this._preview = void 0;
    }
    this._drawingStroke = false;
    this._strokePointerId = void 0;
    this.dispatchEvent(new CustomEvent("endStroke", { detail: event }));
  }
  _drawPreview(predicted, time) {
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
      this._sampleRect ?? this.canvas.getBoundingClientRect()
    );
  }
  _finishCurve(group, drawCurve, drawLine) {
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
          last.pressureSupported
        ),
        options
      );
      if (curve) drawCurve(curve, options);
    }
  }
  _handlePointerEvents() {
    this._drawingStroke = false;
    this.canvas.addEventListener("pointerdown", this._handlePointerDown, {
      passive: false
    });
  }
  _handleMouseEvents() {
    this._drawingStroke = false;
    this.canvas.addEventListener("mousedown", this._handleMouseDown, {
      passive: false
    });
  }
  _handleTouchEvents() {
    this.canvas.addEventListener("touchstart", this._handleTouchStart, {
      passive: false
    });
  }
  // Called when a new line is started
  _reset(options) {
    this._lastPoints = [];
    this._lastVelocity = 0;
    this._lastWidth = (options.minWidth + options.maxWidth) / 2;
    this._ctx.fillStyle = options.penColor;
    this._ctx.globalCompositeOperation = options.compositeOperation;
  }
  _createPoint(x, y, pressure, time) {
    const rect = this._sampleRect ?? this.canvas.getBoundingClientRect();
    return new Point(
      x - rect.left,
      y - rect.top,
      pressure,
      time ?? (/* @__PURE__ */ new Date()).getTime()
    );
  }
  // Add point to _lastPoints array and generate a new curve if there are enough points (i.e. 3)
  _addPoint(point, options) {
    const { _lastPoints } = this;
    if (!_lastPoints.length) {
      this._lastWidth = this._pressureWidth(this._lastWidth, point, options);
    }
    _lastPoints.push(point);
    if (_lastPoints.length > 2) {
      if (_lastPoints.length === 3) {
        _lastPoints.unshift(_lastPoints[0]);
      }
      const widths = this._calculateCurveWidths(
        _lastPoints[1],
        _lastPoints[2],
        options
      );
      const curve = Bezier.fromPoints(_lastPoints, widths);
      _lastPoints.shift();
      return curve;
    }
    return null;
  }
  _calculateCurveWidths(startPoint, endPoint, options) {
    const velocity = options.velocityFilterWeight * endPoint.velocityFrom(startPoint) + (1 - options.velocityFilterWeight) * this._lastVelocity;
    const newWidth = this._pressureWidth(
      this._strokeWidth(velocity, options),
      endPoint,
      options
    );
    const widths = {
      end: newWidth,
      start: this._lastWidth
    };
    this._lastVelocity = velocity;
    this._lastWidth = newWidth;
    return widths;
  }
  _strokeWidth(velocity, options) {
    return Math.max(options.maxWidth / (velocity + 1), options.minWidth);
  }
  _pressureWidth(velocityWidth, point, options) {
    const weight = Number.isFinite(options.pressureWeight) ? Math.max(0, Math.min(1, options.pressureWeight)) : 0;
    if (!weight || point.pressureSupported === false || !Number.isFinite(point.pressure)) {
      return velocityWidth;
    }
    const gamma = Number.isFinite(options.pressureGamma) && options.pressureGamma > 0 ? options.pressureGamma : 1;
    const pressure = Math.pow(Math.max(0, Math.min(1, point.pressure)), gamma);
    const width = options.minWidth + pressure * (options.maxWidth - options.minWidth);
    return Math.max(
      options.minWidth,
      Math.min(options.maxWidth, velocityWidth * (1 - weight) + width * weight)
    );
  }
  _drawCurveSegment(x, y, width) {
    const ctx = this._ctx;
    ctx.moveTo(x, y);
    ctx.arc(x, y, width, 0, 2 * Math.PI, false);
    this._isEmpty = false;
  }
  _drawCurve(curve, options) {
    const ctx = this._ctx;
    const widthDelta = curve.endWidth - curve.startWidth;
    const drawSteps = Math.ceil(curve.length()) * 2;
    ctx.beginPath();
    ctx.fillStyle = options.penColor;
    for (let i = 0; i < drawSteps; i += 1) {
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
        options.maxWidth
      );
      this._drawCurveSegment(x, y, width);
    }
    ctx.closePath();
    ctx.fill();
  }
  _getDotSize(options) {
    return options.dotSize > 0 ? options.dotSize : (options.minWidth + options.maxWidth) / 2;
  }
  _drawDot(point, options) {
    const ctx = this._ctx;
    const width = options.dotSize > 0 ? options.dotSize : this._pressureWidth(this._getDotSize(options), point, options);
    ctx.beginPath();
    this._drawCurveSegment(point.x, point.y, width);
    ctx.closePath();
    ctx.fillStyle = options.penColor;
    ctx.fill();
  }
  _drawLine(startPoint, endPoint, options) {
    const ctx = this._ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(startPoint.x, startPoint.y);
    ctx.lineTo(endPoint.x, endPoint.y);
    ctx.lineWidth = this._pressureWidth(this._getDotSize(options), endPoint, options) * 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = options.penColor;
    ctx.stroke();
    ctx.restore();
    this._isEmpty = false;
  }
  _fromData(pointGroups, drawCurve, drawDot, drawLine) {
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
            basicPoint.pressureSupported
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
  toSVG({
    includeBackgroundColor = false,
    includeDataUrl = false
  } = {}) {
    const state = [
      this._lastPoints,
      this._lastVelocity,
      this._lastWidth,
      this._isEmpty
    ];
    const pointGroups = this._data;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const minX = 0;
    const minY = 0;
    const maxX = this.canvas.width / ratio;
    const maxY = this.canvas.height / ratio;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    svg.setAttribute("viewBox", `${minX} ${minY} ${maxX} ${maxY}`);
    svg.setAttribute("width", maxX.toString());
    svg.setAttribute("height", maxY.toString());
    if (includeBackgroundColor && this.backgroundColor) {
      const rect = document.createElement("rect");
      rect.setAttribute("width", "100%");
      rect.setAttribute("height", "100%");
      rect.setAttribute("fill", this.backgroundColor);
      svg.appendChild(rect);
    }
    if (includeDataUrl && this._dataUrl) {
      const ratio2 = this._dataUrlOptions?.ratio || window.devicePixelRatio || 1;
      const width = this._dataUrlOptions?.width || this.canvas.width / ratio2;
      const height = this._dataUrlOptions?.height || this.canvas.height / ratio2;
      const xOffset = this._dataUrlOptions?.xOffset || 0;
      const yOffset = this._dataUrlOptions?.yOffset || 0;
      const image = document.createElement("image");
      image.setAttribute("x", xOffset.toString());
      image.setAttribute("y", yOffset.toString());
      image.setAttribute("width", width.toString());
      image.setAttribute("height", height.toString());
      image.setAttribute("preserveAspectRatio", "none");
      image.setAttribute("href", this._dataUrl);
      svg.appendChild(image);
    }
    this._fromData(
      pointGroups,
      (curve, { penColor }) => {
        const path = document.createElement("path");
        if (!isNaN(curve.control1.x) && !isNaN(curve.control1.y) && !isNaN(curve.control2.x) && !isNaN(curve.control2.y)) {
          const attr = `M ${curve.startPoint.x.toFixed(3)},${curve.startPoint.y.toFixed(
            3
          )} C ${curve.control1.x.toFixed(3)},${curve.control1.y.toFixed(3)} ${curve.control2.x.toFixed(3)},${curve.control2.y.toFixed(3)} ${curve.endPoint.x.toFixed(3)},${curve.endPoint.y.toFixed(3)}`;
          path.setAttribute("d", attr);
          path.setAttribute("stroke-width", (curve.endWidth * 2.25).toFixed(3));
          path.setAttribute("stroke", penColor);
          path.setAttribute("fill", "none");
          path.setAttribute("stroke-linecap", "round");
          svg.appendChild(path);
        }
      },
      (point, options) => {
        const { penColor, dotSize, minWidth, maxWidth } = options;
        const circle = document.createElement("circle");
        const size = dotSize > 0 ? dotSize : this._pressureWidth((minWidth + maxWidth) / 2, point, options);
        circle.setAttribute("r", size.toString());
        circle.setAttribute("cx", point.x.toString());
        circle.setAttribute("cy", point.y.toString());
        circle.setAttribute("fill", penColor);
        svg.appendChild(circle);
      },
      (startPoint, endPoint, options) => {
        const line = document.createElement("line");
        line.setAttribute("x1", startPoint.x.toString());
        line.setAttribute("y1", startPoint.y.toString());
        line.setAttribute("x2", endPoint.x.toString());
        line.setAttribute("y2", endPoint.y.toString());
        line.setAttribute("stroke", options.penColor);
        line.setAttribute(
          "stroke-width",
          (this._pressureWidth(this._getDotSize(options), endPoint, options) * 2).toString()
        );
        line.setAttribute("stroke-linecap", "round");
        svg.appendChild(line);
      }
    );
    [this._lastPoints, this._lastVelocity, this._lastWidth, this._isEmpty] = state;
    return svg.outerHTML;
  }
};
export {
  SignaturePad as default
};
//# sourceMappingURL=signature_pad.js.map
