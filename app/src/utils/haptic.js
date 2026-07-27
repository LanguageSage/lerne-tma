/**
 * Centralized Telegram WebApp haptic feedback utilities.
 * Replaces copy-pasted window.Telegram?.WebApp?.HapticFeedback?.* calls.
 */

export const hapticImpact = (style = 'light') => {
  window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(style);
};

export const hapticNotification = (type = 'success') => {
  window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred(type);
};

export const hapticSuccess = () => hapticNotification('success');
export const hapticError = () => hapticNotification('error');
export const hapticWarning = () => hapticNotification('warning');
export const hapticSelection = () => {
  window.Telegram?.WebApp?.HapticFeedback?.selectionChanged();
};
