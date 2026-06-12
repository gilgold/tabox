import { render, fireEvent, act } from '@testing-library/react';
import Switch from '../app/Switch';

describe('Switch', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('renders switch with labels', async () => {
        let container;
        await act(async () => {
            const result = render(
                <Switch 
                    id="testSwitch" 
                    textOn="ON" 
                    textOff="OFF" 
                />
            );
            container = result.container;
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        
        expect(container.querySelector('.toggle--on').textContent).toBe('ON');
        expect(container.querySelector('.toggle--off').textContent).toBe('OFF');
    });

    test('renders checkbox input', async () => {
        let container;
        await act(async () => {
            const result = render(
                <Switch id="testSwitch" textOn="ON" textOff="OFF" />
            );
            container = result.container;
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        
        const checkbox = container.querySelector('input[type="checkbox"]');
        expect(checkbox).toBeTruthy();
        expect(checkbox.id).toBe('testSwitch');
        expect(checkbox.name).toBe('testSwitch');
    });

    test('checkbox starts unchecked by default', async () => {
        let container;
        await act(async () => {
            const result = render(
                <Switch id="testSwitch" textOn="ON" textOff="OFF" />
            );
            container = result.container;
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        
        const checkbox = container.querySelector('input[type="checkbox"]');
        expect(checkbox.checked).toBe(false);
    });

    test('checkbox toggles on click', async () => {
        let container;
        await act(async () => {
            const result = render(
                <Switch id="testSwitch" textOn="ON" textOff="OFF" />
            );
            container = result.container;
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        
        const checkbox = container.querySelector('input[type="checkbox"]');
        expect(checkbox.checked).toBe(false);
        
        await act(async () => {
            fireEvent.click(checkbox);
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        
        expect(checkbox.checked).toBe(true);
    });

    test('renders as disabled when disabled prop is true', async () => {
        let container;
        await act(async () => {
            const result = render(
                <Switch id="testSwitch" textOn="ON" textOff="OFF" disabled={true} />
            );
            container = result.container;
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        
        const checkbox = container.querySelector('input[type="checkbox"]');
        expect(checkbox.disabled).toBe(true);
    });

    test('shows unchecked when disabled', async () => {
        let container;
        await act(async () => {
            const result = render(
                <Switch id="testSwitch" textOn="ON" textOff="OFF" disabled={true} />
            );
            container = result.container;
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        
        const checkbox = container.querySelector('input[type="checkbox"]');
        expect(checkbox.checked).toBe(false);
    });

    test('passes through other props', async () => {
        let container;
        await act(async () => {
            const result = render(
                <Switch 
                    id="testSwitch" 
                    textOn="ON" 
                    textOff="OFF"
                    data-testid="my-switch"
                    className="custom-class"
                />
            );
            container = result.container;
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        
        const wrapper = container.querySelector('span');
        expect(wrapper.getAttribute('data-testid')).toBe('my-switch');
        expect(wrapper.classList.contains('custom-class')).toBe(true);
    });

    test('manual animation mode stays still on load and only animates after click', async () => {
        browser.storage.local.get.mockResolvedValue({ testSwitch: true });

        let container;
        await act(async () => {
            const result = render(
                <Switch id="testSwitch" textOn="ON" textOff="OFF" animateOnUserToggleOnly={true} />
            );
            container = result.container;
            await new Promise(resolve => setTimeout(resolve, 0));
        });

        const wrapper = container.querySelector('.switch');
        const checkbox = container.querySelector('input[type="checkbox"]');

        expect(checkbox.checked).toBe(true);
        expect(wrapper.classList.contains('switch--manual-animation')).toBe(true);
        expect(wrapper.classList.contains('switch--animate-on')).toBe(false);
        expect(wrapper.classList.contains('switch--animate-off')).toBe(false);

        await act(async () => {
            fireEvent.click(checkbox);
            await new Promise(resolve => setTimeout(resolve, 0));
        });

        expect(wrapper.classList.contains('switch--animate-off')).toBe(true);
    });

    test('onBeforeChange returning false vetoes the toggle (no storage write with new value)', async () => {
        const onBeforeChange = jest.fn().mockReturnValue(false);
        let container;
        await act(async () => {
            const result = render(
                <Switch id="testSwitch" textOn="ON" textOff="OFF" onBeforeChange={onBeforeChange} />
            );
            container = result.container;
            // Wait for storage.get to resolve so loaded.current=true
            await new Promise(resolve => setTimeout(resolve, 0));
        });

        // Clear any set calls that fired on mount
        browser.storage.local.set.mockClear();
        const checkbox = container.querySelector('input[type="checkbox"]');
        const initialChecked = checkbox.checked; // false

        await act(async () => {
            fireEvent.click(checkbox);
            await new Promise(resolve => setTimeout(resolve, 0));
        });

        // onBeforeChange must have been called with whatever the proposed change value was
        expect(onBeforeChange).toHaveBeenCalledTimes(1);
        // When veto returns false: the toggle MUST be blocked.
        // We verify this by checking no storage write with a value different from the initial state was committed.
        // Specifically: no set({testSwitch: !initialChecked}) should have occurred.
        const setCalls = browser.storage.local.set.mock.calls;
        const toggledCalls = setCalls.filter(([arg]) => arg && arg.testSwitch === !initialChecked);
        expect(toggledCalls).toHaveLength(0);
    });

    test('onBeforeChange returning true allows the toggle (storage written with new value)', async () => {
        const onBeforeChange = jest.fn().mockReturnValue(true);
        let container;
        await act(async () => {
            const result = render(
                <Switch id="testSwitch" textOn="ON" textOff="OFF" onBeforeChange={onBeforeChange} />
            );
            container = result.container;
            // Wait for storage.get to resolve so loaded.current=true
            await new Promise(resolve => setTimeout(resolve, 0));
        });

        browser.storage.local.set.mockClear();
        const checkbox = container.querySelector('input[type="checkbox"]');
        const initialChecked = checkbox.checked; // false

        await act(async () => {
            fireEvent.click(checkbox);
            await new Promise(resolve => setTimeout(resolve, 0));
        });

        // onBeforeChange must have been called
        expect(onBeforeChange).toHaveBeenCalledTimes(1);
        // When allowed: storage must have been written with the toggled value (!initialChecked = true)
        expect(browser.storage.local.set).toHaveBeenCalledWith({ testSwitch: !initialChecked });
    });

    test('has correct CSS classes', async () => {
        let container;
        await act(async () => {
            const result = render(
                <Switch id="testSwitch" textOn="ON" textOff="OFF" />
            );
            container = result.container;
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        
        expect(container.querySelector('.switch-input')).toBeTruthy();
        expect(container.querySelector('.switch-label')).toBeTruthy();
    });
});
