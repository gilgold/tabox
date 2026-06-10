import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import LegacyImportPreviewModal from '../app/fullpage/LegacyImportPreviewModal';
import { buildLegacyImportPreview } from '../app/utils/legacyImportPreview';

describe('LegacyImportPreviewModal', () => {
    test('supports select all and select none for previewed collections', () => {
        const previewData = buildLegacyImportPreview([
            { uid: 'collection-1', name: 'Alpha', tabs: [], chromeGroups: [] },
            { uid: 'collection-2', name: 'Beta', tabs: [], chromeGroups: [] },
        ]);

        render(
            <LegacyImportPreviewModal
                isOpen={true}
                onClose={jest.fn()}
                onConfirm={jest.fn()}
                previewData={previewData}
            />,
        );

        const importButton = screen.getByRole('button', { name: 'Import 2 Selected' });
        expect(importButton).not.toBeDisabled();

        fireEvent.click(screen.getByRole('button', { name: 'Select None' }));
        expect(importButton).toBeDisabled();

        fireEvent.click(screen.getByRole('button', { name: 'Select All' }));
        expect(importButton).not.toBeDisabled();
    });

    test('submits the selected preview ids', () => {
        const onConfirm = jest.fn();
        const previewData = buildLegacyImportPreview([
            { uid: 'collection-1', name: 'Alpha', tabs: [], chromeGroups: [] },
            { uid: 'collection-2', name: 'Beta', tabs: [], chromeGroups: [] },
        ]);

        render(
            <LegacyImportPreviewModal
                isOpen={true}
                onClose={jest.fn()}
                onConfirm={onConfirm}
                previewData={previewData}
            />,
        );

        fireEvent.click(screen.getByLabelText('Import Beta'));
        fireEvent.click(screen.getByRole('button', { name: 'Import 1 Selected' }));

        expect(onConfirm).toHaveBeenCalledWith({
            selectedCollectionIds: [previewData.collections[0].previewId],
        });
    });

    test('renders grouped folder sections and preview metadata', () => {
        const previewData = buildLegacyImportPreview({
            type: 'full_export',
            folders: [{ uid: 'folder-1', name: 'Team', color: '#ef4444' }],
            collections: [
                {
                    uid: 'collection-1',
                    name: 'Alpha',
                    parentId: 'folder-1',
                    tabs: [
                        { title: 'Docs', favIconUrl: 'https://example.com/docs.ico' },
                        { title: 'Mail', favIconUrl: 'https://example.com/mail.ico' },
                        { title: 'Calendar', favIconUrl: 'https://example.com/calendar.ico' },
                        { title: 'Drive', favIconUrl: 'https://example.com/drive.ico' },
                        { title: 'Chat', favIconUrl: 'https://example.com/chat.ico' },
                        { title: 'Meet', favIconUrl: 'https://example.com/meet.ico' },
                        { title: 'Sheets', favIconUrl: 'https://example.com/sheets.ico' },
                        { title: 'Slides', favIconUrl: 'https://example.com/slides.ico' },
                    ],
                    chromeGroups: [],
                },
                { uid: 'collection-2', name: 'Beta', parentId: null, tabs: [{ title: 'Mail', favIconUrl: 'https://example.com/mail.ico' }], chromeGroups: [] },
            ],
        });

        render(
            <LegacyImportPreviewModal
                isOpen={true}
                onClose={jest.fn()}
                onConfirm={jest.fn()}
                previewData={previewData}
            />,
        );

        expect(screen.getByText('Team')).toBeInTheDocument();
        expect(screen.getByText('No Folder')).toBeInTheDocument();
        expect(screen.getByText(/review this txt import before anything is added/i)).toBeInTheDocument();
        const faviconStrip = screen.getByLabelText('Alpha tab preview');
        expect(faviconStrip).toBeInTheDocument();
        expect(screen.getByTitle('Docs')).toBeInTheDocument();
        expect(screen.getByText('+2')).toBeInTheDocument();
        expect(screen.getByLabelText('Toggle Team folder section')).toBeInTheDocument();
    });

    test('supports collapsing folder sections', () => {
        const previewData = buildLegacyImportPreview({
            type: 'full_export',
            folders: [{ uid: 'folder-1', name: 'Team', color: '#ef4444' }],
            collections: [
                { uid: 'collection-1', name: 'Alpha', parentId: 'folder-1', tabs: [{ title: 'Docs', favIconUrl: 'https://example.com/docs.ico' }], chromeGroups: [] },
                { uid: 'collection-2', name: 'Beta', parentId: null, tabs: [{ title: 'Mail', favIconUrl: 'https://example.com/mail.ico' }], chromeGroups: [] },
            ],
        });

        render(
            <LegacyImportPreviewModal
                isOpen={true}
                onClose={jest.fn()}
                onConfirm={jest.fn()}
                previewData={previewData}
            />,
        );

        expect(screen.getByText('Alpha')).toBeInTheDocument();
        fireEvent.click(screen.getByLabelText('Toggle Team folder section'));
        expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
        expect(screen.getByText('Beta')).toBeInTheDocument();
    });

    test('shows unified search results for matching collections and tabs', () => {
        const previewData = buildLegacyImportPreview({
            type: 'full_export',
            folders: [{ uid: 'folder-1', name: 'Team', color: '#ef4444' }],
            collections: [
                { uid: 'collection-1', name: 'Alpha Workspace', parentId: 'folder-1', tabs: [{ title: 'Project Docs', url: 'https://example.com/docs', favIconUrl: 'https://example.com/docs.ico' }], chromeGroups: [] },
                { uid: 'collection-2', name: 'Beta', parentId: null, tabs: [{ title: 'Alpha Release Notes', url: 'https://example.com/release-notes', favIconUrl: 'https://example.com/mail.ico' }], chromeGroups: [] },
                { uid: 'collection-3', name: 'Gamma', parentId: null, tabs: [{ title: 'Mail', favIconUrl: 'https://example.com/chat.ico' }], chromeGroups: [] },
            ],
        });

        render(
            <LegacyImportPreviewModal
                isOpen={true}
                onClose={jest.fn()}
                onConfirm={jest.fn()}
                previewData={previewData}
            />,
        );

        fireEvent.change(screen.getByPlaceholderText('Search collections or tabs'), {
            target: { value: 'alpha' },
        });

        expect(screen.getByText('2 matching collections')).toBeInTheDocument();
        expect(screen.getByText('Alpha Workspace')).toBeInTheDocument();
        expect(screen.getByText('Beta')).toBeInTheDocument();
        expect(screen.getByTitle('https://example.com/docs')).toBeInTheDocument();
        expect(screen.getByTitle('https://example.com/release-notes')).toBeInTheDocument();
        expect(screen.getAllByText('Alpha', { selector: '.search-match-text' }).length).toBeGreaterThan(0);
        expect(screen.queryByText('Gamma')).not.toBeInTheDocument();
        expect(screen.queryByText('Team')).not.toBeInTheDocument();
    });

    test('clears the modal search query from the x button', () => {
        const previewData = buildLegacyImportPreview([
            { uid: 'collection-1', name: 'Alpha Workspace', tabs: [{ title: 'Project Docs', url: 'https://example.com/docs', favIconUrl: 'https://example.com/docs.ico' }], chromeGroups: [] },
            { uid: 'collection-2', name: 'Beta', tabs: [{ title: 'Mail', favIconUrl: 'https://example.com/mail.ico' }], chromeGroups: [] },
        ]);

        render(
            <LegacyImportPreviewModal
                isOpen={true}
                onClose={jest.fn()}
                onConfirm={jest.fn()}
                previewData={previewData}
            />,
        );

        const searchInput = screen.getByPlaceholderText('Search collections or tabs');
        fireEvent.change(searchInput, { target: { value: 'alpha' } });
        expect(searchInput).toHaveValue('alpha');

        fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
        expect(searchInput).toHaveValue('');
    });
});
