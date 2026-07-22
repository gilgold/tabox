const fs = require('fs');
const path = require('path');

describe('fresh-install onboarding eligibility', () => {
    test('is marked only by the install branch, never the update branch', () => {
        const source = fs.readFileSync(path.join(__dirname, '../chrome/background.js'), 'utf8');
        const installBranch = source.match(/else if \(reason === "install"\) \{([\s\S]*?)\n\s*\}/)?.[1] || '';
        const updateBranch = source.match(/if \(reason === "update"\) \{([\s\S]*?)else if \(reason === "install"\)/)?.[1] || '';

        expect(installBranch).toContain('onboardingEligible: true');
        expect(updateBranch).not.toContain('onboardingEligible');
    });
});
