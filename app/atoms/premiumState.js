import { atom } from 'jotai';
import { isEntitled } from '../utils/premiumUtils';

export const premiumEntitlementState = atom(null);

export const isProState = atom((get) => isEntitled(get(premiumEntitlementState)));
