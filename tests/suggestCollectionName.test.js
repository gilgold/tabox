jest.mock('../app/ai/aiClient', () => ({
    createAISession: jest.fn(),
    promptForJSON: jest.fn(),
}));

import { createAISession, promptForJSON } from '../app/ai/aiClient';
import { buildNamePrompt, suggestCollectionName } from '../app/ai/tasks/suggestCollectionName';

describe('buildNamePrompt', () => {
    test('includes tab titles and domains', () => {
        const prompt = buildNamePrompt({ tabs: [{ title: 'React Docs', url: 'https://www.react.dev/learn' }] });
        expect(prompt).toContain('React Docs');
        expect(prompt).toContain('react.dev');
    });

    test('caps the number of tabs at 30', () => {
        const tabs = Array.from({ length: 50 }, (_, i) => ({ title: `Tab ${i}`, url: `https://example.com/${i}` }));
        const prompt = buildNamePrompt({ tabs });
        expect(prompt).toContain('Tab 29');
        expect(prompt).not.toContain('Tab 30');
    });

    test('tolerates invalid URLs and missing tabs', () => {
        expect(buildNamePrompt({ tabs: [{ title: 'Weird', url: 'not-a-url' }] })).toContain('Weird');
        expect(() => buildNamePrompt({})).not.toThrow();
    });
});

describe('suggestCollectionName', () => {
    test('returns the trimmed name and destroys the session', async () => {
        const destroy = jest.fn();
        createAISession.mockResolvedValue({ destroy });
        promptForJSON.mockResolvedValue({ name: '  Research Papers  ' });
        const name = await suggestCollectionName({ tabs: [] });
        expect(name).toBe('Research Papers');
        expect(destroy).toHaveBeenCalled();
    });

    test('destroys the session even when prompting fails', async () => {
        const destroy = jest.fn();
        createAISession.mockResolvedValue({ destroy });
        promptForJSON.mockRejectedValue(new Error('boom'));
        await expect(suggestCollectionName({ tabs: [] })).rejects.toThrow('boom');
        expect(destroy).toHaveBeenCalled();
    });

    test('truncates names longer than 50 characters (collection name limit)', async () => {
        createAISession.mockResolvedValue({ destroy: jest.fn() });
        promptForJSON.mockResolvedValue({ name: 'x'.repeat(80) });
        const name = await suggestCollectionName({ tabs: [] });
        expect(name).toHaveLength(50);
    });
});
