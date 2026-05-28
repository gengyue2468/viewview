export async function waitForNetworkIdle(
  view: Bun.WebView,
  idleTime = 500,
  maxWait = 10000,
): Promise<void> {
  let active = 0;
  let hasSeenRequest = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let done!: () => void;

  const settle = () => {
    if (timer) clearTimeout(timer);
    fallback && clearTimeout(fallback);
    done();
  };

  const onStart = () => {
    hasSeenRequest = true;
    active++;
    if (timer) { clearTimeout(timer); timer = null; }
  };

  const onEnd = () => {
    active = Math.max(0, active - 1);
    if (hasSeenRequest && active === 0 && !timer) {
      timer = setTimeout(settle, idleTime);
    }
  };

  const idle = new Promise<void>((r) => { done = r; });

  view.addEventListener("Network.requestWillBeSent", onStart);
  view.addEventListener("Network.loadingFinished", onEnd);
  view.addEventListener("Network.loadingFailed", onEnd);

  const fallback = Number.isFinite(maxWait) && maxWait > 0
    ? setTimeout(settle, maxWait)
    : null;

  await idle;

  view.removeEventListener("Network.requestWillBeSent", onStart);
  view.removeEventListener("Network.loadingFinished", onEnd);
  view.removeEventListener("Network.loadingFailed", onEnd);
}
