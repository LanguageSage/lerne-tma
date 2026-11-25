import { getNativePlugin, isNativePluginAvailable } from './nativeBridge.js';

const OfflineBackupFile = getNativePlugin('OfflineBackupFile');

export function isNativeBackupPickerAvailable() {
  return isNativePluginAvailable('OfflineBackupFile');
}

/**
 * Persist JSON backup via Android SAF picker on native Capacitor builds,
 * or standard browser file download on web builds.
 */
export async function saveBackupFile({ fileName, content }) {
  if (isNativeBackupPickerAvailable()) {
    return OfflineBackupFile.saveJsonFile({ fileName, content });
  }

  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return { cancelled: false, saved: true, fileName, channel: 'browser-download' };
}

/**
 * Open a backup JSON file using Android SAF picker on native Capacitor builds.
 * Returns null on web where the UI triggers a standard <input type="file">.
 */
export async function openBackupFileFromNative() {
  if (!isNativeBackupPickerAvailable()) {
    return null;
  }
  return OfflineBackupFile.openJsonFile();
}
