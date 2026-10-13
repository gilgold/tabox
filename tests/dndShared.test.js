import { DND_ACTIVATION_DISTANCE, dndPointerSensorOptions } from '../app/utils/dndShared';
import { renderHook } from '@testing-library/react';
import { MouseSensor, PointerSensor, TouchSensor } from '@dnd-kit/core';
import { useDndSensors } from '../app/utils/dndShared';

describe('dndShared', () => {
    test('exposes a single activation distance used by all drag contexts', () => {
        expect(DND_ACTIVATION_DISTANCE).toBe(5);
    });

    test('pointer sensor options use the shared activation distance', () => {
        expect(dndPointerSensorOptions).toEqual({
            activationConstraint: { distance: 5 },
        });
    });
});

describe('dndShared on touch-first devices', () => {
    const { getDndPointerSensorOptions, isCoarsePointerDevice } = require('../app/utils/dndShared');
    const fakeWindow = (coarse) => ({ matchMedia: (q) => ({ matches: coarse && q === '(any-pointer: coarse)' }) });

    test('a coarse primary pointer requires a long-press so swipes scroll instead of dragging', () => {
        expect(isCoarsePointerDevice(fakeWindow(true))).toBe(true);
        expect(getDndPointerSensorOptions(fakeWindow(true))).toEqual({
            activationConstraint: { delay: 250, tolerance: 8 },
        });
    });

    test('a hover-less touchscreen that reports a fine pointer still gets the long-press', () => {
        const win = { navigator: { maxTouchPoints: 5 }, matchMedia: (q) => ({ matches: q === '(hover: none)' }) };
        expect(isCoarsePointerDevice(win)).toBe(true);
    });

    test('a fine pointer keeps the distance constraint', () => {
        expect(getDndPointerSensorOptions(fakeWindow(false))).toEqual({
            activationConstraint: { distance: 5 },
        });
        expect(getDndPointerSensorOptions({})).toEqual({ activationConstraint: { distance: 5 } });
    });
});

describe('shared drag sensors', () => {
    test('retains pointer dragging on non-touch desktops', () => {
        const { result } = renderHook(() => useDndSensors({}));
        expect(result.current.map(entry => entry.sensor)).toEqual([PointerSensor]);
        expect(result.current[0].options.activationConstraint).toEqual({ distance: 5 });
    });

    test('supports both mouse dragging and touch long-press on hybrid devices', () => {
        const win = { matchMedia: q => ({ matches: q === '(any-pointer: coarse)' }) };
        const { result } = renderHook(() => useDndSensors(win));
        expect(result.current.map(entry => entry.sensor)).toEqual([MouseSensor, TouchSensor]);
        expect(result.current[0].options.activationConstraint).toEqual({ distance: 5 });
        expect(result.current[1].options.activationConstraint).toEqual({ delay: 250, tolerance: 8 });
        expect(result.current.flatMap(entry => entry.sensor.activators.map(a => a.eventName)))
            .toEqual(['onMouseDown', 'onTouchStart']);
    });
});
