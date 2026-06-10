/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import OrphanRecoveryModal from '../app/OrphanRecoveryModal';

const orphans = [
    { uid: 'a', name: 'Alpha', tabCount: 3 },
    { uid: 'b', name: 'Beta', tabCount: 1 },
];

test('prompt mode renders the count and wires restore-all and dismiss', () => {
    const onRestoreAll = jest.fn();
    const onDismiss = jest.fn();

    render(
        <OrphanRecoveryModal
            isOpen
            orphans={orphans}
            busy={false}
            onRestoreAll={onRestoreAll}
            onRestoreSelected={() => {}}
            onDismiss={onDismiss}
        />,
    );

    expect(screen.getByText(/2 collections/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /restore all/i }));
    expect(onRestoreAll).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /not now/i }));
    expect(onDismiss).toHaveBeenCalled();
});

test('"Choose what to restore" opens an inline checklist and restores the selected subset', () => {
    const onRestoreSelected = jest.fn();

    render(
        <OrphanRecoveryModal
            isOpen
            orphans={orphans}
            busy={false}
            onRestoreAll={() => {}}
            onRestoreSelected={onRestoreSelected}
            onDismiss={() => {}}
        />,
    );

    // Enter choose mode (does NOT dismiss / navigate away).
    fireEvent.click(screen.getByRole('button', { name: /choose what to restore/i }));

    // Both collections listed, all selected by default → "Restore 2 selected".
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes.every((cb) => cb.checked)).toBe(true);

    // Deselect Beta, then restore → only Alpha's uid is passed.
    fireEvent.click(checkboxes[1]);
    fireEvent.click(screen.getByRole('button', { name: /restore 1 selected/i }));
    expect(onRestoreSelected).toHaveBeenCalledWith(['a']);
});

test('restore-selected is disabled when nothing is selected', () => {
    render(
        <OrphanRecoveryModal isOpen orphans={orphans} busy={false} onRestoreAll={() => {}} onRestoreSelected={() => {}} onDismiss={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /choose what to restore/i }));
    screen.getAllByRole('checkbox').forEach((cb) => fireEvent.click(cb)); // deselect all
    expect(screen.getByRole('button', { name: /restore 0 selected/i })).toBeDisabled();
});

test('disables actions while busy', () => {
    render(
        <OrphanRecoveryModal isOpen orphans={orphans} busy onRestoreAll={() => {}} onRestoreSelected={() => {}} onDismiss={() => {}} />,
    );
    expect(screen.getByRole('button', { name: /restoring/i })).toBeDisabled();
});

test('renders nothing when closed', () => {
    const { container } = render(
        <OrphanRecoveryModal isOpen={false} orphans={orphans} busy={false} onRestoreAll={() => {}} onRestoreSelected={() => {}} onDismiss={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
});
