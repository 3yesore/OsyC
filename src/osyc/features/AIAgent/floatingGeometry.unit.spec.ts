import { describe, expect, it } from "vitest";
import {
    clampBallPosition,
    didExceedDragThreshold,
    restoreBallPosition,
    snapBallPosition,
    storeBallPosition,
} from "./floatingGeometry";

describe("AI 悬浮球几何", () => {
    const viewport = { width: 390, height: 720 };
    const options = { ballSize: 60, margin: 12, bottomInset: 76 };

    it("把球夹紧在可视区域和 Obsidian 底栏之外", () => {
        expect(clampBallPosition({ x: -20, y: 999 }, viewport, options)).toEqual({ x: 12, y: 572 });
    });

    it("移动端同时避开系统状态栏和 Obsidian 底栏", () => {
        const mobileOptions = { ballSize: 60, margin: 12, topInset: 64, bottomInset: 88 };
        expect(clampBallPosition({ x: -20, y: 999 }, viewport, mobileOptions)).toEqual({ x: 12, y: 560 });
        expect(clampBallPosition({ x: 200, y: 0 }, viewport, mobileOptions)).toEqual({ x: 200, y: 64 });
    });

    it("松手时只把球吸附到最近的左右边缘，纵向位置仍然有效", () => {
        expect(snapBallPosition({ x: 280, y: 200 }, viewport, options)).toEqual({ x: 318, y: 200 });
        expect(snapBallPosition({ x: 80, y: 200 }, viewport, options)).toEqual({ x: 12, y: 200 });
    });

    it("移动不足八像素仍视为点击，超过阈值才是拖动", () => {
        expect(didExceedDragThreshold({ x: 100, y: 100 }, { x: 107, y: 100 })).toBe(false);
        expect(didExceedDragThreshold({ x: 100, y: 100 }, { x: 108, y: 100 })).toBe(true);
    });

    it("持久化坐标采用归一化值，换视口后仍会恢复到合法位置", () => {
        const stored = storeBallPosition({ x: 318, y: 572 }, viewport, options);
        expect(stored).toEqual({ x: 1, y: 1 });
        expect(restoreBallPosition(stored, { width: 320, height: 600 }, options)).toEqual({ x: 248, y: 452 });
    });
});
