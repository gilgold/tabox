/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import SplitCollectionPanel from '../app/SplitCollectionPanel';

const collections = [
    { uid: 'big', name: 'Big', tabs: new Array(40).fill({ url: 'https://a.com', title: 'A' }) },
    { uid: 'small', name: 'Small', tabs: new Array(5).fill({ url: 'https://b.com', title: 'B' }) },
];

function setup(props = {}) {
    const onStartScan = jest.fn();
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    render(
        <SplitCollectionPanel
            collections={collections}
            target={null}
            aiTaskState={null}
            busy={false}
            onStartScan={onStartScan}
            onConfirm={onConfirm}
            onCancel={onCancel}
            {...props}
        />
    );
    return { onStartScan, onConfirm, onCancel };
}

test('picker lists only collections at or above the threshold', () => {
    setup();
    expect(screen.getByText('Big')).toBeInTheDocument();
    expect(screen.queryByText('Small')).not.toBeInTheDocument();
});

test('selecting a collection in the picker starts the scan', () => {
    const { onStartScan } = setup();
    // The header toggles a tab preview; the explicit "Split" action starts the scan.
    fireEvent.click(screen.getByText('Split'));
    expect(onStartScan).toHaveBeenCalledWith('big');
});

test('clicking a picker card header expands its tab preview without scanning', () => {
    const { onStartScan } = setup();
    fireEvent.click(screen.getByText('Big'));
    expect(onStartScan).not.toHaveBeenCalled();
});

test('running state shows tab progress once batches start reporting', () => {
    setup({
        aiTaskState: { type: 'split-collection', status: 'running', filed: 80, total: 200 },
    });
    expect(screen.getByText(/Scanning tabs/)).toBeInTheDocument();
    expect(screen.getByText(/80\/200 tabs/)).toBeInTheDocument();
});

test('running state omits the counter before any progress is filed', () => {
    setup({
        aiTaskState: { type: 'split-collection', status: 'running', filed: 0, total: 200 },
    });
    expect(screen.getByText(/Scanning tabs/)).toBeInTheDocument();
    expect(screen.queryByText(/0\/200/)).not.toBeInTheDocument();
});

test('review state shows proposed sub-collections and a folder checkbox (default on)', () => {
    setup({
        aiTaskState: { type: 'split-collection', status: 'done', results: { ok: true, uid: 'big', name: 'Big', groups: [
            { name: 'First', tabIndices: [0], tabs: [{ url: 'https://a.com', title: 'A' }] },
            { name: 'Second', tabIndices: [1], tabs: [{ url: 'https://a.com', title: 'A' }] },
        ] } },
    });
    expect(screen.getByDisplayValue('First')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Second')).toBeInTheDocument();
    const checkbox = screen.getByRole('checkbox', { name: /group .* folder/i });
    expect(checkbox).toBeChecked();
});

test('confirm sends edited group names, folder choice, and uid', () => {
    const { onConfirm } = setup({
        aiTaskState: { type: 'split-collection', status: 'done', results: { ok: true, uid: 'big', name: 'Big', groups: [
            { name: 'First', tabIndices: [0], tabs: [{ url: 'https://a.com', title: 'A' }] },
            { name: 'Second', tabIndices: [1], tabs: [{ url: 'https://a.com', title: 'A' }] },
        ] } },
    });
    fireEvent.click(screen.getByText('Confirm split'));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
        uid: 'big',
        plan: { groups: [
            { name: 'First', tabIndices: [0] },
            { name: 'Second', tabIndices: [1] },
        ] },
        folder: { name: 'Big' },
    }));
});

test('non-splittable result shows a friendly message and no confirm button', () => {
    setup({ aiTaskState: { type: 'split-collection', status: 'done', results: { ok: false, reason: 'too-few-groups' } } });
    expect(screen.getByText(/couldn.t find a good way to split/i)).toBeInTheDocument();
    expect(screen.queryByText('Confirm split')).not.toBeInTheDocument();
});
