import { atom } from 'jotai';
import { isEntitled } from '../utils/premiumUtils';

export const premiumEntitlementState = atom(null);

export const isProState = atom((get) => isEntitled(get(premiumEntitlementState)));

// Manage-subscription modal visibility. Lives here (not local state) so both
// the settings menu and the command palette can open the shared modal in App.
export const manageSubscriptionOpenState = atom(false);

// Non-Chrome pre-checkout confirmation (Tabox AI is Chrome-only). Holds
// { onConfirm } while the confirm modal is open; null when closed. Set only
// by useProCheckout, rendered once by App as NonChromeProConfirmModal.
export const nonChromeProConfirmState = atom(null);
