import type { FeedPost } from "../types";
import type { SwipeBlockReason } from "./FeedState";
import { AnimationDriver } from "./AnimationDriver";
import { PointerGestureHandler } from "./PointerGestureHandler";
import { PostRepository } from "./PostRepository";

export interface SlotInfo {
  /** Which absolute post-index lives in each slot. -1 = before start → renders null. */
  readonly absoluteIndices: readonly [number, number, number];
  /** Base Y offset for each slot in px. Add sharedOffset for final screen position. */
  readonly baseY: readonly [number, number, number];
  /** Which slot index (0|1|2) is the currently active post. */
  readonly activeSlot: 0 | 1 | 2;
  /** Always 0 after a commit; included so React can apply both atomically. */
  readonly sharedOffset: number;
}

/**
 * Pure-JS orchestrator for the virtual 3-slot feed carousel.
 *
 * Only 3 FeedCard DOM nodes exist at any time (prev/current/next).
 * Slots are recycled on each navigation commit — no DOM growth.
 *
 * React component responsibilities:
 *  - Apply onOffsetChange directly to DOM (bypass setState for 60fps)
 *  - Call setState only from onSlotsChange (low-frequency post rotation)
 *  - Call setState from onActiveIndexChange to track the viewed post
 */
/** Consumer that receives horizontal drag events for the active card (e.g. carousel). */
export interface HorizontalConsumer {
  onStart?: (x: number) => void;
  onMove?: (deltaX: number) => void;
  onEnd?: (deltaX: number, velocityX: number) => void;
}

export class FeedController {
  readonly repo = new PostRepository();
  readonly animation: AnimationDriver;
  readonly gesture = new PointerGestureHandler();

  private _slideHeight = 0;
  private _activeAbsoluteIndex = 0;
  private _activeSlot: 0 | 1 | 2 = 1;
  // Slot 0 = prev (empty initially), slot 1 = current, slot 2 = next
  private _absoluteIndices: [number, number, number] = [-1, 0, 1];
  // baseY[i] + sharedOffset = final translateY for slot i
  private _baseY: [number, number, number] = [0, 0, 0];
  private _sharedOffset = 0;
  // Captured at drag-start so an interrupted animation doesn't cause a visual jump
  private _dragBaseOffset = 0;

  private _detachGesture: (() => void) | null = null;

  /** Active-card horizontal consumer (e.g. FeedImageCarousel). */
  private _horizontalConsumer: HorizontalConsumer | null = null;

  /** High-frequency — fires every rAF frame during drag/animation. Apply directly to DOM. */
  onOffsetChange: ((sharedOffset: number) => void) | null = null;
  /** Low-frequency — fires when posts rotate between slots. Trigger React re-render. */
  onSlotsChange: ((info: SlotInfo) => void) | null = null;
  /** Fires when the active post changes (index + post data). */
  onActiveIndexChange: ((index: number, post: FeedPost | null) => void) | null = null;
  /** Delegate from PostRepository.onNearEnd. */
  onNearEnd: (() => void) | null = null;
  /** Fires when a swipe gesture is blocked. */
  onSwipeBlocked: ((reason: SwipeBlockReason) => void) | null = null;

  constructor(animation?: AnimationDriver) {
    this.animation = animation ?? new AnimationDriver();
    this.repo.onNearEnd = () => this.onNearEnd?.();
    this._wireGesture();
  }

  // ─── Gesture wiring ────────────────────────────────────────────────────────

  private _wireGesture(): void {
    this.gesture.onDragStart = () => {
      this.animation.cancel();
      // Capture current offset so the new drag continues from where the animation
      // left off rather than jumping back to 0.
      this._dragBaseOffset = this._sharedOffset;
    };

    this.gesture.onDragMove = (deltaY: number) => {
      let effectiveDelta = deltaY;
      if (deltaY > 0 && this._activeAbsoluteIndex <= 0) {
        effectiveDelta = deltaY * 0.15; // rubber-band at top
      }
      if (deltaY < 0 && this._activeAbsoluteIndex >= this.repo.totalLoaded - 1) {
        effectiveDelta = deltaY * 0.15; // rubber-band at bottom
      }
      this._setSharedOffset(this._dragBaseOffset + effectiveDelta);
    };

    this.gesture.onDragEnd = (velocity: number, totalDelta: number) => {
      this._decideSwipe(velocity, totalDelta);
    };

    // ── Horizontal routing ──
    this.gesture.onHorizontalDragStart = (x: number) => {
      // Cancel any running vertical animation so the feed doesn't shift
      this.animation.cancel();
      this._horizontalConsumer?.onStart?.(x);
    };

    this.gesture.onHorizontalDragMove = (deltaX: number) => {
      this._horizontalConsumer?.onMove?.(deltaX);
    };

    this.gesture.onHorizontalDragEnd = (velocityX: number, totalDeltaX: number) => {
      this._horizontalConsumer?.onEnd?.(totalDeltaX, velocityX);
      // Ensure feed stays at rest (no partial vertical offset)
      if (this._sharedOffset !== 0) {
        this._animateCancel();
      }
    };
  }

  // ─── Swipe decision & animation ────────────────────────────────────────────

  private _setSharedOffset(value: number): void {
    this._sharedOffset = value;
    this.onOffsetChange?.(value);
  }

  private _decideSwipe(velocity: number, totalDelta: number): void {
    const h = this._slideHeight;
    if (h === 0) {
      this.onSwipeBlocked?.("slide_height_zero");
      this._animateCancel();
      return;
    }

    const wantsForward = velocity < -0.3 || totalDelta < -h * 0.4;
    const wantsBackward = velocity > 0.3 || totalDelta > h * 0.4;

    if (wantsForward) {
      if (this._activeAbsoluteIndex >= this.repo.totalLoaded - 1) {
        const reason: SwipeBlockReason =
          this.repo.status === "fetching" ? "fetching_next_page" : "all_viewed";
        this.onSwipeBlocked?.(reason);
        this._animateCancel();
      } else {
        this._animateForward();
      }
    } else if (wantsBackward) {
      if (this._activeAbsoluteIndex <= 0) {
        this.onSwipeBlocked?.("at_first_post");
        this._animateCancel();
      } else {
        this._animateBackward();
      }
    } else {
      if (Math.abs(totalDelta) > h * 0.05) {
        this.onSwipeBlocked?.("swipe_too_weak");
      }
      this._animateCancel();
    }
  }

  private _animateForward(): void {
    this.animation.animate({
      from: this._sharedOffset,
      to: -this._slideHeight,
      duration: 280,
      onFrame: (v) => this._setSharedOffset(v),
      onComplete: () => this._commitForward(),
    });
  }

  private _animateBackward(): void {
    this.animation.animate({
      from: this._sharedOffset,
      to: this._slideHeight,
      duration: 280,
      onFrame: (v) => this._setSharedOffset(v),
      onComplete: () => this._commitBackward(),
    });
  }

  private _animateCancel(): void {
    this.animation.animate({
      from: this._sharedOffset,
      to: 0,
      duration: 200,
      onFrame: (v) => this._setSharedOffset(v),
      onComplete: () => {},
    });
  }

  // ─── Slot rotation on commit ────────────────────────────────────────────────

  private _commitForward(): void {
    const prevSlot = ((this._activeSlot + 2) % 3) as 0 | 1 | 2;
    const nextSlot = ((this._activeSlot + 1) % 3) as 0 | 1 | 2;

    this._activeAbsoluteIndex += 1;
    this._activeSlot = nextSlot;

    // Recycle the old prev slot → new next
    this._absoluteIndices[prevSlot] = this._activeAbsoluteIndex + 1;

    // Normalize: active slot at 0, prev at -h, next at +h
    this._baseY[this._activeSlot] = 0;
    this._baseY[((this._activeSlot + 2) % 3) as 0 | 1 | 2] = -this._slideHeight;
    this._baseY[prevSlot] = this._slideHeight;

    this._sharedOffset = 0;

    this.repo.checkPrefetch(this._activeAbsoluteIndex);
    // onSlotsChange before onOffsetChange so React can apply both in the same paint
    this.onSlotsChange?.(this._buildSlotInfo());
    this.onOffsetChange?.(0);
    this.onActiveIndexChange?.(this._activeAbsoluteIndex, this.repo.get(this._activeAbsoluteIndex));
  }

  private _commitBackward(): void {
    const prevSlot = ((this._activeSlot + 2) % 3) as 0 | 1 | 2;
    const nextSlot = ((this._activeSlot + 1) % 3) as 0 | 1 | 2;

    this._activeAbsoluteIndex -= 1;
    this._activeSlot = prevSlot;

    // Recycle the old next slot → new prev
    this._absoluteIndices[nextSlot] = this._activeAbsoluteIndex - 1;

    // Normalize
    this._baseY[this._activeSlot] = 0;
    this._baseY[((this._activeSlot + 1) % 3) as 0 | 1 | 2] = this._slideHeight;
    this._baseY[nextSlot] = -this._slideHeight;

    this._sharedOffset = 0;

    this.onSlotsChange?.(this._buildSlotInfo());
    this.onOffsetChange?.(0);
    this.onActiveIndexChange?.(this._activeAbsoluteIndex, this.repo.get(this._activeAbsoluteIndex));
  }

  private _buildSlotInfo(): SlotInfo {
    return {
      absoluteIndices: [...this._absoluteIndices] as [number, number, number],
      baseY: [...this._baseY] as [number, number, number],
      activeSlot: this._activeSlot,
      sharedOffset: this._sharedOffset,
    };
  }

  private _recalcBaseY(): void {
    const h = this._slideHeight;
    this._baseY[this._activeSlot] = 0;
    this._baseY[((this._activeSlot + 1) % 3) as 0 | 1 | 2] = h;
    this._baseY[((this._activeSlot + 2) % 3) as 0 | 1 | 2] = -h;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Register a horizontal-drag consumer for the currently-active card
   * (e.g. FeedImageCarousel). Pass null to unregister.
   * When a consumer is registered, horizontal gestures are routed to it
   * exclusively and never trigger vertical navigation.
   */
  setHorizontalConsumer(consumer: HorizontalConsumer | null): void {
    this._horizontalConsumer = consumer;
  }

  setSlideHeight(height: number): void {
    if (this._slideHeight === height) return;
    this._slideHeight = height;
    this._recalcBaseY();
    // Fire callbacks if wired — null-safe so safe to call before React mounts
    this.onSlotsChange?.(this._buildSlotInfo());
    this.onOffsetChange?.(this._sharedOffset);
  }

  syncPosts(posts: FeedPost[]): void {
    const wasEmpty = this.repo.totalLoaded === 0;
    const { added } = this.repo.sync(posts);
    if (added > 0) {
      if (wasEmpty) {
        this.onActiveIndexChange?.(
          this._activeAbsoluteIndex,
          this.repo.get(this._activeAbsoluteIndex),
        );
      }
      this.onSlotsChange?.(this._buildSlotInfo());
    }
  }

  syncStatus(isFetching: boolean, isExhausted: boolean): void {
    const newStatus = isFetching ? "fetching" : isExhausted ? "exhausted" : "idle";
    this.repo.setStatus(newStatus);
  }

  attach(container: HTMLElement): void {
    this.detach();
    this._detachGesture = this.gesture.attach(container);
  }

  detach(): void {
    this._detachGesture?.();
    this._detachGesture = null;
    this.animation.cancel();
  }

  /** Programmatic forward navigation (dev toolbar, keyboard). */
  goForward(): void {
    if (this._slideHeight <= 0) return;
    if (this._activeAbsoluteIndex >= this.repo.totalLoaded - 1) return;
    this.animation.cancel();
    this._animateForward();
  }

  /** Programmatic backward navigation (dev toolbar, keyboard). */
  goBackward(): void {
    if (this._slideHeight <= 0) return;
    if (this._activeAbsoluteIndex <= 0) return;
    this.animation.cancel();
    this._animateBackward();
  }

  reset(): void {
    this.animation.cancel();
    this.repo.reset();
    this._activeAbsoluteIndex = 0;
    this._activeSlot = 1;
    this._absoluteIndices = [-1, 0, 1];
    this._sharedOffset = 0;
    this._recalcBaseY();
  }

  get activeAbsoluteIndex(): number {
    return this._activeAbsoluteIndex;
  }

  /** Snapshot of internal state — for unit tests and the dev debug panel. */
  getSnapshot() {
    return {
      activeAbsoluteIndex: this._activeAbsoluteIndex,
      activeSlot: this._activeSlot,
      absoluteIndices: [...this._absoluteIndices] as [number, number, number],
      baseY: [...this._baseY] as [number, number, number],
      sharedOffset: this._sharedOffset,
      totalLoaded: this.repo.totalLoaded,
      repoStatus: this.repo.status,
    };
  }
}
