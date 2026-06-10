import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import FPBadge from '../app/fullpage/FPBadge';

describe('FPBadge', () => {
    test('renders a unified full-page badge with semantic accent classes', () => {
        render(<FPBadge accent="tabs">12 tabs</FPBadge>);

        const badge = screen.getByText('12 tabs');
        expect(badge).toHaveClass('fp-badge', 'fp-badge-accent-tabs');
    });

    test('accepts a raw color accent through the accent prop', () => {
        render(<FPBadge accent="#22c55e">Synced</FPBadge>);

        expect(screen.getByText('Synced')).toHaveStyle('--fp-badge-accent: #22c55e');
    });

    test('preserves caller classes for existing full-page badge hooks', () => {
        render(<FPBadge accent="groups" className="fp-card-meta-chip groups">2 groups</FPBadge>);

        const badge = screen.getByText('2 groups');
        expect(badge).toHaveClass('fp-badge', 'fp-card-meta-chip', 'groups');
    });
});
