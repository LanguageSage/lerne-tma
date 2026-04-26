export const stripMarkdown = (text) => {
  if (!text) return "";
  return text
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/```/g, "")
    .replace(/\*/g, "")
    .replace(/_/g, "")
    .replace(/`/g, "")
    .replace(/<center>/g, "")
    .replace(/<\/center>/g, "")
    .replace(/<large>/g, "")
    .replace(/<\/large>/g, "")
    .trim();
};
