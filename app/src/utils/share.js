/**
 * Generates a direct Telegram bot share URL.
 * Clicking this link inside Telegram ALWAYS opens Telegram Mini App directly.
 * @param {string} shareId - Share ID (e.g., d_123, f_123, c_123)
 * @returns {string} Public share URL
 */
export const getPublicShareUrl = (shareId) => {
  if (!shareId) return 'https://t.me/LerneDeutsch287_bot';
  return `https://t.me/LerneDeutsch287_bot?startapp=${shareId}`;
};

/**
 * Universal cross-platform share helper.
 * - In Telegram Mini App: opens native Telegram share sheet.
 * - On Mobile Browsers: opens native Web Share dialog.
 * - On PC / Desktop Browsers: copies link to clipboard directly.
 */
export const executeShare = async ({ title, text, link }) => {
  // 1. Inside Telegram Mini App: use Telegram's in-app share sheet
  const tg = window.Telegram?.WebApp;
  if (tg && tg.initData && tg.openTelegramLink) {
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text || '')}`;
    tg.openTelegramLink(shareUrl);
    return { success: true, type: 'telegram' };
  }

  // 2. Mobile devices: use native Web Share API
  const isMobile = typeof navigator !== 'undefined' && /android|iphone|ipad|ipod/i.test(navigator.userAgent);
  if (isMobile && navigator.share) {
    try {
      await navigator.share({ title, text, url: link });
      return { success: true, type: 'share' };
    } catch (err) {
      if (err.name === 'AbortError') return { success: false };
    }
  }

  // 3. Desktop / PC Web Browsers: copy to clipboard
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(link);
      return { success: true, type: 'copy' };
    } catch (e) {
      console.warn("Clipboard write failed, using fallback:", e);
    }
  }

  // Fallback copy using textarea element
  try {
    const ta = document.createElement('textarea');
    ta.value = link;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return { success: true, type: 'copy' };
  } catch {
    return { success: false };
  }
};
