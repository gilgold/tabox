import React, { Suspense } from 'react';
import { render } from '@testing-library/react';
import { Provider, createStore } from 'jotai';

export const renderWithProviders = (
    ui,
    {
        atomValues = [],
        fallback = null,
        store = createStore(),
        withSuspense = true,
        ...renderOptions
    } = {},
) => {
    atomValues.forEach(([atom, value]) => {
        store.set(atom, value);
    });

    const Wrapper = ({ children }) => {
        const content = (
            <Provider store={store}>
                {children}
            </Provider>
        );

        if (!withSuspense) {
            return content;
        }

        return (
            <Suspense fallback={fallback}>
                {content}
            </Suspense>
        );
    };

    return {
        store,
        ...render(ui, { wrapper: Wrapper, ...renderOptions }),
    };
};
