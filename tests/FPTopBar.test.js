import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import FPTopBar from '../app/fullpage/FPTopBar';
import { sidebarNavigationState } from '../app/atoms/fullpageState';

jest.mock('../app/Header', () => ({
    LoginSection: () => <div>Login Section</div>,
    SyncStatus: ({ onTriggerSync }) => (
        <div>
            <span>Sync Status</span>
            {onTriggerSync ? (
                <button type="button" onClick={onTriggerSync}>Sync Now</button>
            ) : null}
        </div>
    ),
}));

jest.mock('../app/SettingsMenu', () => ({
    __esModule: true,
    default: function MockSettingsMenu(props) {
        return <div>{`Settings Menu ${props.variant || 'popup'}`}</div>;
    },
}));

const renderWithNavigation = (navigation, overrideProps = {}) => {
    const store = createStore();
    store.set(sidebarNavigationState, navigation);

    return render(
        <Provider store={store}>
            <FPTopBar
                logout={jest.fn()}
                applyDataFromServer={jest.fn()}
                updateRemoteData={jest.fn()}
                triggerSync={jest.fn()}
                {...overrideProps}
            />
        </Provider>,
    );
};

describe('FPTopBar', () => {
    test('shows a sessions-specific search placeholder', async () => {
        renderWithNavigation('sessions');
        await screen.findByText('Settings Menu fullpage');

        expect(screen.getByPlaceholderText('Search recently closed browser items')).toBeInTheDocument();
    });

    test('shows a current windows-specific search placeholder', async () => {
        renderWithNavigation('current-windows');
        await screen.findByText('Settings Menu fullpage');

        expect(screen.getByPlaceholderText('Search for tabs within your current windows')).toBeInTheDocument();
    });

    test('passes the full-page settings variant to the settings menu', async () => {
        renderWithNavigation('all');

        expect(await screen.findByText('Settings Menu fullpage')).toBeInTheDocument();
    });

    test('wires the full-page sync status action button to the shared triggerSync handler', async () => {
        const triggerSync = jest.fn();
        renderWithNavigation('all', { triggerSync });

        fireEvent.click(await screen.findByRole('button', { name: 'Sync Now' }));

        expect(triggerSync).toHaveBeenCalledTimes(1);
    });
});
