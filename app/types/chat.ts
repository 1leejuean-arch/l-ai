export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  isError?: boolean;
};

export type ChatApiResponse = {
  reply: string;
};

export type ChatApiError = {
  error: string;
};
