import type { GoogleDriveFile } from "./types";

function escapeMarkdownLabel(value: string) {
  return value.replace(/([\\\[\]])/gu, "\\$1");
}

function getGoogleDriveFileUrl(fileId: string) {
  const encodedId = encodeURIComponent(fileId).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `https://drive.google.com/open?id=${encodedId}`;
}

export function formatDriveSearchResults(
  query: string,
  files: GoogleDriveFile[],
) {
  if (files.length === 0) {
    return `Google Drive에서 '${query}'와 관련된 파일을 찾지 못했어.`;
  }

  const fileList = files
    .map(
      (file) =>
        `• [${escapeMarkdownLabel(file.name)}](${getGoogleDriveFileUrl(file.id)})`,
    )
    .join("\n");

  return `Google Drive에서 ${files.length}개 찾았어.\n\n${fileList}`;
}
