export type GoogleDriveFile = {
  id: string;
  name: string;
  webViewLink?: string;
  modifiedTime?: string;
};

export type DriveAction = "search" | "recent";

export type DriveSearchIntent = {
  action: DriveAction;
  query: string | null;
};