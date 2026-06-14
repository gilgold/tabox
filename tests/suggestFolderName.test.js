// tests/suggestFolderName.test.js
jest.mock('../app/ai/aiClient', () => ({
    createAISession: jest.fn(),
    promptForJSON: jest.fn(),
}));

import { createAISession, promptForJSON } from '../app/ai/aiClient';
import { buildFolderNamePrompt, suggestFolderName } from '../app/ai/tasks/suggestFolderName';

describe('buildFolderNamePrompt', () => {
    test('includes collection names and sampled tab titles', () => {
        const prompt = buildFolderNamePrompt({
            collections: [
                { name: 'React stuff', tabs: [{ title: 'React Docs', url: 'https://react.dev' }] },
            ],
        });
        expect(prompt).toContain('React stuff');
        expect(prompt).toContain('React Docs');
    });

    test('instructs the model to fall back to tab titles', () => {
        const prompt = buildFolderNamePrompt({ collections: [{ name: 'Untitled', tabs: [] }] });
        expect(prompt).toMatch(/tab titles/i);
    });

    test('caps collections at 20 and titles at 5 per collection', () => {
        const collections = Array.from({ length: 30 }, (_, i) => ({
            name: `Collection ${i}`,
            tabs: Array.from({ length: 10 }, (_, j) => ({ title: `C${i}T${j}`, url: 'https://example.com' })),
        }));
        const prompt = buildFolderNamePrompt({ collections });
        expect(prompt).toContain('Collection 19');
        expect(prompt).not.toContain('Collection 20');
        expect(prompt).toContain('C0T4');
        expect(prompt).not.toContain('C0T5');
    });

    test('tolerates missing collections', () => {
        expect(() => buildFolderNamePrompt({})).not.toThrow();
    });
});

describe('suggestFolderName', () => {
    test('returns the trimmed name and destroys the session', async () => {
        const destroy = jest.fn();
        createAISession.mockResolvedValue({ destroy });
        promptForJSON.mockResolvedValue({ name: '  Frontend Docs  ' });
        const name = await suggestFolderName({ collections: [] });
        expect(name).toBe('Frontend Docs');
        expect(destroy).toHaveBeenCalled();
    });

    test('truncates names longer than 50 characters', async () => {
        createAISession.mockResolvedValue({ destroy: jest.fn() });
        promptForJSON.mockResolvedValue({ name: 'x'.repeat(80) });
        const name = await suggestFolderName({ collections: [] });
        expect(name).toHaveLength(50);
    });

    test('destroys the session even when prompting fails', async () => {
        const destroy = jest.fn();
        createAISession.mockResolvedValue({ destroy });
        promptForJSON.mockRejectedValue(new Error('boom'));
        await expect(suggestFolderName({ collections: [] })).rejects.toThrow('boom');
        expect(destroy).toHaveBeenCalled();
    });

    test('forwards signal to createAISession and promptForJSON', async () => {
        const destroy = jest.fn();
        createAISession.mockResolvedValue({ destroy });
        promptForJSON.mockResolvedValue({ name: 'Work Folders' });
        const signal = new AbortController().signal;
        await suggestFolderName({ collections: [] }, { signal });
        expect(createAISession).toHaveBeenCalledWith(expect.objectContaining({ signal }));
        expect(promptForJSON).toHaveBeenCalledWith(expect.anything(), expect.any(String), expect.anything(), signal);
    });
});
