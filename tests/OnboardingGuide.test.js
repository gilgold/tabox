const { render, screen, fireEvent, waitFor } = require('@testing-library/react');
require('@testing-library/jest-dom');
const { Provider, createStore } = require('jotai');

const { createBrowserHarness } = require('./helpers/browserHarness');

const mockBrowserProxy = new Proxy({}, {
    get(_target, property) {
        return global.browser?.[property];
    }
});

jest.mock('../static/globals', () => ({ browser: mockBrowserProxy }));

const mockStartProCheckout = jest.fn();
jest.mock('../app/useProCheckout', () => () => mockStartProCheckout);

const OnboardingGuide = require('../app/OnboardingGuide').default;
const fs = require('fs');
const path = require('path');

const renderGuide = (localData = {}, props = {}) => {
    global.browser = createBrowserHarness({ localData });
    global.chrome = { runtime: global.browser.runtime };

    return render(
        <Provider store={createStore()}>
            <OnboardingGuide {...props} />
        </Provider>
    );
};

describe('OnboardingGuide', () => {
    afterEach(() => {
        mockStartProCheckout.mockClear();
        delete global.browser;
        delete global.chrome;
    });

    test('shows when the fresh-install eligibility marker is present', async () => {
        renderGuide({ onboardingEligible: true });

        expect(await screen.findByRole('dialog', { name: 'Welcome to Tabox' })).toBeInTheDocument();
        expect(screen.getByText('Your tabs, finally under control.')).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: /go to step/i })).toHaveLength(6);
    });

    test('stays hidden for an existing user who already completed onboarding', async () => {
        renderGuide({
            extensionUpdated: true,
            extensionInstalled: true,
            installedVersion: '4.0.0',
            onboardingCompleted: true
        });

        await waitFor(() => {
            expect(global.browser.storage.local.get).toHaveBeenCalled();
        });
        expect(screen.queryByRole('dialog', { name: 'Welcome to Tabox' })).not.toBeInTheDocument();
    });

    test('stays hidden when the fresh-install eligibility marker is absent', async () => {
        renderGuide({});

        await waitFor(() => {
            expect(global.browser.storage.local.get).toHaveBeenCalled();
        });
        expect(screen.queryByRole('dialog', { name: 'Welcome to Tabox' })).not.toBeInTheDocument();
    });

    test('walks through the requested feature education with fluid step controls', async () => {
        renderGuide({ onboardingEligible: true });
        await screen.findByRole('dialog');

        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        expect(screen.getByRole('heading', { name: 'Save now. Find anything later.' })).toBeInTheDocument();
        expect(screen.getByText(/one box does both/i)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        expect(screen.getByRole('heading', { name: 'Collections stay flexible' })).toBeInTheDocument();
        expect(screen.getByText(/drag tabs into the order you want/i)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        expect(screen.getByRole('heading', { name: 'Build a system that feels like yours' })).toBeInTheDocument();
        expect(screen.getByText(/star the collections/i)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        expect(screen.getByRole('heading', { name: 'More room when you need it' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        expect(screen.getByRole('heading', { name: 'Meet Tabox Pro' })).toBeInTheDocument();
        expect(screen.getByText('Tabox AI')).toBeInTheDocument();
        expect(screen.getByText('Share folders & collections')).toBeInTheDocument();
        expect(screen.getByText('7 days free')).toBeInTheDocument();
    });

    test('all paging dots remain visible controls and can jump directly to a page', async () => {
        renderGuide({ onboardingEligible: true });
        await screen.findByRole('dialog');

        const dots = screen.getAllByRole('button', { name: /go to step/i });
        expect(dots).toHaveLength(6);
        dots.forEach((dot) => expect(dot).toHaveClass('onboarding-progress-dot'));
        expect(dots[0]).toHaveClass('active');
        expect(dots[1]).not.toHaveClass('active');

        fireEvent.click(dots[3]);
        expect(screen.getByRole('heading', { name: 'Build a system that feels like yours' })).toBeInTheDocument();
        expect(dots[3]).toHaveAttribute('aria-current', 'step');
    });

    test('keeps one shared scene frame static while only its contents change pages', async () => {
        const { container } = renderGuide({ onboardingEligible: true });
        await screen.findByRole('dialog');

        const frame = container.querySelector('.onboarding-scene-frame');
        const sceneTrack = container.querySelector('.onboarding-scene-track');

        expect(frame).toBeInTheDocument();
        expect(frame.querySelectorAll('.onboarding-scene')).toHaveLength(6);
        expect(frame.closest('.onboarding-track')).toBeNull();
        expect(sceneTrack).toHaveStyle({ transform: 'translate3d(-0%, 0, 0)' });

        fireEvent.click(screen.getByRole('button', { name: 'Next' }));

        expect(container.querySelector('.onboarding-scene-frame')).toBe(frame);
        expect(sceneTrack).toHaveStyle({ transform: 'translate3d(-100%, 0, 0)' });
    });

    test('feature animations are single-run timelines with no infinite loops', () => {
        const css = fs.readFileSync(path.join(__dirname, '../app/OnboardingGuide.css'), 'utf8');
        const source = fs.readFileSync(path.join(__dirname, '../app/OnboardingGuide.js'), 'utf8');

        expect(css).not.toMatch(/animation(?:-iteration-count)?[^;{}]*infinite/i);
        expect(css).toContain('animation-fill-mode: both !important');
        expect(css).toContain('animation-iteration-count: 1 !important');
        expect(css).toContain('.onboarding-scene.is-active');
        expect(source).toContain('browser-tab-row');
        expect(source).toContain('welcome-scene-intro');
        expect(css).toContain('animation:welcome-scene-intro 3.2s');
        expect(css).toContain('animation-delay:3.2s');
        expect(css).toContain('font-size:54px');
        expect(source).toContain('welcome-tabox-ui');
        expect(source).not.toContain('welcome-tabox-placeholder');
        expect(source).not.toContain('welcome-tabox-target');
        expect(source.match(/welcome-saved-box/g)).toHaveLength(1);
        expect(css).toContain('translate(var(--tab-flight-x),68px) scale(.14)');
        expect(css).toContain('left:calc(100% - 217px); top:97px; opacity:1');
        expect(css).toContain('padding:8px 13px; border:1px solid');
        expect(css).toContain('font-size:12px; font-weight:750');
        expect(css).toContain('.save-demo-label svg { font-size:16px; }');
        expect(css).toContain('@keyframes dragged-row-down { 0%,31% { transform:translate(0,0)');
        expect(css).toContain('38% { transform:translate(4px,18px)');
        expect(css).toContain('38% { opacity:1; transform:translate(4px,18px); }');
        expect(css).toContain('58% { transform:translate(16px,74px)');
        expect(css).toContain('58% { opacity:1; transform:translate(16px,74px); }');
        expect(css).toContain('62%,100% { transform:translate(0,74px); box-shadow:none; }');
        expect(css).toContain('62% { opacity:1; transform:translate(0,74px); }');
        expect(css).toContain('69% { opacity:0; transform:translate(0,74px); }');
        expect(css).toContain('.collection-pointer { animation: collection-pointer-path 6.7s cubic-bezier(.55,.05,.2,1); }');
        expect(css).not.toContain('60%,100% { transform: translateY(74px)');
        expect(source.indexOf('save-list-created')).toBeLessThan(source.indexOf('card-reading'));
        expect(source).toContain('organize-tabox-window');
        expect(source).toContain('organize-folder-row');
        expect(source).toContain('organize-collection-row');
        expect(source).toContain('organize-favorite-star');
        expect(source).not.toContain('organize-paint-sweep');
        expect(css).toContain('@keyframes favorite-star-saved');
        expect(source).toContain('morphing-window');
        expect(source).toContain('shared-folder-fullview');
        expect(source).toContain('shared-arriving-collection');
        expect(source).not.toContain('shared-slot');
        expect(css).not.toContain('popup-gives-way');
        expect(css).not.toContain('workspace-expands');
        expect(css).toContain('width: min(560px, calc(100vw - 16px))');
        expect(css).toContain('flex-wrap: nowrap');
        expect(css).toContain('left:92px; right:92px');
        expect(css).toContain('top:58px; bottom:7px; padding:12px 12px 18px');
        expect(css).toContain('.fullpage-pointer { z-index:6; top:43px; left:310px; }');
        expect(css).toContain('.fullpage-pointer { top:43px; left:224px; }');
        expect(css).toContain('.sharing-user svg { font-size:18px; }');
        expect(css).toContain('font-size:11px; }.shared-arriving-collection i');
    });

    test('styles the first-step heading as a larger brand gradient', () => {
        const css = fs.readFileSync(path.join(__dirname, '../app/OnboardingGuide.css'), 'utf8');

        expect(css).toContain('.onboarding-slide--welcome .onboarding-eyebrow');
        expect(css).toContain('font-size:17px');
        expect(css).toContain('linear-gradient(90deg, #6757e8, #50c8ff)');
        expect(css).toContain('background-clip:text');
    });

    test('skip is always available and permanently completes onboarding', async () => {
        renderGuide({ onboardingEligible: true });
        await screen.findByRole('dialog');

        fireEvent.click(screen.getByRole('button', { name: 'Skip onboarding' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(global.browser.storage.local._data).toEqual(expect.objectContaining({
            onboardingEligible: false,
            onboardingCompleted: true
        }));
    });

    test('free and Pro choices both complete onboarding, while Pro starts checkout', async () => {
        renderGuide({ onboardingEligible: true });
        await screen.findByRole('dialog');

        fireEvent.click(screen.getByRole('button', { name: 'Go to step 6' }));
        fireEvent.click(screen.getByRole('button', { name: /start 7-day free trial/i }));

        await waitFor(() => expect(mockStartProCheckout).toHaveBeenCalledWith({ ensureLogin: true }));
        expect(global.browser.storage.local._data.onboardingCompleted).toBe(true);
    });

    test('stays hidden in full-page mode', async () => {
        renderGuide({ onboardingEligible: true }, { mode: 'fullpage' });

        await waitFor(() => expect(global.browser.storage.local.get).not.toHaveBeenCalled());
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    test('manual show-onboarding event reopens the guide even after completion', async () => {
        const { SHOW_ONBOARDING_EVENT } = require('../app/OnboardingGuide');
        renderGuide({ onboardingEligible: false, onboardingCompleted: true });

        await waitFor(() => expect(global.browser.storage.local.get).toHaveBeenCalled());
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

        fireEvent(window, new CustomEvent(SHOW_ONBOARDING_EVENT));

        expect(await screen.findByRole('dialog', { name: 'Welcome to Tabox' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Your tabs, finally under control.' })).toBeInTheDocument();
    });

    test('manual show-onboarding event works in full-page mode (parity)', async () => {
        const { SHOW_ONBOARDING_EVENT } = require('../app/OnboardingGuide');
        renderGuide({ onboardingCompleted: true }, { mode: 'fullpage' });

        fireEvent(window, new CustomEvent(SHOW_ONBOARDING_EVENT));

        expect(await screen.findByRole('dialog', { name: 'Welcome to Tabox' })).toBeInTheDocument();
    });
});
