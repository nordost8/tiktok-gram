/**
 * Translates pointer/touch events into high-level drag callbacks.
 * Pure DOM logic — no React, easily unit-testable.
 *
 * Axis-locking: after ~8px of movement, the dominant axis is locked for the
 * rest of the gesture. Vertical callbacks fire as before; horizontal callbacks
 * fire to the new onHorizontalDrag* set. Until the lock is established neither
 * set fires, so the consumer never sees a partial gesture.
 */
export class PointerGestureHandler {
  private startY = 0;
  private startX = 0;
  private lastY = 0;
  private lastX = 0;
  private lastT = 0;
  private velocity = 0;        // px/ms, vertical
  private velocityX = 0;       // px/ms, horizontal
  private active = false;
  private startScrollTop = 0;
  private _axis: null | "vertical" | "horizontal" = null;

  // ─── Vertical callbacks (unchanged interface) ──────────────────────────────
  onDragStart: ((y: number) => void) | null = null;
  onDragMove: ((deltaY: number) => void) | null = null;
  /** velocity in px/ms (positive = downward = going to prev) */
  onDragEnd: ((velocityPxPerMs: number, totalDeltaY: number) => void) | null = null;

  // ─── Horizontal callbacks (new) ────────────────────────────────────────────
  onHorizontalDragStart: ((x: number) => void) | null = null;
  onHorizontalDragMove: ((deltaX: number) => void) | null = null;
  /** velocityX in px/ms (positive = rightward) */
  onHorizontalDragEnd: ((velocityXPxPerMs: number, totalDeltaX: number) => void) | null = null;

  private static readonly AXIS_LOCK_THRESHOLD = 8; // px

  attach(el: HTMLElement): () => void {
    const onPointerDown = (e: PointerEvent) => {
      // Only single-touch or left-button
      if (e.pointerType === "mouse" && e.button !== 0) return;
      this.active = true;
      this.startY = e.clientY;
      this.startX = e.clientX;
      this.lastY = e.clientY;
      this.lastX = e.clientX;
      this.lastT = e.timeStamp;
      this.velocity = 0;
      this.velocityX = 0;
      this.startScrollTop = 0;
      this._axis = null;
      el.setPointerCapture(e.pointerId);
      // Don't fire onDragStart yet — wait for axis lock
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!this.active) return;
      const dt = e.timeStamp - this.lastT;

      if (this._axis === null) {
        // Try to establish axis lock
        const dx = e.clientX - this.startX;
        const dy = e.clientY - this.startY;
        const dist = Math.hypot(dx, dy);
        if (dist < PointerGestureHandler.AXIS_LOCK_THRESHOLD) return; // not enough movement yet

        // Lock axis by dominant direction
        if (Math.abs(dx) > Math.abs(dy)) {
          this._axis = "horizontal";
          this.onHorizontalDragStart?.(e.clientX);
        } else {
          this._axis = "vertical";
          this.onDragStart?.(e.clientY);
        }
        // Re-seed last positions from start to get clean first delta
        this.lastY = this.startY;
        this.lastX = this.startX;
        this.lastT = e.timeStamp - 1; // avoid dt=0
      }

      if (this._axis === "vertical") {
        const dy = e.clientY - this.lastY;
        if (dt > 0) this.velocity = dy / dt;
        this.lastY = e.clientY;
        this.lastT = e.timeStamp;
        this.onDragMove?.(e.clientY - this.startY);
      } else {
        const dx = e.clientX - this.lastX;
        if (dt > 0) this.velocityX = dx / dt;
        this.lastX = e.clientX;
        this.lastT = e.timeStamp;
        this.onHorizontalDragMove?.(e.clientX - this.startX);
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!this.active) return;
      this.active = false;

      if (this._axis === "vertical") {
        const totalDelta = e.clientY - this.startY;
        this.onDragEnd?.(this.velocity, totalDelta);
      } else if (this._axis === "horizontal") {
        const totalDeltaX = e.clientX - this.startX;
        this.onHorizontalDragEnd?.(this.velocityX, totalDeltaX);
      }
      // If axis was never locked (too short a gesture) — nothing to emit
      this._axis = null;
    };

    const onPointerCancel = () => {
      if (!this.active) return;
      this.active = false;
      if (this._axis === "vertical") {
        this.onDragEnd?.(0, 0);
      } else if (this._axis === "horizontal") {
        this.onHorizontalDragEnd?.(0, 0);
      }
      this._axis = null;
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerCancel);

    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerCancel);
    };
  }

  /**
   * For unit tests: simulate a complete drag gesture.
   * If axis is not supplied it is determined from the delta (|dx|>|dy| → horizontal).
   */
  simulateDrag(opts: {
    startY: number;
    endY: number;
    startX?: number;
    endX?: number;
    durationMs?: number;
    axis?: "vertical" | "horizontal";
  }): void {
    const {
      startY,
      endY,
      startX = 0,
      endX = 0,
      durationMs = 200,
    } = opts;

    const totalDX = endX - startX;
    const totalDY = endY - startY;

    // Determine axis from opts or dominant direction
    let axis: "vertical" | "horizontal";
    if (opts.axis) {
      axis = opts.axis;
    } else if (Math.abs(totalDX) > Math.abs(totalDY)) {
      axis = "horizontal";
    } else {
      axis = "vertical";
    }

    // Initialise internal state
    this.startY = startY;
    this.startX = startX;
    this.lastY = startY;
    this.lastX = startX;
    this.lastT = 0;
    this.velocity = 0;
    this.velocityX = 0;
    this.active = true;
    this._axis = axis;

    if (axis === "vertical") {
      this.onDragStart?.(startY);
    } else {
      this.onHorizontalDragStart?.(startX);
    }

    const steps = 5;
    for (let i = 1; i <= steps; i++) {
      const y = startY + (totalDY * i) / steps;
      const x = startX + (totalDX * i) / steps;
      const t = (durationMs * i) / steps;
      if (axis === "vertical") {
        const dy = y - this.lastY;
        const dt = t - this.lastT;
        if (dt > 0) this.velocity = dy / dt;
        this.lastY = y;
        this.lastT = t;
        this.onDragMove?.(y - startY);
      } else {
        const dx = x - this.lastX;
        const dt = t - this.lastT;
        if (dt > 0) this.velocityX = dx / dt;
        this.lastX = x;
        this.lastT = t;
        this.onHorizontalDragMove?.(x - startX);
      }
    }

    this.active = false;
    this._axis = null;

    if (axis === "vertical") {
      this.onDragEnd?.(this.velocity, totalDY);
    } else {
      this.onHorizontalDragEnd?.(this.velocityX, totalDX);
    }
  }
}
