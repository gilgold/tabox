
<div align="right">
  <details>
    <summary >🌐 Language</summary>
    <div>
      <div align="center">
        <a href="https://openaitx.github.io/view.html?user=gilgold&project=tabox&lang=en">English</a>
        | <a href="https://openaitx.github.io/view.html?user=gilgold&project=tabox&lang=zh-CN">简体中文</a>
        | <a href="https://openaitx.github.io/view.html?user=gilgold&project=tabox&lang=zh-TW">繁體中文</a>
        | <a href="https://openaitx.github.io/view.html?user=gilgold&project=tabox&lang=ja">日本語</a>
        | <a href="https://openaitx.github.io/view.html?user=gilgold&project=tabox&lang=ko">한국어</a>
        | <a href="https://openaitx.github.io/view.html?user=gilgold&project=tabox&lang=hi">हिन्दी</a>
        | <a href="https://openaitx.github.io/view.html?user=gilgold&project=tabox&lang=th">ไทย</a>
        | <a href="https://openaitx.github.io/view.html?user=gilgold&project=tabox&lang=fr">Français</a>
        | <a href="https://openaitx.github.io/view.html?user=gilgold&project=tabox&lang=de">Deutsch</a>
        | <a href="https://openaitx.github.io/view.html?user=gilgold&project=tabox&lang=es">Español</a>
        | <a href="https://openaitx.github.io/view.html?user=gilgold&project=tabox&lang=it">Italiano</a>
        | <a href="https://openaitx.github.io/view.html?user=gilgold&project=tabox&lang=ru">Русский</a>
        | <a href="https://openaitx.github.io/view.html?user=gilgold&project=tabox&lang=pt">Português</a>
        | <a href="https://openaitx.github.io/view.html?user=gilgold&project=tabox&lang=nl">Nederlands</a>
        | <a href="https://openaitx.github.io/view.html?user=gilgold&project=tabox&lang=pl">Polski</a>
        | <a href="https://openaitx.github.io/view.html?user=gilgold&project=tabox&lang=ar">العربية</a>
        | <a href="https://openaitx.github.io/view.html?user=gilgold&project=tabox&lang=fa">فارسی</a>
        | <a href="https://openaitx.github.io/view.html?user=gilgold&project=tabox&lang=tr">Türkçe</a>
        | <a href="https://openaitx.github.io/view.html?user=gilgold&project=tabox&lang=vi">Tiếng Việt</a>
        | <a href="https://openaitx.github.io/view.html?user=gilgold&project=tabox&lang=id">Bahasa Indonesia</a>
        | <a href="https://openaitx.github.io/view.html?user=gilgold&project=tabox&lang=as">অসমীয়া</
      </div>
    </div>
  </details>
</div>

# Tabox - Save and Share Tab Groups

[![Release](https://github.com/gilgold/tabox/actions/workflows/release.yml/badge.svg?branch=main)](https://github.com/gilgold/tabox/actions/workflows/release.yml)
![Chrome Web Store](https://img.shields.io/chrome-web-store/users/bdbliblipiempfdkkkjohnecmeknnpoa)
![Chrome Web Store](https://img.shields.io/chrome-web-store/v/bdbliblipiempfdkkkjohnecmeknnpoa)
[![](https://img.shields.io/badge/dynamic/json?label=edge%20add-on&prefix=v&query=%24.version&url=https%3A%2F%2Fmicrosoftedge.microsoft.com%2Faddons%2Fgetproductdetailsbycrxid%2Fekkmpemnpkaecapbjcgidkflglondcem)](https://microsoftedge.microsoft.com/addons/detail/tabox-save-and-share-ta/ekkmpemnpkaecapbjcgidkflglondcem)

<img src="https://static.wixstatic.com/media/8734ed_2f844e78ea2c4cc8aa8175552e1893ce~mv2.jpg" height="300">

Tabox is a Chrome (and also other Chromium based browsers) extension to save open tabs and tab groups in collections that can be easily re-opened in a single click. 

You can also export and import collections, allowing you the option of sharing a group of tabs with others.

Tabox allows you to sync your collections so you can have them in all your devices (Using your Google Drive account)

Want to help support Tabox and get your link, icon or banner here on this repo? [Click here to sponsor Tabox!](https://github.com/sponsors/gilgold)

[Get Tabox on the Chrome Web Store](https://chrome.google.com/webstore/detail/tabox-save-and-share-tab/bdbliblipiempfdkkkjohnecmeknnpoa)

[Get Tabox on the Edge Add-on Store](https://microsoftedge.microsoft.com/addons/detail/tabox-save-and-share-ta/ekkmpemnpkaecapbjcgidkflglondcem)

## Building from source

These instructions produce an exact copy of the packages submitted to the stores.
All build tools are open source and run locally; no network access is needed beyond
downloading npm packages.

### Requirements

| Tool | Version | Install |
|---|---|---|
| Node.js | 24.x (tested with 24.11.0; the AMO reviewer default 24.14.0 works) | https://nodejs.org/en/download |
| Yarn | 4.12.0 (pinned via `packageManager` in package.json) | `corepack enable` (Corepack ships with Node 24 and reads the pin automatically) |

Any 64-bit Linux (e.g. Ubuntu 24.04, ARM64 or x86_64) or macOS works — the build is
pure Node/webpack with no native or OS-specific steps. Dependency versions are locked
by `yarn.lock`.

### Build steps

```bash
corepack enable
yarn install --immutable

# Firefox (output: build-firefox/ — matches the XPI submitted to addons.mozilla.org)
INLINE_RUNTIME_CHUNK=false NODE_ENV=production yarn webpack --mode production --config webpack.js --env target=firefox --env sourcemap=false --env drop_console=true

# Chrome/Edge (output: build/ — matches the Chrome Web Store / Edge Add-ons package)
yarn build:release
```

The Firefox package is the contents of `build-firefox/` zipped (excluding
`browser-polyfill.min.js.map` and `.DS_Store`):

```bash
cd build-firefox && zip -r ../tabox-firefox.zip . -x "browser-polyfill.min.js.map" -x "*.DS_Store"
```

Notes for reviewers:

- Bundling: webpack 5 + Babel 7, minified by Terser (no obfuscation). All processing
  tools are open-source npm packages listed in `package.json` / locked in `yarn.lock`.
- The Firefox `manifest.json` is derived at build time from `chrome/manifest.json` by
  `chrome/buildManifest.js` (drops Chrome-only keys, adds `browser_specific_settings`,
  converts the service worker to event-page background scripts).
- `browser-polyfill.min.js` is copied verbatim from the `webextension-polyfill` npm
  package (see `yarn.lock` for the exact version).
- No remote code is loaded or executed at runtime; all JS ships in the package.

## License

Tabox is **source-available**: the code is published for transparency, security
review, and extension-store source verification. It is not open source — see
[LICENSE](LICENSE) for what you may and may not do with it.
