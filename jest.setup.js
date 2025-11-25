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

// Mock ReactDOM.createPortal to render portals inline for testing
jest.spyOn(ReactDOM, 'createPortal').mockImplementation((element, node) => element);


const b = {
    runtime: {
      getManifest: jest.fn(() => ({ version: '1.0.0' })),
    },
    storage: {
        local: {
            get: jest.fn(),
            set: jest.fn(),
        },
    }
  };
global.browser = b;
Object.defineProperty(global.browser, "browser", { b, writable: true });
