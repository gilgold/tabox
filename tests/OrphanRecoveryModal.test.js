/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import OrphanRecoveryModal from '../app/OrphanRecoveryModal';

const orphans = [
    { uid: 'a', name: 'Alpha', tabCount: 3 },
    { uid: 'b', name: 'Beta', tabCount: 1 },
];

test('renders the count and wires the three actions', () => {
    const onRestoreAll = jest.fn();
    const onChoose = jest.fn();
    const onDismiss = jest.fn();

    render(
        <OrphanRecoveryModal
            isOpen
            orphans={orphans}
            busy={false}
            onRestoreAll={onRestoreAll}
            onChoose={onChoose}
            onDismiss={onDismiss}
        />,
    );

    expect(screen.getByText(/2 collections/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /restore all/i }));
    expect(onRestoreAll).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /choose what to restore/i }));
    expect(onChoose).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /not now/i }));
    expect(onDismiss).toHaveBeenCalled();
});

test('disables actions while busy', () => {
    render(
        <OrphanRecoveryModal isOpen orphans={orphans} busy onRestoreAll={() => {}} onChoose={() => {}} onDismiss={() => {}} />,
    );
    expect(screen.getByRole('button', { name: /restoring/i })).toBeDisabled();
});

test('renders nothing when closed', () => {
    const { container } = render(
        <OrphanRecoveryModal isOpen={false} orphans={orphans} busy={false} onRestoreAll={() => {}} onChoose={() => {}} onDismiss={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
});
