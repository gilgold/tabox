const { mkdtempSync, readFileSync, rmSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');
const { spawnSync } = require('child_process');

const projectRoot = join(__dirname, '..');
const template = readFileSync(
    join(projectRoot, 'site', 'pricing', 'pricing.template.html'),
    'utf8',
);

describe('Wix pricing page template', () => {
    test('makes annual billing the default and labels it as the best value', () => {
        expect(template).toContain('var cadence = "year"');
        expect(template).toContain('data-cadence="year" aria-pressed="true"');
        expect(template).toContain('data-cadence="month" aria-pressed="false"');
        expect(template).toContain('BEST VALUE');
    });

    test('contains the conversion-focused copy and trial CTA', () => {
        expect(template).toContain('Turn tab chaos into organized focus.');
        expect(template).toContain('7-day free trial');
        expect(template).toContain('Start free trial');
        expect(template).toContain('Cancel anytime');
    });

    test('keeps the hero clean and separates the value ribbon from plan copy', () => {
        expect(template).not.toContain('class="tbx-eyebrow"');
        expect(template).not.toContain('.tbx-eyebrow');
        expect(template).toContain('top: 0;');
        expect(template).toContain('padding: 92px 42px 36px;');
    });

    test('renders the product story with code-native graphics', () => {
        expect(template).toContain('class="tbx-product-visual"');
        expect(template).toContain('class="tbx-browser-window"');
        expect(template).not.toContain('tbx-ai-orbit');
        expect(template).toContain('class="tbx-visual-features"');
        expect(template).toContain('Tabox AI');
        expect(template).toContain('Shared folders');
        expect(template).toContain('Share collections via link');
        expect(template).toMatch(/\.tbx-visual-feature svg\s*\{[\s\S]*?width: 32px;[\s\S]*?background: none;/);
        expect(template).toContain('.tbx-visual-feature:first-child');
        expect(template).toContain('@keyframes tbx-ai-feature-border');
        expect(template).toContain('class="tbx-sync-orbit"');
        expect(template).not.toMatch(/<img\b/i);
    });

    test('leaves the Wix site background visible', () => {
        expect(template).toContain('background: transparent;');
        expect(template).not.toContain('class="tbx-backdrop"');
        expect(template).not.toContain('tbx-ghost-folder');
    });

    test('keeps billing controls and status updates accessible', () => {
        expect(template).toContain('aria-label="Billing period"');
        expect(template).toContain('aria-live="polite"');
        expect(template).toContain('@media (prefers-reduced-motion: reduce)');
    });

    test('builds a Wix snippet within the 15,000 character limit', () => {
        const canonicalOutputPath = join(projectRoot, 'site', 'pricing', 'pricing.html');
        const canonicalOutputBefore = readFileSync(canonicalOutputPath, 'utf8');
        const tempDirectory = mkdtempSync(join(tmpdir(), 'tabox-pricing-'));
        const tempOutputPath = join(tempDirectory, 'pricing.html');

        try {
            const result = spawnSync(
                process.execPath,
                ['site/pricing/build-pricing.mjs'],
                {
                    cwd: projectRoot,
                    encoding: 'utf8',
                    env: {
                        ...process.env,
                        PADDLE_ENV: 'sandbox',
                        PADDLE_CLIENT_TOKEN: 'test_wix_size_check',
                        PRICING_OUTPUT_PATH: tempOutputPath,
                        SITE_URL: 'https://www.tabox.co',
                    },
                },
            );

            expect(result.status).toBe(0);
            const built = readFileSync(tempOutputPath, 'utf8');
            expect([...built].length).toBeLessThanOrEqual(15000);
            expect(readFileSync(canonicalOutputPath, 'utf8')).toBe(canonicalOutputBefore);
        } finally {
            rmSync(tempDirectory, { recursive: true, force: true });
        }
    });
});
