import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import AddNewTextbox from '../app/AddNewTextbox';
import { searchState, syncInProgressState, isLoggedInState } from '../app/atoms/globalAppSettingsState';
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

const pill = () => screen.getByRole('button', { name: /^Save to folder:/ });
const choose = uid => {
    pill().focus();
    fireEvent.click(pill());
    fireEvent.click(document.querySelector(`[data-folder-uid="${uid}"]`));
};

beforeEach(() => {
    jest.clearAllMocks();
    browser.windows.getAll.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    browser.tabs.query.mockResolvedValue([]);
    browser.storage.local.get.mockImplementation(async key => ({ [key]: folders.find(folder => `folder_${folder.uid}` === key) }));
    getCurrentTabsAndGroups.mockImplementation(async () => ({ uid: 'new', window: { id: 10 }, tabs: [{ url: 'https://example.com/', highlighted: true }], chromeGroups: [] }));
});

test('root is always a grey folder button inside the left edge of the textbox border', () => {
    const { container } = setup({ folders: [] });
    const pill = screen.getByRole('button', { name: 'Save to folder: root' });
    const input = screen.getByRole('textbox');
    expect(pill).toHaveTextContent(/^root$/);
    expect(pill).toHaveClass('quick-save-pill', 'is-root');
    expect(pill.querySelector('svg')).toBeInTheDocument();
    expect(pill).toHaveAttribute('type', 'button');
    expect(pill).toHaveAttribute('aria-haspopup', 'dialog');
    expect(pill.parentElement).toBe(input.parentElement.parentElement);
    expect(pill.nextElementSibling).toContainElement(input);
    expect(container.querySelector('.quick-save-destination')).toBeNull();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});

test('defaults to root and exposes only writable existing destinations, using UIDs for duplicate names', async () => {
    const { addCollection, store } = setup();
    expect(pill()).toHaveTextContent('root');
    name();
    expect(store.get(searchState)).toBe('Reading');
    pill().focus();
    fireEvent.click(pill());
    const dialog = screen.getByRole('dialog', { name: 'Save to folder' });
    expect(Array.from(dialog.querySelectorAll('[data-folder-uid]')).map(o => o.dataset.folderUid)).toEqual(['', 'personal', 'team', 'owner']);
    fireEvent.click(dialog.querySelector('[data-folder-uid="team"]'));
    expect(addCollection).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('Reading');
    expect(store.get(searchState)).toBe('Reading');
    save();
    await waitFor(() => expect(showSuccessToast).toHaveBeenCalled());
    expect(addCollection).toHaveBeenCalledWith(expect.objectContaining({ parentId: 'team', tabs: [expect.objectContaining({ highlighted: true })] }), false, true, { sourceWindowId: 10 });
    expect(triggerBackgroundSync).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(pill()).toHaveTextContent('root');
    expect(store.get(searchState)).toBe('');
});

test.each([{ eligible: [] }, { eligible: [folders[3]] }])('keeps the root destination when no writable folders exist: %j', async ({ eligible }) => {
    const { addCollection } = setup({ folders: eligible });
    expect(pill()).toHaveTextContent('root');
    fireEvent.click(pill());
    expect(screen.getAllByRole('button', { name: 'root', exact: true })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
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
    choose('personal');
    save();
    await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith(expect.stringContaining('Failed to save')));
    expect(screen.getByRole('textbox')).toHaveValue('Reading');
    expect(pill()).toHaveAccessibleName('Save to folder: Project');
    expect(store.get(searchState)).toBe('Reading');
    expect(onDataUpdate).not.toHaveBeenCalled();
    expect(showSuccessToast).not.toHaveBeenCalled();
    expect(triggerBackgroundSync).not.toHaveBeenCalled();
});

test.each(['deleted', 'read-only'])('a %s selected folder cannot silently become a root save', async change => {
    const { update, addCollection } = setup();
    name();
    choose('personal');
    update({ folders: change === 'deleted' ? [] : [{ ...folders[0], shared: { folderId: 'remote', role: 'read' } }] });
    save();
    await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith(expect.stringMatching(/destination.*(available|writable)/i)));
    expect(addCollection).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('Reading');
    expect(pill()).toHaveAccessibleName('Save to folder: Destination unavailable — choose again');
});

test('personal destination syncs and root quick save remains the default after success', async () => {
    const { addCollection } = setup();
    name();
    choose('personal');
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
    getAllWindowsTabsAndGroups.mockResolvedValue({ folder: { name: 'Reading', color: 'default', collapsed: true }, collections: [{ uid: 'window-1', window: { id: 11 }, tabs: [] }] });
    const { addCollection } = setup({ addFolder });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save all windows as folder' })).not.toBeDisabled());
    choose('personal');
    name();
    fireEvent.click(screen.getByRole('button', { name: 'Save all windows as folder' }));
    expect(screen.queryByRole('button', { name: /^Save to folder:/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add Folder' }));
    await waitFor(() => expect(showSuccessToast).toHaveBeenCalled());
    expect(addCollection).toHaveBeenCalledWith(expect.objectContaining({ parentId: 'fresh-folder' }), true, true, { sourceWindowId: 11 });
});

test('locks the form while saving, prevents duplicate Enter, and resets immediately after local success while sync is pending', async () => {
    let completeSave;
    let completeSync;
    const pendingSave = new Promise(resolve => { completeSave = resolve; });
    triggerBackgroundSync.mockImplementationOnce(() => new Promise(resolve => { completeSync = resolve; }));
    const addCollection = jest.fn(() => pendingSave);
    const { store } = setup({ addCollection });
    name();
    choose('personal');
    save();
    await waitFor(() => expect(addCollection).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(pill()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save all windows as folder' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(addCollection).toHaveBeenCalledTimes(1);
    completeSave(true);
    await waitFor(() => expect(triggerBackgroundSync).toHaveBeenCalled());
    expect(showSuccessToast).toHaveBeenCalled();
    expect(store.get(syncInProgressState)).toBe(true);
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(pill()).toHaveTextContent('root');
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
    expect(pill()).toHaveTextContent('root');
});


test('a false sync response reports local-only success for a signed-in user', async () => {
    triggerBackgroundSync.mockResolvedValueOnce(false);
    const { addCollection, store } = setup();
    act(() => store.set(isLoggedInState, true));
    name();
    save();
    await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith(expect.stringMatching(/saved locally.*sync failed/i)));
    expect(addCollection).toHaveBeenCalledTimes(1);
    expect(showSuccessToast).toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(store.get(syncInProgressState)).toBe(false);
    expect(screen.getByRole('button', { name: 'Add Collection' })).not.toBeDisabled();
});

test.each([true, false])('a signed-out save does not report a sync error when background returns %s', async result => {
    triggerBackgroundSync.mockResolvedValueOnce(result);
    setup();
    name();
    save();
    await waitFor(() => expect(showSuccessToast).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Collection' })).not.toBeDisabled());
    expect(showErrorToast).not.toHaveBeenCalled();
});

test('if the persisted destination cannot be rechecked after a successful save, it avoids routing a possibly shared write to Drive', async () => {
    browser.storage.local.get.mockResolvedValue({});
    setup();
    name();
    choose('team');
    save();
    await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith(expect.stringMatching(/saved locally.*destination.*sync/i)));
    expect(showSuccessToast).toHaveBeenCalled();
    expect(triggerBackgroundSync).not.toHaveBeenCalled();
});

test.each(['Cancel', 'Escape', 'backdrop'])('dialog %s preserves destination, query and tabs without writes and restores focus', async action => {
    const { store, addCollection } = setup();
    choose('personal');
    name();
    await waitFor(() => expect(browser.tabs.query).toHaveBeenCalled());
    const queryCalls = browser.tabs.query.mock.calls.length;
    browser.storage.local.set.mockClear();
    pill().focus();
    fireEvent.click(pill());
    const dialog = screen.getByRole('dialog', { name: 'Save to folder' });
    expect(within(dialog).getAllByRole('button', { name: 'Project', exact: true })[0]).toHaveAttribute('aria-pressed', 'true');
    if (action === 'Escape') fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape', keyCode: 27 });
    else if (action === 'backdrop') fireEvent.click(document.querySelector('.quick-save-modal-overlay'));
    else fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(pill()).toHaveFocus());
    expect(pill()).toHaveTextContent('Project');
    expect(screen.getByRole('textbox')).toHaveValue('Reading');
    expect(store.get(searchState)).toBe('Reading');
    expect(addCollection).not.toHaveBeenCalled();
    expect(browser.storage.local.set).not.toHaveBeenCalled();
    expect(triggerBackgroundSync).not.toHaveBeenCalled();
    expect(browser.tabs.query.mock.calls.length).toBe(queryCalls);
});

test('dialog handles live lists, long names, root selection and Enter without creating', async () => {
    const { update, addCollection, store } = setup();
    choose('team');
    name();
    pill().focus();
    fireEvent.click(pill());
    const longName = 'A very long folder name '.repeat(8).trim();
    update({ folders: [{ uid: 'long', name: longName, color: 'blue' }] });
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByRole('button', { name: 'Project' })).not.toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: 'Enter' });
    expect(addCollection).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: longName }));
    expect(pill()).toHaveAccessibleName(`Save to folder: ${longName}`);
    expect(pill()).toHaveAttribute('data-tooltip-content', longName);
    await waitFor(() => expect(pill()).toHaveFocus());
    choose('');
    expect(pill()).toHaveTextContent(/^root$/);
    expect(screen.getByRole('textbox')).toHaveValue('Reading');
    expect(store.get(searchState)).toBe('Reading');
    expect(addCollection).not.toHaveBeenCalled();
});

test('dialog arrow keys navigate UID choices without leaking keys to the popup', () => {
    setup();
    pill().focus();
    fireEvent.click(pill());
    const root = screen.getByRole('button', { name: 'root', exact: true });
    root.focus();
    const leaked = jest.fn();
    document.addEventListener('keydown', leaked);
    try {
        fireEvent.keyDown(root, { key: 'ArrowDown' });
        expect(document.querySelector('[data-folder-uid="personal"]')).toHaveFocus();
        fireEvent.keyDown(document.activeElement, { key: 'End' });
        expect(document.querySelector('[data-folder-uid="owner"]')).toHaveFocus();
        fireEvent.keyDown(document.activeElement, { key: 'Home' });
        expect(root).toHaveFocus();
        fireEvent.keyDown(root, { key: 'Enter' });
        expect(leaked).not.toHaveBeenCalled();
    } finally {
        document.removeEventListener('keydown', leaked);
    }
});

test('highlights the saved folder collection immediately instead of scrolling to root collections', async () => {
    const { highlightedCollectionUidState } = require('../app/atoms/animationsState');
    const { store } = setup();
    name();
    choose('personal');
    save();
    await waitFor(() => expect(showSuccessToast).toHaveBeenCalled());
    expect(store.get(highlightedCollectionUidState)).toBe('new');
});
