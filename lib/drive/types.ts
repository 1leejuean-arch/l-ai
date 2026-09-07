export type GoogleDriveFile = {
  id: string;
  name: string;
  webViewLink?: string;
  modifiedTime?: string;
};

export type DriveAction =
  | "search"
  | "recent"
  | "summarize"
  | "ask"
  | "compare";

export type DriveSearchIntent = {
  action: DriveAction;

  // search / summarize / ask
  query: string | null;

  // ask
  question?: string | null;

  // compare
  queries?: string[] | null;
  compareQuestion?: string | null;
};