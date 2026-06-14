/** @jest-environment jsdom */
import { act, fireEvent, render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import CollectionDetailPanel from '../app/CollectionDetailPanel';
import { aiProcessingUidsState, aiProcessingCurrentUidState } from '../app/atoms/aiState';

// ── Module mocks ──────────────────────────────────────────────────────────────

jest.mock('javascript-time-ago', () => jest.fn().mockImplementation(() => ({
    format: jest.fn(() => '4 hours ago'),
})));

jest.mock('../app/useCollectionOperations', () => ({
    useCollectionOperations: jest.fn(() => ({
        _handleDelete: jest.fn(),
        _handleDuplicate: jest.fn(),
        _exportCollectionToFile: jest.fn(),
        _handleUpdate: jest.fn(),
        _handleOpenTabs: jest.fn(),
        _handleFocusWindow: jest.fn(),
        _handleStopTracking: jest.fn(),
    })),
}));

jest.mock('../app/ColorPicker', () => function MockColorPicker() {
    return <div data-testid="color-picker" />;
});

jest.mock('../app/ExpandedCollectionData', () => function MockExpandedCollectionData() {
    return <div data-testid="expanded-collection-data" />;
});

// AI-specific mocks
let mockAIEnabled = true;
jest.mock('../app/ai/useTaboxAIEnabled', () => ({
    useTaboxAIEnabled: () => mockAIEnabled,
}));

let mockAISupported = true;
jest.mock('../app/ai/aiClient', () => ({
    isAISupported: () => mockAISupported,
}));

const mockSuggestCollectionName = jest.fn();
jest.mock('../app/ai/tasks/suggestCollectionName', () => ({
    suggestCollectionName: (...args) => mockSuggestCollectionName(...args),
}));

// Only mock loadSingleCollection; keep the rest from the actual module to avoid
// import errors (the component may import other named exports).
const mockLoadSingleCollection = jest.fn();
jest.mock('../app/utils/storageUtils', () => ({
    ...jest.requireActual('../app/utils/storageUtils'),
    loadSingleCollection: (...args) => mockLoadSingleCollection(...args),
}));

const mockShowUndoToast = jest.fn();
const mockShowErrorToast = jest.fn();
const mockShowSuccessToast = jest.fn();
jest.mock('../app/toastHelpers', () => ({
    showUndoToast: (...args) => mockShowUndoToast(...args),
    showErrorToast: (...args) => mockShowErrorToast(...args),
    showSuccessToast: (...args) => mockShowSuccessToast(...args),
    showInfoToast: jest.fn(),
    UNDO_TIME: 10,
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseCollection = {
    uid: 'col-1',
    name: 'Old Name',
    tabs: [{ url: 'https://example.com', title: 'Example' }],
    chromeGroups: [],
    lastUpdated: Date.now(),
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const renderPanel = async (props = {}, store = undefined) => {
    let result;
    await act(async () => {
        result = render(
            <Provider store={store}>
                <CollectionDetailPanel
                    collection={baseCollection}
                    isOpen={true}
                    onClose={jest.fn()}
                    updateCollection={jest.fn()}
                    removeCollection={jest.fn()}
                    updateRemoteData={jest.fn()}
                    addCollection={jest.fn()}
                    onDataUpdate={jest.fn()}
                    renderInline={true}
                    {...props}
                />
            </Provider>,
        );
    });
    return result;
};

const getAiBtn = (container) => container.querySelector('.panel-ai-rename-btn');

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CollectionDetailPanel – AI rename button visibility', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockAIEnabled = true;
        mockAISupported = true;
        browser.storage.local.get.mockResolvedValue({});
    });

    test('button is absent when AI is disabled', async () => {
        mockAIEnabled = false;
        const { container } = await renderPanel();
        expect(getAiBtn(container)).toBeNull();
    });

    test('button is absent when AI is not supported', async () => {
        mockAISupported = false;
        const { container } = await renderPanel();
        expect(getAiBtn(container)).toBeNull();
    });

    test('button is present when AI is enabled and supported', async () => {
        const { container } = await renderPanel();
        expect(getAiBtn(container)).toBeInTheDocument();
    });

    test('button is absent while the title is being edited', async () => {
        const { container } = await renderPanel();
        const editBtn = container.querySelector('.panel-edit-btn:not(.panel-ai-rename-btn)');
        fireEvent.click(editBtn);
        expect(getAiBtn(container)).toBeNull();
    });
});

describe('CollectionDetailPanel – AI rename happy path', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockAIEnabled = true;
        mockAISupported = true;
        browser.storage.local.get.mockResolvedValue({});
    });

    test('click → suggest → updateCollection called with fresh data + new name + true', async () => {
        const freshCollection = { ...baseCollection, name: 'Old Name' };
        mockSuggestCollectionName.mockResolvedValue('New AI Name');
        mockLoadSingleCollection.mockResolvedValue(freshCollection);
        const updateCollection = jest.fn().mockResolvedValue(undefined);

        const { container } = await renderPanel({ updateCollection });

        await act(async () => {
            fireEvent.click(getAiBtn(container));
        });

        expect(mockSuggestCollectionName).toHaveBeenCalledWith(baseCollection);
        expect(mockLoadSingleCollection).toHaveBeenCalledWith(baseCollection.uid);
        expect(updateCollection).toHaveBeenCalledWith(
            expect.objectContaining({
                uid: freshCollection.uid,
                tabs: freshCollection.tabs,
                chromeGroups: freshCollection.chromeGroups,
                name: 'New AI Name',
                lastUpdated: expect.any(Number),
            }),
            true,
        );
    });

    test('undo toast is fired with old name in args after successful rename', async () => {
        const freshCollection = { ...baseCollection, name: 'Old Name' };
        mockSuggestCollectionName.mockResolvedValue('New AI Name');
        mockLoadSingleCollection.mockResolvedValue(freshCollection);

        const { container } = await renderPanel();

        await act(async () => {
            fireEvent.click(getAiBtn(container));
        });

        expect(mockShowUndoToast).toHaveBeenCalledTimes(1);
        const [, message, title] = mockShowUndoToast.mock.calls[0];
        expect(message).toContain('New AI Name');
        expect(title).toBe('Old Name');
    });
});

describe('CollectionDetailPanel – AI rename undo callback', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockAIEnabled = true;
        mockAISupported = true;
        browser.storage.local.get.mockResolvedValue({});
    });

    test('undo restores old name when current name still matches the AI name', async () => {
        const freshCollection = { ...baseCollection, name: 'Old Name' };
        // After rename, storage has the new name
        const renamedCollection = { ...baseCollection, name: 'New AI Name' };

        mockSuggestCollectionName.mockResolvedValue('New AI Name');
        mockLoadSingleCollection
            .mockResolvedValueOnce(freshCollection)    // first call during rename
            .mockResolvedValueOnce(renamedCollection); // call inside undo

        const updateCollection = jest.fn().mockResolvedValue(undefined);
        const { container } = await renderPanel({ updateCollection });

        await act(async () => {
            fireEvent.click(getAiBtn(container));
        });

        // Grab the undo callback that was passed to showUndoToast
        const undoFn = mockShowUndoToast.mock.calls[0][3];
        await act(async () => {
            await undoFn();
        });

        expect(updateCollection).toHaveBeenCalledTimes(2);
        expect(updateCollection).toHaveBeenLastCalledWith(
            expect.objectContaining({ name: 'Old Name' }),
            true,
        );
    });

    test('undo does NOT call updateCollection if name was manually changed since AI rename', async () => {
        const freshCollection = { ...baseCollection, name: 'Old Name' };
        // User manually renamed to something else after AI rename
        const manuallyRenamedCollection = { ...baseCollection, name: 'Manually Set Name' };

        mockSuggestCollectionName.mockResolvedValue('New AI Name');
        mockLoadSingleCollection
            .mockResolvedValueOnce(freshCollection)           // first call during rename
            .mockResolvedValueOnce(manuallyRenamedCollection); // undo check

        const updateCollection = jest.fn().mockResolvedValue(undefined);
        const { container } = await renderPanel({ updateCollection });

        await act(async () => {
            fireEvent.click(getAiBtn(container));
        });

        const undoFn = mockShowUndoToast.mock.calls[0][3];
        await act(async () => {
            await undoFn();
        });

        // Only the first rename call; undo should have bailed out
        expect(updateCollection).toHaveBeenCalledTimes(1);
    });
});

describe('CollectionDetailPanel – AI rename error cases', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockAIEnabled = true;
        mockAISupported = true;
        browser.storage.local.get.mockResolvedValue({});
    });

    test('suggest failure → error toast, updateCollection NOT called', async () => {
        mockSuggestCollectionName.mockRejectedValue(new Error('model failed'));
        const updateCollection = jest.fn();

        const { container } = await renderPanel({ updateCollection });

        await act(async () => {
            fireEvent.click(getAiBtn(container));
        });

        expect(mockShowErrorToast).toHaveBeenCalledWith(
            expect.stringContaining('Could not generate'),
        );
        expect(updateCollection).not.toHaveBeenCalled();
    });

    test('unchanged suggestion → success toast "already fits", no updateCollection', async () => {
        // suggestCollectionName returns the same name as the current collection
        mockSuggestCollectionName.mockResolvedValue(baseCollection.name);
        const updateCollection = jest.fn();

        const { container } = await renderPanel({ updateCollection });

        await act(async () => {
            fireEvent.click(getAiBtn(container));
        });

        expect(mockShowSuccessToast).toHaveBeenCalledWith(
            expect.stringMatching(/already fits/i),
        );
        expect(updateCollection).not.toHaveBeenCalled();
    });

    test('loadSingleCollection returns null → error toast, updateCollection NOT called', async () => {
        mockSuggestCollectionName.mockResolvedValue('Brand New Name');
        mockLoadSingleCollection.mockResolvedValue(null);
        const updateCollection = jest.fn();

        const { container } = await renderPanel({ updateCollection });

        await act(async () => {
            fireEvent.click(getAiBtn(container));
        });

        expect(mockShowErrorToast).toHaveBeenCalledWith(
            expect.stringContaining('no longer exists'),
        );
        expect(updateCollection).not.toHaveBeenCalled();
    });
});

describe('CollectionDetailPanel – AI rename processing effect', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockAIEnabled = true;
        mockAISupported = true;
        browser.storage.local.get.mockResolvedValue({});
    });

    test('while suggest is pending, .panel-title-slot has ai-name-processing class', async () => {
        let resolveSuggest;
        mockSuggestCollectionName.mockReturnValue(
            new Promise((resolve) => { resolveSuggest = resolve; }),
        );
        const store = createStore();
        const { container } = await renderPanel({}, store);

        // Start the rename (don't await — it's still pending)
        act(() => { fireEvent.click(getAiBtn(container)); });

        // The class should be present while the promise is unresolved
        expect(container.querySelector('.panel-title-slot')).toHaveClass('ai-name-processing');

        // Atom should reflect the processing uid
        expect(store.get(aiProcessingUidsState)).toContain(baseCollection.uid);
        expect(store.get(aiProcessingCurrentUidState)).toBe(baseCollection.uid);

        // Clean up: resolve so the test doesn't leak
        await act(async () => { resolveSuggest(null); });
    });

    test('after suggest resolves, ai-name-processing class is removed', async () => {
        let resolveSuggest;
        mockSuggestCollectionName.mockReturnValue(
            new Promise((resolve) => { resolveSuggest = resolve; }),
        );
        const store = createStore();
        const { container } = await renderPanel({}, store);

        act(() => { fireEvent.click(getAiBtn(container)); });

        // Confirm class is present before resolving
        expect(container.querySelector('.panel-title-slot')).toHaveClass('ai-name-processing');

        // Resolve with a new name and let the rename complete
        mockLoadSingleCollection.mockResolvedValue({ ...baseCollection });
        await act(async () => { resolveSuggest('Resolved Name'); });

        expect(container.querySelector('.panel-title-slot')).not.toHaveClass('ai-name-processing');
        expect(store.get(aiProcessingUidsState)).toEqual([]);
        expect(store.get(aiProcessingCurrentUidState)).toBeNull();
    });

    test('after suggest rejects, ai-name-processing class is removed', async () => {
        let rejectSuggest;
        mockSuggestCollectionName.mockReturnValue(
            new Promise((_, reject) => { rejectSuggest = reject; }),
        );
        const store = createStore();
        const { container } = await renderPanel({}, store);

        act(() => { fireEvent.click(getAiBtn(container)); });

        expect(container.querySelector('.panel-title-slot')).toHaveClass('ai-name-processing');

        await act(async () => { rejectSuggest(new Error('ai failed')); });

        expect(container.querySelector('.panel-title-slot')).not.toHaveClass('ai-name-processing');
        expect(store.get(aiProcessingUidsState)).toEqual([]);
        expect(store.get(aiProcessingCurrentUidState)).toBeNull();
    });
});
