/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import NoPermissionModal from '../app/NoPermissionModal';
import { noPermissionOpenState } from '../app/atoms/sharedFoldersState';

test('renders the permission message when open, nothing when closed', () => {
  const store = createStore();
  store.set(noPermissionOpenState, true);
  render(<Provider store={store}><NoPermissionModal /></Provider>);
  expect(screen.getByText(/don't have permission to edit this folder/i)).toBeInTheDocument();
});

test('renders nothing when closed', () => {
  const store = createStore();
  store.set(noPermissionOpenState, false);
  const { container } = render(<Provider store={store}><NoPermissionModal /></Provider>);
  expect(container).toBeEmptyDOMElement();
});

test('the OK button closes the modal', () => {
  const store = createStore();
  store.set(noPermissionOpenState, true);
  render(<Provider store={store}><NoPermissionModal /></Provider>);

  fireEvent.click(screen.getByRole('button', { name: /got it/i }));

  expect(store.get(noPermissionOpenState)).toBe(false);
});
