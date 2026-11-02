import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import QuickSaveFolderModal from '../app/QuickSaveFolderModal';

const folders = [
    { uid: 'work', name: 'Work Projects', color: '#ef4444' },
    { uid: 'read', name: 'Reading', color: '#1698e2' },
];

test('filters folders as typed, supports empty results and clears search when reopened', async () => {
    const props = { isOpen: true, onClose: jest.fn(), onSelect: jest.fn(), folders, destinationId: 'work' };
    const { rerender } = render(<QuickSaveFolderModal {...props} />);
    const search = screen.getByRole('searchbox', { name: 'Search folders' });
    fireEvent.change(search, { target: { value: '  READ ' } });
    expect(screen.getByRole('button', { name: 'Reading' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Work Projects' })).not.toBeInTheDocument();
    search.focus();
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(screen.getByRole('button', { name: 'Reading' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Reading' }));
    expect(props.onSelect).toHaveBeenCalledWith('read');
    fireEvent.change(search, { target: { value: 'missing' } });
    expect(screen.getByText('No folders found.')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'root' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Work Projects' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(search, { target: { value: 'Reading' } });
    rerender(<QuickSaveFolderModal {...props} isOpen={false} />);
    rerender(<QuickSaveFolderModal {...props} />);
    await waitFor(() => expect(screen.getByRole('searchbox')).toHaveValue(''));
    expect(screen.getByRole('button', { name: 'Work Projects' })).toBeInTheDocument();
});
