import { useEffect, useState } from "react";
import StatusBanner from "./StatusBanner";

export default function NetworkStatusBanner() {
  const [isOnline, setIsOnline] = useState(window.navigator.onLine);

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
    }

    function handleOffline() {
      setIsOnline(false);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (isOnline) {
    return null;
  }

  return (
    <StatusBanner
      tone="warning"
      message="You are offline. Cached pages and saved exam progress remain available, but new syncs will wait until the internet returns."
    />
  );
}
