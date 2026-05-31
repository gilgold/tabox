import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CollectionFilter } from '../app/CollectionFilter';
import { COLOR_PALETTE } from '../app/utils/colorMigration';

jest.mock('react-tiny-popover', () => ({
  Popover: ({ isOpen, content, children }) => (
    <>
      {children}
      {isOpen ? content : null}
    </>
  ),
}));

describe('CollectionFilter', () => {
  test('shows the tooltip only on the closed color picker opener in popup view', async () => {
    const onFiltersChange = jest.fn();

    const { container } = render(<CollectionFilter onFiltersChange={onFiltersChange} />);

    const pickerTrigger = container.querySelector('.modern-color-picker-wrapper');
    expect(pickerTrigger).toBeInTheDocument();

    fireEvent.mouseEnter(pickerTrigger);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Filter collections by color');

    fireEvent.click(container.querySelector('.modern-color-picker'));

    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
      expect(container.querySelector('.color-grid')).toBeInTheDocument();
    });

    const firstColorName = Object.keys(COLOR_PALETTE)[0];
    const firstColorOption = container.querySelector('.modern-color-option');

    expect(firstColorOption).toBeInTheDocument();
    expect(firstColorOption).not.toHaveAttribute('data-tooltip-content');

    fireEvent.mouseEnter(firstColorOption);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    fireEvent.click(firstColorOption);

    await waitFor(() => {
      expect(onFiltersChange).toHaveBeenCalledWith({
        recentlyOpenedActual: false,
        color: firstColorName,
      });
      expect(container.querySelector('.color-grid')).not.toBeInTheDocument();
    });
  });
});
