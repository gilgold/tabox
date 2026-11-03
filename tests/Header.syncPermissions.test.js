import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { LoginSection, SyncStatus } from '../app/Header';
import { isLoggedInState, syncSessionStateState } from '../app/atoms/globalAppSettingsState';
import { browser } from '../static/globals';
import { showErrorToast } from '../app/toastHelpers';

jest.mock('../static/globals', () => ({ browser: { permissions: { request: jest.fn() }, runtime: { sendMessage: jest.fn() } } }));
jest.mock('../app/toastHelpers', () => ({ showErrorToast: jest.fn(), showSuccessToast: jest.fn() }));

describe('sync permission user gestures', () => {
    beforeEach(() => { jest.clearAllMocks(); browser.permissions.request.mockResolvedValue(true); browser.runtime.sendMessage.mockResolvedValue({ syncStatus: 'active' }); });
    test('asks before enabling sync', async () => {
        render(<Provider store={createStore()}><LoginSection /></Provider>);
        fireEvent.click(screen.getByAltText('user avatar'));
        expect(browser.permissions.request).toHaveBeenCalledTimes(1);
        expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
        await waitFor(() => expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'login' }));
    });
    test('denial leaves sync disabled and explains recovery', async () => {
        browser.permissions.request.mockResolvedValue(false);
        render(<Provider store={createStore()}><LoginSection /></Provider>);
        fireEvent.click(screen.getByAltText('user avatar'));
        await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith(expect.stringContaining('Google site access')));
        expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
    });
    test('popup retries permission errors from the existing account control', async () => {
        const store = createStore();
        store.set(isLoggedInState, true);
        store.set(syncSessionStateState, { status: 'error', user: { displayName: 'Test' }, error: 'Google site access is missing' });
        render(<Provider store={store}><LoginSection /></Provider>);
        fireEvent.click(screen.getByAltText('user avatar'));
        expect(browser.permissions.request).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'updateRemote' }));
    });
    test('full page sync button requests permission before triggering sync', async () => {
        const store = createStore(); store.set(isLoggedInState, true); store.set(syncSessionStateState, { status: 'error' });
        const onTriggerSync = jest.fn();
        render(<Provider store={store}><SyncStatus onTriggerSync={onTriggerSync} /></Provider>);
        fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
        expect(browser.permissions.request).toHaveBeenCalledTimes(1);
        expect(onTriggerSync).not.toHaveBeenCalled();
        await waitFor(() => expect(onTriggerSync).toHaveBeenCalledTimes(1));
    });
});
