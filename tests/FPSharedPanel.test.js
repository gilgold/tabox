/** @jest-environment jsdom */
/* global browser */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import FPSharedPanel, { describeActivityEvent } from '../app/fullpage/FPSharedPanel';
import { premiumEntitlementState } from '../app/atoms/premiumState';
import { sharedPanelOpenState } from '../app/atoms/sharedFoldersState';
import { detailPanelOpenState, selectedCollectionUidState } from '../app/atoms/globalAppSettingsState';
import { showErrorToast } from '../app/toastHelpers';

jest.mock('../app/toastHelpers', () => ({
    showErrorToast: jest.fn(),
}));

const NOW = Date.now();

const folder = {
    uid: 'f1',
    name: 'Team Folder',
    shared: { folderId: 'f1', role: 'owner', ownerEmail: 'gil@example.com' },
};

const collections = [
    { uid: 'c1', name: 'Research', parentId: 'f1' },
    { uid: 'c2', name: 'Design', parentId: 'f1' },
    { uid: 'elsewhere', name: 'Elsewhere', parentId: 'other-folder' },
];

const activityEvents = [
    {
        id: 7,
        actorEmail: 'gil@example.com',
        action: 'collection_added',
        subject: 'c1',
        detail: JSON.stringify({ name: 'Research' }),
        createdAt: NOW - 60 * 1000,
    },
    {
        id: 6,
        actorEmail: 'amy@example.com',
        action: 'member_joined',
        subject: 'amy@example.com',
        detail: JSON.stringify({ role: 'write' }),
        createdAt: NOW - 3 * 24 * 60 * 60 * 1000,
    },
];

const defaultComments = {
    comments: [
        {
            id: 'cm1',
            collectionUid: null,
            authorEmail: 'amy@example.com',
            body: 'Hello from Amy',
            createdAt: NOW - 5 * 60 * 1000,
        },
    ],
    counts: [
        { collectionUid: null, n: 1 },
        { collectionUid: 'c1', n: 2 },
    ],
};

const installSendMessageMock = (overrides = {}) => {
    browser.runtime.sendMessage.mockImplementation((message) => {
        const type = message?.type;
        if (overrides[type]) return Promise.resolve(overrides[type](message));
        switch (type) {
            case 'sharedGetActivity':
                return Promise.resolve({ ok: true, data: { events: activityEvents } });
            case 'sharedGetComments':
                return Promise.resolve({ ok: true, data: defaultComments });
            case 'sharedPostComment':
                return Promise.resolve({ ok: true, data: { comment: { id: 'cm-new' } } });
            case 'sharedDeleteComment':
                return Promise.resolve({ ok: true, data: { deleted: true } });
            default:
                return Promise.resolve({});
        }
    });
};

const installStorageMock = ({ lastActivityId = 7, seen = {}, googleEmail = 'gil@example.com' } = {}) => {
    browser.storage.local.get.mockImplementation(() => Promise.resolve({
        googleUser: googleEmail ? { emailAddress: googleEmail } : undefined,
        shared_sync_state: { f1: { lastActivityId } },
        shared_activity_seen: seen,
    }));
};

const proEntitlement = { entitled: true, refreshedAt: new Date().toISOString() };

const renderPanel = ({ pro = true, store = createStore(), props = {} } = {}) => {
    if (pro) store.set(premiumEntitlementState, proEntitlement);
    const utils = render(
        <Provider store={store}>
            <FPSharedPanel
                folder={folder}
                collections={collections}
                isOpen={true}
                onClose={jest.fn()}
                {...props}
            />
        </Provider>,
    );
    return { store, ...utils };
};

const callsOfType = (type) => browser.runtime.sendMessage.mock.calls.filter(([m]) => m?.type === type);

beforeEach(() => {
    jest.clearAllMocks();
    installSendMessageMock();
    installStorageMock();
});

describe('FPSharedPanel', () => {
    test('renders the Activity tab by default with verbs, "You" for self, and day grouping', async () => {
        const { container } = renderPanel();

        expect(await screen.findByText(/You added “Research”/)).toBeInTheDocument();
        expect(screen.getByText(/amy@example\.com joined as write/)).toBeInTheDocument();

        const dayLabels = container.querySelectorAll('.fp-shared-activity-day');
        expect(dayLabels.length).toBe(2);
        expect(dayLabels[0]).toHaveTextContent('Today');
    });

    test('opening the Activity tab writes the mark-seen entry from shared_sync_state', async () => {
        installStorageMock({ lastActivityId: 42, seen: {} });
        renderPanel();

        await waitFor(() => {
            expect(browser.storage.local.set).toHaveBeenCalledWith({
                shared_activity_seen: { f1: 42 },
            });
        });
    });

    test('tab switching shows the Comments tab with thread switcher counts and comments', async () => {
        renderPanel();
        fireEvent.click(screen.getByRole('tab', { name: 'Comments' }));

        expect(await screen.findByText('Hello from Amy')).toBeInTheDocument();
        expect(screen.getByText('amy@example.com')).toBeInTheDocument();

        const threadSelect = screen.getByLabelText('Comment thread');
        expect(threadSelect).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Folder discussion (1)' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Research (2)' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Design (0)' })).toBeInTheDocument();
        // Collections outside this folder never appear as threads.
        expect(screen.queryByRole('option', { name: /Elsewhere/ })).not.toBeInTheDocument();
    });

    test('switching threads refetches comments scoped to the collection', async () => {
        renderPanel();
        fireEvent.click(screen.getByRole('tab', { name: 'Comments' }));
        await screen.findByText('Hello from Amy');

        fireEvent.change(screen.getByLabelText('Comment thread'), { target: { value: 'c1' } });

        await waitFor(() => {
            expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
                type: 'sharedGetComments',
                folderId: 'f1',
                collectionUid: 'c1',
            });
        });
    });

    test('selecting a collection in the content area scopes the comments thread', async () => {
        const store = createStore();
        renderPanel({ store });
        fireEvent.click(screen.getByRole('tab', { name: 'Comments' }));
        await screen.findByText('Hello from Amy');

        act(() => {
            store.set(selectedCollectionUidState, 'c2');
        });

        await waitFor(() => {
            expect(screen.getByLabelText('Comment thread')).toHaveValue('c2');
        });
    });

    test('composer is disabled with an upgrade CTA for free users', async () => {
        renderPanel({ pro: false });
        fireEvent.click(screen.getByRole('tab', { name: 'Comments' }));
        await screen.findByText('Hello from Amy');

        expect(screen.getByLabelText('Write a comment')).toBeDisabled();
        expect(screen.getByText('Pro')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Upgrade to post comments' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Send comment' })).not.toBeInTheDocument();
    });

    test('composer is enabled for Pro users', async () => {
        renderPanel({ pro: true });
        fireEvent.click(screen.getByRole('tab', { name: 'Comments' }));
        await screen.findByText('Hello from Amy');

        expect(screen.getByLabelText('Write a comment')).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Send comment' })).toBeInTheDocument();
    });

    test('posting sends sharedPostComment and refetches the thread', async () => {
        renderPanel();
        fireEvent.click(screen.getByRole('tab', { name: 'Comments' }));
        await screen.findByText('Hello from Amy');
        const getCallsBefore = callsOfType('sharedGetComments').length;

        fireEvent.change(screen.getByLabelText('Write a comment'), { target: { value: 'A new comment' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send comment' }));

        await waitFor(() => {
            expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
                type: 'sharedPostComment',
                folderId: 'f1',
                body: 'A new comment',
            });
        });
        await waitFor(() => {
            expect(callsOfType('sharedGetComments').length).toBeGreaterThan(getCallsBefore);
        });
        expect(screen.getByLabelText('Write a comment')).toHaveValue('');
    });

    test('a pro_required server error surfaces an error toast', async () => {
        installSendMessageMock({
            sharedPostComment: () => ({ ok: false, error: 'pro_required' }),
        });
        renderPanel();
        fireEvent.click(screen.getByRole('tab', { name: 'Comments' }));
        await screen.findByText('Hello from Amy');

        fireEvent.change(screen.getByLabelText('Write a comment'), { target: { value: 'Blocked comment' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send comment' }));

        await waitFor(() => {
            expect(showErrorToast).toHaveBeenCalledWith('Posting comments requires Tabox Pro.');
        });
    });

    test('activity fetch failure shows an inline retry state that refetches', async () => {
        let fail = true;
        installSendMessageMock({
            sharedGetActivity: () => (fail ? { ok: false, error: 'server_error' } : { ok: true, data: { events: activityEvents } }),
        });
        renderPanel();

        expect(await screen.findByText('Couldn’t load activity.')).toBeInTheDocument();
        fail = false;
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(await screen.findByText(/You added “Research”/)).toBeInTheDocument();
    });

    test('opening the shared panel closes the detail panel (mutual exclusion, atom level)', () => {
        const store = createStore();
        store.set(detailPanelOpenState, true);

        store.set(sharedPanelOpenState, true);

        expect(store.get(sharedPanelOpenState)).toBe(true);
        expect(store.get(detailPanelOpenState)).toBe(false);
    });

    test('renders nothing without a shared folder', () => {
        const { container } = render(
            <Provider store={createStore()}>
                <FPSharedPanel folder={null} collections={collections} isOpen={false} onClose={jest.fn()} />
            </Provider>,
        );
        expect(container).toBeEmptyDOMElement();
    });
});

describe('describeActivityEvent', () => {
    const self = 'gil@example.com';

    test.each([
        [{ actorEmail: 'amy@x.com', action: 'collection_updated', subject: 'c1', detail: '{"name":"Docs"}' }, 'amy@x.com updated “Docs”'],
        [{ actorEmail: 'amy@x.com', action: 'collection_deleted', subject: 'c1', detail: '{"name":"Docs"}' }, 'amy@x.com deleted “Docs”'],
        [{ actorEmail: self, action: 'folder_renamed', detail: '{"from":"Old","to":"New"}' }, 'You renamed the folder from “Old” to “New”'],
        [{ actorEmail: 'amy@x.com', action: 'member_left' }, 'amy@x.com left the folder'],
        [{ actorEmail: self, action: 'member_removed', subject: 'amy@x.com' }, 'You removed amy@x.com'],
        [{ actorEmail: 'amy@x.com', action: 'role_changed', subject: self, detail: '{"role":"write"}' }, 'amy@x.com changed your role to write'],
    ])('describes %j', (event, expected) => {
        expect(describeActivityEvent(event, self)).toBe(expected);
    });
});
