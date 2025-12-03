import { showUndoToast, showSuccessToast, showErrorToast } from '../app/toastHelpers';
import toast from 'react-hot-toast';

// Mock react-hot-toast (already mocked in jest.setup.js, but let's verify behavior)
jest.mock('react-hot-toast', () => ({
    custom: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
}));

describe('toastHelpers', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('showSuccessToast', () => {
        test('calls toast.success with message', () => {
            showSuccessToast('Success message');
            
            expect(toast.success).toHaveBeenCalledWith(
                'Success message',
                expect.objectContaining({
                    duration: 3000,
                    position: 'bottom-center',
                })
            );
        });

        test('applies green styling', () => {
            showSuccessToast('Test');
            
            expect(toast.success).toHaveBeenCalledWith(
                'Test',
                expect.objectContaining({
                    style: expect.objectContaining({
                        background: '#4caf50',
                        color: '#fff',
                    }),
                })
            );
        });
    });

    describe('showErrorToast', () => {
        test('calls toast.error with message', () => {
            showErrorToast('Error message');
            
            expect(toast.error).toHaveBeenCalledWith(
                'Error message',
                expect.objectContaining({
                    duration: 4000,
                    position: 'bottom-center',
                })
            );
        });

        test('applies red styling', () => {
            showErrorToast('Test');
            
            expect(toast.error).toHaveBeenCalledWith(
                'Test',
                expect.objectContaining({
                    style: expect.objectContaining({
                        background: '#f44336',
                        color: '#fff',
                    }),
                })
            );
        });
    });

    describe('showUndoToast', () => {
        test('calls toast.custom with correct options', () => {
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
    });
});

