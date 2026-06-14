const { aiAvailability, promptForJSON } = require('../chrome/ai-client.js');

describe('ai-client module', () => {
  afterEach(() => { delete global.LanguageModel; });

  test('aiAvailability returns "unsupported" when LanguageModel is absent', async () => {
    delete global.LanguageModel;
    expect(await aiAvailability()).toBe('unsupported');
  });

  test('aiAvailability proxies LanguageModel.availability', async () => {
    global.LanguageModel = { availability: jest.fn().mockResolvedValue('available') };
    expect(await aiAvailability()).toBe('available');
  });

  test('promptForJSON parses the model JSON response', async () => {
    const session = { prompt: jest.fn().mockResolvedValue('{"name":"Reading"}') };
    const out = await promptForJSON(session, 'p', { type: 'object' });
    expect(out).toEqual({ name: 'Reading' });
    expect(session.prompt).toHaveBeenCalledWith('p', expect.objectContaining({ responseConstraint: { type: 'object' } }));
  });
});
