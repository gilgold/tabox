/** @jest-environment jsdom */
const { render, screen, waitFor, cleanup, act } = require('@testing-library/react');
require('@testing-library/jest-dom');
const { Provider, createStore } = require('jotai');
const toast = require('react-hot-toast').default;

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
// node_modules CSS is excluded from the jest-transform-stub transform
// (default transformIgnorePatterns), so stub App.js's react-tooltip CSS import.
jest.mock('react-tooltip/dist/react-tooltip.css', () => ({}));

const App = require('../app/App').default;

const inviteToastCalls = () =>
    toast.custom.mock.calls.filter(([, opts]) => opts?.id?.startsWith('shared-invite-'));

const renderInviteToast = (call) => {
    const [renderFn, opts] = call;
    return render(renderFn({ id: opts.id, visible: true }));
};

// C1 wiring test: chrome/shared-folders.js's pollInvites() persists
// SHARED_PENDING_INVITES_KEY as { invites, notifiedFolderIds } (see
// chrome/shared-folders.js ~line 302). App.js must unwrap that object down to
// the `invites` array before feeding jotai's pendingInvitesState, which is
// what SharedInviteToastController (rendered, unmocked, below) reads to
// spawn one persistent invite toast per pending invite (react-hot-toast is
// mocked in jest.setup.js, so we assert on toast.custom and render the toast
// callback by hand).
describe('App shared-invite storage wiring (C1)', () => {
    let browser;

    beforeEach(() => {
        toast.custom.mockClear();
        toast.dismiss.mockClear();
    });

    afterEach(() => {
        cleanup();
        delete global.browser;
        delete global.chrome;
    });

    test('spawns the invite toast from the real { invites, notifiedFolderIds } storage shape on mount', async () => {
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
            expect(inviteToastCalls()).toHaveLength(1);
        });
        expect(inviteToastCalls()[0][1]).toEqual(
            expect.objectContaining({
                id: 'shared-invite-f1',
                duration: Infinity,
                position: 'bottom-right'
            })
        );

        renderInviteToast(inviteToastCalls()[0]);
        expect(screen.getByRole('status').textContent).toMatch(/owner@example\.com invited you to/);
        expect(screen.getByRole('status').textContent).toMatch(/"Team"/);
    });

    test('spawns the invite toast when the shape arrives via a storage.onChanged event after mount', async () => {
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

        // No invite yet — no invite toast must be spawned.
        expect(inviteToastCalls()).toHaveLength(0);

        await act(async () => {
            await browser.storage.local.set({
                shared_pending_invites: {
                    invites: [{ folderId: 'f2', folderName: 'Design', ownerEmail: 'designer@example.com', role: 'write' }],
                    notifiedFolderIds: ['f2']
                }
            });
        });

        await waitFor(() => {
            expect(inviteToastCalls()).toHaveLength(1);
        });
        expect(inviteToastCalls()[0][1]).toEqual(
            expect.objectContaining({ id: 'shared-invite-f2' })
        );

        renderInviteToast(inviteToastCalls()[0]);
        expect(screen.getByRole('status').textContent).toMatch(/designer@example\.com invited you to/);
        expect(screen.getByRole('status').textContent).toMatch(/"Design"/);
    });
});
