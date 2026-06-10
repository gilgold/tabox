/** @jest-environment jsdom */
import React from 'react';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

describe('static entrypoints', () => {
    const mountEntrypoint = (modulePath) => {
        jest.resetModules();
        cleanup();
        document.body.innerHTML = '<div id="root"></div>';

        let renderedElement = null;
        const mockCreateRoot = jest.fn(() => ({
            render: (element) => {
                renderedElement = element;
            },
        }));
        const mockAppComponent = jest.fn(() => null);
        const mockToastViewport = jest.fn(() => null);

        jest.doMock('react-dom/client', () => ({
            createRoot: mockCreateRoot,
        }));

        jest.doMock('../app/App', () => ({
            __esModule: true,
            default: mockAppComponent,
        }));

        jest.doMock('../app/ToastViewport', () => ({
            ToastViewport: mockToastViewport,
        }));

        jest.isolateModules(() => {
            require(modulePath);
        });

        return {
            mockCreateRoot,
            renderedElement,
            mockAppComponent,
            mockToastViewport,
        };
    };

    afterEach(() => {
        cleanup();
        jest.resetModules();
    });

    test('static/index mounts the popup app and popup toast viewport', () => {
        const {
            mockCreateRoot,
            renderedElement,
            mockAppComponent,
            mockToastViewport,
        } = mountEntrypoint('../static/index');

        expect(mockCreateRoot).toHaveBeenCalledWith(document.querySelector('#root'));
        const children = React.Children.toArray(renderedElement.props.children);

        expect(children[0].type).toBe(mockAppComponent);
        expect(children[0].props.mode).toBeUndefined();
        expect(children[1].type).toBe(mockToastViewport);
        expect(children[1].props.context).toBe('popup');
    });

    test('static/fullpage mounts the full-page app and toast viewport', () => {
        const {
            mockCreateRoot,
            renderedElement,
            mockAppComponent,
            mockToastViewport,
        } = mountEntrypoint('../static/fullpage');

        expect(mockCreateRoot).toHaveBeenCalledWith(document.querySelector('#root'));
        const children = React.Children.toArray(renderedElement.props.children);

        expect(children[0].type).toBe(mockAppComponent);
        expect(children[0].props.mode).toBe('fullpage');
        expect(children[1].type).toBe(mockToastViewport);
        expect(children[1].props.context).toBe('fullpage');
    });
});
