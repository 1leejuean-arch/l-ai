export type LocalAppId =
  | "chrome"
  | "edge"
  | "vscode"
  | "explorer"
  | "notepad"
  | "calculator";

export type LocalFileScope =
  | "Desktop"
  | "Documents"
  | "Downloads"
  | "Pictures"
  | "Videos"
  | "Music"
  | "Project";

export type LocalActionName =
  | "app.open"
  | "app.close"
  | "browser.open"
  | "browser.search"
  | "file.search"
  | "file.open"
  | "file.reveal"
  | "file.rename"
  | "file.move"
  | "file.copy"
  | "file.delete";

export type LocalFileInfo = {
  name: string;
  path: string;
  extension: string;
  size: number;
  modifiedAt: string;
};

export type LocalActionRequest =
  | { action: "app.open"; input: { app: LocalAppId } }
  | { action: "app.close"; input: { app: LocalAppId } }
  | { action: "browser.open" | "browser.search"; input: { url: string } }
  | {
      action: "file.search";
      input: {
        scope: LocalFileScope;
        query: string;
        extension: string | null;
        limit: number;
      };
    }
  | { action: "file.open" | "file.reveal" | "file.delete"; input: { path: string } }
  | { action: "file.rename"; input: { path: string; newName: string } }
  | {
      action: "file.move" | "file.copy";
      input: { path: string; destinationScope: LocalFileScope };
    };

export type LocalAgentHealth = {
  ok: true;
  platform: string;
  version: string;
  capabilities: LocalActionName[];
};

export type LocalAppCloseResult = {
  app: LocalAppId;
  status: "success" | "failed" | "not_running";
  reason?: "window_still_open" | "close_request_failed";
};

export type LocalIntent =
  | { action: "app.open" | "app.close"; app: LocalAppId }
  | { action: "browser.open" | "browser.search"; url: string; label: string }
  | {
      action: "file.search";
      scope: LocalFileScope;
      query: string;
      extension: string | null;
    }
  | {
      action: "file.open" | "file.reveal" | "file.delete";
      selectionIndex: number | null;
    }
  | { action: "file.rename"; newName: string }
  | {
      action: "file.move" | "file.copy";
      destinationScope: LocalFileScope;
    };

export type LocalPendingAction =
  | { action: "app.close"; app: LocalAppId }
  | { action: "file.rename"; file: LocalFileInfo; newName: string }
  | {
      action: "file.move" | "file.copy";
      file: LocalFileInfo;
      destinationScope: LocalFileScope;
    }
  | { action: "file.delete"; file: LocalFileInfo };
