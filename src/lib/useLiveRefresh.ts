import { useEffect, useEffectEvent } from "react"

const REFRESH_INTERVAL_MS = 12_000

export function useLiveRefresh(enabled: boolean, refresh: (signal: AbortSignal) => Promise<unknown>) {
  const refreshLatest = useEffectEvent(refresh)

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    let pending = false
    let lastStarted = 0

    async function check() {
      if (document.visibilityState !== "visible" || pending || controller.signal.aborted) return
      if (Date.now() - lastStarted < 1_000) return
      pending = true
      lastStarted = Date.now()
      try {
        await refreshLatest(controller.signal)
      } catch {
        // Keep the last successful view during a background connection failure.
      } finally {
        pending = false
      }
    }

    const timer = window.setInterval(check, REFRESH_INTERVAL_MS)
    document.addEventListener("visibilitychange", check)
    window.addEventListener("focus", check)
    return () => {
      controller.abort()
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", check)
      window.removeEventListener("focus", check)
    }
  }, [enabled])
}
