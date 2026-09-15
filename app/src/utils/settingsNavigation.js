export const SETTINGS_TABS = ['profile', 'srs', 'reminders', 'general', 'design', 'voice', 'autoplay', 'ai', 'prompts'];

export const readLastSettingsTab = () => {
  try {
    const tab = globalThis.localStorage?.getItem('lerne_last_settings_tab');
    return SETTINGS_TABS.includes(tab) ? tab : 'general';
  } catch { return 'general'; }
};

export const rememberSettingsTab = (tab) => {
  if (!SETTINGS_TABS.includes(tab)) return;
  try { globalThis.localStorage?.setItem('lerne_last_settings_tab', tab); } catch { /* storage unavailable */ }
};
