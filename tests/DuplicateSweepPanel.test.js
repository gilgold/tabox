/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
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

test('shows the AI message and resolves on collection-chip click', () => {
  render(<DuplicateSweepPanel sweep={sweep} namesByUid={namesByUid} />);
  expect(screen.getByText(/consider keeping them in D only/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Keep in Reference/i }));
  expect(sweep.apply).toHaveBeenCalledWith({ groupId: 'cross:A|D', action: 'keep-one', keeperUid: 'D', applyToAll: false });
});

test('Extract and Discard buttons dispatch their actions', () => {
  render(<DuplicateSweepPanel sweep={sweep} namesByUid={namesByUid} />);
  fireEvent.click(screen.getByRole('button', { name: /Extract to new collection/i }));
  expect(sweep.apply).toHaveBeenCalledWith(expect.objectContaining({ action: 'extract' }));
  fireEvent.click(screen.getByRole('button', { name: /Discard from all/i }));
  expect(sweep.apply).toHaveBeenCalledWith(expect.objectContaining({ action: 'discard-all' }));
});

test('apply-to-all checkbox flows into the dispatched action', () => {
  render(<DuplicateSweepPanel sweep={sweep} namesByUid={namesByUid} />);
  fireEvent.click(screen.getByLabelText(/Apply this action to all/i));
  fireEvent.click(screen.getByRole('button', { name: /Discard from all/i }));
  expect(sweep.apply).toHaveBeenCalledWith(expect.objectContaining({ action: 'discard-all', applyToAll: true }));
});

test('undo button is disabled with empty history, enabled otherwise', () => {
  const withHistory = { ...sweep, state: { ...sweep.state, history: [{ actionId: '1' }] } };
  const { rerender } = render(<DuplicateSweepPanel sweep={sweep} namesByUid={namesByUid} />);
  expect(screen.getByRole('button', { name: /Undo last action/i })).toBeDisabled();
  rerender(<DuplicateSweepPanel sweep={withHistory} namesByUid={namesByUid} />);
  expect(screen.getByRole('button', { name: /Undo last action/i })).toBeEnabled();
});

test('shows done state when no pending groups remain', () => {
  const done = { ...sweep, state: { groups: [{ ...sweep.state.groups[0], status: 'resolved' }], history: [{ actionId: '1' }] } };
  render(<DuplicateSweepPanel sweep={done} namesByUid={namesByUid} />);
  expect(screen.getByText(/All duplicates handled/i)).toBeInTheDocument();
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
  // expanded by default
  const title = screen.getByText('Example Page');
  expect(title).toBeInTheDocument();
  // URL is surfaced via the shared rich tooltip (react-tooltip), not native title.
  const row = title.closest('li');
  expect(row).not.toHaveAttribute('title');
  expect(row).toHaveAttribute('data-tooltip-id', 'main-tooltip');
  expect(row).toHaveAttribute('data-tooltip-content', 'https://x.com/p');
  // hide
  fireEvent.click(screen.getByRole('button', { name: /Hide 1 tab/i }));
  expect(screen.queryByText('Example Page')).not.toBeInTheDocument();
  // reveal again
  fireEvent.click(screen.getByRole('button', { name: /Show 1 tab/i }));
  expect(screen.getByText('Example Page')).toBeInTheDocument();
});
