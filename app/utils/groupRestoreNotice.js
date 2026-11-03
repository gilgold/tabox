import { browser } from '../../static/globals';
import { showInfoToast } from '../toastHelpers';

const GROUP_RESTORE_NOTICE_KEY = 'groupRestoreNoticePending';

// Like fileAccessNotice: full-page can consume live feedback; a popup may die
// when the opened tabs take focus, so leave its live notice for the next mount.
export const initGroupRestoreNoticeWatcher = ({ isFullPage = false } = {}) => {
    const showPending = async (consume) => {
        try {
            const stored = await browser.storage.local.get(GROUP_RESTORE_NOTICE_KEY);
            const pending = stored?.[GROUP_RESTORE_NOTICE_KEY];
            if (!(pending?.tabsOpened > 0 && pending?.groupsFailed > 0)) return;
            const { tabsOpened, groupsFailed } = pending;
            showInfoToast(
                `Opened ${tabsOpened} ${tabsOpened === 1 ? 'tab' : 'tabs'}, but ${groupsFailed} saved ${groupsFailed === 1 ? 'group' : 'groups'} could not be fully restored.`,
                10000,
            );
            if (consume) await browser.storage.local.remove(GROUP_RESTORE_NOTICE_KEY);
        } catch (error) {
            console.warn('Could not show group-restore notice:', error);
        }
    };
    const handleChange = (changes, areaName) => {
        if (areaName === 'local' && changes[GROUP_RESTORE_NOTICE_KEY]?.newValue) {
            showPending(isFullPage);
        }
    };
    browser.storage.onChanged.addListener(handleChange);
    showPending(true);
    return () => browser.storage.onChanged.removeListener(handleChange);
};
