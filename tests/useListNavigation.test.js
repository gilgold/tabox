import { renderHook, act } from '@testing-library/react';
import useListNavigation from '../app/useListNavigation';

const keyEvent = (key) => ({ key, preventDefault: jest.fn() });

describe('useListNavigation', () => {
    test('arrows move selection and wrap at both ends', () => {
        const { result } = renderHook(() => useListNavigation({ count: 3 }));
        act(() => result.current.handleKeyDown(keyEvent('ArrowDown')));
        expect(result.current.selectedIndex).toBe(1);
        act(() => result.current.handleKeyDown(keyEvent('ArrowDown')));
        act(() => result.current.handleKeyDown(keyEvent('ArrowDown')));
        expect(result.current.selectedIndex).toBe(0); // wrapped
        act(() => result.current.handleKeyDown(keyEvent('ArrowUp')));
        expect(result.current.selectedIndex).toBe(2); // wrapped back
    });

    test('Home and End jump to first and last', () => {
        const { result } = renderHook(() => useListNavigation({ count: 5 }));
        act(() => result.current.handleKeyDown(keyEvent('End')));
        expect(result.current.selectedIndex).toBe(4);
        act(() => result.current.handleKeyDown(keyEvent('Home')));
        expect(result.current.selectedIndex).toBe(0);
    });

    test('Enter calls onSelect with the selected index; Escape calls onClose', () => {
        const onSelect = jest.fn();
        const onClose = jest.fn();
        const { result } = renderHook(() => useListNavigation({ count: 3, onSelect, onClose }));
        act(() => result.current.handleKeyDown(keyEvent('ArrowDown')));
        act(() => result.current.handleKeyDown(keyEvent('Enter')));
        expect(onSelect).toHaveBeenCalledWith(1);
        act(() => result.current.handleKeyDown(keyEvent('Escape')));
        expect(onClose).toHaveBeenCalled();
    });

    test('Escape still works with an empty list; other keys are ignored', () => {
        const onClose = jest.fn();
        const onSelect = jest.fn();
        const { result } = renderHook(() => useListNavigation({ count: 0, onSelect, onClose }));
        act(() => result.current.handleKeyDown(keyEvent('Enter')));
        expect(onSelect).not.toHaveBeenCalled();
        act(() => result.current.handleKeyDown(keyEvent('Escape')));
        expect(onClose).toHaveBeenCalled();
    });

    test('selection resets to 0 when resetKey changes', () => {
        const { result, rerender } = renderHook(
            ({ resetKey }) => useListNavigation({ count: 3, resetKey }),
            { initialProps: { resetKey: '' } },
        );
        act(() => result.current.handleKeyDown(keyEvent('ArrowDown')));
        expect(result.current.selectedIndex).toBe(1);
        rerender({ resetKey: 'abc' });
        expect(result.current.selectedIndex).toBe(0);
    });

    test('scrollTo is invoked on movement with the new index', () => {
        const scrollTo = jest.fn();
        const { result } = renderHook(() => useListNavigation({ count: 3, scrollTo }));
        act(() => result.current.handleKeyDown(keyEvent('ArrowDown')));
        expect(scrollTo).toHaveBeenCalledWith(1);
    });
});
