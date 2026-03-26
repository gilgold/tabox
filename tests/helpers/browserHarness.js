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

const createStorageArea = (eventBus, areaName, initialData = {}) => {
    let store = cloneValue(initialData) || {};

    const area = {
        get: jest.fn(async (keys) => resolveStorageGet(keys, store)),
        set: jest.fn(async (items) => {
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
            const changes = {};

            Object.keys(store).forEach((key) => {
                changes[key] = { oldValue: cloneValue(store[key]), newValue: undefined };
                delete store[key];
            });

            if (Object.keys(changes).length > 0) {
                await eventBus.trigger(changes, areaName);
            }
        })
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
        runtimeSendMessageImpl = null
    } = options;

    const storageChanged = createEventMock();
    const runtimeOnMessage = createEventMock();
    const alarmsOnAlarm = createEventMock();
    const local = createStorageArea(storageChanged, 'local', localData);
    const sync = createStorageArea(storageChanged, 'sync', syncData);
    const alarms = [];

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
            onChanged: storageChanged
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
            launchWebAuthFlow: jest.fn()
        },
        extension: {
            isAllowedIncognitoAccess: jest.fn(async () => true)
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
            create: jest.fn(async (options = {}) => ({ id: 100, tabs: [{ id: 1000, url: 'about:blank' }], ...options })),
            update: jest.fn(async (windowId, updates) => ({ id: windowId, ...updates })),
            onCreated: createEventMock(),
            onRemoved: createEventMock(),
            onFocusChanged: createEventMock(),
            onBoundsChanged: createEventMock()
        },
        tabs: {
            query: jest.fn(async () => []),
            create: jest.fn(async (properties) => ({ id: Math.floor(Math.random() * 10000), ...properties })),
            update: jest.fn(async (tabId, properties) => ({ id: tabId, ...properties })),
            remove: jest.fn(async () => {}),
            group: jest.fn(async () => 1),
            onCreated: createEventMock(),
            onRemoved: createEventMock(),
            onUpdated: createEventMock(),
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
