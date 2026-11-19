import { useSyncExternalStore } from "react";
import { installSnapshot, promptInstall, subscribeInstall } from "../services/installPrompt";

export default function InstallAppButton() {
  const state = useSyncExternalStore(subscribeInstall, installSnapshot);
  if (state.installed || !state.prompt) return null;
  return <button type="button" onClick={() => void promptInstall().catch((error) => console.error("Install prompt unavailable", error))}
    className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">Install app</button>;
}
