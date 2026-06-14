jest.mock('../app/ai/aiClient', () => ({
    createAISession: jest.fn(),
    promptForJSON: jest.fn(),
}));

import { createAISession, promptForJSON } from '../app/ai/aiClient';
import { buildArrangePrompt, autoArrangeCollections, CATCHALL_FOLDER_NAME } from '../app/ai/tasks/autoArrangeCollections';

const rootCollections = [
    { uid: 'c1', name: 'React docs', tabs: [{ title: 'React' }] },
    { uid: 'c2', name: 'Recipes', tabs: [{ title: 'Pasta' }] },
    { uid: 'c3', name: 'Misc stuff', tabs: [{ title: 'Whatever' }] },
];
const existingFolders = [{ id: 'f-dev', name: 'Development' }];

describe('buildArrangePrompt', () => {
    test('includes collection names, sample tab titles, and existing folder names', () => {
        const prompt = buildArrangePrompt({ collections: rootCollections, existingFolders });
        expect(prompt).toContain('React docs');
        expect(prompt).toContain('Pasta');
        expect(prompt).toContain('Development');
    });
});

describe('autoArrangeCollections', () => {
    beforeEach(() => {
        createAISession.mockResolvedValue({ destroy: jest.fn() });
        promptForJSON.mockReset();
    });

    test('routes collections to existing folders and new folders', async () => {
        promptForJSON.mockResolvedValue({
            assignments: [
                { collectionId: 'c1', existingFolderId: 'f-dev', newFolderName: null },
                { collectionId: 'c2', existingFolderId: null, newFolderName: 'Cooking' },
                { collectionId: 'c3', existingFolderId: null, newFolderName: 'Cooking' },
            ],
        });
        const plan = await autoArrangeCollections({ collections: rootCollections, existingFolders });
        expect(plan.assignments).toContainEqual({ collectionId: 'c1', existingFolderId: 'f-dev', newFolderName: null });
        expect(plan.assignments).toContainEqual({ collectionId: 'c2', existingFolderId: null, newFolderName: 'Cooking' });
        expect(plan.assignments).toContainEqual({ collectionId: 'c3', existingFolderId: null, newFolderName: 'Cooking' });
    });

    test('every input collection gets exactly one assignment (force-assign), invalid existingFolderId falls through', async () => {
        promptForJSON.mockResolvedValue({
            assignments: [
                { collectionId: 'c1', existingFolderId: 'nope', newFolderName: null },
                { collectionId: 'c2', existingFolderId: null, newFolderName: 'Cooking' },
            ],
        });
        const plan = await autoArrangeCollections({ collections: rootCollections, existingFolders });
        expect(plan.assignments).toHaveLength(3);
        const ids = plan.assignments.map((a) => a.collectionId).sort();
        expect(ids).toEqual(['c1', 'c2', 'c3']);
        const c1 = plan.assignments.find((a) => a.collectionId === 'c1');
        const c3 = plan.assignments.find((a) => a.collectionId === 'c3');
        expect(c1.newFolderName).toBe(CATCHALL_FOLDER_NAME);
        expect(c3.newFolderName).toBe(CATCHALL_FOLDER_NAME);
    });

    test('every assignment has exactly one non-null target', async () => {
        promptForJSON.mockResolvedValue({
            assignments: [
                { collectionId: 'c1', existingFolderId: 'f-dev', newFolderName: 'AlsoThis' },
                { collectionId: 'c2', existingFolderId: null, newFolderName: 'Cooking' },
                { collectionId: 'c3', existingFolderId: null, newFolderName: 'Cooking' },
            ],
        });
        const plan = await autoArrangeCollections({ collections: rootCollections, existingFolders });
        for (const a of plan.assignments) {
            const hasExisting = a.existingFolderId != null;
            const hasNew = a.newFolderName != null;
            expect(hasExisting !== hasNew).toBe(true);
        }
        expect(plan.assignments.find((a) => a.collectionId === 'c1').existingFolderId).toBe('f-dev');
    });

    test('dedups a new folder name that collides with an existing folder (case-insensitive) into that existing folder', async () => {
        promptForJSON.mockResolvedValue({
            assignments: [
                { collectionId: 'c1', existingFolderId: null, newFolderName: 'development' },
                { collectionId: 'c2', existingFolderId: null, newFolderName: 'Cooking' },
                { collectionId: 'c3', existingFolderId: null, newFolderName: 'Cooking' },
            ],
        });
        const plan = await autoArrangeCollections({ collections: rootCollections, existingFolders });
        const c1 = plan.assignments.find((a) => a.collectionId === 'c1');
        expect(c1.existingFolderId).toBe('f-dev');
        expect(c1.newFolderName).toBeNull();
    });

    test('forwards the abort signal and destroys the session', async () => {
        const destroy = jest.fn();
        createAISession.mockResolvedValue({ destroy });
        promptForJSON.mockResolvedValue({ assignments: [] });
        const signal = new AbortController().signal;
        await autoArrangeCollections({ collections: rootCollections, existingFolders, signal });
        expect(promptForJSON).toHaveBeenCalledWith(expect.anything(), expect.any(String), expect.any(Object), signal);
        expect(destroy).toHaveBeenCalled();
    });
});
