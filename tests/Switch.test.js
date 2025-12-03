import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import Switch from '../app/Switch';

describe('Switch', () => {
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

