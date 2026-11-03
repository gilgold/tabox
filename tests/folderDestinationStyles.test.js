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

test('popup prefix and editable area share a flex border with bounded truncation', () => {
    const sheet = postcss.parse(fs.readFileSync(path.join(__dirname, '../app/AddNewTextbox.css'), 'utf8'));
    expect(declarations('.add-collection-group', sheet)).toEqual(expect.objectContaining({ display: 'flex', border: '2px solid transparent' }));
    expect(declarations('.quick-save-pill', sheet)).toEqual(expect.objectContaining({ 'max-width': '112px', 'border-radius': '999px', 'flex-shrink': '0' }));
    expect(declarations('.quick-save-pill-name', sheet)).toEqual(expect.objectContaining({ overflow: 'hidden', 'text-overflow': 'ellipsis' }));
    expect(declarations('.quick-save-input-area', sheet)).toEqual(expect.objectContaining({ flex: '1', 'min-width': '0' }));
    expect(declarations('.quick-save-pill.is-root', sheet).color).toBe('var(--quick-save-root-color)');
});

test('the floating placeholder remains within the editable area beside long destinations', () => {
    const sheet = postcss.parse(fs.readFileSync(path.join(__dirname, '../app/AddNewTextbox.css'), 'utf8'));
    expect(declarations('.add-collection-group label.textbox_label', sheet)).toEqual(expect.objectContaining({
        'max-width': 'calc(100% - 64px)', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap',
    }));
});
