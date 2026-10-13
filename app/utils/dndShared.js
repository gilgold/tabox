import { MouseSensor, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';

// Single source of truth for drag-and-drop interaction tuning so every
// DndContext (sidebar folders, collection cards, detail-panel tabs) feels identical.
export const DND_ACTIVATION_DISTANCE = 5;

// Touch-first devices (Firefox for Android): a distance constraint turns every
// scroll swipe into a drag (and lights up the sidebar drop zones), so require
// a short long-press instead. Moving more than the tolerance during the delay
// lets the browser scroll and cancels the pending drag.
export const DND_TOUCH_ACTIVATION_DELAY_MS = 250;
export const DND_TOUCH_ACTIVATION_TOLERANCE = 8;

// Firefox for Android can report `pointer: fine` (e.g. in desktop-site mode or
// with a hardware keyboard attached), so a touchscreen without hover counts too.
export const isCoarsePointerDevice = (win = typeof window !== 'undefined' ? window : undefined) => {
    if (typeof win?.matchMedia !== 'function') return false;
    if (win.matchMedia('(any-pointer: coarse)').matches) return true;
    return (win.navigator?.maxTouchPoints || 0) > 0 && win.matchMedia('(hover: none)').matches;
};

export const getDndPointerSensorOptions = (win) => Object.freeze({
    activationConstraint: Object.freeze(isCoarsePointerDevice(win)
        ? { delay: DND_TOUCH_ACTIVATION_DELAY_MS, tolerance: DND_TOUCH_ACTIVATION_TOLERANCE }
        : { distance: DND_ACTIVATION_DISTANCE }),
});

export const dndPointerSensorOptions = getDndPointerSensorOptions();

// On touch devices the touch input must use TouchSensor:
// with PointerSensor + a delay, the browser starts panning on the first finger
// movement and fires pointercancel, killing the drag. TouchSensor lets a quick
// swipe scroll, and once the long-press activates it prevents the scroll.
// Pair it with MouseSensor on hybrid devices. PointerSensor would also consume
// their touch events, bypassing the touch-specific scroll/long-press behavior.
const mouseSensorOptions = Object.freeze({ activationConstraint: Object.freeze({ distance: DND_ACTIVATION_DISTANCE }) });
const touchSensorOptions = Object.freeze({ activationConstraint: Object.freeze({
    delay: DND_TOUCH_ACTIVATION_DELAY_MS, tolerance: DND_TOUCH_ACTIVATION_TOLERANCE
}) });

export function useDndSensors(win) {
    const hasTouch = isCoarsePointerDevice(win);
    const primary = useSensor(hasTouch ? MouseSensor : PointerSensor, mouseSensorOptions);
    const touch = useSensor(TouchSensor, touchSensorOptions);
    return useSensors(primary, hasTouch ? touch : undefined);
}

// The Firefox browserAction panel fires spurious zero-delta `resize` events:
// the panel auto-sizes to content, and every re-layout re-notifies the popup
// window even when innerWidth/innerHeight are unchanged. dnd-kit's
// AbstractPointerSensor registers a cancel-on-resize listener for each drag,
// so in the Firefox popup every drag was cancelled ~one frame after
// activation. Swallow resize events that carry no actual size change while a
// pointer drag is in progress, before dnd-kit's listener can see them.
//
// Ordering guarantee: `resize` fires AT_TARGET on `window`, where listeners
// run in registration order. This guard registers at module load; the sensor
// registers per-drag on pointerdown, so the guard always runs first.
// Real size changes still propagate (dnd-kit's cancel stays meaningful).
export function installDragResizeGuard(win) {
    let pointerActive = false;
    let lastWidth = win.innerWidth;
    let lastHeight = win.innerHeight;
    win.addEventListener('pointerdown', () => { pointerActive = true; }, true);
    win.addEventListener('pointerup', () => { pointerActive = false; }, true);
    win.addEventListener('pointercancel', () => { pointerActive = false; }, true);
    win.addEventListener('resize', (event) => {
        const sizeChanged = win.innerWidth !== lastWidth || win.innerHeight !== lastHeight;
        lastWidth = win.innerWidth;
        lastHeight = win.innerHeight;
        if (!sizeChanged && pointerActive) {
            event.stopImmediatePropagation();
        }
    }, true);
}

if (typeof window !== 'undefined') {
    installDragResizeGuard(window);
}
