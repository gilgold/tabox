import * as Snackbar from 'react-simple-snackbar';
import ReactDOM from 'react-dom';

if (!chrome.runtime.id) chrome.runtime.id = "tabox-test";
const openSnackbarMock = jest.fn()
const closeSnackbarMock = jest.fn()
jest.spyOn(Snackbar, 'useSnackbar').mockImplementation(() => [openSnackbarMock, closeSnackbarMock])

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
