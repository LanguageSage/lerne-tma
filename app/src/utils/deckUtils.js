/**
 * Shared deck and folder utility functions.
 * Replaces duplicated metadata parsing and folder tree sorting across components.
 */

export const parseDeckMetadata = (deck) => {
  if (!deck) return { resources: [] };
  try {
    const raw = deck.metadata || deck.deck_metadata;
    if (!raw) return { resources: [] };
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return { resources: [] };
  }
};

export const getDescendantFolderIds = (folderId, foldersList = []) => {
  const descendantIds = [];
  const traverse = (parentId) => {
    const children = foldersList.filter(f => f.parent_id === parentId);
    for (const child of children) {
      descendantIds.push(child.id);
      traverse(child.id);
    }
  };
  traverse(folderId);
  return descendantIds;
};

export const getSortedFolderTree = (foldersList = [], excludeId = null, excludeDescendantIds = []) => {
  const result = [];
  const traverse = (parentId, depth) => {
    const children = foldersList.filter(f => f.parent_id === parentId);
    for (const child of children) {
      if (child.id === excludeId || excludeDescendantIds.includes(child.id)) {
        continue;
      }
      result.push({
        ...child,
        depth: depth,
        displayName: `${'\u00A0'.repeat(depth * 3)}${child.name}`
      });
      traverse(child.id, depth + 1);
    }
  };
  traverse(null, 0);
  return result;
};

export const getResourceSrc = (item, mediaType = 'images') => {
  if (!item) return '';
  if (item.url) return item.url;
  if (item.path) {
    const cleanPath = item.path.replace(/^(images|audio|videos)\//, '');
    return `/api/media/${mediaType}/${cleanPath}`;
  }
  return '';
};
