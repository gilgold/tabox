// Editable tier catalog for the Tabox pricing page.
//
// To add or change a tier, edit this array and re-run `node build-pricing.mjs`.
// Price IDs come from the Paddle LIVE catalog (immutable amounts — archive+recreate to change).
//
// Shape (informal — this is plain JS, not TypeScript):
//   { name, description, features: string[], priceId: { month, year } }

export const TIERS = [
  {
    name: 'Pro',
    description: 'Everything in Tabox, unlocked.',
    features: [
      'Tabox AI: organize, rename, and arrange collections automatically',
      'Shared Folders: collaborate on live-syncing folders with your team',
      'Share links to collections: send any collection with a single link',
      '7-day free trial, cancel anytime',
    ],
    priceId: {
      month: 'pri_01kxk6xwxdgmtr2eat3xqacs3z', // Tabox Pro — monthly (live)
      year: 'pri_01kxk6xx37e1h9pdjvmvy457br', //  Tabox Pro — annual (live)
    },
    highlighted: true,
  },
];
