import fs from 'fs';
import path from 'path';

describe('full-page PipelinePro styling contract', () => {
    const css = fs.readFileSync(path.join(__dirname, '../app/fullpage/FPLayout.css'), 'utf8');
    const contentAreaCss = fs.readFileSync(path.join(__dirname, '../app/fullpage/FPContentArea.css'), 'utf8');
    const collectionCardCss = fs.readFileSync(path.join(__dirname, '../app/fullpage/FPCollectionCard.css'), 'utf8');
    const sidebarCss = fs.readFileSync(path.join(__dirname, '../app/fullpage/FPSidebar.css'), 'utf8');
    const legacyImportCss = fs.readFileSync(path.join(__dirname, '../app/fullpage/LegacyImportPreviewModal.css'), 'utf8');
    const badgeCss = fs.readFileSync(path.join(__dirname, '../app/fullpage/FPBadge.css'), 'utf8');
    const designDoc = fs.readFileSync(path.join(__dirname, '../DESIGN.md'), 'utf8');

    test('defines the PipelinePro theme tokens in the full-page scope', () => {
        const fullpageTokenRule = css.match(/html\.fullpage-mode\s*{[\s\S]+?^}/m)?.[0] || '';
        const darkTokenRule = css.match(/html\.fullpage-mode\[data-theme="dark"\]\s*{[\s\S]+?^}/m)?.[0] || '';

        expect(fullpageTokenRule).toContain('--color-primary: #4F46E5');
        expect(fullpageTokenRule).toContain('--color-secondary: #06B6D4');
        expect(fullpageTokenRule).toContain('--color-tertiary: #F97316');
        expect(fullpageTokenRule).toContain('--fp-card-radius: 12px');
        expect(fullpageTokenRule).toContain('--fp-radius-xs: 6px');
        expect(fullpageTokenRule).toContain('--fp-radius-sm: 12px');
        expect(fullpageTokenRule).toContain('--fp-radius-md: 12px');
        expect(fullpageTokenRule).toContain('--fp-radius-lg: 16px');
        expect(fullpageTokenRule).toContain('--fp-radius-xl: 24px');
        expect(fullpageTokenRule).toContain('--primary-color: var(--color-primary)');

        expect(darkTokenRule).toContain('--color-primary: #1490f1');
        expect(darkTokenRule).toContain('--color-info: #1490f1');
        expect(darkTokenRule).toContain('--color-background: #09090B');
        expect(darkTokenRule).toContain('--color-surface: #18181B');
        expect(darkTokenRule).toContain('--color-selected-bg: #0c2953');
    });

    test('documents the rounder PipelinePro radius scale', () => {
        expect(designDoc).toContain('**Small:** 6px');
        expect(designDoc).toContain('**Medium:** 12px');
        expect(designDoc).toContain('**Large:** 16px');
        expect(designDoc).toContain('**XL:** 24px');
        expect(designDoc).toContain('--fp-radius-sm: 12px;');
        expect(designDoc).toContain('--fp-radius-xl: 24px;');
        expect(designDoc).toContain('12px corners');
    });

    test('keeps the Tabox topbar logo gradient text treatment', () => {
        const logoRule = css.match(/html\.fullpage-mode \.fp-topbar-logo\s*{[^}]+}/)?.[0] || '';

        expect(logoRule).toContain('background: linear-gradient(135deg, var(--gradient-blue) 0%, var(--gradient-purple) 50%, var(--gradient-orange) 100%)');
        expect(logoRule).toContain('-webkit-background-clip: text');
        expect(logoRule).toContain('-webkit-text-fill-color: transparent');
        expect(logoRule).toContain('background-clip: text');
    });

    test('normalizes repeated full-page controls through shared PipelinePro selectors', () => {
        expect(css).toContain('html.fullpage-mode .fp-toolbar-btn');
        expect(css).toContain('html.fullpage-mode .fp-card-action-btn');
        expect(css).toContain('html.fullpage-mode .fp-session-action-btn');
        expect(css).toContain('html.fullpage-mode .save-collection-btn');
        expect(css).toContain('html.fullpage-mode .bulk-collection-btn');
        expect(css).toContain('html.fullpage-mode .delete-confirm-btn');
        expect(css).toContain('html.fullpage-mode .current-window-close-btn');
        expect(css).toContain('html.fullpage-mode .create-folder-btn');
        expect(css).toContain('html.fullpage-mode .save-collection-input');
        expect(css).toContain('html.fullpage-mode .bulk-collection-select');
        expect(css).toContain('html.fullpage-mode .create-folder-input');
        expect(css).toContain('html.fullpage-mode .current-window-close-form-group input');
    });

    test('covers overlay surfaces and contextual menus with the same design layer', () => {
        expect(css).toContain('html.fullpage-mode .save-collection-modal-content');
        expect(css).toContain('html.fullpage-mode .bulk-collection-modal-content');
        expect(css).toContain('html.fullpage-mode .create-folder-modal-content');
        expect(css).toContain('html.fullpage-mode .current-window-close-modal');
        expect(css).toContain('html.fullpage-mode .fp-card-ctx-menu');
        expect(css).toContain('html.fullpage-mode .fp-sidebar-ctx-menu');
        expect(css).toContain('html.fullpage-mode .fp-tab-ctx-menu');
        expect(css).toContain('html.fullpage-mode .fp-toast');
    });

    test('keeps list rows compact and tile hover restrained', () => {
        const listCardRule = css.match(/html\.fullpage-mode \.fp-content-list-mode \.fp-card\s*{[^}]+}/)?.[0] || '';
        const listBodyRule = css.match(/html\.fullpage-mode \.fp-content-list-mode \.fp-card-body\s*{[^}]+}/)?.[0] || '';
        const cardRule = css.match(/html\.fullpage-mode \.fp-card\s*{[^}]+}/)?.[0] || '';
        const hoverRule = css.match(/html\.fullpage-mode \.fp-card:hover,[\s\S]+?\.fp-single-tab-session-row:focus-visible\s*{[^}]+}/)?.[0] || '';
        const faviconHoverRule = css.match(/html\.fullpage-mode \.fp-card:hover \.fp-card-favicon,[\s\S]+?\.fp-card\.fp-card-interaction-active \.fp-card-favicon-more\s*{[^}]+}/)?.[0] || '';

        expect(cardRule).toContain('border-left: 4px solid var(--card-color, var(--color-primary))');
        expect(listCardRule).toContain('min-height: 44px');
        expect(listCardRule).toContain('max-height: 56px');
        expect(listBodyRule).toContain('padding: 6px 12px');
        expect(hoverRule).toContain('background: var(--color-surface)');
        expect(hoverRule).toContain('border-color: var(--color-border-strong)');
        expect(hoverRule).not.toContain('transform: translateY');
        expect(faviconHoverRule).toContain('filter: none');
        expect(faviconHoverRule).toContain('opacity: 1');
    });

    test('keeps collection hover actions visually consistent', () => {
        const actionsRule = css.match(/html\.fullpage-mode \.fp-card-actions\s*{[^}]+}/)?.[0] || '';
        const actionButtonRule = css.match(/html\.fullpage-mode \.fp-card-actions \.fp-card-action-btn\s*{[^}]+}/)?.[0] || '';
        const primaryActionRule = css.match(/html\.fullpage-mode \.fp-card-actions \.fp-card-action-btn\.primary\s*{[^}]+}/)?.[0] || '';
        const secondaryActionRule = css.match(/html\.fullpage-mode \.fp-card-actions \.fp-card-action-btn\.secondary\s*{[^}]+}/)?.[0] || '';
        const secondaryWrapRule = css.match(/html\.fullpage-mode \.fp-card-action-secondary\s*{[^}]+}/)?.[0] || '';
        const colorPickerRule = css.match(/html\.fullpage-mode \.fp-card-actions \.modern-color-picker\s*{[^}]+}/)?.[0] || '';

        expect(actionsRule).toContain('box-sizing: border-box');
        expect(actionsRule).toContain('min-width: 0');
        expect(actionsRule).toContain('gap: 5px');
        expect(actionsRule).toContain('padding: 8px');
        expect(actionButtonRule).toContain('height: 32px');
        expect(actionButtonRule).toContain('min-height: 32px');
        expect(actionButtonRule).toContain('min-width: 0');
        expect(actionButtonRule).toContain('padding: 0 8px');
        expect(actionButtonRule).toContain('white-space: nowrap');
        expect(actionButtonRule).toContain('border-radius: var(--fp-radius-sm)');
        expect(actionButtonRule).toContain('font-size: 12px');
        expect(actionButtonRule).toContain('line-height: 1');
        expect(primaryActionRule).toContain('flex: 1 1 auto');
        expect(primaryActionRule).toContain('min-width: 0');
        expect(secondaryActionRule).toContain('flex: 0 0 84px');
        expect(secondaryActionRule).toContain('min-width: 84px');
        expect(secondaryWrapRule).toContain('flex: 0 0 auto');
        expect(secondaryWrapRule).toContain('min-width: max-content');
        expect(colorPickerRule).toContain('width: 32px');
        expect(colorPickerRule).toContain('height: 32px');
    });

    test('uses one padded sidebar counter style', () => {
        const counterRule = sidebarCss.match(/\.fp-sidebar-counter\s*{[^}]+}/)?.[0] || '';
        const badgeRule = badgeCss.match(/\.fp-badge\s*{[^}]+}/)?.[0] || '';
        const fullpageCounterRule = css.match(/html\.fullpage-mode \.fp-sidebar-counter,[\s\S]+?legacy-import-preview-root-badge\s*{[^}]+}/)?.[0] || '';

        expect(badgeRule).toContain('display: inline-flex');
        expect(badgeRule).toContain('border-radius: var(--fp-radius-xs, 6px)');
        expect(counterRule).toContain('min-width: 26px');
        expect(counterRule).toContain('min-height: 22px');
        expect(counterRule).toContain('padding: 2px 9px');
        expect(counterRule).toContain('font-weight: 600');
        expect(fullpageCounterRule).toContain('html.fullpage-mode .fp-sidebar-counter');
    });

    test('uses the shared small-radius badge shape for tab and group counts', () => {
        const tabsChipRule = css.match(/html\.fullpage-mode \.fp-card-meta-chip\.tabs(?::not\([^)]*\))?,[\s\S]+?\.current-window-live-badge\s*{[^}]+}/)?.[0] || '';
        const groupsChipRule = css.match(/html\.fullpage-mode \.fp-card-meta-chip\.groups(?::not\([^)]*\))?,[\s\S]+?\.fp-single-tab-session-badge\s*{[^}]+}/)?.[0] || '';

        expect(tabsChipRule).toContain('border-radius: var(--fp-radius-xs)');
        expect(groupsChipRule).toContain('border-radius: var(--fp-radius-xs)');
        expect(designDoc).toContain('Full-page badges use the shared `FPBadge` component');
    });

    test('keeps collection count badges distinct and dark-theme friendly with no border', () => {
        const countChipRule = collectionCardCss.match(/\.fp-collection-card \.fp-card-count-chip\s*{[^}]+}/)?.[0] || '';
        const fullpageCountChipRule = collectionCardCss.match(/html\.fullpage-mode \.fp-collection-card \.fp-card-count-chip\s*{[^}]+}/)?.[0] || '';
        const tabsChipRule = collectionCardCss.match(/\.fp-collection-card \.fp-card-count-chip\.tabs\s*{[^}]+}/)?.[0] || '';
        const groupsChipRule = collectionCardCss.match(/\.fp-collection-card \.fp-card-count-chip\.groups\s*{[^}]+}/)?.[0] || '';
        const darkChipRule = collectionCardCss.match(/\[data-theme="dark"\] \.fp-collection-card \.fp-card-count-chip,[\s\S]+?html\.fullpage-mode\[data-theme="dark"\] \.fp-collection-card \.fp-card-count-chip\s*{[^}]+}/)?.[0] || '';

        expect(countChipRule).toContain('--fp-badge-bg: var(--fp-card-count-bg)');
        expect(countChipRule).toContain('--fp-badge-text: #fff');
        expect(countChipRule).toContain('border: 0');
        expect(fullpageCountChipRule).toContain('background: var(--fp-badge-bg)');
        expect(fullpageCountChipRule).toContain('color: var(--fp-badge-text)');
        expect(fullpageCountChipRule).toContain('border: 0');
        expect(tabsChipRule).toContain('--fp-card-count-bg: #2563eb');
        expect(tabsChipRule).toContain('--fp-card-count-dark-bg: #1e3a8a');
        expect(groupsChipRule).toContain('--fp-card-count-bg: #7c3aed');
        expect(groupsChipRule).toContain('--fp-card-count-dark-bg: #4c1d95');
        expect(darkChipRule).toContain('--fp-badge-bg: var(--fp-card-count-dark-bg)');
        expect(darkChipRule).toContain('--fp-badge-text: rgba(255, 255, 255, 0.86)');
    });

    test('keeps search clear buttons stationary with a clearer x', () => {
        const clearRule = css.match(/html\.fullpage-mode \.fp-search-clear,[\s\S]+?\.legacy-import-preview-search-clear\s*{[^}]+}/)?.[0] || '';
        const clearHoverRule = css.match(/html\.fullpage-mode \.fp-search-clear:hover,[\s\S]+?\.legacy-import-preview-search-clear:hover\s*{[^}]+}/)?.[0] || '';
        const clearActiveRule = css.match(/html\.fullpage-mode \.fp-search-clear:active,[\s\S]+?\.legacy-import-preview-search-clear:active\s*{[^}]+}/)?.[0] || '';

        expect(clearRule).toContain('font-size: 18px');
        expect(clearRule).toContain('font-weight: 700');
        expect(clearRule).toContain('transition: color 0.15s ease');
        expect(clearHoverRule).toContain('background: var(--color-surface-muted)');
        expect(clearHoverRule).toContain('transform: none');
        expect(clearActiveRule).toContain('transform: none');
    });

    test('applies one glass treatment to the header and toolbar', () => {
        const glassRule = css.match(/html\.fullpage-mode \.fp-content-heading,[\s\S]+?html\.fullpage-mode \.fp-toolbar\s*{[^}]+}/)?.[0] || '';

        expect(glassRule).toContain('background: color-mix(in srgb, var(--color-surface) 72%, transparent)');
        expect(glassRule).toContain('backdrop-filter: saturate(1.35) blur(18px)');
        expect(glassRule).toContain('-webkit-backdrop-filter: saturate(1.35) blur(18px)');
        expect(glassRule).toContain('border-color: color-mix(in srgb, var(--color-border) 78%, transparent)');
    });

    test('uses the heading accent as a real left border that reaches the rounded corners', () => {
        const headingAccentRule = css.match(/html\.fullpage-mode \.fp-content-heading\s*{[^}]+}/)?.[0] || '';
        const headingBeforeRule = css.match(/html\.fullpage-mode \.fp-content-heading::before\s*{[^}]+}/)?.[0] || '';
        const baseHeadingBeforeRule = contentAreaCss.match(/\.fp-content-heading::before\s*{[^}]+}/)?.[0] || '';

        expect(headingAccentRule).toContain('border-left: 4px solid var(--fp-heading-accent, var(--color-primary))');
        expect(headingAccentRule).toContain('border-left-color: var(--fp-heading-accent, var(--color-primary))');
        expect(headingBeforeRule).toContain('display: none');
        expect(baseHeadingBeforeRule).not.toContain('inset: 10px auto 10px 0');
    });

    test('aligns the import preview modal header and close button', () => {
        const headerRule = legacyImportCss.match(/\.legacy-import-preview-modal \.bulk-collection-modal-header\s*{[^}]+}/)?.[0] || '';
        const titleRule = legacyImportCss.match(/\.legacy-import-preview-modal \.bulk-collection-modal-title\s*{[^}]+}/)?.[0] || '';
        const closeRule = legacyImportCss.match(/\.legacy-import-preview-modal \.bulk-collection-modal-close\s*{[^}]+}/)?.[0] || '';

        expect(headerRule).toContain('min-height: 56px');
        expect(headerRule).toContain('align-items: center');
        expect(headerRule).toContain('padding: 0 22px');
        expect(titleRule).toContain('align-items: center');
        expect(titleRule).toContain('line-height: 1');
        expect(closeRule).toContain('align-self: center');
        expect(closeRule).toContain('line-height: 1');
    });
});
