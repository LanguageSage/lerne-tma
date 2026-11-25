import { Capacitor, registerPlugin } from '@capacitor/core';
import { isPlatformAssetUrl } from '../utils/platform.js';

const pluginCache = new Map();

export { isPlatformAssetUrl };

export function isNativePlatform() {
  try {
    return Boolean(Capacitor.isNativePlatform());
  } catch {
    return false;
  }
}

export function isNativePluginAvailable(name) {
  try {
    return Boolean(isNativePlatform() && Capacitor.isPluginAvailable(name));
  } catch {
    return false;
  }
}

export function getNativePlugin(name) {
  if (!pluginCache.has(name)) {
    pluginCache.set(name, registerPlugin(name));
  }
  return pluginCache.get(name);
}

export function convertNativeFileSrc(filePath) {
  try {
    if (typeof Capacitor?.convertFileSrc === 'function') {
      return Capacitor.convertFileSrc(filePath);
    }
  } catch {
    // Ignore native URL conversion errors in non-native runtimes.
  }
  return filePath;
}
