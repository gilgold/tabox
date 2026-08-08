const js = require("@eslint/js");
const globals = require("globals");
const react = require("eslint-plugin-react");
const jest = require("eslint-plugin-jest");

// CommonJS interop globals: several source files are dual-use (bundled by
// webpack but also `require()`d directly in tests) and guard on `module`.
const commonjsInterop = {
  module: "readonly",
  require: "readonly",
  process: "readonly",
  global: "readonly",
  __dirname: "readonly",
};

// Stylistic / legacy-cleanup rules are reported as warnings so they surface
// without failing CI. Correctness rules stay at "error".
const relaxedStyleRules = {
  "no-unused-vars": "warn",
  "no-empty": "warn",
  "no-useless-escape": "warn",
};

module.exports = [
  // Ignore build output, dependencies, generated bundles and scratch dirs.
  {
    ignores: [
      "build/**",
      "build-firefox/**",
      // Committed copy of a minified production bundle — not source.
      "v4/**",
      // Scratch/repro scripts (e.g. Playwright repros), not shipped source.
      "output/**",
      // Wix site code (Velo $w globals, Wix-hosted) — not extension source.
      "site/**",
      ".yarn/**",
      // Claude Code session data — includes git worktrees of the whole repo
      // that would otherwise be double-linted (without this project's parser
      // options, so they fail on JSX).
      ".claude/**",
      "node_modules/**",
      "coverage/**",
      "stats.json",
      "**/*.min.js",
      // Standalone server package (Cloudflare Worker) with its own ESLint.
      "server/**",
    ],
  },

  // Base recommended rules for all JS/JSX.
  js.configs.recommended,

  // React app code (popup + full page). Browser + WebExtension globals.
  {
    files: ["app/**/*.js", "static/**/*.js"],
    ...react.configs.flat.recommended,
    languageOptions: {
      ...react.configs.flat.recommended.languageOptions,
      ecmaVersion: 2021,
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        ...commonjsInterop,
        chrome: "readonly",
        browser: "readonly",
      },
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      // React 19 / new JSX transform: no need to import React in scope.
      "react/react-in-jsx-scope": "off",
      // prop-types are intentionally not used in this project.
      "react/prop-types": "off",
      // Legacy cleanup items — surface as warnings, don't block CI.
      "react/no-unescaped-entities": "warn",
      "react/display-name": "warn",
      ...relaxedStyleRules,
    },
  },

  // Extension service worker / background scripts.
  {
    files: ["chrome/**/*.js"],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
        ...globals.webextensions,
        ...commonjsInterop,
        chrome: "readonly",
        browser: "readonly",
      },
    },
    rules: {
      ...relaxedStyleRules,
    },
  },

  // Build/config scripts that run under Node (CommonJS).
  {
    files: ["*.js", "babel.config.js", "jest.coverage-all.config.js"],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...relaxedStyleRules,
    },
  },

  // Dev/seed scripts: run in Node but poke at extension/browser globals.
  {
    files: ["seed-test-data*.js", "quick-seed.js"],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.webextensions,
        chrome: "readonly",
        browser: "readonly",
      },
    },
    rules: {
      ...relaxedStyleRules,
    },
  },

  // Test files: Jest globals + recommended jest rules.
  {
    files: ["tests/**/*.js", "**/*.test.js", "__mocks__/**/*.js", "jest.setup.js"],
    ...jest.configs["flat/recommended"],
    plugins: {
      ...jest.configs["flat/recommended"].plugins,
      react,
    },
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest,
        chrome: "readonly",
        browser: "readonly",
      },
    },
    rules: {
      ...jest.configs["flat/recommended"].rules,
      "jest/no-conditional-expect": "warn",
      // Many test files also declare these via legacy `/* global */`
      // comments, which would otherwise collide with the config globals above.
      "no-redeclare": "off",
      // Without this, no-unused-vars can't see that imports are used as JSX
      // elements in test render calls.
      "react/jsx-uses-vars": "error",
      ...relaxedStyleRules,
    },
  },
];
