interface NetworkIdleOptions {
  idleTime?: number;
}

class NetworkIdleTracker {
  private activeRequests = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private resolve: (() => void) | null = null;
  private idleTime: number;
  private view: Bun.WebView;
  private onRequestStart: EventListener | null = null;
  private onRequestEnd: EventListener | null = null;

  constructor(view: Bun.WebView, options?: NetworkIdleOptions) {
    this.view = view;
    this.idleTime = options?.idleTime ?? 2000;
  }

  async start(): Promise<void> {
    await this.view.cdp("Network.enable", {});

    this.onRequestStart = (_event: Event) => {
      this.activeRequests++;
      this.cancelIdleTimer();
    };

    this.onRequestEnd = (_event: Event) => {
      this.activeRequests = Math.max(0, this.activeRequests - 1);
      if (this.activeRequests === 0) {
        this.startIdleTimer();
      }
    };

    this.view.addEventListener("Network.requestWillBeSent", this.onRequestStart);
    this.view.addEventListener("Network.loadingFinished", this.onRequestEnd);
    this.view.addEventListener("Network.loadingFailed", this.onRequestEnd);
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
    if (this.onRequestStart) {
      this.view.removeEventListener("Network.requestWillBeSent", this.onRequestStart);
      this.onRequestStart = null;
    }
    if (this.onRequestEnd) {
      this.view.removeEventListener("Network.loadingFinished", this.onRequestEnd);
      this.view.removeEventListener("Network.loadingFailed", this.onRequestEnd);
      this.onRequestEnd = null;
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
