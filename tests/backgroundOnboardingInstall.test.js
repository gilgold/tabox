const fs = require('fs');
const path = require('path');

describe('onboarding eligibility triggers in background.js', () => {
    const source = fs.readFileSync(path.join(__dirname, '../chrome/background.js'), 'utf8');
    const installBranch = source.match(/else if \(reason === "install"\) \{([\s\S]*?)\n\s*\}/)?.[1] || '';
    const updateBranch = source.match(/if \(reason === "update"\) \{([\s\S]*?)else if \(reason === "install"\)/)?.[1] || '';

    test('fresh install marks onboarding eligibility', () => {
        expect(installBranch).toContain('onboardingEligible: true');
    });

    test('update branch marks eligibility only when crossing the 4.2 boundary and not yet completed', () => {
        expect(updateBranch).toContain("ONBOARDING_INTRO_VERSION = '4.2'");
        expect(updateBranch).toContain('onboardingEligible: true');
        // Gated on both the version crossing and the completed flag
        expect(updateBranch).toMatch(/!versionAtLeast\(previousVersion, ONBOARDING_INTRO_VERSION\) && versionAtLeast\(currentVersion, ONBOARDING_INTRO_VERSION\)/);
        expect(updateBranch).toMatch(/onboardingCompleted[\s\S]*?!== true[\s\S]*?onboardingEligible: true/);
    });

    describe('versionAtLeast gate logic', () => {
        // Evaluate the helper exactly as it exists in the shipped source.
        const helperSource = updateBranch.match(/const versionAtLeast = ([\s\S]*?\n\s*};)/)?.[1];
        const versionAtLeast = eval(`(${helperSource.replace(/;\s*$/, '')})`);

        test.each([
            ['4.1', false],
            ['4.1.9', false],
            ['3.9', false],
            ['4.2', true],
            ['4.2.1', true],
            ['4.10', true],
            [undefined, false],
        ])('previousVersion %s → at least 4.2 is %s', (version, expected) => {
            expect(versionAtLeast(version, '4.2')).toBe(expected);
        });
    });
});
