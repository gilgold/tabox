import fs from 'fs';
import path from 'path';
import postcss from 'postcss';

// Regression contract for the production cascade. Native option paint still
// requires an OS/browser check; jsdom cannot render a native expanded select.
const css = postcss.parse(fs.readFileSync(path.join(__dirname, '../app/fullpage/FPLayout.css'), 'utf8'));
function declarations(selector, stylesheet = css) {
    const result = {};
    stylesheet.walkRules(rule => {
        if (rule.selectors.includes(selector)) rule.walkDecls(d => { result[d.prop] = d.value; });
    });
    return result;
}

test.each([
    'html.fullpage-mode .save-collection-folder-select option',
    'html.fullpage-mode .current-window-close-form-group select option',
    'html.fullpage-mode .bulk-collection-select option',
])('%s pairs an opaque surface with its theme foreground', selector => {
    expect(declarations(selector)).toEqual(expect.objectContaining({
        'background-color': 'var(--color-surface)',
        color: 'var(--color-text)',
    }));
});

test('popup controls reserve their natural height and the list scrolls in the remaining viewport', () => {
    const popupCss = postcss.parse(fs.readFileSync(path.join(__dirname, '../app/App.css'), 'utf8'));
    const popupDeclarations = selector => declarations(`.App:not(.fullpage) ${selector}`, popupCss);
    expect(declarations('.App:not(.fullpage)', popupCss).height).toBe('min(585px, 100vh)');
    expect(popupDeclarations('.header')['flex-shrink']).toBe('0');
    expect(popupDeclarations('.add-collections-wrapper')['flex-shrink']).toBe('0');
    expect(popupDeclarations('.collections-toolbar-wrapper')).toEqual(expect.objectContaining({
        position: 'static',
        'flex-shrink': '0',
    }));
    expect(popupDeclarations('.collection-list-container')).toEqual(expect.objectContaining({
        flex: '1',
        height: 'auto',
        'min-height': '0',
        'max-height': 'none',
        'padding-top': '5px',
        'overflow-y': 'auto',
    }));
});

test('FullPage Save To retains a native indicator with room beside the dot and label', () => {
    expect(declarations('html.fullpage-mode .save-collection-folder-select')).toEqual(expect.objectContaining({
        appearance: 'auto',
        'padding-right': '34px',
    }));
});
