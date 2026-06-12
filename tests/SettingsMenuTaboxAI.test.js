import { act, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider } from 'jotai';
import SettingsMenu from '../app/SettingsMenu';

jest.mock('../app/OrphanRecoveryContext', () => ({
    useOrphanRecoveryContext: () => ({}),
}));

describe('SettingsMenu — Tabox AI section', () => {
    test('renders a Tabox AI section with the enable switch', async () => {
        await act(async () => {
            render(
                <Provider>
                    <SettingsMenu updateRemoteData={jest.fn()} applyDataFromServer={jest.fn()} />
                </Provider>
            );
        });
        expect(screen.getByText('Tabox AI')).toBeInTheDocument();
        expect(document.getElementById('chkTaboxAI')).toBeInTheDocument();
    });
});
