import { fireEvent, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from './helpers/renderWithProviders';
import CollapsableSection from '../app/CollapsableSection';
import { browser } from '../static/globals';

describe('CollapsableSection', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('loads the persisted collapsed state and hides children when collapsed', async () => {
        browser.storage.local.get.mockResolvedValue({
            section_state: true,
        });

        renderWithProviders(
            <CollapsableSection sectionKey="section_state" sectionTitle="Saved" count={2}>
                <div>Section Content</div>
            </CollapsableSection>,
        );

        await waitFor(() => {
            expect(screen.queryByText('Section Content')).not.toBeInTheDocument();
        });
        expect(screen.getByText('Saved')).toBeInTheDocument();
        expect(screen.getByText('(2)')).toBeInTheDocument();
    });

    test('toggles collapsed state and persists it to storage', async () => {
        browser.storage.local.get.mockResolvedValue({
            section_state: false,
        });
        browser.storage.local.set.mockResolvedValue(undefined);

        renderWithProviders(
            <CollapsableSection sectionKey="section_state" sectionTitle="Toggle" count={1}>
                <div>Section Content</div>
            </CollapsableSection>,
        );

        await waitFor(() => {
            expect(screen.getByText('Section Content')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('Toggle'));

        await waitFor(() => {
            expect(screen.queryByText('Section Content')).not.toBeInTheDocument();
        });
        expect(browser.storage.local.set).toHaveBeenCalledWith({
            section_state: true,
        });
    });
});
