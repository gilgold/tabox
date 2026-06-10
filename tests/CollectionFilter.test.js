import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CollectionFilter } from '../app/CollectionFilter';
import ColorPicker from '../app/ColorPicker';
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
      const last = onFiltersChange.mock.calls.at(-1)[0];
      expect(last).toEqual({
        recentlyOpenedActual: false,
        colors: [firstColorName],
      });
      // multi-select keeps the popover open after a pick
      expect(container.querySelector('.color-grid')).toBeInTheDocument();
    });
  });
});

describe('ColorPicker multi-select mode', () => {
  test('checkmarks every selected color and stays open after a pick', () => {
    const action = jest.fn();
    const { container } = render(
      <ColorPicker
        multiSelect
        selectedColors={['red', 'blue']}
        action={action}
        onClear={jest.fn()}
        size="small"
      />
    );

    fireEvent.click(container.querySelector('.modern-color-picker'));

    const selected = container.querySelectorAll('.modern-color-option.selected');
    expect(selected.length).toBe(2);

    fireEvent.click(container.querySelector('.modern-color-option'));
    expect(action).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.color-grid')).toBeInTheDocument();
  });

  test('Clear row calls onClear and is disabled when nothing selected', () => {
    const onClear = jest.fn();
    const { container } = render(
      <ColorPicker multiSelect selectedColors={[]} action={jest.fn()} onClear={onClear} size="small" />
    );
    fireEvent.click(container.querySelector('.modern-color-picker'));

    const clearBtn = container.querySelector('.color-picker-clear-row');
    expect(clearBtn).toBeInTheDocument();
    expect(clearBtn).toBeDisabled();
    fireEvent.click(clearBtn);
    expect(onClear).not.toHaveBeenCalled();
  });

  test('trigger preview is a gradient when 2+ colors selected', () => {
    const { container } = render(
      <ColorPicker multiSelect selectedColors={['red', 'blue']} action={jest.fn()} onClear={jest.fn()} size="small" />
    );
    const preview = container.querySelector('.current-color-preview');
    expect(preview.getAttribute('style')).toMatch(/linear-gradient/);
  });
});

describe('CollectionFilter multi-color', () => {
  test('selecting two colors emits both; clear empties the selection', async () => {
    const onFiltersChange = jest.fn();
    const { container } = render(<CollectionFilter onFiltersChange={onFiltersChange} />);

    fireEvent.click(container.querySelector('.modern-color-picker'));
    const options = container.querySelectorAll('.modern-color-option');

    // pick first two non-default colors
    fireEvent.click(options[1]);
    fireEvent.click(options[2]);

    await waitFor(() => {
      const last = onFiltersChange.mock.calls.at(-1)[0];
      expect(last.colors).toHaveLength(2);
    });

    // clear via the popover Clear row
    fireEvent.click(container.querySelector('.color-picker-clear-row'));
    await waitFor(() => {
      const last = onFiltersChange.mock.calls.at(-1)[0];
      expect(last.colors).toEqual([]);
    });
  });
});
