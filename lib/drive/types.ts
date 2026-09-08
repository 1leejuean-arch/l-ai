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
  | "compare"
  | "combine";

export type DriveSearchIntent = {
  action: DriveAction;

  query: string | null;

  // ask
  question?: string | null;

  // compare / combine
  queries?: string[] | null;

  // compare
  compareQuestion?: string | null;

  // combine
  combineQuestion?: string | null;
};