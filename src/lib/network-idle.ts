export async function waitForNetworkIdle(
  view: Bun.WebView,
  idleTime = 2000,
): Promise<void> {
  let active = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let done!: () => void;

  const onStart = () => {
    active++;
    if (timer) { clearTimeout(timer); timer = null; }
  };

  const onEnd = () => {
    active = Math.max(0, active - 1);
    if (active === 0 && !timer) {
      timer = setTimeout(done, idleTime);
    }
  };

  const idle = new Promise<void>((r) => { done = r; });

  view.addEventListener("Network.requestWillBeSent", onStart);
  view.addEventListener("Network.loadingFinished", onEnd);
  view.addEventListener("Network.loadingFailed", onEnd);

  if (active === 0) {
    timer = setTimeout(done, idleTime);
  }

  await idle;

  view.removeEventListener("Network.requestWillBeSent", onStart);
  view.removeEventListener("Network.loadingFinished", onEnd);
  view.removeEventListener("Network.loadingFailed", onEnd);
}
