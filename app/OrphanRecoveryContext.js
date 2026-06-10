import { createContext, useContext } from 'react';

/** Shared orphan-recovery state (from useOrphanRecovery), provided at the App root. */
export const OrphanRecoveryContext = createContext(null);

export const useOrphanRecoveryContext = () => useContext(OrphanRecoveryContext);
