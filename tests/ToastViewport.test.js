/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ToastViewport } from '../app/ToastViewport';

const mockToaster = jest.fn(() => <div data-testid="toaster" />);

jest.mock('react-hot-toast', () => ({
    Toaster: (props) => mockToaster(props),
}));

describe('ToastViewport', () => {
    beforeEach(() => {
        mockToaster.mockClear();
    });

    test('uses popup toast positioning by default', () => {
        render(<ToastViewport />);

        expect(screen.getByTestId('toaster')).toBeInTheDocument();
        expect(mockToaster).toHaveBeenCalledWith(expect.objectContaining({
            position: 'bottom-center',
            containerStyle: { bottom: 16 },
            containerClassName: 'tabox-toast-viewport tabox-toast-viewport--popup',
            toastOptions: expect.objectContaining({
                duration: 3000,
            }),
        }));
    });

    test('uses full-page toast positioning when requested', () => {
        render(<ToastViewport context="fullpage" />);

        expect(mockToaster).toHaveBeenCalledWith(expect.objectContaining({
            position: 'bottom-right',
            containerStyle: { bottom: 24, right: 24, zIndex: 2147483647 },
            containerClassName: 'tabox-toast-viewport tabox-toast-viewport--fullpage',
        }));
    });
});
