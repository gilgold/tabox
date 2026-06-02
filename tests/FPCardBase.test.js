/** @jest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import FPCardBase from '../app/fullpage/FPCardBase';

jest.mock('../app/fullpage/FPCardFaviconPreview', () => function MockFPCardFaviconPreview({ tabs }) {
    return <div data-testid="favicons">{tabs.length}</div>;
});

jest.mock('../app/fullpage/FPCardMatchingTabs', () => function MockFPCardMatchingTabs({ matchingTabs, search }) {
    return <div data-testid="matching-tabs">{`${matchingTabs.length}:${search}`}</div>;
});

describe('FPCardBase', () => {
    test('renders top badges, search matches, and matching tab props', () => {
        render(
            <FPCardBase
                ariaLabel="Open card"
                title="Saved Session"
                titleText="Saved Session"
                topBadge={<span>Recent</span>}
                meta={<span>2 tabs</span>}
                timeLabel="Recently"
                tabs={[{ uid: 'tab-1' }]}
                search="open"
                matchingTabs={[{ uid: 'match-1' }, { uid: 'match-2' }]}
                actionMenu={<button type="button">Menu</button>}
                actions={<button type="button">Action</button>}
            />,
        );

        const card = screen.getByRole('button', { name: 'Open card' });
        expect(card).toHaveClass('fp-card-has-top-badge');
        expect(card).toHaveClass('fp-card-has-matches');
        expect(screen.getByText('Recent')).toBeInTheDocument();
        expect(screen.getByText('2 tabs')).toBeInTheDocument();
        expect(screen.getByText('Recently')).toBeInTheDocument();
        expect(screen.queryByTestId('favicons')).not.toBeInTheDocument();
        expect(screen.getByTestId('matching-tabs')).toHaveTextContent('2:open');
    });

    test('shows favicon preview without matches and stops click propagation from action areas', () => {
        const onClick = jest.fn();

        render(
            <FPCardBase
                ariaLabel="Open card"
                title="Saved Session"
                tabs={[{ uid: 'tab-1' }, { uid: 'tab-2' }]}
                matchingTabs={[]}
                onClick={onClick}
                actionMenu={<button type="button">Menu</button>}
                actions={<button type="button">Action</button>}
            />,
        );

        expect(screen.getByTestId('favicons')).toHaveTextContent('2');

        fireEvent.click(screen.getByText('Menu'));
        fireEvent.click(screen.getByText('Action'));
        expect(onClick).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Open card' }));
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});
