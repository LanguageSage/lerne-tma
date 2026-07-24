/**
 * Platform Abstraction Adapter for Lerne
 * Handles platform detection and hardware/UI bridges across Telegram Mini App (TMA),
 * Capacitor (Android/iOS Native), and Standalone Web.
 */

export const getPlatform = () => {
  if (typeof window !== 'undefined') {
    if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) {
      return 'capacitor';
    }
    if (window.Telegram?.WebApp && window.Telegram.WebApp.initData) {
      return 'telegram';
    }
  }
  return 'web';
};

export const isTelegram = () => getPlatform() === 'telegram';
export const isCapacitor = () => getPlatform() === 'capacitor';
export const isNative = () => isCapacitor();
export const isWeb = () => getPlatform() === 'web';

/**
 * Trigger platform-appropriate haptic feedback
 * @param {'light'|'medium'|'heavy'|'success'|'error'|'warning'} type 
 */
export const triggerHaptic = (type = 'light') => {
  try {
    const tg = window.Telegram?.WebApp?.HapticFeedback;
    if (tg) {
      if (['success', 'error', 'warning'].includes(type)) {
        tg.notificationOccurred(type);
      } else {
        tg.impactOccurred(type);
      }
      return;
    }

    if (navigator?.vibrate) {
      const patterns = {
        light: 10,
        medium: 25,
        heavy: 50,
        success: [15, 30, 15],
        warning: [30, 50, 30],
        error: [50, 50, 50]
      };
      navigator.vibrate(patterns[type] || 15);
    }
  } catch (e) {
    // Ignore haptic errors on unsupported devices
  }
};

/**
 * Enable swipe/window closing confirmation if supported by platform
 */
export const enableClosingConfirmation = () => {
  try {
    if (window.Telegram?.WebApp?.enableClosingConfirmation) {
      window.Telegram.WebApp.enableClosingConfirmation();
    }
  } catch (e) {}
};

/**
 * Control Native Back Button (Telegram & Capacitor)
 */
export const setupBackButton = (onClickCallback) => {
  try {
    const tg = window.Telegram?.WebApp?.BackButton;
    if (tg) {
      tg.show();
      tg.onClick(onClickCallback);
      return () => tg.offClick(onClickCallback);
    }
  } catch (e) {}
  return () => {};
};

export const hideBackButton = () => {
  try {
    const tg = window.Telegram?.WebApp?.BackButton;
    if (tg) {
      tg.hide();
    }
  } catch (e) {}
};
