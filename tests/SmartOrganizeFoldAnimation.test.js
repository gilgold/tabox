/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import SmartOrganizeFoldAnimation from '../app/SmartOrganizeFoldAnimation';

test('shows a browser tab row morphing loose tabs into tab groups', () => {
    render(<SmartOrganizeFoldAnimation />);

    const animation = screen.getByTestId('smart-grouping-browser-animation');
    expect(animation).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getAllByTestId('smart-grouping-tab')).toHaveLength(6);
    expect(screen.getAllByTestId('smart-grouping-group')).toHaveLength(2);
    expect(animation.querySelectorAll('.so-tab-group-label')).toHaveLength(2);
});
