import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import AddNewTextbox from '../app/AddNewTextbox';
import { searchState, syncInProgressState } from '../app/atoms/globalAppSettingsState';
import { getCurrentTabsAndGroups, getAllWindowsTabsAndGroups } from '../app/utils';
import { showErrorToast, showSuccessToast } from '../app/toastHelpers';
import { triggerBackgroundSync } from '../app/utils/sharedSync';

jest.mock('../app/utils', () => ({
    ...jest.requireActual('../app/utils'),
    getCurrentTabsAndGroups: jest.fn(),
    getAllWindowsTabsAndGroups: jest.fn(),
}));
jest.mock('../app/toastHelpers', () => ({ showErrorToast: jest.fn(), showSuccessToast: jest.fn() }));
jest.mock('../app/utils/sharedSync', () => ({ triggerBackgroundSync: jest.fn() }));

const folders = [
    { uid: 'personal', name: 'Project', color: '#1698e2' },
    { uid: 'team', name: 'Project', shared: { folderId: 'remote', role: 'write' } },
    { uid: 'owner', name: 'Owned', shared: { folderId: 'owned', role: 'owner' } },
    { uid: 'readonly', name: 'Reference', shared: { folderId: 'read', role: 'read' } },
];
function setup(props = {}) {
    const store = createStore();
    const addCollection = jest.fn().mockResolvedValue(true);
    const onDataUpdate = jest.fn();
    const merged = { folders, addCollection, onDataUpdate, ...props };
    const view = render(<Provider store={store}><AddNewTextbox {...merged} /></Provider>);
    return { ...view, store, addCollection, onDataUpdate,
        update: next => view.rerender(<Provider store={store}><AddNewTextbox {...merged} {...next} /></Provider>),
    };
}
const name = () => fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Reading' } });
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Add Collection' }));

beforeEach(() => {
    jest.clearAllMocks();
    browser.windows.getAll.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    browser.tabs.query.mockResolvedValue([]);
    browser.storage.local.get.mockImplementation(async key => ({ [key]: folders.find(folder => `folder_${folder.uid}` === key) }));
    getCurrentTabsAndGroups.mockImplementation(async () => ({ uid: 'new', tabs: [{ url: 'https://example.com/', highlighted: true }], chromeGroups: [] }));
});

test('defaults to root and exposes only writable existing destinations, using UIDs for duplicate names', async () => {
    const { addCollection, store } = setup();
    const select = screen.getByRole('combobox', { name: 'Save To' });
    expect(select).toHaveValue('');
    expect(Array.from(select.options).map(o => o.value)).toEqual(['', 'personal', 'team', 'owner']);
    name();
    expect(store.get(searchState)).toBe('Reading');
    fireEvent.change(select, { target: { value: 'team' } });
    select.focus();
    fireEvent.keyDown(select, { key: 'ArrowDown' });
    fireEvent.keyDown(select, { key: 'Enter' });
    expect(addCollection).not.toHaveBeenCalled();
    save();
    await waitFor(() => expect(showSuccessToast).toHaveBeenCalled());
    expect(addCollection).toHaveBeenCalledWith(expect.objectContaining({ parentId: 'team', tabs: [expect.objectContaining({ highlighted: true })] }), false, true);
    expect(triggerBackgroundSync).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(select).toHaveValue('');
    expect(store.get(searchState)).toBe('');
});

test.each([{ eligible: [] }, { eligible: [folders[3]] }])('hides destination when no writable folders exist: %j', async ({ eligible }) => {
    const { addCollection } = setup({ folders: eligible });
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    name();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    await waitFor(() => expect(showSuccessToast).toHaveBeenCalled());
    expect(addCollection.mock.calls[0][0].parentId).toBeFalsy();
    expect(triggerBackgroundSync).toHaveBeenCalledWith({ updateLocalTimestamp: false });
});

test.each(['false', 'throw'])('retains name, search and destination without a success or refresh on %s save', async failure => {
    const addCollection = failure === 'false' ? jest.fn().mockResolvedValue(false) : jest.fn().mockRejectedValue(new Error('Storage unavailable'));
    const { store, onDataUpdate } = setup({ addCollection });
    name();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'personal' } });
    save();
    await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith(expect.stringContaining('Failed to save')));
    expect(screen.getByRole('textbox')).toHaveValue('Reading');
    expect(screen.getByRole('combobox')).toHaveValue('personal');
    expect(store.get(searchState)).toBe('Reading');
    expect(onDataUpdate).not.toHaveBeenCalled();
    expect(showSuccessToast).not.toHaveBeenCalled();
    expect(triggerBackgroundSync).not.toHaveBeenCalled();
});

test.each(['deleted', 'read-only'])('a %s selected folder cannot silently become a root save', async change => {
    const { update, addCollection } = setup();
    name();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'personal' } });
    update({ folders: change === 'deleted' ? [] : [{ ...folders[0], shared: { folderId: 'remote', role: 'read' } }] });
    save();
    await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith(expect.stringMatching(/destination.*(available|writable)/i)));
    expect(addCollection).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('Reading');
    expect(screen.getByRole('combobox')).toHaveValue('personal');
});

test('personal destination syncs and root quick save remains the default after success', async () => {
    const { addCollection } = setup();
    name();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'personal' } });
    save();
    await waitFor(() => expect(showSuccessToast).toHaveBeenCalled());
    expect(triggerBackgroundSync).toHaveBeenCalledWith({ updateLocalTimestamp: false });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Collection' })).not.toBeDisabled());
    name();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    await waitFor(() => expect(addCollection).toHaveBeenCalledTimes(2));
    expect(addCollection.mock.calls[1][0].parentId).toBeFalsy();
});

test('All Windows hides the existing destination and saves only into its newly created folder', async () => {
    const addFolder = jest.fn().mockResolvedValue({ uid: 'fresh-folder' });
    getAllWindowsTabsAndGroups.mockResolvedValue({ folder: { name: 'Reading', color: 'default', collapsed: true }, collections: [{ uid: 'window-1', tabs: [] }] });
    const { addCollection } = setup({ addFolder });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save all windows as folder' })).not.toBeDisabled());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'personal' } });
    name();
    fireEvent.click(screen.getByRole('button', { name: 'Save all windows as folder' }));
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add Folder' }));
    await waitFor(() => expect(showSuccessToast).toHaveBeenCalled());
    expect(addCollection).toHaveBeenCalledWith(expect.objectContaining({ parentId: 'fresh-folder' }), true, true);
});

test('locks the form while saving, prevents duplicate Enter, and resets immediately after local success while sync is pending', async () => {
    let completeSave;
    let completeSync;
    const pendingSave = new Promise(resolve => { completeSave = resolve; });
    triggerBackgroundSync.mockImplementationOnce(() => new Promise(resolve => { completeSync = resolve; }));
    const addCollection = jest.fn(() => pendingSave);
    const { store } = setup({ addCollection });
    name();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'personal' } });
    save();
    await waitFor(() => expect(addCollection).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save all windows as folder' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(addCollection).toHaveBeenCalledTimes(1);
    completeSave(true);
    await waitFor(() => expect(triggerBackgroundSync).toHaveBeenCalled());
    expect(showSuccessToast).toHaveBeenCalled();
    expect(store.get(syncInProgressState)).toBe(true);
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.getByRole('combobox')).toHaveValue('');
    completeSync();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Collection' })).not.toBeDisabled());
    expect(store.get(syncInProgressState)).toBe(false);
});

test('a sync failure after local success reports that the collection was saved and leaves the form reset', async () => {
    triggerBackgroundSync.mockRejectedValueOnce(new Error('Offline'));
    const { addCollection } = setup();
    name();
    save();
    await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith(expect.stringMatching(/saved locally.*sync failed/i)));
    expect(addCollection).toHaveBeenCalledTimes(1);
    expect(showSuccessToast).toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.getByRole('combobox')).toHaveValue('');
});


test('if the persisted destination cannot be rechecked after a successful save, it avoids routing a possibly shared write to Drive', async () => {
    browser.storage.local.get.mockResolvedValue({});
    setup();
    name();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'team' } });
    save();
    await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith(expect.stringMatching(/saved locally.*destination.*sync/i)));
    expect(showSuccessToast).toHaveBeenCalled();
    expect(triggerBackgroundSync).not.toHaveBeenCalled();
});
