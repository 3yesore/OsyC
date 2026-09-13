import type { App } from "@/deps.ts";
import {
    clampBallPosition,
    DEFAULT_FLOATING_GEOMETRY,
    didExceedDragThreshold,
    restoreBallPosition,
    snapBallPosition,
    storeBallPosition,
    type FloatingPoint,
} from "./floatingGeometry";

export interface FloatingCallbacks {
    /** Open/focus the single Agent view in Obsidian's main workspace. */
    onOpenPane: () => void;
    /** 0..1 normalized position, persisted by the wiring layer. */
    onPositionChange?: (position: FloatingPoint) => void;
}

const FLOATING_ROOT_ID = "osyc-ai-floating-ball";
const GLOBAL_CLEANUP_KEY = "__osycFloatingCleanup";

/**
 * A draggable shortcut only. The conversation itself is always rendered by the
 * registered Obsidian ItemView, so there is never a second interactive pane or
 * overlay competing with the host workspace and mobile keyboard.
 */
export class AIAgentFloating {
    private ballRoot?: HTMLElement;
    private ball?: HTMLButtonElement;
    private tripleTapEnabled = true;
    private showBall = true;
    private pointerId?: number;
    private pointerStart?: FloatingPoint;
    private ballStart?: FloatingPoint;
    private moved = false;
    private suppressClick = false;
    private normalizedPosition: FloatingPoint;
    private globalCleanup?: () => void;
    private readonly onViewportChange = () => this.applyBallPosition();

    constructor(
        private app: App,
        private cb: FloatingCallbacks,
        position?: FloatingPoint
    ) {
        this.normalizedPosition = position ?? { x: 1, y: 1 };
    }

    mount(): void {
        if (this.ballRoot) return;
        // Obsidian can reload a plugin bundle without running the previous
        // instance's unload hook. Keep one cross-bundle owner so stale balls
        // cannot remain interactive on top of the current workspace.
        const globalState = globalThis as typeof globalThis & {
            __osycFloatingCleanup?: () => void;
        };
        globalState[GLOBAL_CLEANUP_KEY]?.();
        // Also remove roots from pre-1.0.36 bundles. Those bundles used a
        // different class and could survive a BRAT hot update, leaving a
        // second ball or an interactive drawer over the workspace.
        const staleRootSelectors = [
            "#osyc-ai-floating-ball",
            ".ai-float-ball-root",
            ".ai-float-root",
            ".ai-float-" + "sheet-root",
        ];
        document.querySelectorAll<HTMLElement>(staleRootSelectors.join(", ")).forEach((node) => node.remove());

        const ballRoot = document.createElement("div");
        ballRoot.id = FLOATING_ROOT_ID;
        ballRoot.className = "ai-float-ball-root";
        const ball = document.createElement("button");
        ball.className = "ai-float-ball ai-pulse";
        ball.type = "button";
        ball.textContent = "OC";
        ball.setAttribute("aria-label", "打开 OC 对话页");
        ballRoot.appendChild(ball);

        // Attach to the document viewport, not workspace.containerEl. Obsidian's
        // mobile workspace may be translated or clipped while switching tabs.
        document.body.appendChild(ballRoot);

        this.ballRoot = ballRoot;
        this.ball = ball;
        this.globalCleanup = () => this.destroy();
        globalState[GLOBAL_CLEANUP_KEY] = this.globalCleanup;
        ballRoot.hidden = !this.showBall;
        ball.addEventListener("click", this.onBallClick);
        ball.addEventListener("pointerdown", this.onPointerDown);
        ball.addEventListener("pointermove", this.onPointerMove);
        ball.addEventListener("pointerup", this.onPointerUp);
        ball.addEventListener("pointercancel", this.onPointerCancel);
        window.addEventListener("resize", this.onViewportChange);
        window.visualViewport?.addEventListener("resize", this.onViewportChange);
        this.applyBallPosition();
    }

    private viewport() {
        return { width: window.visualViewport?.width ?? window.innerWidth, height: window.visualViewport?.height ?? window.innerHeight };
    }

    private currentPosition(): FloatingPoint {
        const rect = this.ballRoot?.getBoundingClientRect();
        return rect ? { x: rect.left, y: rect.top } : restoreBallPosition(this.normalizedPosition, this.viewport(), DEFAULT_FLOATING_GEOMETRY);
    }

    private applyBallPosition(position?: FloatingPoint): void {
        if (!this.ballRoot) return;
        const viewport = this.viewport();
        const next = position
            ? clampBallPosition(position, viewport, DEFAULT_FLOATING_GEOMETRY)
            : restoreBallPosition(this.normalizedPosition, viewport, DEFAULT_FLOATING_GEOMETRY);
        this.ballRoot.setCssStyles({ left: `${next.x}px`, top: `${next.y}px` });
    }

    private persistPosition(position: FloatingPoint): void {
        this.normalizedPosition = storeBallPosition(position, this.viewport(), DEFAULT_FLOATING_GEOMETRY);
        this.cb.onPositionChange?.(this.normalizedPosition);
    }

    private onBallClick = (): void => {
        if (!this.suppressClick) this.cb.onOpenPane();
    };

    private onPointerDown = (event: PointerEvent): void => {
        // Safari reports touch pointers with button = -1 in some WebView versions.
        if (event.button > 0 || !this.ball) return;
        event.preventDefault();
        this.pointerId = event.pointerId;
        this.pointerStart = { x: event.clientX, y: event.clientY };
        this.ballStart = this.currentPosition();
        this.moved = false;
        this.ball.setPointerCapture(event.pointerId);
    };

    private onPointerMove = (event: PointerEvent): void => {
        if (event.pointerId !== this.pointerId || !this.pointerStart || !this.ballStart) return;
        const current = { x: event.clientX, y: event.clientY };
        if (!this.moved && !didExceedDragThreshold(this.pointerStart, current)) return;
        this.moved = true;
        this.ball?.classList.add("ai-float-dragging");
        this.applyBallPosition({ x: this.ballStart.x + current.x - this.pointerStart.x, y: this.ballStart.y + current.y - this.pointerStart.y });
    };

    private onPointerUp = (event: PointerEvent): void => {
        if (event.pointerId !== this.pointerId) return;
        if (this.ball?.hasPointerCapture(event.pointerId)) this.ball.releasePointerCapture(event.pointerId);
        if (this.moved) {
            const position = snapBallPosition(this.currentPosition(), this.viewport(), DEFAULT_FLOATING_GEOMETRY);
            this.applyBallPosition(position);
            this.persistPosition(position);
            this.suppressClick = true;
            window.setTimeout(() => (this.suppressClick = false), 0);
        }
        this.resetPointer();
    };

    private onPointerCancel = (): void => this.resetPointer();

    private resetPointer(): void {
        this.pointerId = undefined;
        this.pointerStart = undefined;
        this.ballStart = undefined;
        this.moved = false;
        this.ball?.classList.remove("ai-float-dragging");
    }

    handleTripleTap(): void { if (this.tripleTapEnabled) this.cb.onOpenPane(); }
    setTripleTap(enabled: boolean): void { this.tripleTapEnabled = enabled; }
    setShowBall(visible: boolean): void { this.showBall = visible; if (this.ballRoot) this.ballRoot.hidden = !visible; }
    setPosition(position: FloatingPoint): void {
        this.normalizedPosition = position;
        this.applyBallPosition();
    }
    /** Backward-compatible command hook; it now opens the Agent page. */
    toggle(): void { this.cb.onOpenPane(); }

    destroy(): void {
        this.ball?.removeEventListener("click", this.onBallClick);
        this.ball?.removeEventListener("pointerdown", this.onPointerDown);
        this.ball?.removeEventListener("pointermove", this.onPointerMove);
        this.ball?.removeEventListener("pointerup", this.onPointerUp);
        this.ball?.removeEventListener("pointercancel", this.onPointerCancel);
        window.removeEventListener("resize", this.onViewportChange);
        window.visualViewport?.removeEventListener("resize", this.onViewportChange);
        this.ballRoot?.remove();
        const globalState = globalThis as typeof globalThis & {
            __osycFloatingCleanup?: () => void;
        };
        if (globalState[GLOBAL_CLEANUP_KEY] === this.globalCleanup) {
            delete globalState[GLOBAL_CLEANUP_KEY];
        }
        this.globalCleanup = undefined;
        this.ballRoot = undefined;
        this.ball = undefined;
    }
}
