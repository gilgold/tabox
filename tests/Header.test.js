import { render, act } from '@testing-library/react';
import Header from '../app/Header';
import { Provider } from 'jotai';

// Real getAIAvailability() would resolve 'unsupported' in jsdom (no
// LanguageModel global) and render the AI-unavailable warning banner inside
// SettingsMenu's Tabox Pro section — mock it so this snapshot stays focused
// on Header, not on Tabox AI device support.
jest.mock('../app/ai/aiClient', () => ({
    getAIAvailability: jest.fn().mockResolvedValue(undefined),
    downloadModel: jest.fn(),
}));

describe('Header -- Sync disabled', () => {
  test('Header renders correctly - sync disabled', async () => {
    let container;
    
    await act(async () => {
      const result = render(
        <Provider>
          <Header />
        </Provider>,
      );
      container = result.container;
      
      // Allow all microtasks (Promise resolutions) to complete
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    
    expect(container).toMatchSnapshot();
  });
});
