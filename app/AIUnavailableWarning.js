import React, { useEffect, useState } from 'react';
import { MdWarningAmber } from 'react-icons/md';
import { getAIAvailability } from './ai/aiClient';
import { getBrowserName } from './ai/browserSupport';
import './AIUnavailableWarning.css';

// Purchase-material warning shown on every Pro-checkout entry point when this
// browser/device can never run Tabox AI. Copy lives in JS strings (not JSX
// text) so apostrophes don't trip react/no-unescaped-entities.
const COPY = {
    unavailable: {
        lead: "Tabox AI won't work on this computer.",
        body: "This device doesn't meet Chrome's requirements for on-device AI (needs ~22 GB free disk space and a supported GPU). Other Pro features like shared folders will still work.",
    },
    unsupported: {
        lead: "Tabox AI isn't supported in this browser.",
        body: 'Tabox AI requires Google Chrome 138 or newer. Other Pro features like shared folders will still work.',
    },
    'unsupported-browser': {
        lead: 'Tabox AI is only available on Google Chrome.',
        get body() {
            return `You're using ${getBrowserName()}, which doesn't include Chrome's built-in AI model. Other Pro features like shared folders will still work.`;
        },
    },
};

export default function AIUnavailableWarning() {
    const [availability, setAvailability] = useState(null);

    useEffect(() => {
        let cancelled = false;
        getAIAvailability().then((state) => {
            if (!cancelled) setAvailability(state);
        });
        return () => { cancelled = true; };
    }, []);

    const copy = COPY[availability];
    if (!copy) return null;

    return (
        <div className="ai-unavailable-warning" role="alert">
            <MdWarningAmber className="ai-unavailable-warning-icon" aria-hidden="true" />
            <p><strong>{copy.lead}</strong> {copy.body}</p>
        </div>
    );
}
