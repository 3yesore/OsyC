export interface FloatingPoint {
    x: number;
    y: number;
}

export interface FloatingViewport {
    width: number;
    height: number;
}

export interface FloatingGeometryOptions {
    ballSize: number;
    margin: number;
    topInset?: number;
    bottomInset: number;
}

export const DEFAULT_FLOATING_GEOMETRY: FloatingGeometryOptions = {
    ballSize: 60,
    margin: 12,
    topInset: 64,
    bottomInset: 88,
};

function bounds(viewport: FloatingViewport, options: FloatingGeometryOptions) {
    const minX = options.margin;
    const minY = Math.max(options.margin, options.topInset ?? options.margin);
    return {
        minX,
        minY,
        maxX: Math.max(minX, viewport.width - options.ballSize - options.margin),
        maxY: Math.max(minY, viewport.height - options.ballSize - options.margin - options.bottomInset),
    };
}

/** Keep the floating ball wholly within the current visual viewport. */
export function clampBallPosition(
    point: FloatingPoint,
    viewport: FloatingViewport,
    options: FloatingGeometryOptions = DEFAULT_FLOATING_GEOMETRY
): FloatingPoint {
    const box = bounds(viewport, options);
    return {
        x: Math.min(box.maxX, Math.max(box.minX, point.x)),
        y: Math.min(box.maxY, Math.max(box.minY, point.y)),
    };
}

/** Snap horizontally to the nearest edge after a drag while retaining the vertical position. */
export function snapBallPosition(
    point: FloatingPoint,
    viewport: FloatingViewport,
    options: FloatingGeometryOptions = DEFAULT_FLOATING_GEOMETRY
): FloatingPoint {
    const clamped = clampBallPosition(point, viewport, options);
    const box = bounds(viewport, options);
    return {
        x: clamped.x - box.minX <= box.maxX - clamped.x ? box.minX : box.maxX,
        y: clamped.y,
    };
}

export function didExceedDragThreshold(
    start: FloatingPoint,
    current: FloatingPoint,
    threshold = 8
): boolean {
    return Math.hypot(current.x - start.x, current.y - start.y) >= threshold;
}

/** Persist a clamped position in the 0..1 range so it survives viewport changes. */
export function storeBallPosition(
    point: FloatingPoint,
    viewport: FloatingViewport,
    options: FloatingGeometryOptions = DEFAULT_FLOATING_GEOMETRY
): FloatingPoint {
    const clamped = clampBallPosition(point, viewport, options);
    const box = bounds(viewport, options);
    return {
        x: box.maxX === box.minX ? 0 : (clamped.x - box.minX) / (box.maxX - box.minX),
        y: box.maxY === box.minY ? 0 : (clamped.y - box.minY) / (box.maxY - box.minY),
    };
}

/** Restore stored normalized coordinates and clamp them for the new viewport. */
export function restoreBallPosition(
    stored: FloatingPoint,
    viewport: FloatingViewport,
    options: FloatingGeometryOptions = DEFAULT_FLOATING_GEOMETRY
): FloatingPoint {
    const box = bounds(viewport, options);
    const x = box.minX + Math.min(1, Math.max(0, stored.x)) * (box.maxX - box.minX);
    const y = box.minY + Math.min(1, Math.max(0, stored.y)) * (box.maxY - box.minY);
    return clampBallPosition({ x, y }, viewport, options);
}
