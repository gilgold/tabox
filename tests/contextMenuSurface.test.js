const fs = require('fs');
const postcss = require('postcss');

// Check the opaque surface contract independently of backdrop-filter support.
// Actual engine paint/hit testing lives in fix-artifacts/menu-repro.cjs.
test.each(['light', 'dark'])('popup menu surface is opaque in %s theme even without blur', theme => {
    const globalCss = postcss.parse(fs.readFileSync('static/index.css', 'utf8'));
    const menuCss = postcss.parse(fs.readFileSync('app/CollectionList.css', 'utf8'));
    const tokens = {};
    globalCss.walkRules(rule => {
        if (rule.selector === ':root, [data-theme="light"]' || rule.selector === `[data-theme="${theme}"]`) {
            rule.walkDecls(decl => { if (decl.prop.startsWith('--')) tokens[decl.prop] = decl.value; });
        }
    });
    let background;
    menuCss.walkRules(rule => {
        if (rule.selector === '.context-menu') rule.walkDecls('background', decl => { background = decl.value; });
    });
    const color = background.replace(/var\((--[a-z-]+)(?:,[^)]*)?\)/, (_match, key) => tokens[key]);
    // Opaque hex or explicit alpha 1. Translucent eight-digit hex is rejected.
    expect(color).toMatch(/^(#[a-f0-9]{6}|#[a-f0-9]{3}|rgba\([^)]*,\s*1\))$/i);
});
