import type { GoogleDriveFile } from "./types";

function escapeMarkdownLabel(value: string) {
  return value.replace(/([\\[\]])/g, "\\$1");
}

function getGoogleDriveFileUrl(file: GoogleDriveFile) {
  if (file.webViewLink?.trim()) {
    return file.webViewLink.trim();
  }

  const encodedId = encodeURIComponent(file.id);

  return `https://drive.google.com/open?id=${encodedId}`;
}

function formatFileLink(file: GoogleDriveFile) {
  return `• [${escapeMarkdownLabel(file.name)}](${getGoogleDriveFileUrl(file)})`;
}

export function formatDriveSearchResults(
  query: string,
  files: GoogleDriveFile[],
) {
  if (files.length === 0) {
    return `Google Drive에서 '${query}'와 관련된 파일을 찾지 못했어.`;
  }

  const fileList = files.map(formatFileLink).join("\n");

  return `Google Drive에서 '${query}' 관련 파일 ${files.length}개 찾았어.\n\n${fileList}`;
}

export function formatRecentDriveFiles(files: GoogleDriveFile[]) {
  if (files.length === 0) {
    return "Google Drive에서 최근 수정한 파일을 찾지 못했어.";
  }

  const fileList = files
    .map((file) => {
      const link = formatFileLink(file);

      if (!file.modifiedTime) {
        return link;
      }

      const modified = new Date(file.modifiedTime).toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });

      return `${link}\n  └ 수정: ${modified}`;
    })
    .join("\n");

  return `Google Drive에서 최근 수정한 파일 ${files.length}개야.\n\n${fileList}`;
}