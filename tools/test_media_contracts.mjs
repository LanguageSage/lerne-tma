import assert from 'node:assert/strict';

// Test media resolution logic contract
function getResolvedImageUrl(c) {
  if (!c) return null;
  const raw = c.image_url || c.media_url || c.image_path || c.image;
  if (!raw || typeof raw !== 'string') return null;
  if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('data:') || raw.startsWith('blob:') || raw.startsWith('/lid_images/')) {
    return raw;
  }
  if (raw.startsWith('/api/media/')) {
    return raw;
  }
  const cleanPath = raw.replace(/^(images|audio|videos)\//, '');
  return `/api/media/images/${cleanPath}`;
}

// Contract 1: Full image_url passes through
assert.equal(
  getResolvedImageUrl({ image_url: '/api/media/images/upload_123.webp' }),
  '/api/media/images/upload_123.webp'
);

// Contract 2: image_path without prefix gets normalized
assert.equal(
  getResolvedImageUrl({ image_path: 'upload_123.webp' }),
  '/api/media/images/upload_123.webp'
);

// Contract 3: image_path with images/ prefix gets cleaned and normalized
assert.equal(
  getResolvedImageUrl({ image_path: 'images/upload_642478257_367ab1553b6a.webp' }),
  '/api/media/images/upload_642478257_367ab1553b6a.webp'
);

// Contract 4: media_url fallback
assert.equal(
  getResolvedImageUrl({ media_url: 'images/lid_banner.png' }),
  '/api/media/images/lid_banner.png'
);

// Contract 5: lid_images legacy route preserved
assert.equal(
  getResolvedImageUrl({ image_url: '/lid_images/photo.png' }),
  '/lid_images/photo.png'
);

// Contract 6: Empty or null card handled safely
assert.equal(getResolvedImageUrl(null), null);
assert.equal(getResolvedImageUrl({}), null);
assert.equal(getResolvedImageUrl({ image_path: '' }), null);

console.log('✅ All media resolution contract tests passed successfully!');
