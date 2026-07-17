const { render, screen, waitFor, cleanup, act } = require('@testing-library/react');
require('@testing-library/jest-dom');
const { Provider, createStore } = require('jotai');

const { createBrowserHarness } = require('./helpers/browserHarness');

const mockBrowserProxy = new Proxy({}, {
    get(_target, property) {
        return global.browser?.[property];
    }
});

jest.mock('../static/globals', () => ({
    browser: mockBrowserProxy
}));

jest.mock('../app/Header', () => () => null);
jest.mock('../app/AddNewTextbox', () => () => null);
jest.mock('../app/CollectionList', () => () => null);
jest.mock('../app/Footer', () => () => null);
jest.mock('../app/fullpage/FPLayout', () => () => null);
jest.mock('../app/CommandPalette', () => () => null);
jest.mock('../app/CollectionListOptions', () => ({
    CollectionListOptions: () => null
}));
jest.mock('react-tooltip', () => ({ Tooltip: () => null }));

const App = require('../app/App').default;

// C1 wiring test: chrome/shared-folders.js's pollInvites() persists
// SHARED_PENDING_INVITES_KEY as { invites, notifiedFolderIds } (see
// chrome/shared-folders.js ~line 302). App.js must unwrap that object down to
// the `invites` array before feeding jotai's pendingInvitesState, which is
// what SharedInviteBanner (rendered, unmocked, below) reads directly.
describe('App shared-invite storage wiring (C1)', () => {
    let browser;

    afterEach(() => {
        cleanup();
        delete global.browser;
        delete global.chrome;
    });

    test('renders the invite banner from the real { invites, notifiedFolderIds } storage shape on mount', async () => {
        browser = createBrowserHarness({
            localData: {
                collections_index: {},
                folders_index: {},
                tabox_storage_version: 3,
                shared_pending_invites: {
                    invites: [{ folderId: 'f1', folderName: 'Team', ownerEmail: 'owner@example.com', role: 'read' }],
                    notifiedFolderIds: ['f1']
                }
            }
        });
        global.browser = browser;
        global.chrome = { runtime: browser.runtime };

        render(
            <Provider store={createStore()}>
                <App />
            </Provider>
        );

        await waitFor(() => {
            expect(screen.getByRole('status').textContent).toMatch(/owner@example\.com wants to share the folder/);
        });
        expect(screen.getByRole('status').textContent).toMatch(/"Team"/);
    });

    test('renders the invite banner when the shape arrives via a storage.onChanged event after mount', async () => {
        browser = createBrowserHarness({
            localData: {
                collections_index: {},
                folders_index: {},
                tabox_storage_version: 3
            }
        });
        global.browser = browser;
        global.chrome = { runtime: browser.runtime };

        render(
            <Provider store={createStore()}>
                <App />
            </Provider>
        );

        // No invite yet — banner must not render.
        expect(screen.queryByRole('status')).not.toBeInTheDocument();

        await act(async () => {
            await browser.storage.local.set({
                shared_pending_invites: {
                    invites: [{ folderId: 'f2', folderName: 'Design', ownerEmail: 'designer@example.com', role: 'write' }],
                    notifiedFolderIds: ['f2']
                }
            });
        });

        await waitFor(() => {
            expect(screen.getByRole('status').textContent).toMatch(/designer@example\.com wants to share the folder/);
        });
        expect(screen.getByRole('status').textContent).toMatch(/"Design"/);
    });
});
