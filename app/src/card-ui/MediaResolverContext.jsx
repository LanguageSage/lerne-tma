/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useMemo } from 'react';

const SUPABASE_AUDIO_CDN = 'https://wdopyuulhiykrextyvnt.supabase.co/storage/v1/object/public/audio';

export const defaultResolveAudioUrl = (pathOrUrl) => {
  if (!pathOrUrl || typeof pathOrUrl !== 'string') return '';
  const trimmed = pathOrUrl.trim();
  if (!trimmed) return '';
  if (/^(blob:|data:)/i.test(trimmed)) return trimmed;

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    if (trimmed.includes('/storage/v1/object/public/tma-audio/')) {
      return trimmed.replace('/storage/v1/object/public/tma-audio/', '/storage/v1/object/public/audio/');
    }
    return trimmed;
  }

  if (trimmed.startsWith('/api/media/')) return trimmed;

  const cleanPath = trimmed.split('?')[0];
  const filename = cleanPath.split(/[\\/]/).pop();
  if (!filename) return '';

  return `${SUPABASE_AUDIO_CDN}/${filename}`;
};

export function defaultResolveMediaUrl(path, kind = 'images') {
  if (!path || typeof path !== 'string') return null;
  if (kind === 'audio') return defaultResolveAudioUrl(path);
  const trimmed = path.trim();
  if (!trimmed) return null;
  if (/^(blob:|data:)/i.test(trimmed)) return trimmed;
  if (/^https?:/.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/api/media/')) return trimmed;
  const clean = trimmed.replace(/^(images|audio|videos)\//, '').replace(/^\/lid_images\//, '');
  return clean ? `/api/media/${kind}/${clean.split(/[\\/]/).pop()}` : null;
}

export function isDirectMediaUrl(value) {
  return typeof value === 'string' && /^(blob:|data:)/i.test(value.trim());
}

const MediaResolverContext = createContext({
  resolveMediaUrl: defaultResolveMediaUrl,
  resolveAudioUrl: defaultResolveAudioUrl,
  isLocalAssetUrl: isDirectMediaUrl,
  _customIsLocalAssetUrl: null,
});

export function MediaResolverProvider({
  resolveMediaUrl,
  resolveAudioUrl,
  isLocalAssetUrl,
  children,
}) {
  const parent = useContext(MediaResolverContext);
  const value = useMemo(() => {
    const nextResolveMediaUrl = resolveMediaUrl ?? parent.resolveMediaUrl ?? defaultResolveMediaUrl;
    const nextResolveAudioUrl = resolveAudioUrl ?? parent.resolveAudioUrl ?? defaultResolveAudioUrl;
    const nextCustomLocalCheck = isLocalAssetUrl ?? parent._customIsLocalAssetUrl ?? null;
    return {
      resolveMediaUrl: nextResolveMediaUrl,
      resolveAudioUrl: nextResolveAudioUrl,
      _customIsLocalAssetUrl: nextCustomLocalCheck,
      isLocalAssetUrl: (src) => isDirectMediaUrl(src) || Boolean(nextCustomLocalCheck?.(src)),
    };
  }, [resolveMediaUrl, resolveAudioUrl, isLocalAssetUrl, parent]);

  return (
    <MediaResolverContext.Provider value={value}>
      {children}
    </MediaResolverContext.Provider>
  );
}

export function useMediaResolvers() {
  return useContext(MediaResolverContext);
}
