const TOAST_EVENT = "cbt:toast";

export function notify(message, tone = "info") {
  if (typeof window === "undefined" || !message) return;
  const detail = {
    message: String(message),
    tone: ["success", "info", "warning", "error"].includes(tone) ? tone : "info",
  };
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail }));
}

export const toast = {
  error: (message) => notify(message, "error"),
  success: (message) => notify(message, "success"),
  warning: (message) => notify(message, "warning"),
  info: (message) => notify(message, "info"),
};
export { TOAST_EVENT };
