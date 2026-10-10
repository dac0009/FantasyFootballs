import { useState } from "react";

/**
 * One-tap share to iMessage (or anything else) using the phone's native share
 * sheet. Falls back to copying the text where the share API is unavailable,
 * which is most desktop browsers.
 */
export function ShareButton({ title, text, url }: { title: string; text: string; url: string }) {
  const [state, setState] = useState<"idle" | "copied" | "shared">("idle");

  async function share() {
    const payload = { title, text, url };
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share(payload);
        setState("shared");
      } catch {
        // user dismissed the sheet; nothing to do
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      window.prompt("Copy this:", `${text}\n${url}`);
    }
  }

  return (
    <button type="button" className="pill" onClick={share} aria-live="polite">
      {state === "copied" ? "Copied" : state === "shared" ? "Shared" : "Share this week"}
    </button>
  );
}
