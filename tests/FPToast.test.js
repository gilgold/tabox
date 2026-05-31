/** @jest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { FPToast } from '../app/fullpage/FPToast';
import toast from 'react-hot-toast';

jest.mock('react-hot-toast', () => ({
    __esModule: true,
    default: {
        dismiss: jest.fn(),
    },
}));

describe('FPToast', () => {
    beforeEach(() => {
        toast.dismiss.mockReset();
    });

    test('renders a visible success toast and closes it', () => {
        render(
            <FPToast
                t={{ id: 'toast-1' }}
                variant="success"
                title="Saved"
                message="Collection updated"
                duration={4000}
                visible={true}
            />,
        );

        expect(screen.getByText('Saved')).toBeInTheDocument();
        expect(screen.getByText('Collection updated')).toBeInTheDocument();

        fireEvent.click(screen.getByTitle('Close'));

        expect(toast.dismiss).toHaveBeenCalledWith('toast-1');
    });

    test('runs undo actions before dismissing undo toasts', async () => {
        const undoAction = jest.fn(async () => {});

        render(
            <FPToast
                t={{ id: 'toast-2' }}
                variant="undo"
                title="Deleted"
                undoAction={undoAction}
                visible={true}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: /Undo/i }));

        await waitFor(() => {
            expect(undoAction).toHaveBeenCalledTimes(1);
        });
        expect(toast.dismiss).toHaveBeenCalledWith('toast-2');
    });
});
