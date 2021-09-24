import * as Snackbar from 'react-simple-snackbar';

const openSnackbarMock = jest.fn()
const closeSnackbarMock = jest.fn()
jest.spyOn(Snackbar, 'useSnackbar').mockImplementation(() => [openSnackbarMock, closeSnackbarMock])


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
