/**
 * Generates a public share URL suitable for OpenGraph previews and Telegram sharing on all devices.
 * If running locally or on HTTP, falls back to the public production domain.
 * @param {string} shareId - Share ID (e.g., d_123, f_123, c_123)
 * @returns {string} Public share URL
 */
export const getPublicShareUrl = (shareId) => {
  const origin = window.location.origin;
  if (!origin || origin.includes('localhost') || origin.includes('127.0.0.1') || origin.startsWith('http:')) {
    return `https://tma-amber.vercel.app/api/share/v/${shareId}`;
  }
  return `${origin}/api/share/v/${shareId}`;
};

/**
 * Universal cross-platform share helper.
 * Tries Web Share API -> Telegram WebApp -> Clipboard -> Window Open.
 */
export const executeShare = async ({ title, text, link }) => {
  // 1. Try native mobile Web Share API
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url: link });
      return { success: true, type: 'share' };
    } catch (err) {
      if (err.name === 'AbortError') return { success: false };
    }
  }

  // 2. Try Telegram WebApp openTelegramLink
  const tg = window.Telegram?.WebApp;
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
  if (tg && tg.openTelegramLink) {
    tg.openTelegramLink(shareUrl);
    return { success: true, type: 'telegram' };
  }

  // 3. Fallback to Clipboard (PC Web Browsers)
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(link);
    return { success: true, type: 'copy' };
  }

  // 4. Final fallback to window.open
  window.open(shareUrl, '_blank');
  return { success: true, type: 'telegram' };
};
