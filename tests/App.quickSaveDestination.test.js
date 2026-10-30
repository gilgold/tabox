import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import { createBrowserHarness } from './helpers/browserHarness';
import { showSuccessToast, showErrorToast } from '../app/toastHelpers';

const mockBrowserProxy = new Proxy({}, { get: (_target, property) => global.browser?.[property] });
jest.mock('../static/globals', () => ({ browser: mockBrowserProxy }));
jest.mock('../app/Header', () => () => null);
jest.mock('../app/CollectionList', () => () => null);
jest.mock('../app/Footer', () => () => null);
jest.mock('../app/fullpage/FPLayout', () => () => null);
jest.mock('../app/CommandPalette', () => () => null);
jest.mock('../app/CollectionListOptions', () => ({ CollectionListOptions: () => null }));
jest.mock('react-tooltip', () => ({ Tooltip: () => null }));
jest.mock('../app/toastHelpers', () => ({
    ...jest.requireActual('../app/toastHelpers'),
    showSuccessToast: jest.fn(), showErrorToast: jest.fn(),
}));
const App = require('../app/App').default;

const folder = { uid: 'project', name: 'Project', color: '#1698e2', lastUpdated: 100, order: 0 };
let harness;
beforeEach(() => {
    jest.clearAllMocks();
    harness = createBrowserHarness({ localData: {
        collections_index: {}, folders_index: { project: { ...folder, collectionCount: 0 } },
        folder_project: folder, tabox_storage_version: 3,
    } });
    harness.tabs.query.mockImplementation(async query => query.highlighted ? [
        { id: 1, title: 'Selected A', url: 'https://example.com/a', highlighted: true },
        { id: 2, title: 'Selected B', url: 'https://example.com/b', highlighted: true },
    ] : [{ id: 3, title: 'Unselected', url: 'https://example.com/c' }]);
    global.browser = harness;
    global.chrome = { runtime: harness.runtime };
});
afterEach(() => { cleanup(); delete global.browser; delete global.chrome; });
async function openForm() {
    render(<Provider store={createStore()}><App /></Provider>);
    const picker = await screen.findByRole('combobox', { name: 'Save To' });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Reading' } });
    fireEvent.change(picker, { target: { value: 'project' } });
    return picker;
}

test('real popup → App → indexed storage saves selected tabs into the chosen folder and refreshes its count', async () => {
    await openForm();
    fireEvent.click(screen.getByRole('button', { name: 'Add Collection' }));
    await waitFor(() => expect(showSuccessToast).toHaveBeenCalled());
    const stored = await harness.storage.local.get(null);
    const [uid, entry] = Object.entries(stored.collections_index)[0];
    expect(entry.parentId).toBe('project');
    expect(stored[`collection_${uid}`].parentId).toBe('project');
    expect(stored[`collection_${uid}`].tabs.map(t => t.url)).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect(stored.folder_project.collectionCount).toBe(1);
    expect(stored.folders_index.project.collectionCount).toBe(1);
    expect(harness.runtime.sendMessage).toHaveBeenCalledWith({ type: 'updateRemote' });
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Save To' })).toHaveValue('');
});

test('permission changes during tab capture are rejected by the actual save path, preserving the form', async () => {
    await openForm();
    const query = harness.tabs.query.getMockImplementation();
    harness.tabs.query.mockImplementation(async options => {
        if (options.currentWindow) {
            await harness.storage.local.set({ folder_project: { ...folder, shared: { folderId: 'remote', role: 'read' } } });
        }
        return query(options);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Collection' }));
    await waitFor(() => expect(showErrorToast).toHaveBeenCalled());
    const stored = await harness.storage.local.get(null);
    expect(stored.collections_index).toEqual({});
    expect(Object.keys(stored).filter(key => key.startsWith('collection_'))).toEqual([]);
    expect(showSuccessToast).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('Reading');
});

test('a destination becoming shared during capture uses shared upload without an extra Drive sync', async () => {
    await openForm();
    const query = harness.tabs.query.getMockImplementation();
    harness.tabs.query.mockImplementation(async options => {
        if (options.currentWindow) {
            await harness.storage.local.set({ folder_project: { ...folder, shared: { folderId: 'remote', role: 'write' } } });
        }
        return query(options);
    });
    harness.runtime.sendMessage.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Add Collection' }));
    await waitFor(() => expect(showSuccessToast).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Collection' })).not.toBeDisabled());
    expect(harness.runtime.sendMessage).toHaveBeenCalledWith({ type: 'sharedSyncNow' });
    expect(harness.runtime.sendMessage).not.toHaveBeenCalledWith({ type: 'updateRemote' });
});


test('a personal destination becoming shared during storage preparation uses exactly one shared upload and no Drive clock', async () => {
    await openForm();
    const get = harness.storage.local.get.getMockImplementation();
    let injected = false;
    let appReadPersonal = false;
    harness.storage.local.get.mockImplementation(async keys => {
        const result = await get(keys);
        if (keys === 'folder_project' && !injected) appReadPersonal = !result.folder_project.shared;
        if (keys === 'collections_index' && !injected) {
            expect(appReadPersonal).toBe(true);
            injected = true;
            const shared = { ...folder, shared: { folderId: 'remote', role: 'write' } };
            await harness.storage.local.set({ folder_project: shared, folders_index: { project: shared } });
        }
        return result;
    });
    harness.runtime.sendMessage.mockClear();
    harness.storage.local.set.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Add Collection' }));
    await waitFor(() => expect(showSuccessToast).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Collection' })).not.toBeDisabled());
    expect(injected).toBe(true);
    const stored = await get(null);
    const [[uid, entry]] = Object.entries(stored.collections_index);
    expect(entry.parentId).toBe('project');
    expect(stored[`collection_${uid}`].parentId).toBe('project');
    expect(stored.folder_project.collectionCount).toBe(1);
    expect(stored.folders_index.project.collectionCount).toBe(1);
    expect(harness.runtime.sendMessage.mock.calls.filter(([m]) => m?.type === 'sharedSyncNow')).toHaveLength(1);
    expect(harness.runtime.sendMessage).not.toHaveBeenCalledWith({ type: 'updateRemote' });
    expect(harness.storage.local.set.mock.calls.filter(([values]) => Object.hasOwn(values, 'localTimestamp'))).toEqual([]);
    expect(stored.localTimestamp).toBeUndefined();
});
