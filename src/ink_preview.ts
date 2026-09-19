import { BasicPoint } from './point.js';

/** Disposable visual ink. This canvas is never read by data/image exports. */
export class InkPreview {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private timer?: ReturnType<typeof setTimeout>;
  private active = false;
  private hide = (): void => {
    this.active = false;
    this.clear();
  };

  constructor(private source: HTMLCanvasElement) {
    this.canvas = source.ownerDocument.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.style.cssText =
      'position:fixed;pointer-events:none;z-index:2147483647;';
    this.ctx = this.canvas.getContext('2d')!;
  }

  public begin(context: CanvasRenderingContext2D): void {
    if (
      typeof context.getTransform !== 'function' ||
      typeof this.ctx.setTransform !== 'function'
    )
      return;
    this.active = true;
    const rect = this.source.getBoundingClientRect();
    this.canvas.width = this.source.width;
    this.canvas.height = this.source.height;
    Object.assign(this.canvas.style, {
      left: `${rect.left + this.source.clientLeft}px`,
      top: `${rect.top + this.source.clientTop}px`,
      width: `${this.source.clientWidth || rect.width}px`,
      height: `${this.source.clientHeight || rect.height}px`,
    });
    this.ctx.setTransform(context.getTransform());
    this.source.ownerDocument.body.appendChild(this.canvas);
    this.source.ownerDocument.addEventListener('scroll', this.hide, true);
    this.source.ownerDocument.defaultView?.addEventListener(
      'resize',
      this.hide,
    );
  }

  public clear(): void {
    clearTimeout(this.timer);
    this.ctx.save();
    this.ctx.resetTransform();
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();
  }

  public remove(): void {
    this.clear();
    this.canvas.remove();
    this.source.ownerDocument.removeEventListener('scroll', this.hide, true);
    this.source.ownerDocument.defaultView?.removeEventListener(
      'resize',
      this.hide,
    );
  }

  public draw(
    start: BasicPoint,
    last: BasicPoint,
    predicted: PointerEvent[],
    time: number,
    radius: number,
    color: string,
    rect: DOMRect,
  ): void {
    if (!this.active) return;
    this.clear();
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(last.x, last.y);
    for (const point of predicted) {
      if (
        point.timeStamp > time &&
        point.timeStamp <= time + 32 &&
        Number.isFinite(point.clientX) &&
        Number.isFinite(point.clientY)
      ) {
        ctx.lineTo(point.clientX - rect.left, point.clientY - rect.top);
      }
    }
    ctx.lineWidth = radius * 2;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    ctx.stroke();
    if (predicted.length) {
      // Do not leave a future tail visible when the pointer stops moving.
      this.timer = setTimeout(
        () => this.draw(start, last, [], time, radius, color, rect),
        40,
      );
    }
  }
}
