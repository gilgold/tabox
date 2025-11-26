import ReactDOM from 'react-dom';
import toast from 'react-hot-toast';

if (!chrome.runtime.id) chrome.runtime.id = "tabox-test";

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
jest.mock('webextension-polyfill', () => ({
    runtime: {
        getManifest: jest.fn(() => ({ version: '1.0.0' })),
        sendMessage: jest.fn(() => Promise.resolve()),
    },
    storage: {
        local: {
            get: jest.fn(() => Promise.resolve({})),
            set: jest.fn(() => Promise.resolve()),
        },
    },
    windows: {
        WINDOW_ID_CURRENT: -2,
        getAll: jest.fn(() => Promise.resolve([{ id: 1 }])),
    },
    tabs: {
        query: jest.fn(() => Promise.resolve([])),
    },
}));

// Mock ReactDOM.createPortal to render portals inline for testing
jest.spyOn(ReactDOM, 'createPortal').mockImplementation((element, node) => element);


const b = {
    runtime: {
      getManifest: jest.fn(() => ({ version: '1.0.0' })),
      sendMessage: jest.fn(() => Promise.resolve()),
    },
    storage: {
        local: {
            get: jest.fn(() => Promise.resolve({})),
            set: jest.fn(() => Promise.resolve()),
        },
    },
    windows: {
        WINDOW_ID_CURRENT: -2,
        getAll: jest.fn(() => Promise.resolve([{ id: 1 }])),
    },
    tabs: {
        query: jest.fn(() => Promise.resolve([])),
    },
  };
global.browser = b;
Object.defineProperty(global.browser, "browser", { b, writable: true });
