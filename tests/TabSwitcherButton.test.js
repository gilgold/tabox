import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import TabSwitcherButton from '../app/TabSwitcherButton';
import { tabSwitcherOpenState } from '../app/atoms/tabSwitcherState';

test('clicking the button opens the tab switcher atom', () => {
    const store = createStore();
    render(
        <Provider store={store}>
            <TabSwitcherButton />
        </Provider>
    );
    const btn = screen.getByTestId('tab-switcher-button');
    expect(btn).toHaveAttribute('data-tooltip-content', expect.stringContaining('Quick tab switcher'));
    fireEvent.click(btn);
    expect(store.get(tabSwitcherOpenState)).toBe(true);
});
