const cloneValue = (value) => {
    if (value === undefined) {
        return undefined;
    }

    return JSON.parse(JSON.stringify(value));
};

const createEventMock = () => {
    const listeners = new Set();

    return {
        addListener: jest.fn((listener) => listeners.add(listener)),
        removeListener: jest.fn((listener) => listeners.delete(listener)),
        hasListener: jest.fn((listener) => listeners.has(listener)),
        trigger: async (...args) => {
            const results = [];
            for (const listener of listeners) {
                results.push(await listener(...args));
            }
            return results;
        },
        _listeners: listeners
    };
};

const resolveStorageGet = async (keys, storage) => {
    if (keys === undefined || keys === null) {
        return cloneValue(storage);
    }

    if (typeof keys === 'string') {
        return { [keys]: cloneValue(storage[keys]) };
    }

    if (Array.isArray(keys)) {
        return keys.reduce((result, key) => {
            if (storage[key] !== undefined) {
                result[key] = cloneValue(storage[key]);
            }
            return result;
        }, {});
    }

    if (typeof keys === 'object') {
        return Object.keys(keys).reduce((result, key) => {
            result[key] = storage[key] !== undefined ? cloneValue(storage[key]) : keys[key];
            return result;
        }, {});
    }

    return {};
};

const createStorageArea = (eventBus, areaName, initialData = {}, behavior = {}) => {
    let store = cloneValue(initialData) || {};

    const area = {
        get: jest.fn(async (keys) => {
            if (behavior.getError) {
                throw behavior.getError;
            }

            if (behavior.getImpl) {
                return behavior.getImpl(keys, store);
            }

            return resolveStorageGet(keys, store);
        }),
        set: jest.fn(async (items) => {
            if (behavior.setError) {
                throw behavior.setError;
            }

            if (behavior.setImpl) {
                return behavior.setImpl(items, store);
            }

            const changes = {};

            Object.entries(items).forEach(([key, value]) => {
                const oldValue = cloneValue(store[key]);
                const newValue = cloneValue(value);
                store[key] = newValue;
                changes[key] = { oldValue, newValue };
            });

            if (Object.keys(changes).length > 0) {
                await eventBus.trigger(changes, areaName);
            }
        }),
        remove: jest.fn(async (keys) => {
            if (behavior.removeError) {
                throw behavior.removeError;
            }

            if (behavior.removeImpl) {
                return behavior.removeImpl(keys, store);
            }

            const targetKeys = Array.isArray(keys) ? keys : [keys];
            const changes = {};

            targetKeys.forEach((key) => {
                if (key in store) {
                    changes[key] = { oldValue: cloneValue(store[key]), newValue: undefined };
                    delete store[key];
                }
            });

            if (Object.keys(changes).length > 0) {
                await eventBus.trigger(changes, areaName);
            }
        }),
        clear: jest.fn(async () => {
            if (behavior.clearError) {
                throw behavior.clearError;
            }

            if (behavior.clearImpl) {
                return behavior.clearImpl(store);
            }

            const changes = {};

            Object.keys(store).forEach((key) => {
                changes[key] = { oldValue: cloneValue(store[key]), newValue: undefined };
                delete store[key];
            });

            if (Object.keys(changes).length > 0) {
                await eventBus.trigger(changes, areaName);
            }
        }),
        getBytesInUse: jest.fn(async () => JSON.stringify(store).length)
    };

    Object.defineProperty(area, '_data', {
        get() {
            return store;
        },
        set(nextValue) {
            store = cloneValue(nextValue) || {};
        }
    });

    return area;
};

const createBrowserHarness = (options = {}) => {
    const {
        localData = {},
        syncData = {},
        manifestVersion = '4.1',
        runtimeSendMessageImpl = null,
        localStorageBehavior = {},
        syncStorageBehavior = {},
        displays = [
            {
                bounds: { left: 0, top: 0, width: 1920, height: 1080 }
            }
        ]
    } = options;

    const storageChanged = createEventMock();
    const runtimeOnMessage = createEventMock();
    const alarmsOnAlarm = createEventMock();
    const local = createStorageArea(storageChanged, 'local', localData, localStorageBehavior);
    const sync = createStorageArea(storageChanged, 'sync', syncData, syncStorageBehavior);
    const session = createStorageArea(storageChanged, 'session', {});
    const alarms = [];
    let nextTabId = 1;
    let nextWindowId = 100;

    const browser = {
        runtime: {
            id: 'tabox-test-runtime',
            getManifest: jest.fn(() => ({ version: manifestVersion, oauth2: { client_id: 'test-client', scopes: [] } })),
            getURL: jest.fn((path) => `chrome-extension://test/${path}`),
            sendMessage: jest.fn(async (message) => {
                if (runtimeSendMessageImpl) {
                    return runtimeSendMessageImpl(message, browser);
                }

                for (const listener of runtimeOnMessage._listeners) {
                    const result = await listener(message);
                    if (result !== undefined) {
                        return result;
                    }
                }

                return undefined;
            }),
            onMessage: runtimeOnMessage,
            onInstalled: createEventMock(),
            onStartup: createEventMock()
        },
        sessions: {
            MAX_SESSION_RESULTS: 25,
            getRecentlyClosed: jest.fn(async () => []),
            restore: jest.fn(async () => undefined),
            onChanged: createEventMock()
        },
        storage: {
            local,
            sync,
            session,
            onChanged: storageChanged
        },
        permissions: {
            contains: jest.fn(async () => false),
            request: jest.fn(async () => false),
            onAdded: createEventMock(),
            onRemoved: createEventMock()
        },
        notifications: {
            create: jest.fn(async () => 'notif-id'),
            clear: jest.fn(async () => true),
            onClicked: createEventMock()
        },
        alarms: {
            create: jest.fn((name, alarmInfo) => {
                const index = alarms.findIndex((alarm) => alarm.name === name);
                const nextAlarm = { name, ...alarmInfo };
                if (index > -1) {
                    alarms[index] = nextAlarm;
                } else {
                    alarms.push(nextAlarm);
                }
            }),
            getAll: jest.fn(async () => cloneValue(alarms)),
            clear: jest.fn(async (name) => {
                const index = alarms.findIndex((alarm) => alarm.name === name);
                if (index > -1) {
                    alarms.splice(index, 1);
                    return true;
                }
                return false;
            }),
            onAlarm: alarmsOnAlarm
        },
        identity: {
            getRedirectURL: jest.fn(() => 'https://example.test/redirect'),
            launchWebAuthFlow: jest.fn(),
            getAuthToken: jest.fn(async () => 'token-123'),
            removeCachedAuthToken: jest.fn(async () => undefined)
        },
        extension: {
            isAllowedIncognitoAccess: jest.fn(async () => true)
        },
        system: {
            display: {
                getInfo: jest.fn(async () => cloneValue(displays))
            }
        },
        action: {
            setPopup: jest.fn(async () => {}),
            setBadgeText: jest.fn(),
            setBadgeBackgroundColor: jest.fn(),
            onClicked: createEventMock()
        },
        contextMenus: {
            create: jest.fn(),
            removeAll: jest.fn(async () => {}),
            onClicked: createEventMock()
        },
        commands: {
            onCommand: createEventMock()
        },
        windows: {
            WINDOW_ID_CURRENT: -2,
            getAll: jest.fn(async () => []),
            get: jest.fn(async (windowId) => ({ id: windowId, tabs: [] })),
            getCurrent: jest.fn(async () => ({ id: 1, focused: true, tabs: [] })),
            getLastFocused: jest.fn(async () => ({ id: 1, focused: true, tabs: [] })),
            create: jest.fn(async (options = {}) => ({
                id: nextWindowId++,
                tabs: [{ id: nextTabId++, url: 'about:blank' }],
                ...options
            })),
            update: jest.fn(async (windowId, updates) => ({ id: windowId, ...updates })),
            onCreated: createEventMock(),
            onRemoved: createEventMock(),
            onFocusChanged: createEventMock(),
            onBoundsChanged: createEventMock()
        },
        tabs: {
            query: jest.fn(async () => []),
            create: jest.fn(async (properties) => ({ id: nextTabId++, ...properties })),
            update: jest.fn(async (tabId, properties) => ({ id: tabId, ...properties })),
            get: jest.fn(async (tabId) => ({ id: tabId, url: 'https://example.com' })),
            move: jest.fn(async (tabIds, moveProperties) => ({ tabIds, ...moveProperties })),
            highlight: jest.fn(async () => undefined),
            reload: jest.fn(async () => undefined),
            remove: jest.fn(async () => {}),
            discard: jest.fn(async () => undefined),
            sendMessage: jest.fn(async () => undefined),
            group: jest.fn(async () => 1),
            ungroup: jest.fn(async () => undefined),
            captureVisibleTab: jest.fn(async () => 'data:image/jpeg;base64,TEST'),
            onCreated: createEventMock(),
            onRemoved: createEventMock(),
            onUpdated: createEventMock(),
            onActivated: createEventMock(),
            onMoved: createEventMock(),
            onAttached: createEventMock(),
            onDetached: createEventMock()
        },
        tabGroups: {
            query: jest.fn(async () => []),
            update: jest.fn(async (groupId, properties) => ({ id: groupId, ...properties })),
            onCreated: createEventMock(),
            onUpdated: createEventMock(),
            onMoved: createEventMock(),
            onRemoved: createEventMock()
        }
    };

    return browser;
};

module.exports = {
    cloneValue,
    createBrowserHarness,
    createEventMock
};
