interface NetworkIdleOptions {
  idleTime?: number;
}

class NetworkIdleTracker {
  private activeRequests = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private resolve: (() => void) | null = null;
  private idleTime: number;
  private view: Bun.WebView;
  private handler: EventListener | null = null;

  constructor(view: Bun.WebView, options?: NetworkIdleOptions) {
    this.view = view;
    this.idleTime = options?.idleTime ?? 2000;
  }

  async start(): Promise<void> {
    await this.view.cdp("Network.enable", {});

    this.handler = (event: Event) => {
      const data = (event as MessageEvent).data;
      if (!data || typeof data.method !== "string") return;

      const { method } = data;

      if (method === "Network.requestWillBeSent") {
        this.activeRequests++;
        this.cancelIdleTimer();
      } else if (
        method === "Network.loadingFinished" ||
        method === "Network.loadingFailed"
      ) {
        this.activeRequests = Math.max(0, this.activeRequests - 1);
        if (this.activeRequests === 0) {
          this.startIdleTimer();
        }
      }
    };

    this.view.addEventListener("message", this.handler);
  }

  waitForIdle(): Promise<void> {
    if (this.idleTime <= 0) return Promise.resolve();

    return new Promise<void>((resolve) => {
      this.resolve = resolve;

      if (this.activeRequests === 0) {
        this.startIdleTimer();
      }
    });
  }

  stop(): void {
    this.cancelIdleTimer();
    if (this.handler) {
      this.view.removeEventListener("message", this.handler);
      this.handler = null;
    }
    this.resolve = null;
  }

  private startIdleTimer(): void {
    this.cancelIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.resolve) {
        const resolve = this.resolve;
        this.resolve = null;
        resolve();
      }
    }, this.idleTime);
  }

  private cancelIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}

export { NetworkIdleTracker };
