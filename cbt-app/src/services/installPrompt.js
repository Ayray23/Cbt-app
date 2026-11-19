let snapshot = { prompt: null, installed: window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true };
const listeners = new Set();
function update(next) { snapshot = next; listeners.forEach((listener) => listener()); }

// Capture the browser event before an authenticated header mounts.
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  update({ ...snapshot, prompt: event });
});
window.addEventListener("appinstalled", () => update({ prompt: null, installed: true }));

export const installSnapshot = () => snapshot;
export function subscribeInstall(listener) { listeners.add(listener); return () => listeners.delete(listener); }
export async function promptInstall() {
  const prompt = snapshot.prompt;
  if (!prompt) return;
  await prompt.prompt();
  const choice = await prompt.userChoice;
  update({ prompt: null, installed: snapshot.installed || choice.outcome === "accepted" });
}
