const { jest: baseConfig } = require('./package.json');

module.exports = {
    ...baseConfig,
    transformIgnorePatterns: ['node_modules/(?!@toolz/allow-react)/'],
    testEnvironment: 'jsdom',
    collectCoverage: true,
    collectCoverageFrom: [
        'app/**/*.js',
        'chrome/**/*.js',
        'static/**/*.js',
        '!tests/**',
        '!__mocks__/**',
        '!build/**'
    ],
    coveragePathIgnorePatterns: [
        '/node_modules/',
        '/tests/',
        '/__mocks__/',
        '/build/'
    ],
    coverageReporters: [
        'text',
        'text-summary',
        'json-summary',
        'lcov'
    ],
    reporters: ['default']
};
