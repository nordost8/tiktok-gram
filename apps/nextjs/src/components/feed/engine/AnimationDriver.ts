/** rAF-based animation driver. No CSS transitions — full JS control. */
export class AnimationDriver {
  private rafId: number | null = null;
  private startTime: number | null = null;
  private fromValue = 0;
  private toValue = 0;
  private duration = 0;
  private easingFn: (t: number) => number = AnimationDriver.easeOutCubic;
  private onFrame: ((v: number) => void) | null = null;
  private onComplete: (() => void) | null = null;

  static easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }

  static easeOutQuart(t: number): number {
    return 1 - Math.pow(1 - t, 4);
  }

  animate(opts: {
    from: number;
    to: number;
    duration: number;
    easing?: (t: number) => number;
    onFrame: (value: number) => void;
    onComplete: () => void;
  }): void {
    this.cancel();
    this.fromValue = opts.from;
    this.toValue = opts.to;
    this.duration = opts.duration;
    this.easingFn = opts.easing ?? AnimationDriver.easeOutCubic;
    this.onFrame = opts.onFrame;
    this.onComplete = opts.onComplete;
    this.startTime = null;

    const step = (ts: number) => {
      if (this.startTime === null) this.startTime = ts;
      const elapsed = ts - this.startTime;
      const raw = Math.min(elapsed / this.duration, 1);
      const eased = this.easingFn(raw);
      const value = this.fromValue + (this.toValue - this.fromValue) * eased;
      this.onFrame?.(value);
      if (raw < 1) {
        this.rafId = requestAnimationFrame(step);
      } else {
        this.rafId = null;
        this.startTime = null;
        this.onComplete?.();
      }
    };

    this.rafId = requestAnimationFrame(step);
  }

  cancel(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.startTime = null;
  }

  get isRunning(): boolean {
    return this.rafId !== null;
  }

  /**
   * For unit tests: run animation synchronously by stepping through frames.
   * Calls onFrame N times then onComplete.
   */
  runSync(opts: {
    from: number;
    to: number;
    duration: number;
    easing?: (t: number) => number;
    onFrame: (value: number) => void;
    onComplete: () => void;
    steps?: number;
  }): void {
    const { from, to, duration, easing = AnimationDriver.easeOutCubic, onFrame, onComplete, steps = 10 } = opts;
    for (let i = 1; i <= steps; i++) {
      const raw = i / steps;
      onFrame(from + (to - from) * easing(raw));
    }
    onComplete();
  }
}
