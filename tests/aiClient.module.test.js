const { aiAvailability, createAISession, promptForJSON } = require('../chrome/ai-client.js');

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

  test('promptForJSON logs the inference duration', async () => {
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    const session = { prompt: jest.fn().mockResolvedValue('{"name":"X"}') };
    const out = await promptForJSON(session, 'p', { type: 'object' });
    expect(out).toEqual({ name: 'X' });
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('Tabox AI: inference'));
    debugSpy.mockRestore();
  });

  test('createAISession passes merged options to LanguageModel.create', async () => {
    const fakeSession = { prompt: jest.fn() };
    global.LanguageModel = { create: jest.fn().mockResolvedValue(fakeSession) };
    const sig = new AbortController().signal;
    const out = await createAISession({ systemPrompt: 'be brief', temperature: 0.7, topK: 3, signal: sig });
    expect(out).toBe(fakeSession);
    const opts = global.LanguageModel.create.mock.calls[0][0];
    expect(opts.initialPrompts).toEqual([{ role: 'system', content: 'be brief' }]);
    expect(opts.temperature).toBe(0.7);
    expect(opts.topK).toBe(3);
    expect(opts.signal).toBe(sig);
    expect(opts.expectedInputs).toBeDefined(); // LANGUAGE_OPTIONS merged in
  });

  test('createAISession omits initialPrompts when no systemPrompt', async () => {
    global.LanguageModel = { create: jest.fn().mockResolvedValue({}) };
    await createAISession({});
    expect(global.LanguageModel.create.mock.calls[0][0].initialPrompts).toBeUndefined();
  });

  test('createAISession throws a clear error when LanguageModel is absent', async () => {
    delete global.LanguageModel;
    await expect(createAISession({})).rejects.toThrow(/LanguageModel/);
  });

  test('aiAvailability returns "unavailable" when availability() throws', async () => {
    global.LanguageModel = { availability: jest.fn().mockRejectedValue(new Error('boom')) };
    expect(await aiAvailability()).toBe('unavailable');
  });

  // The Prompt API rejects a session that sets only one of temperature/topK
  // (NotSupportedError: "must either specify both topK and temperature, or neither").
  test('createAISession pairs a default topK when only temperature is given', async () => {
    global.LanguageModel = { create: jest.fn().mockResolvedValue({}) };
    await createAISession({ temperature: 0 });
    const opts = global.LanguageModel.create.mock.calls[0][0];
    expect(opts.temperature).toBe(0);
    expect(opts.topK).toBe(3);
  });

  test('createAISession pairs a default temperature when only topK is given', async () => {
    global.LanguageModel = { create: jest.fn().mockResolvedValue({}) };
    await createAISession({ topK: 5 });
    const opts = global.LanguageModel.create.mock.calls[0][0];
    expect(opts.topK).toBe(5);
    expect(opts.temperature).toBe(1);
  });

  test('createAISession sends neither temperature nor topK when neither is given', async () => {
    global.LanguageModel = { create: jest.fn().mockResolvedValue({}) };
    await createAISession({});
    const opts = global.LanguageModel.create.mock.calls[0][0];
    expect(opts.temperature).toBeUndefined();
    expect(opts.topK).toBeUndefined();
  });
});
