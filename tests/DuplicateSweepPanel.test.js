/** @jest-environment jsdom */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { DuplicateSweepPanel } from '../app/DuplicateSweepPanel';

const sweep = {
  state: {
    groups: [{
      id: 'cross:A|D', kind: 'cross', collectionUids: ['A', 'D'], status: 'pending',
      recommendation: { recommendedKeeperUid: 'D', message: 'These tabs appear in A and D — consider keeping them in D only.', suggestedNewCollectionName: 'Shared' },
      urls: [{ normalizedUrl: 'x.com', occurrences: [{}, {}] }],
    }],
    history: [],
  },
  apply: jest.fn(async () => ({ ok: true })),
  undo: jest.fn(async () => ({ ok: true })),
  dismiss: jest.fn(async () => ({ ok: true })),
};
const namesByUid = { A: 'Work', D: 'Reference' };

beforeEach(() => { sweep.apply.mockClear(); sweep.undo.mockClear(); sweep.dismiss.mockClear(); });

test('shows the Option 3 summary and preselects the recommended keep action', () => {
  render(<DuplicateSweepPanel sweep={sweep} namesByUid={namesByUid} />);

  expect(screen.getByText('Found in')).toBeInTheDocument();
  const locations = screen.getByRole('list', { name: 'Collections containing these tabs' });
  expect(within(locations).getByText('Work')).toHaveClass('dup-sweep-collection-name');
  expect(within(locations).getByText('Reference')).toHaveClass('dup-sweep-collection-name');
  expect(screen.getByText(/duplicate copies/i)).toHaveTextContent('1 tab has duplicate copies.');
  expect(screen.getByText('What should happen?')).toBeInTheDocument();

  const keep = screen.getByRole('radio', { name: /Keep one copy/i });
  expect(keep).toHaveAttribute('aria-checked', 'true');
  expect(keep).toHaveTextContent('Keep these tabs in Reference');
  expect(keep).toHaveTextContent('Remove duplicates from Work');

  fireEvent.click(screen.getByRole('button', { name: /Apply choice/i }));
  expect(sweep.apply).toHaveBeenCalledWith({ groupId: 'cross:A|D', action: 'keep-one', keeperUid: 'D', applyToAll: false });
});

test('formats duplicates within one collection as one clear choice', () => {
  const withinCollection = {
    ...sweep,
    state: {
      history: [],
      groups: [{
        ...sweep.state.groups[0],
        id: 'within:A',
        kind: 'within',
        collectionUids: ['A'],
        recommendation: { recommendedKeeperUid: 'A', message: 'Work contains the same tab more than once.' },
      }],
    },
  };

  render(<DuplicateSweepPanel sweep={withinCollection} namesByUid={namesByUid} />);
  const choice = screen.getByRole('radio', { name: /Remove duplicate copies/i });
  expect(choice).toHaveAttribute('aria-checked', 'true');
  expect(choice).toHaveTextContent('Keep one copy of each tab in Work');
  fireEvent.click(screen.getByRole('button', { name: /Apply choice/i }));
  expect(sweep.apply).toHaveBeenCalledWith(expect.objectContaining({ action: 'dedupe-within' }));
});

test('Move to a new collection shows the AI-suggested name and applies extract', () => {
  render(<DuplicateSweepPanel sweep={sweep} namesByUid={namesByUid} />);
  const move = screen.getByRole('radio', { name: /Move to a new collection/i });
  expect(move).toHaveTextContent('Suggested name: Shared');
  fireEvent.click(move);
  expect(sweep.apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /Apply choice/i }));
  expect(sweep.apply).toHaveBeenCalledWith(expect.objectContaining({ action: 'extract' }));
});

test('summarizes additional remove-from collections without colliding with the badge', () => {
  const manyCollections = {
    ...sweep,
    state: {
      history: [],
      groups: [{
        ...sweep.state.groups[0],
        id: 'cross:A|B|C|D',
        collectionUids: ['A', 'B', 'C', 'D'],
        recommendation: { ...sweep.state.groups[0].recommendation, recommendedKeeperUid: 'A' },
      }],
    },
  };
  const names = { A: 'Keeper', B: 'A Very Long Collection Name', C: 'Admin', D: 'Test Copies' };

  render(<DuplicateSweepPanel sweep={manyCollections} namesByUid={names} />);
  const keep = screen.getByRole('radio', { name: /Keep one copy/i });
  const outcome = keep.querySelector('.dup-sweep-choice-outcome');
  expect(keep).toHaveClass('dup-sweep-choice--has-badge');
  expect(outcome).toHaveTextContent('Remove duplicates from A Very Long Collection Name +2 more');
  expect(outcome.textContent).toBe('Remove duplicates from\u00a0A Very Long Collection Name\u00a0+2 more');
  expect(outcome).not.toHaveTextContent('Admin');
  expect(outcome).toHaveAttribute(
    'data-tooltip-content',
    'Remove duplicates from A Very Long Collection Name, Admin, Test Copies',
  );
});

test('apply-to-all checkbox flows into the dispatched action', () => {
  render(<DuplicateSweepPanel sweep={sweep} namesByUid={namesByUid} />);
  fireEvent.click(screen.getByLabelText(/Use this choice for all remaining groups/i));
  fireEvent.click(screen.getByRole('radio', { name: /Remove every copy/i }));
  fireEvent.click(screen.getByRole('button', { name: /Apply choice/i }));
  expect(sweep.apply).toHaveBeenCalledWith(expect.objectContaining({ action: 'discard-all', applyToAll: true }));
});

test('undo button is disabled with empty history, enabled otherwise', () => {
  const withHistory = { ...sweep, state: { ...sweep.state, history: [{ actionId: '1' }] } };
  const { rerender } = render(<DuplicateSweepPanel sweep={sweep} namesByUid={namesByUid} />);
  expect(screen.getByRole('button', { name: /Undo last action/i })).toBeDisabled();
  rerender(<DuplicateSweepPanel sweep={withHistory} namesByUid={namesByUid} />);
  expect(screen.getByRole('button', { name: /Undo last action/i })).toBeEnabled();
});

test('celebrates completion and summarizes the sweep results', () => {
  const done = {
    ...sweep,
    state: {
      groups: [
        { ...sweep.state.groups[0], id: 'g1', status: 'resolved' },
        { ...sweep.state.groups[0], id: 'g2', status: 'resolved' },
        { ...sweep.state.groups[0], id: 'g3', status: 'resolved' },
      ],
      history: [
        { actionId: '1', action: 'keep-one', removedTabs: [{ collectionUid: 'A' }, { collectionUid: 'B' }] },
        { actionId: '2', action: 'extract', createdCollectionUid: 'new-1', removedTabs: [{ collectionUid: 'B' }, { collectionUid: 'C' }, { collectionUid: 'D' }] },
        { actionId: '3', action: 'skip', removedTabs: [] },
      ],
    },
  };
  render(<DuplicateSweepPanel sweep={done} namesByUid={namesByUid} />);
  expect(screen.getByRole('heading', { name: /Sweep complete/i })).toBeInTheDocument();
  expect(screen.getByText('5')).toHaveAccessibleName('5 tabs removed');
  expect(screen.getByText('1')).toHaveAccessibleName('1 new collection created');
  expect(screen.getByText('4')).toHaveAccessibleName('4 collections cleaned');
  expect(screen.getByText('1 skipped')).toBeInTheDocument();
  expect(document.querySelectorAll('.dup-sweep-confetti-piece')).toHaveLength(24);
});

test('shows step counter and progress bar reflecting resolved groups', () => {
  const twoGroups = {
    ...sweep,
    state: {
      history: [{ actionId: '1' }],
      groups: [
        { ...sweep.state.groups[0], id: 'g1', status: 'resolved' },
        { ...sweep.state.groups[0], id: 'g2', status: 'pending' },
      ],
    },
  };
  render(<DuplicateSweepPanel sweep={twoGroups} namesByUid={namesByUid} />);
  expect(screen.getByText(/2 of 2 duplicate groups/i)).toBeInTheDocument();
  const bar = screen.getByRole('progressbar');
  expect(bar).toHaveAttribute('aria-valuenow', '1');
  expect(bar).toHaveAttribute('aria-valuemax', '2');
  expect(bar.querySelector('.dup-sweep-progress-fill')).toHaveStyle({ width: '50%' });
});

test('first group shows 1 of 1 with an empty bar', () => {
  render(<DuplicateSweepPanel sweep={sweep} namesByUid={namesByUid} />);
  expect(screen.getByText(/1 of 1 duplicate groups/i)).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
});

test('End sweep dismisses the session, keeping choices made so far', () => {
  render(<DuplicateSweepPanel sweep={sweep} namesByUid={namesByUid} />);
  const end = screen.getByRole('button', { name: /End sweep/i });
  // explains itself via the shared rich tooltip, not native title
  expect(end).not.toHaveAttribute('title');
  expect(end).toHaveAttribute('data-tooltip-id', 'main-tooltip');
  fireEvent.click(end);
  expect(sweep.dismiss).toHaveBeenCalled();
});

const makeDoneSweep = (overrides = {}) => ({
  ...sweep,
  state: {
    groups: [{ ...sweep.state.groups[0], id: 'g1', status: 'resolved' }],
    history: [{ actionId: '1', action: 'keep-one', removedTabs: [{ collectionUid: 'A' }] }],
  },
  cleanupPreview: jest.fn(async () => ({
    ok: true,
    collections: [{ uid: 'A', name: 'Work' }, { uid: 'B', name: 'Old Stuff' }],
    folders: [{ uid: 'F', name: 'Archive', collectionUids: ['A'] }],
  })),
  cleanup: jest.fn(async () => ({ ok: true, removedCollections: 2, removedFolders: 1 })),
  ...overrides,
});

test('completion screen lists sweep-emptied items as chips, all selected, and removes them', async () => {
  const done = makeDoneSweep();
  render(<DuplicateSweepPanel sweep={done} namesByUid={namesByUid} />);

  expect(await screen.findByText(/left 2 collections and 1 folder empty/i)).toBeInTheDocument();
  const list = screen.getByRole('list', { name: /Empty collections and folders/i });
  for (const name of ['Work', 'Old Stuff', 'Archive']) {
    expect(within(list).getByRole('checkbox', { name: new RegExp(name) })).toHaveAttribute('aria-checked', 'true');
  }

  const remove = screen.getByRole('button', { name: /Remove selected \(3\)/i });
  // rich tooltip, not native title
  expect(remove).not.toHaveAttribute('title');
  expect(remove).toHaveAttribute('data-tooltip-id', 'main-tooltip');
  fireEvent.click(remove);
  expect(done.cleanup).toHaveBeenCalledWith({ collectionUids: ['A', 'B'], folderUids: ['F'] });
  await waitFor(() => expect(remove).toBeEnabled()); // async handler settles
});

test('deselecting a chip excludes it; deselecting a folder’s last collection disables the folder', async () => {
  const done = makeDoneSweep();
  render(<DuplicateSweepPanel sweep={done} namesByUid={namesByUid} />);
  await screen.findByText(/left 2 collections and 1 folder empty/i);

  // Deselect the "Old Stuff" collection — count drops, it's excluded from the payload.
  fireEvent.click(screen.getByRole('checkbox', { name: /Old Stuff/ }));
  expect(screen.getByRole('checkbox', { name: /Old Stuff/ })).toHaveAttribute('aria-checked', 'false');
  expect(screen.getByRole('button', { name: /Remove selected \(2\)/i })).toBeInTheDocument();

  // Deselect "Work" — folder Archive only holds Work, so it can't be removed anymore.
  fireEvent.click(screen.getByRole('checkbox', { name: /Work/ }));
  const folderChip = screen.getByRole('checkbox', { name: /Archive/ });
  expect(folderChip).toHaveAttribute('aria-checked', 'false');
  expect(folderChip).toHaveAttribute('aria-disabled', 'true');
  expect(folderChip).toHaveAttribute('data-tooltip-id', 'main-tooltip');
  const remove = screen.getByRole('button', { name: /Remove selected/i });
  expect(remove).toBeDisabled();

  // Clicking the disabled folder chip does nothing; re-selecting Work re-enables it.
  fireEvent.click(folderChip);
  expect(folderChip).toHaveAttribute('aria-checked', 'false');
  fireEvent.click(screen.getByRole('checkbox', { name: /Work/ }));
  expect(screen.getByRole('checkbox', { name: /Archive/ })).toHaveAttribute('aria-checked', 'true');

  fireEvent.click(screen.getByRole('button', { name: /Remove selected \(2\)/i }));
  expect(done.cleanup).toHaveBeenCalledWith({ collectionUids: ['A'], folderUids: ['F'] });
  await waitFor(() => expect(screen.getByRole('button', { name: /Remove selected/i })).toBeEnabled());
});

test('completion screen shows no cleanup section when nothing was left empty', async () => {
  const done = {
    ...sweep,
    state: {
      groups: [{ ...sweep.state.groups[0], id: 'g1', status: 'resolved' }],
      history: [{ actionId: '1', action: 'skip', removedTabs: [] }],
    },
    cleanupPreview: jest.fn(async () => ({ ok: true, collections: [], folders: [] })),
    cleanup: jest.fn(),
  };
  render(<DuplicateSweepPanel sweep={done} namesByUid={namesByUid} />);
  await screen.findByRole('heading', { name: /Sweep complete/i });
  expect(done.cleanupPreview).toHaveBeenCalled();
  expect(screen.queryByText(/left .* empty/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Remove them/i })).not.toBeInTheDocument();
});

test('reveals/hides the duplicated tabs with favicon, title, and url tooltip', () => {
  const s = {
    apply: jest.fn(), undo: jest.fn(), dismiss: jest.fn(),
    state: { history: [], groups: [{
      id: 'cross:A|D', kind: 'cross', collectionUids: ['A', 'D'], status: 'pending',
      recommendation: { recommendedKeeperUid: 'D', message: 'msg', suggestedNewCollectionName: 'S', bestTitlePerUrl: [] },
      urls: [{ normalizedUrl: 'x.com/p', occurrences: [
        { collectionUid: 'A', title: 'Example Page', url: 'https://x.com/p', tab: { uid: 'a1', url: 'https://x.com/p', title: 'Example Page', favIconUrl: 'https://x.com/ic.png' } },
        { collectionUid: 'D', title: 'Example Page', url: 'https://x.com/p', tab: { uid: 'd1', url: 'https://x.com/p', title: 'Example Page' } },
      ] }],
    }] },
  };
  render(<DuplicateSweepPanel sweep={s} namesByUid={namesByUid} />);
  // collapsed by default in the compact Option 3 layout
  expect(screen.queryByText('Example Page')).not.toBeInTheDocument();
  const previewButton = screen.getByRole('button', { name: /Preview the 1 affected tab/i });
  fireEvent.click(previewButton);
  const title = screen.getByText('Example Page');
  expect(title).toBeInTheDocument();
  // Disclosure and its independently scrollable list share one visual container.
  const previewContainer = previewButton.closest('.dup-tab-preview');
  expect(previewContainer).toContainElement(title.closest('.dup-tab-list'));
  // URL is surfaced via the shared rich tooltip (react-tooltip), not native title.
  const row = title.closest('li');
  expect(row).not.toHaveAttribute('title');
  expect(row).toHaveAttribute('data-tooltip-id', 'main-tooltip');
  expect(row).toHaveAttribute('data-tooltip-content', 'https://x.com/p');
  // collapse
  fireEvent.click(screen.getByRole('button', { name: /Hide the 1 affected tab/i }));
  expect(screen.queryByText('Example Page')).not.toBeInTheDocument();
});
