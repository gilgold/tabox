# Tabox AI (Chrome Built-in AI) — Auto-Naming POC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in "Tabox AI" feature layer powered by Chrome's built-in Prompt API (Gemini Nano, on-device), shipping one POC tool: AI-suggested collection names.

**Architecture:** A self-contained `app/ai/` module wraps the `LanguageModel` global (availability, download, sessions, structured JSON prompts) so feature code never touches the raw API. Features register in a tool registry (`app/ai/aiTasks.js`) rendered by a shared `AIToolsModal`. Enablement is a settings toggle (`chkTaboxAI` in `browser.storage.local`) gated by an acknowledgment modal that checks device eligibility and drives the model download. A gradient AI button appears in the popup `Header` and full-page `FPTopBar` only when enabled, opening the shared tools modal. Inference runs in the page context (popup/full-page) for the POC — prompts are short; moving to the service worker later only requires changing `aiClient.js` internals.

**Tech Stack:** React 19, Jotai, react-modal, react-icons, Chrome Prompt API (`LanguageModel`, stable for extensions since Chrome 138 — no manifest permission needed), Jest + React Testing Library.

---

## Design Decisions (locked in)

1. **No manifest changes.** `LanguageModel` is feature-detected at runtime; `minimum_chrome_version: 89` stays. Users on older Chrome / ineligible hardware simply never see AI UI beyond the settings entry (which explains requirements).
2. **Storage key `chkTaboxAI`** follows the existing `chk*` convention. The standard `Switch` component auto-persists by id; enabling is intercepted (see Task 5) so the acknowledgment modal always runs first.
3. **Inference in page context** for the POC (no background messaging). Name suggestion is a 1–3s generation while a modal is open. The `aiClient` abstraction is the seam for moving to the service worker later.
4. **Full-page UI:** the same `AIButton` goes in the `FPTopBar` control strip, opening the same `AIToolsModal` with a wider `--fullpage` layout (tool cards in a grid). Rationale: one shared modal keeps the tool registry the single extension point for both views; contextual per-collection AI affordances (e.g. a sparkle next to the name in `CollectionDetailPanel`) are deliberately deferred to a follow-up so the POC has one entry path to validate.
5. **Structured output:** name suggestions use `session.prompt(text, { responseConstraint: <JSON schema> })` so parsing is reliable.
6. **Modal opening state** lives in a Jotai atom (`aiToolsModalOpenState`) so the button (in Header/FPTopBar) and the modal (rendered once in `App.js`, which owns `updateCollection`) don't need prop drilling.

## File Structure

```
app/ai/aiClient.js                     # NEW — thin wrapper over globalThis.LanguageModel
app/ai/aiTasks.js                      # NEW — AI tool registry (extension point)
app/ai/tasks/suggestCollectionName.js  # NEW — POC task: tabs → suggested name
app/ai/useTaboxAIEnabled.js            # NEW — hook: chkTaboxAI storage flag + live updates
app/atoms/aiState.js                   # NEW — aiToolsModalOpenState atom
app/AIEnableModal.js / .css            # NEW — acknowledgment + download modal
app/AIButton.js / .css                 # NEW — gradient header button
app/AIToolsModal.js / .css             # NEW — shared tools modal (popup + fullpage)
app/SettingsMenu.js                    # MODIFY — "Tabox AI" section + enable interception
app/Header.js                          # MODIFY — add <AIButton /> (popup)
app/fullpage/FPTopBar.js               # MODIFY — add <AIButton /> (fullpage)
app/App.js                             # MODIFY — render <AIToolsModal /> in both modes
tests/aiClient.test.js                 # NEW
tests/suggestCollectionName.test.js    # NEW
tests/useTaboxAIEnabled.test.js        # NEW
tests/AIEnableModal.test.js            # NEW
tests/AIButton.test.js                 # NEW
tests/AIToolsModal.test.js             # NEW
tests/SettingsMenuTaboxAI.test.js      # NEW
```

Conventions reminder: JavaScript only (no TS), co-located CSS, react-icons for icons, `yarn prod` must pass at the end (CLAUDE.md requirement).

---

### Task 1: AI client module (`app/ai/aiClient.js`)

**Files:**
- Create: `app/ai/aiClient.js`
- Test: `tests/aiClient.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/aiClient.test.js
import { isAISupported, getAIAvailability, downloadModel, createAISession, promptForJSON } from '../app/ai/aiClient';

describe('aiClient', () => {
    afterEach(() => {
        delete globalThis.LanguageModel;
    });

    test('isAISupported is false when LanguageModel is missing', () => {
        expect(isAISupported()).toBe(false);
    });

    test('getAIAvailability returns "unsupported" when the API is missing', async () => {
        expect(await getAIAvailability()).toBe('unsupported');
    });

    test('getAIAvailability proxies LanguageModel.availability()', async () => {
        globalThis.LanguageModel = { availability: jest.fn().mockResolvedValue('downloadable') };
        expect(await getAIAvailability()).toBe('downloadable');
    });

    test('getAIAvailability returns "unavailable" when availability() throws', async () => {
        globalThis.LanguageModel = { availability: jest.fn().mockRejectedValue(new Error('boom')) };
        expect(await getAIAvailability()).toBe('unavailable');
    });

    test('downloadModel reports progress and destroys the temporary session', async () => {
        const destroy = jest.fn();
        globalThis.LanguageModel = {
            create: jest.fn(async ({ monitor }) => {
                const listeners = {};
                monitor({ addEventListener: (name, cb) => { listeners[name] = cb; } });
                listeners.downloadprogress({ loaded: 1, total: 2 });
                return { destroy };
            }),
        };
        const onProgress = jest.fn();
        await downloadModel(onProgress);
        expect(onProgress).toHaveBeenCalledWith(50);
        expect(destroy).toHaveBeenCalled();
    });

    test('createAISession passes system prompt and sampling params', async () => {
        globalThis.LanguageModel = { create: jest.fn().mockResolvedValue({}) };
        await createAISession({ systemPrompt: 'sys', temperature: 0.7, topK: 3 });
        expect(globalThis.LanguageModel.create).toHaveBeenCalledWith({
            initialPrompts: [{ role: 'system', content: 'sys' }],
            temperature: 0.7,
            topK: 3,
        });
    });

    test('promptForJSON sends the schema as responseConstraint and parses the reply', async () => {
        const session = { prompt: jest.fn().mockResolvedValue('{"name":"Research"}') };
        const schema = { type: 'object' };
        const result = await promptForJSON(session, 'prompt text', schema);
        expect(session.prompt).toHaveBeenCalledWith('prompt text', { responseConstraint: schema });
        expect(result).toEqual({ name: 'Research' });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn jest tests/aiClient.test.js`
Expected: FAIL — `Cannot find module '../app/ai/aiClient'`

- [ ] **Step 3: Write minimal implementation**

```js
// app/ai/aiClient.js
// Thin wrapper around Chrome's built-in Prompt API (the LanguageModel global,
// stable for extensions since Chrome 138). Every Tabox AI feature goes through
// this module so the underlying API — or the execution context (e.g. moving
// inference to the service worker) — can change without touching feature code.

export function isAISupported() {
    return typeof globalThis.LanguageModel !== 'undefined';
}

// Returns: 'unsupported' | 'unavailable' | 'downloadable' | 'downloading' | 'available'
export async function getAIAvailability() {
    if (!isAISupported()) return 'unsupported';
    try {
        return await globalThis.LanguageModel.availability();
    } catch (error) {
        console.error('Tabox AI availability check failed:', error);
        return 'unavailable';
    }
}

// Creating a session triggers the model download. Must be called from a user
// gesture. onProgress receives an integer percentage (0-100).
export async function downloadModel(onProgress) {
    const session = await globalThis.LanguageModel.create({
        monitor(m) {
            m.addEventListener('downloadprogress', (e) => {
                if (onProgress) onProgress(e.total ? Math.floor((e.loaded / e.total) * 100) : 0);
            });
        },
    });
    session.destroy();
}

export async function createAISession({ systemPrompt, temperature, topK } = {}) {
    const options = {};
    if (systemPrompt) options.initialPrompts = [{ role: 'system', content: systemPrompt }];
    if (temperature !== undefined) options.temperature = temperature;
    if (topK !== undefined) options.topK = topK;
    return globalThis.LanguageModel.create(options);
}

export async function promptForJSON(session, prompt, schema) {
    const raw = await session.prompt(prompt, { responseConstraint: schema });
    return JSON.parse(raw);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn jest tests/aiClient.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add app/ai/aiClient.js tests/aiClient.test.js
git commit -m "feat(ai): add aiClient wrapper around Chrome built-in Prompt API"
```

---

### Task 2: Name-suggestion task + tool registry

**Files:**
- Create: `app/ai/tasks/suggestCollectionName.js`
- Create: `app/ai/aiTasks.js`
- Test: `tests/suggestCollectionName.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/suggestCollectionName.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn jest tests/suggestCollectionName.test.js`
Expected: FAIL — `Cannot find module '../app/ai/tasks/suggestCollectionName'`

- [ ] **Step 3: Write the implementation**

```js
// app/ai/tasks/suggestCollectionName.js
import { createAISession, promptForJSON } from '../aiClient';

// Collection names are capped at 50 chars in CollectionDetailPanel's input.
const MAX_NAME_LENGTH = 50;
const MAX_TABS = 30;

const NAME_SCHEMA = {
    type: 'object',
    properties: {
        name: { type: 'string', maxLength: MAX_NAME_LENGTH },
    },
    required: ['name'],
    additionalProperties: false,
};

export function buildNamePrompt(collection) {
    const lines = (collection.tabs || []).slice(0, MAX_TABS).map((tab) => {
        let domain = '';
        try {
            domain = new URL(tab.url).hostname.replace(/^www\./, '');
        } catch {
            // Tab URLs can be chrome://, about:blank, or malformed — skip the domain.
        }
        const title = tab.title || domain || 'Untitled';
        return `- ${title}${domain ? ` (${domain})` : ''}`;
    });
    return `Suggest a short, descriptive name for a group of browser tabs.\n\nTabs:\n${lines.join('\n')}\n\nRespond with JSON: {"name": "..."}`;
}

export async function suggestCollectionName(collection) {
    const session = await createAISession({
        systemPrompt: 'You name groups of browser tabs. Names are short (2-4 words), specific, and in Title Case. Never include quotes or emojis.',
        temperature: 0.7,
        topK: 3,
    });
    try {
        const { name } = await promptForJSON(session, buildNamePrompt(collection), NAME_SCHEMA);
        return String(name).trim().substring(0, MAX_NAME_LENGTH);
    } finally {
        session.destroy();
    }
}
```

```js
// app/ai/aiTasks.js
import { MdDriveFileRenameOutline } from 'react-icons/md';

// Registry of AI tools shown in the AI Tools modal.
// To add a new AI feature: implement it under app/ai/tasks/ and add an entry
// here; AIToolsModal renders the list and routes to the tool's panel by id.
export const AI_TOOLS = [
    {
        id: 'auto-rename',
        title: 'Auto-name collection',
        description: 'Let AI suggest a name for a collection based on its tabs.',
        icon: MdDriveFileRenameOutline,
    },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn jest tests/suggestCollectionName.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add app/ai/tasks/suggestCollectionName.js app/ai/aiTasks.js tests/suggestCollectionName.test.js
git commit -m "feat(ai): add collection name suggestion task and AI tool registry"
```

---

### Task 3: Enabled-state hook + modal atom

**Files:**
- Create: `app/ai/useTaboxAIEnabled.js`
- Create: `app/atoms/aiState.js`
- Test: `tests/useTaboxAIEnabled.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/useTaboxAIEnabled.test.js
import { renderHook, waitFor, act } from '@testing-library/react';
import { browser } from '../static/globals';
import { useTaboxAIEnabled } from '../app/ai/useTaboxAIEnabled';

describe('useTaboxAIEnabled', () => {
    beforeEach(() => {
        browser.storage.local.get.mockReset();
    });

    test('reflects the stored chkTaboxAI flag', async () => {
        browser.storage.local.get.mockResolvedValue({ chkTaboxAI: true });
        const { result } = renderHook(() => useTaboxAIEnabled());
        await waitFor(() => expect(result.current).toBe(true));
    });

    test('defaults to false and reacts to storage changes', async () => {
        browser.storage.local.get.mockResolvedValue({});
        let listener;
        const originalAdd = browser.storage.onChanged.addListener;
        browser.storage.onChanged.addListener = jest.fn((cb) => { listener = cb; });
        const { result } = renderHook(() => useTaboxAIEnabled());
        await waitFor(() => expect(result.current).toBe(false));
        act(() => listener({ chkTaboxAI: { newValue: true } }));
        expect(result.current).toBe(true);
        browser.storage.onChanged.addListener = originalAdd;
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn jest tests/useTaboxAIEnabled.test.js`
Expected: FAIL — `Cannot find module '../app/ai/useTaboxAIEnabled'`

- [ ] **Step 3: Write the implementation**

```js
// app/ai/useTaboxAIEnabled.js
import { useEffect, useState } from 'react';
import { browser } from '../../static/globals';

// Mirrors the Switch component's storage pattern: read once, stay in sync
// via storage.onChanged so the header button reacts to the settings toggle.
export function useTaboxAIEnabled() {
    const [enabled, setEnabled] = useState(false);

    useEffect(() => {
        browser.storage.local.get('chkTaboxAI').then(({ chkTaboxAI }) => setEnabled(!!chkTaboxAI));

        const onStorageChanged = (changes) => {
            if (changes.chkTaboxAI && changes.chkTaboxAI.newValue !== undefined) {
                setEnabled(!!changes.chkTaboxAI.newValue);
            }
        };
        browser.storage.onChanged.addListener(onStorageChanged);
        return () => browser.storage.onChanged.removeListener(onStorageChanged);
    }, []);

    return enabled;
}
```

```js
// app/atoms/aiState.js
import { atom } from 'jotai';

// Whether the shared AI Tools modal is open (popup and full-page).
export const aiToolsModalOpenState = atom(false);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn jest tests/useTaboxAIEnabled.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add app/ai/useTaboxAIEnabled.js app/atoms/aiState.js tests/useTaboxAIEnabled.test.js
git commit -m "feat(ai): add Tabox AI enabled hook and modal state atom"
```

---

### Task 4: AIEnableModal (acknowledgment + download)

**Files:**
- Create: `app/AIEnableModal.js`
- Create: `app/AIEnableModal.css`
- Test: `tests/AIEnableModal.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/AIEnableModal.test.js
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { browser } from '../static/globals';

jest.mock('../app/ai/aiClient', () => ({
    getAIAvailability: jest.fn(),
    downloadModel: jest.fn(),
}));
jest.mock('../app/toastHelpers', () => ({
    showSuccessToast: jest.fn(),
}));

import { getAIAvailability, downloadModel } from '../app/ai/aiClient';
import AIEnableModal from '../app/AIEnableModal';

describe('AIEnableModal', () => {
    beforeEach(() => {
        browser.storage.local.set.mockReset();
        getAIAvailability.mockReset();
        downloadModel.mockReset();
    });

    test('shows the system requirements', () => {
        render(<AIEnableModal isOpen={true} onClose={jest.fn()} />);
        expect(screen.getByText(/22 GB of free disk space/i)).toBeInTheDocument();
        expect(screen.getByText(/never leave your computer/i)).toBeInTheDocument();
    });

    test('enables directly when the model is already available', async () => {
        getAIAvailability.mockResolvedValue('available');
        const onClose = jest.fn();
        render(<AIEnableModal isOpen={true} onClose={onClose} />);
        fireEvent.click(screen.getByRole('button', { name: /enable tabox ai/i }));
        await waitFor(() => expect(browser.storage.local.set).toHaveBeenCalledWith({ chkTaboxAI: true }));
        expect(downloadModel).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
    });

    test('downloads the model first when downloadable', async () => {
        getAIAvailability.mockResolvedValue('downloadable');
        downloadModel.mockResolvedValue();
        render(<AIEnableModal isOpen={true} onClose={jest.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /enable tabox ai/i }));
        await waitFor(() => expect(downloadModel).toHaveBeenCalled());
        await waitFor(() => expect(browser.storage.local.set).toHaveBeenCalledWith({ chkTaboxAI: true }));
    });

    test('shows an error and does not enable on unsupported devices', async () => {
        getAIAvailability.mockResolvedValue('unavailable');
        render(<AIEnableModal isOpen={true} onClose={jest.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /enable tabox ai/i }));
        await waitFor(() => expect(screen.getByText(/does not meet the requirements/i)).toBeInTheDocument());
        expect(browser.storage.local.set).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn jest tests/AIEnableModal.test.js`
Expected: FAIL — `Cannot find module '../app/AIEnableModal'`

- [ ] **Step 3: Write the component**

```jsx
// app/AIEnableModal.js
import React, { useState } from 'react';
import Modal from 'react-modal';
import { MdClose } from 'react-icons/md';
import { BsStars } from 'react-icons/bs';
import { browser } from '../static/globals';
import { getAIAvailability, downloadModel } from './ai/aiClient';
import { showSuccessToast } from './toastHelpers';
import './AIEnableModal.css';

function AIEnableModal({ isOpen, onClose }) {
    const [status, setStatus] = useState('idle'); // idle | checking | downloading | error
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState(null);

    const busy = status === 'checking' || status === 'downloading';

    const handleEnable = async () => {
        setError(null);
        setStatus('checking');
        const availability = await getAIAvailability();

        if (availability === 'unsupported') {
            setError('Tabox AI requires Chrome 138 or newer.');
            setStatus('error');
            return;
        }
        if (availability === 'unavailable') {
            setError('This device does not meet the requirements for on-device AI.');
            setStatus('error');
            return;
        }
        if (availability !== 'available') {
            setStatus('downloading');
            try {
                await downloadModel(setProgress);
            } catch (downloadError) {
                console.error('Tabox AI model download failed:', downloadError);
                setError('The AI model download failed. Please try again.');
                setStatus('error');
                return;
            }
        }

        await browser.storage.local.set({ chkTaboxAI: true });
        showSuccessToast('Tabox AI is enabled!');
        setStatus('idle');
        onClose();
    };

    return (
        <Modal
            isOpen={isOpen}
            onRequestClose={busy ? undefined : onClose}
            contentLabel="Enable Tabox AI"
            className="modal-content ai-enable-modal"
            overlayClassName="modal-overlay"
            ariaHideApp={false}
            shouldCloseOnOverlayClick={!busy}
            shouldCloseOnEsc={!busy}
        >
            <div className="ai-enable-modal-content">
                <div className="ai-enable-modal-header">
                    <div className="ai-enable-modal-title">
                        <BsStars className="ai-enable-title-icon" size={20} />
                        <span>Enable Tabox AI</span>
                    </div>
                    <button className="ai-enable-modal-close" onClick={onClose} type="button" disabled={busy}>
                        <MdClose />
                    </button>
                </div>

                <div className="ai-enable-modal-body">
                    <p>
                        Tabox AI runs entirely on your device using Chrome&apos;s built-in AI model (Gemini Nano).
                        Your tabs and collections <strong>never leave your computer</strong>.
                    </p>

                    <div className="ai-enable-requirements">
                        <h4>Before enabling, please note:</h4>
                        <ul>
                            <li>Requires Chrome 138 or newer on Windows 10/11, macOS 13+, Linux, or ChromeOS.</li>
                            <li>Requires at least 22 GB of free disk space on the drive with your Chrome profile.</li>
                            <li>Requires a GPU with more than 4 GB of VRAM, or 16 GB of RAM with a 4-core CPU.</li>
                            <li>Chrome will download the AI model (a few GB) the first time you enable this. This can take a while on slow connections.</li>
                        </ul>
                    </div>

                    {status === 'downloading' && (
                        <div className="ai-enable-progress">
                            <div className="ai-enable-progress-track">
                                <div className="ai-enable-progress-fill" style={{ width: `${progress}%` }} />
                            </div>
                            <span className="ai-enable-progress-label">Downloading AI model… {progress}%</span>
                        </div>
                    )}

                    {error && <div className="ai-enable-error">{error}</div>}
                </div>

                <div className="ai-enable-modal-footer">
                    <button type="button" className="ai-enable-btn ai-enable-btn-cancel" onClick={onClose} disabled={busy}>
                        Cancel
                    </button>
                    <button type="button" className="ai-enable-btn ai-enable-btn-primary" onClick={handleEnable} disabled={busy}>
                        {status === 'checking' ? 'Checking device…'
                            : status === 'downloading' ? 'Downloading…'
                                : 'Enable Tabox AI'}
                    </button>
                </div>
            </div>
        </Modal>
    );
}

export default AIEnableModal;
```

```css
/* app/AIEnableModal.css */
.ai-enable-modal {
    max-width: 440px;
}

.ai-enable-modal-content {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
}

.ai-enable-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.ai-enable-modal-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 16px;
    font-weight: 700;
    color: var(--text-color);
}

.ai-enable-title-icon {
    color: #7c3aed;
}

.ai-enable-modal-close {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-color);
    font-size: 18px;
}

.ai-enable-modal-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-size: 13px;
    color: var(--text-color);
}

.ai-enable-requirements {
    border: 1px solid rgba(124, 58, 237, 0.35);
    background: rgba(124, 58, 237, 0.08);
    border-radius: 8px;
    padding: 10px 12px;
}

.ai-enable-requirements h4 {
    margin: 0 0 6px;
    font-size: 13px;
}

.ai-enable-requirements ul {
    margin: 0;
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.ai-enable-progress {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.ai-enable-progress-track {
    height: 6px;
    border-radius: 3px;
    background: rgba(124, 58, 237, 0.15);
    overflow: hidden;
}

.ai-enable-progress-fill {
    height: 100%;
    border-radius: 3px;
    background: linear-gradient(135deg, #7c3aed 0%, #2563eb 100%);
    transition: width 0.2s ease;
}

.ai-enable-progress-label {
    font-size: 12px;
    opacity: 0.8;
}

.ai-enable-error {
    color: #dc2626;
    font-size: 13px;
    font-weight: 600;
}

.ai-enable-modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
}

.ai-enable-btn {
    border: none;
    border-radius: 6px;
    padding: 8px 14px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
}

.ai-enable-btn:disabled {
    opacity: 0.6;
    cursor: default;
}

.ai-enable-btn-cancel {
    background: transparent;
    color: var(--text-color);
    border: 1px solid var(--border-color, rgba(128, 128, 128, 0.4));
}

.ai-enable-btn-primary {
    background: linear-gradient(135deg, #7c3aed 0%, #2563eb 100%);
    color: #fff;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn jest tests/AIEnableModal.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add app/AIEnableModal.js app/AIEnableModal.css tests/AIEnableModal.test.js
git commit -m "feat(ai): add Tabox AI acknowledgment and model download modal"
```

---

### Task 5: Settings integration (Tabox AI section + enable interception)

**Files:**
- Modify: `app/SettingsMenu.js` (imports at top; state ~line 31; sections array ~line 213; expandedSections init ~line 34; modal render next to the SyncDebugModal block ~line 677)
- Test: `tests/SettingsMenuTaboxAI.test.js`

How the interception works: the shared `Switch` component persists `chkTaboxAI` on click *by itself* (see `app/Switch.js:72-79`). So the handler runs 100ms later (same pattern as `handlePerformanceMode`), and if the flag just flipped to `true` it reverts it to `false` and opens `AIEnableModal` instead. Only the modal's Enable button can set the flag for real. Turning the switch **off** needs no interception.

- [ ] **Step 1: Write the failing test**

```js
// tests/SettingsMenuTaboxAI.test.js
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { Provider } from 'jotai';
import SettingsMenu from '../app/SettingsMenu';

jest.mock('../app/OrphanRecoveryContext', () => ({
    useOrphanRecoveryContext: () => ({}),
}));

describe('SettingsMenu — Tabox AI section', () => {
    test('renders a Tabox AI section with the enable switch', async () => {
        await act(async () => {
            render(
                <Provider>
                    <SettingsMenu updateRemoteData={jest.fn()} applyDataFromServer={jest.fn()} />
                </Provider>
            );
        });
        expect(screen.getByText('Tabox AI')).toBeInTheDocument();
        expect(document.getElementById('chkTaboxAI')).toBeInTheDocument();
    });
});
```

(If `OrphanRecoveryContext` already tolerates a missing provider, the mock is harmless; keep it for isolation.)

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn jest tests/SettingsMenuTaboxAI.test.js`
Expected: FAIL — `Unable to find an element with the text: Tabox AI`

- [ ] **Step 3: Modify SettingsMenu.js**

3a. Add imports at the top (near the other `lazy` import and icon imports):

```js
import { BsStars } from 'react-icons/bs';

const AIEnableModal = lazy(() => import('./AIEnableModal'));
```

3b. Add state next to `isSyncDebugModalOpen` (~line 31):

```js
const [isAIEnableModalOpen, setIsAIEnableModalOpen] = useState(false);
```

3c. Add `ai: true` to the `expandedSections` initial state object (~line 34):

```js
const [expandedSections, setExpandedSections] = useState({
    general: true,
    ai: true,
    adding: true,
    opening: true,
    editing: true,
    autoUpdate: true,
    backup: true,
});
```

3d. Add the toggle handler next to `handlePerformanceMode` (~line 195):

```js
const handleTaboxAIToggle = async () => {
    setTimeout(async () => {
        const { chkTaboxAI } = await browser.storage.local.get('chkTaboxAI');
        if (chkTaboxAI === true) {
            // The switch persisted "on" — revert and require acknowledgment first.
            // Only AIEnableModal's Enable button sets the flag for real.
            await browser.storage.local.set({ chkTaboxAI: false });
            setIsAIEnableModalOpen(true);
            closeMenu();
        }
    }, 100);
};
```

3e. Add a new section to `commonSettingsSections`, right after the `general` section object (so it shows in both popup drawer and full-page settings):

```js
{
    key: 'ai',
    title: 'Tabox AI',
    icon: BsStars,
    description: 'On-device AI features powered by Chrome’s built-in model. Nothing leaves your computer.',
    items: [
        {
            type: 'switch',
            key: 'chkTaboxAI',
            title: 'Tabox AI',
            description: 'Enable on-device AI tools like auto-naming collections. Requires a one-time model download.',
            switchProps: {
                id: 'chkTaboxAI',
                onMouseUp: handleTaboxAIToggle,
                'data-tooltip-id': 'main-tooltip',
                'data-tooltip-content': 'AI runs locally in Chrome — your data never leaves your device',
                textOn: <span><BsStars size="14" style={{ marginRight: '8px' }} />Tabox AI: <strong>Enabled</strong></span>,
                textOff: <span><BsStars size="14" style={{ marginRight: '8px' }} />Tabox AI: <strong>Disabled</strong></span>,
            },
        },
    ],
},
```

3f. Render the modal at the end of the component's return fragment, after the existing `{!isFullPageVariant && (<Modal ... SyncDebugModal ...>)}` block (render in BOTH variants — full-page settings also has the switch):

```jsx
{isAIEnableModalOpen && (
    <Suspense fallback={null}>
        <AIEnableModal
            isOpen={isAIEnableModalOpen}
            onClose={() => setIsAIEnableModalOpen(false)}
        />
    </Suspense>
)}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn jest tests/SettingsMenuTaboxAI.test.js`
Expected: PASS
Run: `yarn jest tests/ --testPathPattern "SettingsMenu"`
Expected: any pre-existing SettingsMenu tests still PASS

- [ ] **Step 5: Commit**

```bash
git add app/SettingsMenu.js tests/SettingsMenuTaboxAI.test.js
git commit -m "feat(ai): add Tabox AI settings section gated by acknowledgment modal"
```

---

### Task 6: AIButton in popup Header and full-page FPTopBar

**Files:**
- Create: `app/AIButton.js`
- Create: `app/AIButton.css`
- Modify: `app/Header.js:233-234` (header-right, before `<TabSwitcherButton />`)
- Modify: `app/fullpage/FPTopBar.js:86-88` (fp-control-strip, before `<TabSwitcherButton />`)
- Test: `tests/AIButton.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/AIButton.test.js
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'jotai';
import { browser } from '../static/globals';
import AIButton from '../app/AIButton';

describe('AIButton', () => {
    beforeEach(() => {
        browser.storage.local.get.mockReset();
    });

    test('renders when Tabox AI is enabled', async () => {
        browser.storage.local.get.mockResolvedValue({ chkTaboxAI: true });
        render(<Provider><AIButton /></Provider>);
        await waitFor(() => expect(screen.getByRole('button', { name: /tabox ai/i })).toBeInTheDocument());
    });

    test('renders nothing when Tabox AI is disabled', async () => {
        browser.storage.local.get.mockResolvedValue({});
        const { container } = render(<Provider><AIButton /></Provider>);
        await waitFor(() => expect(browser.storage.local.get).toHaveBeenCalled());
        expect(container.querySelector('.ai-button')).toBeNull();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn jest tests/AIButton.test.js`
Expected: FAIL — `Cannot find module '../app/AIButton'`

- [ ] **Step 3: Write the component and integrate**

```jsx
// app/AIButton.js
import React from 'react';
import { useSetAtom } from 'jotai';
import { BsStars } from 'react-icons/bs';
import { aiToolsModalOpenState } from './atoms/aiState';
import { useTaboxAIEnabled } from './ai/useTaboxAIEnabled';
import './AIButton.css';

function AIButton() {
    const enabled = useTaboxAIEnabled();
    const setAIToolsOpen = useSetAtom(aiToolsModalOpenState);

    if (!enabled) return null;

    return (
        <button
            type="button"
            className="ai-button"
            aria-label="Tabox AI"
            onClick={() => setAIToolsOpen(true)}
            data-tooltip-id="main-tooltip"
            data-tooltip-content="Tabox AI tools"
        >
            <BsStars size={15} />
            <span className="ai-button-label">AI</span>
        </button>
    );
}

export default AIButton;
```

```css
/* app/AIButton.css */
.ai-button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: none;
    border-radius: 14px;
    padding: 5px 11px;
    cursor: pointer;
    color: #fff;
    background: linear-gradient(135deg, #7c3aed 0%, #2563eb 100%);
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
}

.ai-button:hover {
    filter: brightness(1.15);
    box-shadow: 0 0 10px rgba(124, 58, 237, 0.45);
}

.ai-button-label {
    letter-spacing: 0.4px;
}
```

In `app/Header.js`, add the import and render before `<TabSwitcherButton />` in the `header-right` div:

```jsx
import AIButton from './AIButton';
// ...
<div className="header-right">
    <AIButton />
    <TabSwitcherButton />
    {/* existing buttons unchanged */}
</div>
```

In `app/fullpage/FPTopBar.js`, add the import and render at the start of the control strip:

```jsx
import AIButton from '../AIButton';
// ...
<div className="fp-control-strip">
    <AIButton />
    <TabSwitcherButton />
    <div className="header-separator" />
    {/* existing strip unchanged */}
</div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn jest tests/AIButton.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add app/AIButton.js app/AIButton.css app/Header.js app/fullpage/FPTopBar.js tests/AIButton.test.js
git commit -m "feat(ai): add AI button to popup header and full-page top bar"
```

---

### Task 7: AIToolsModal + App.js wiring

**Files:**
- Create: `app/AIToolsModal.js`
- Create: `app/AIToolsModal.css`
- Modify: `app/App.js` (~line 2009: define `aiToolsModalEl`; ~line 2024 and ~line 2068: render it in both mode branches next to `{tabSwitcherEl}`)
- Test: `tests/AIToolsModal.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/AIToolsModal.test.js
import React from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { aiToolsModalOpenState } from '../app/atoms/aiState';

jest.mock('../app/ai/tasks/suggestCollectionName', () => ({
    suggestCollectionName: jest.fn(),
}));
jest.mock('../app/utils/storageUtils', () => ({
    loadAllCollections: jest.fn(),
}));
jest.mock('../app/toastHelpers', () => ({
    showSuccessToast: jest.fn(),
}));

import { suggestCollectionName } from '../app/ai/tasks/suggestCollectionName';
import { loadAllCollections } from '../app/utils/storageUtils';
import AIToolsModal from '../app/AIToolsModal';

const renderOpenModal = async (updateCollection = jest.fn()) => {
    const store = createStore();
    store.set(aiToolsModalOpenState, true);
    await act(async () => {
        render(
            <Provider store={store}>
                <AIToolsModal updateCollection={updateCollection} />
            </Provider>
        );
    });
    return store;
};

describe('AIToolsModal', () => {
    beforeEach(() => {
        loadAllCollections.mockResolvedValue([
            { uid: 'c1', name: 'Untitled', tabs: [{ title: 'React Docs', url: 'https://react.dev' }] },
        ]);
        suggestCollectionName.mockReset();
    });

    test('lists the registered AI tools', async () => {
        await renderOpenModal();
        expect(screen.getByText('Auto-name collection')).toBeInTheDocument();
    });

    test('suggests and applies a new collection name', async () => {
        suggestCollectionName.mockResolvedValue('React Learning');
        const updateCollection = jest.fn();
        await renderOpenModal(updateCollection);

        fireEvent.click(screen.getByText('Auto-name collection'));
        fireEvent.change(screen.getByLabelText(/collection/i), { target: { value: 'c1' } });
        fireEvent.click(screen.getByRole('button', { name: /suggest name/i }));

        await waitFor(() => expect(screen.getByDisplayValue('React Learning')).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: /apply/i }));
        await waitFor(() => expect(updateCollection).toHaveBeenCalledWith(
            expect.objectContaining({ uid: 'c1', name: 'React Learning' }),
            true,
        ));
    });

    test('shows an error when suggestion fails', async () => {
        suggestCollectionName.mockRejectedValue(new Error('boom'));
        await renderOpenModal();
        fireEvent.click(screen.getByText('Auto-name collection'));
        fireEvent.change(screen.getByLabelText(/collection/i), { target: { value: 'c1' } });
        fireEvent.click(screen.getByRole('button', { name: /suggest name/i }));
        await waitFor(() => expect(screen.getByText(/could not generate/i)).toBeInTheDocument());
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn jest tests/AIToolsModal.test.js`
Expected: FAIL — `Cannot find module '../app/AIToolsModal'`

- [ ] **Step 3: Write the component**

```jsx
// app/AIToolsModal.js
import React, { useEffect, useState } from 'react';
import Modal from 'react-modal';
import { useAtom, useAtomValue } from 'jotai';
import { MdClose, MdArrowBack } from 'react-icons/md';
import { BsStars } from 'react-icons/bs';
import { aiToolsModalOpenState } from './atoms/aiState';
import { viewContextState } from './atoms/globalAppSettingsState';
import { AI_TOOLS } from './ai/aiTasks';
import { suggestCollectionName } from './ai/tasks/suggestCollectionName';
import { loadAllCollections } from './utils/storageUtils';
import { showSuccessToast } from './toastHelpers';
import './AIToolsModal.css';

function AIToolsModal({ updateCollection }) {
    const [isOpen, setIsOpen] = useAtom(aiToolsModalOpenState);
    const viewContext = useAtomValue(viewContextState);
    const [activeToolId, setActiveToolId] = useState(null);
    const [collections, setCollections] = useState([]);
    const [selectedUid, setSelectedUid] = useState('');
    const [suggestion, setSuggestion] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!isOpen) return;
        setActiveToolId(null);
        setSelectedUid('');
        setSuggestion('');
        setError(null);
        loadAllCollections().then(setCollections).catch((loadError) => {
            console.error('Tabox AI: failed to load collections', loadError);
            setCollections([]);
        });
    }, [isOpen]);

    const close = () => setIsOpen(false);
    const selectedCollection = collections.find((collection) => collection.uid === selectedUid);

    const handleSuggest = async () => {
        if (!selectedCollection) return;
        setLoading(true);
        setError(null);
        try {
            setSuggestion(await suggestCollectionName(selectedCollection));
        } catch (suggestError) {
            console.error('Tabox AI name suggestion failed:', suggestError);
            setError('Could not generate a suggestion. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const handleApply = async () => {
        const trimmed = suggestion.trim();
        if (!selectedCollection || !trimmed) return;
        await updateCollection({
            ...selectedCollection,
            name: trimmed.substring(0, 50),
            lastUpdated: Date.now(),
        }, true);
        showSuccessToast('Collection renamed!');
        close();
    };

    return (
        <Modal
            isOpen={isOpen}
            onRequestClose={close}
            contentLabel="Tabox AI Tools"
            className={`modal-content ai-tools-modal${viewContext === 'fullpage' ? ' ai-tools-modal--fullpage' : ''}`}
            overlayClassName="modal-overlay"
            ariaHideApp={false}
            shouldCloseOnOverlayClick={true}
            shouldCloseOnEsc={true}
        >
            <div className="ai-tools-modal-content">
                <div className="ai-tools-modal-header">
                    <div className="ai-tools-modal-title">
                        {activeToolId ? (
                            <button type="button" className="ai-tools-back" onClick={() => setActiveToolId(null)} aria-label="Back to tools">
                                <MdArrowBack size={18} />
                            </button>
                        ) : (
                            <BsStars className="ai-tools-title-icon" size={18} />
                        )}
                        <span>{activeToolId ? AI_TOOLS.find((tool) => tool.id === activeToolId)?.title : 'Tabox AI'}</span>
                    </div>
                    <button className="ai-tools-modal-close" onClick={close} type="button">
                        <MdClose />
                    </button>
                </div>

                {!activeToolId && (
                    <div className="ai-tools-list">
                        {AI_TOOLS.map((tool) => {
                            const ToolIcon = tool.icon;
                            return (
                                <button key={tool.id} type="button" className="ai-tool-card" onClick={() => setActiveToolId(tool.id)}>
                                    <ToolIcon size={22} className="ai-tool-card-icon" />
                                    <span className="ai-tool-card-title">{tool.title}</span>
                                    <span className="ai-tool-card-description">{tool.description}</span>
                                </button>
                            );
                        })}
                    </div>
                )}

                {activeToolId === 'auto-rename' && (
                    <div className="ai-tool-panel">
                        <label className="ai-tool-label" htmlFor="ai-rename-collection">Collection</label>
                        <select
                            id="ai-rename-collection"
                            className="ai-tool-select"
                            value={selectedUid}
                            onChange={(e) => { setSelectedUid(e.target.value); setSuggestion(''); setError(null); }}
                        >
                            <option value="">Choose a collection…</option>
                            {collections.map((collection) => (
                                <option key={collection.uid} value={collection.uid}>
                                    {collection.name} ({(collection.tabs || []).length} tabs)
                                </option>
                            ))}
                        </select>

                        <button
                            type="button"
                            className="ai-tool-action-btn"
                            onClick={handleSuggest}
                            disabled={!selectedUid || loading}
                        >
                            <BsStars size={14} style={{ marginRight: '6px' }} />
                            {loading ? 'Thinking…' : suggestion ? 'Suggest again' : 'Suggest name'}
                        </button>

                        {suggestion && (
                            <div className="ai-tool-suggestion">
                                <label className="ai-tool-label" htmlFor="ai-rename-suggestion">Suggested name (editable)</label>
                                <input
                                    id="ai-rename-suggestion"
                                    type="text"
                                    className="ai-tool-suggestion-input"
                                    maxLength={50}
                                    value={suggestion}
                                    onChange={(e) => setSuggestion(e.target.value)}
                                />
                                <button type="button" className="ai-tool-apply-btn" onClick={handleApply} disabled={!suggestion.trim()}>
                                    Apply
                                </button>
                            </div>
                        )}

                        {error && <div className="ai-tool-error">{error}</div>}
                    </div>
                )}
            </div>
        </Modal>
    );
}

export default AIToolsModal;
```

```css
/* app/AIToolsModal.css */
.ai-tools-modal {
    max-width: 360px;
    width: 90%;
}

.ai-tools-modal--fullpage {
    max-width: 560px;
}

.ai-tools-modal-content {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px;
}

.ai-tools-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.ai-tools-modal-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
    font-weight: 700;
    color: var(--text-color);
}

.ai-tools-title-icon {
    color: #7c3aed;
}

.ai-tools-back,
.ai-tools-modal-close {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-color);
    display: inline-flex;
    align-items: center;
}

.ai-tools-list {
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
}

.ai-tools-modal--fullpage .ai-tools-list {
    grid-template-columns: 1fr 1fr;
}

.ai-tool-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    padding: 12px;
    border: 1px solid rgba(124, 58, 237, 0.35);
    border-radius: 10px;
    background: rgba(124, 58, 237, 0.06);
    cursor: pointer;
    text-align: left;
    color: var(--text-color);
}

.ai-tool-card:hover {
    border-color: #7c3aed;
    box-shadow: 0 0 8px rgba(124, 58, 237, 0.25);
}

.ai-tool-card-icon {
    color: #7c3aed;
}

.ai-tool-card-title {
    font-size: 13px;
    font-weight: 700;
}

.ai-tool-card-description {
    font-size: 12px;
    opacity: 0.75;
}

.ai-tool-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.ai-tool-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-color);
    opacity: 0.8;
}

.ai-tool-select,
.ai-tool-suggestion-input {
    width: 100%;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid var(--border-color, rgba(128, 128, 128, 0.4));
    background: var(--background-color, transparent);
    color: var(--text-color);
    font-size: 13px;
    box-sizing: border-box;
}

.ai-tool-action-btn,
.ai-tool-apply-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 6px;
    padding: 8px 14px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    color: #fff;
    background: linear-gradient(135deg, #7c3aed 0%, #2563eb 100%);
}

.ai-tool-action-btn:disabled,
.ai-tool-apply-btn:disabled {
    opacity: 0.5;
    cursor: default;
}

.ai-tool-suggestion {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.ai-tool-error {
    color: #dc2626;
    font-size: 13px;
    font-weight: 600;
}
```

3b. Wire into `app/App.js`. Add the import at the top:

```js
import AIToolsModal from './AIToolsModal';
```

Define the element next to `tabSwitcherEl` (~line 2009):

```js
const aiToolsModalEl = <AIToolsModal updateCollection={updateCollection} />;
```

Render `{aiToolsModalEl}` immediately after `{tabSwitcherEl}` in BOTH return branches (full-page branch ~line 2024 and popup branch ~line 2068).

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn jest tests/AIToolsModal.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add app/AIToolsModal.js app/AIToolsModal.css app/App.js tests/AIToolsModal.test.js
git commit -m "feat(ai): add AI tools modal with auto-naming POC wired into both views"
```

---

### Task 8: Full verification

- [ ] **Step 1: Run the full test suite**

Run: `yarn test`
Expected: all suites PASS (including all pre-existing tests)

- [ ] **Step 2: Lint**

Run: `yarn lint`
Expected: no errors

- [ ] **Step 3: Production build (required by CLAUDE.md)**

Run: `yarn prod`
Expected: webpack build completes with no errors

- [ ] **Step 4: Manual smoke test (requires Chrome 138+ on eligible hardware)**

1. Load `build/` as unpacked extension; open the popup.
2. Settings → "Tabox AI" section exists; toggling on opens the acknowledgment modal (the switch must NOT stay on by itself).
3. Click "Enable Tabox AI" — on eligible hardware: download progress → success toast → AI button appears in the popup header; on ineligible hardware: requirements error shown and the flag stays off.
4. AI button → modal → "Auto-name collection" → pick a collection → Suggest → edit → Apply → collection renamed (with lightning effect) and synced.
5. Open full page — AI button appears in the top bar control strip, modal works with the wider layout.
6. Toggle Tabox AI off in settings — buttons disappear in both views without reload (storage.onChanged).

- [ ] **Step 5: Commit any fixes and finish**

Use superpowers:finishing-a-development-branch to decide merge/PR.

---

## Future extension points (out of scope, documented for reviewers)

- New AI tools: add an entry to `AI_TOOLS` in `app/ai/aiTasks.js` + implementation under `app/ai/tasks/` + a panel branch in `AIToolsModal` (candidates: smart-organize tabs into groups, "where does this tab belong", contextual sparkle button next to the collection name in `CollectionDetailPanel`).
- Moving inference to the service worker: change `aiClient.js` to `browser.runtime.sendMessage` calls; feature code is unaffected.
- A pre-fill hook at save time (suggest a name in `AddNewTextbox` before the user saves) once the POC validates quality.
