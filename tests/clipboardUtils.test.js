import { copyToClipboard } from '../app/utils/clipboardUtils.js';

describe('copyToClipboard', () => {
    let originalClipboard;
    let originalExecCommand;

    beforeEach(() => {
        originalClipboard = navigator.clipboard;
        originalExecCommand = document.execCommand;
    });

    afterEach(() => {
        Object.defineProperty(navigator, 'clipboard', {
            value: originalClipboard,
            configurable: true,
            writable: true,
        });
        document.execCommand = originalExecCommand;
        jest.restoreAllMocks();
    });

    const setClipboard = (value) => {
        Object.defineProperty(navigator, 'clipboard', {
            value,
            configurable: true,
            writable: true,
        });
    };

    test('uses navigator.clipboard.writeText on the happy path', async () => {
        const writeText = jest.fn(() => Promise.resolve());
        setClipboard({ writeText });

        await expect(copyToClipboard('hello world')).resolves.toBeUndefined();
        expect(writeText).toHaveBeenCalledWith('hello world');
    });

    test('falls back to execCommand when writeText rejects', async () => {
        const writeText = jest.fn(() => Promise.reject(new Error('denied')));
        setClipboard({ writeText });
        document.execCommand = jest.fn(() => true);

        await expect(copyToClipboard('fallback text')).resolves.toBeUndefined();
        expect(writeText).toHaveBeenCalledWith('fallback text');
        expect(document.execCommand).toHaveBeenCalledWith('copy');
    });

    test('falls back to execCommand when navigator.clipboard is unavailable', async () => {
        setClipboard(undefined);
        document.execCommand = jest.fn(() => true);

        await expect(copyToClipboard('no async api')).resolves.toBeUndefined();
        expect(document.execCommand).toHaveBeenCalledWith('copy');
    });

    test('cleans up the temporary textarea on the fallback path', async () => {
        setClipboard(undefined);
        document.execCommand = jest.fn(() => true);

        await copyToClipboard('cleanup');
        expect(document.querySelector('textarea')).toBeNull();
    });

    test('rejects when execCommand returns false', async () => {
        setClipboard(undefined);
        document.execCommand = jest.fn(() => false);

        await expect(copyToClipboard('total failure')).rejects.toThrow();
        // textarea is still removed even on failure
        expect(document.querySelector('textarea')).toBeNull();
    });

    test('rejects when both writeText and execCommand throw', async () => {
        setClipboard({ writeText: jest.fn(() => Promise.reject(new Error('denied'))) });
        document.execCommand = jest.fn(() => {
            throw new Error('execCommand blew up');
        });

        await expect(copyToClipboard('boom')).rejects.toThrow();
    });
});
