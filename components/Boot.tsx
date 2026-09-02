"use client";

import { useEffect, useState } from "react";
import { flushQueue, pendingCount } from "@/lib/client";

/** Реєструє service worker і доганяє чергу змін, коли повертається мережа. */
export default function Boot() {
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    const sync = async () => {
      setOffline(!navigator.onLine);
      if (navigator.onLine) await flushQueue();
      setPending(pendingCount());
    };
    void sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    const timer = setInterval(sync, 20000);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
      clearInterval(timer);
    };
  }, []);

  if (!offline && !pending) return null;
  return (
    <div className="offline-bar">
      {offline ? "Немає зв'язку — зміни збережуться локально" : `Синхронізую ${pending} змін…`}
    </div>
  );
}
