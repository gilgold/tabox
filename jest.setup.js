import ReactDOM from 'react-dom';

if (!chrome.runtime.id) chrome.runtime.id = "tabox-test";

const createEventMock = () => {
    const listeners = new Set();
    return {
        addListener: jest.fn((listener) => listeners.add(listener)),
        removeListener: jest.fn((listener) => listeners.delete(listener)),
        hasListener: jest.fn((listener) => listeners.has(listener)),
        trigger: (...args) => {
            listeners.forEach((listener) => listener(...args));
        },
        _listeners: listeners,
    };
};

const mockBrowser = {
    runtime: {
        getManifest: jest.fn(() => ({ version: '1.0.0' })),
        getURL: jest.fn((path) => `chrome-extension://test/${path}`),
        sendMessage: jest.fn(() => Promise.resolve()),
    },
    sessions: {
        MAX_SESSION_RESULTS: 25,
        getRecentlyClosed: jest.fn(() => Promise.resolve([])),
        restore: jest.fn(() => Promise.resolve()),
        onChanged: createEventMock(),
    },
    storage: {
        local: {
            get: jest.fn(() => Promise.resolve({})),
            set: jest.fn(() => Promise.resolve()),
        },
        onChanged: createEventMock(),
    },
    windows: {
        WINDOW_ID_CURRENT: -2,
        create: jest.fn(() => Promise.resolve({ id: 1 })),
        getAll: jest.fn(() => Promise.resolve([{ id: 1 }])),
        getCurrent: jest.fn(() => Promise.resolve({ id: 1, focused: true, tabs: [] })),
        remove: jest.fn(() => Promise.resolve()),
        onCreated: createEventMock(),
        onRemoved: createEventMock(),
        onFocusChanged: createEventMock(),
        onBoundsChanged: createEventMock(),
    },
    tabs: {
        query: jest.fn(() => Promise.resolve([])),
        update: jest.fn(() => Promise.resolve({ id: 1 })),
        create: jest.fn(() => Promise.resolve({ id: 2 })),
        remove: jest.fn(() => Promise.resolve()),
        onCreated: createEventMock(),
        onRemoved: createEventMock(),
        onUpdated: createEventMock(),
        onMoved: createEventMock(),
        onAttached: createEventMock(),
        onDetached: createEventMock(),
    },
    tabGroups: {
        query: jest.fn(() => Promise.resolve([])),
        onCreated: createEventMock(),
        onUpdated: createEventMock(),
        onMoved: createEventMock(),
        onRemoved: createEventMock(),
    },
};

// Mock react-hot-toast for testing
jest.mock('react-hot-toast', () => ({
    __esModule: true,
    default: {
        success: jest.fn(),
        error: jest.fn(),
        custom: jest.fn(),
        dismiss: jest.fn(),
    },
    Toaster: () => null,
}));

// Mock webextension-polyfill (used by static/globals.js)
jest.mock('webextension-polyfill', () => mockBrowser);

// Mock ReactDOM.createPortal to render portals inline for testing
jest.spyOn(ReactDOM, 'createPortal').mockImplementation((element) => element);

global.browser = mockBrowser;
Object.defineProperty(global.browser, "browser", { value: mockBrowser, writable: true });
