// app/ai/aiClient.js — popup-side relay: every completion goes to the service
// worker via the aiComplete message; the popup never sees tokens or endpoints.
import { browser } from '../static/globals';
import { isAISupported, getAIAvailability, createAISession, promptForJSON } from '../app/ai/aiClient';

describe('aiClient (popup → SW relay)', () => {
    beforeEach(() => {
        browser.runtime.sendMessage = jest.fn();
    });

    test('isAISupported is true everywhere (cloud inference)', () => {
        expect(isAISupported()).toBe(true);
    });

    test('getAIAvailability relays the SW answer', async () => {
        browser.runtime.sendMessage.mockResolvedValue('sign-in-required');
        expect(await getAIAvailability()).toBe('sign-in-required');
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'aiAvailability' });
    });

    test('getAIAvailability maps a dead SW / empty answer to "unavailable"', async () => {
        browser.runtime.sendMessage.mockRejectedValue(new Error('no receiver'));
        expect(await getAIAvailability()).toBe('unavailable');
        browser.runtime.sendMessage.mockResolvedValue(undefined);
        expect(await getAIAvailability()).toBe('unavailable');
    });

    test('prompt relays config and text via the aiComplete message', async () => {
        browser.runtime.sendMessage.mockResolvedValue({ ok: true, content: 'reply' });
        const session = await createAISession({ systemPrompt: 'sys', temperature: 0.7, topK: 3 });
        const out = await session.prompt('hello');
        expect(out).toBe('reply');
        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
            type: 'aiComplete',
            payload: {
                systemPrompt: 'sys',
                temperature: 0.7,
                topK: 3,
                prompt: 'hello',
                responseConstraint: undefined,
            },
        });
    });

    test('promptForJSON passes the schema as responseConstraint and parses the reply', async () => {
        browser.runtime.sendMessage.mockResolvedValue({ ok: true, content: '{"name":"Research"}' });
        const session = await createAISession({});
        const schema = { type: 'object' };
        const result = await promptForJSON(session, 'prompt text', schema);
        expect(result).toEqual({ name: 'Research' });
        expect(browser.runtime.sendMessage.mock.calls[0][0].payload.responseConstraint).toBe(schema);
    });

    test('promptForJSON parses a fenced JSON reply', async () => {
        browser.runtime.sendMessage.mockResolvedValue({ ok: true, content: '```json\n{"name":"Reading"}\n```' });
        const session = await createAISession({});
        expect(await promptForJSON(session, 'p', { type: 'object' })).toEqual({ name: 'Reading' });
    });

    test('an SW error is rethrown with its message', async () => {
        browser.runtime.sendMessage.mockResolvedValue({ ok: false, error: 'Tabox AI: request failed (429): rate_limited' });
        const session = await createAISession({});
        await expect(session.prompt('hello')).rejects.toThrow(/rate_limited/);
    });

    test('an aborted signal throws AbortError without sending', async () => {
        const controller = new AbortController();
        controller.abort();
        const session = await createAISession({ signal: controller.signal });
        await expect(session.prompt('hello')).rejects.toMatchObject({ name: 'AbortError' });
        expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
    });

    test('a signal aborted mid-flight discards the result with AbortError', async () => {
        const controller = new AbortController();
        browser.runtime.sendMessage.mockImplementation(async () => {
            controller.abort();
            return { ok: true, content: 'late reply' };
        });
        const session = await createAISession({});
        await expect(session.prompt('hello', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    });

    test('clone returns an independent session with the same config', async () => {
        browser.runtime.sendMessage.mockResolvedValue({ ok: true, content: 'x' });
        const session = await createAISession({ systemPrompt: 'sys' });
        const clone = await session.clone();
        expect(clone).not.toBe(session);
        await clone.prompt('hi');
        expect(browser.runtime.sendMessage.mock.calls[0][0].payload.systemPrompt).toBe('sys');
        expect(() => session.destroy()).not.toThrow();
    });
});
