import {
    showUndoToast,
    showSuccessToast,
    showErrorToast,
    showInfoToast,
    setToastViewContext,
} from '../app/toastHelpers';
import toast from 'react-hot-toast';

// Mock react-hot-toast (already mocked in jest.setup.js, but let's verify behavior)
jest.mock('react-hot-toast', () => ({
    __esModule: true,
    default: {
        custom: jest.fn(),
        success: jest.fn(),
        error: jest.fn(),
        dismiss: jest.fn(),
    },
    custom: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
    dismiss: jest.fn(),
}));

describe('toastHelpers', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setToastViewContext('popup');
    });

    describe('showSuccessToast', () => {
        test('uses the shared custom toast in popup view', () => {
            showSuccessToast('Success message');

            expect(toast.custom).toHaveBeenCalledWith(
                expect.any(Function),
                expect.objectContaining({
                    duration: 3000,
                    position: 'bottom-center',
                })
            );
        });

        test('uses the shared custom toast in fullpage view', () => {
            setToastViewContext('fullpage');

            showSuccessToast('Test');

            expect(toast.custom).toHaveBeenCalledWith(
                expect.any(Function),
                expect.objectContaining({
                    duration: 3000,
                    position: 'bottom-right',
                })
            );
        });
    });

    describe('showErrorToast', () => {
        test('uses the shared custom toast in popup view', () => {
            showErrorToast('Error message');

            expect(toast.custom).toHaveBeenCalledWith(
                expect.any(Function),
                expect.objectContaining({
                    duration: 4000,
                    position: 'bottom-center',
                })
            );
        });

        test('uses the shared custom toast in fullpage view', () => {
            setToastViewContext('fullpage');

            showErrorToast('Test');

            expect(toast.custom).toHaveBeenCalledWith(
                expect.any(Function),
                expect.objectContaining({
                    duration: 4000,
                    position: 'bottom-right',
                })
            );
        });
    });

    describe('showInfoToast', () => {
        test('uses the shared custom toast in popup view', () => {
            showInfoToast('Heads up');

            expect(toast.custom).toHaveBeenCalledWith(
                expect.any(Function),
                expect.objectContaining({
                    duration: 4000,
                    position: 'bottom-center',
                })
            );
        });
    });

    describe('showUndoToast', () => {
        test('calls toast.custom with correct options in popup view', () => {
            const mockIcon = 'icon';
            const mockMessage = 'Item deleted';
            const mockCollectionName = 'My Collection';
            const mockUndoAction = jest.fn();
            
            showUndoToast(mockIcon, mockMessage, mockCollectionName, mockUndoAction, 5);
            
            expect(toast.custom).toHaveBeenCalledWith(
                expect.any(Function),
                expect.objectContaining({
                    duration: 5000,
                    position: 'bottom-center',
                })
            );
        });

        test('uses default duration from UNDO_TIME constant', () => {
            showUndoToast('icon', 'message', 'name', jest.fn());

            expect(toast.custom).toHaveBeenCalledWith(
                expect.any(Function),
                expect.objectContaining({
                    position: 'bottom-center',
                })
            );
        });

        test('uses fullpage positioning when fullpage context is active', () => {
            setToastViewContext('fullpage');

            showUndoToast('icon', 'message', 'name', jest.fn());

            expect(toast.custom).toHaveBeenCalledWith(
                expect.any(Function),
                expect.objectContaining({
                    position: 'bottom-right',
                })
            );
        });
    });
});
