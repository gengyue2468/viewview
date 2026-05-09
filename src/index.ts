import { Hono, MiddlewareHandler } from "hono";
import { isValidURL } from "./lib/valid";
import { getBrowserDebuggingURL } from "./lib/browser";
import { htmlParser } from "./lib/parser";

const authMiddleware: MiddlewareHandler = async (c, next) => {
  const authorization = c.req.header("Authorization");
  const bearerToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : undefined;
  if (bearerToken !== Bun.env.ACCESS_TOKEN) {
    return c.json({ error: "咦，你是谁啊？" }, 401);
  }
  await next();
};

const app = new Hono();

app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

app.get("read", (c) => {
  return c.json({ error: "Method Not Allowed" }, 405);
});

app.post("/read", authMiddleware, async (c) => {
  const req = await c.req.json();
  const url = req.url;

  if (!url) {
    return c.json({ error: "似乎没看到 URL" }, 400);
  }

  if (!isValidURL(url)) {
    return c.json({ error: "URL 无效欸" }, 400);
  }

  const waitMs = Number(c.req.query("wait") ?? "30000");

  async function withTimeout<T>(
    promise: Promise<T>,
    timeout: number,
    label: string,
  ) {
    if (!Number.isFinite(timeout) || timeout <= 0) return promise;
    let id: Timer | undefined;
    const t = new Promise<never>((_, reject) => {
      id = setTimeout(
        () => reject(new Error(`${label} 经过 ${timeout}ms 后超时了`)),
        timeout,
      );
    });
    try {
      return await Promise.race([promise, t]);
    } finally {
      if (id) clearTimeout(id);
    }
  }

  try {
    let navigatedUrl: string | null = null;
    let navigatedTitle: string | null = null;
    let navigationFailed: Error | null = null;
    let resolveNavigated: (() => void) | null = null;
    let rejectNavigated: ((err: Error) => void) | null = null;

    const navigated = new Promise<void>((resolve, reject) => {
      resolveNavigated = resolve;
      rejectNavigated = reject;
    });

    const view = new Bun.WebView({
      backend: {
        type: "chrome",
        url: await getBrowserDebuggingURL(),
      },
      headless: true,
    });

    view.onNavigated = (nextUrl, nextTitle) => {
      navigatedUrl = nextUrl;
      navigatedTitle = nextTitle;
      resolveNavigated?.();
    };
    view.onNavigationFailed = (err) => {
      navigationFailed = err;
      rejectNavigated?.(err);
    };

    try {
      await view.navigate(url);
      await withTimeout(navigated, Math.min(waitMs, 5000), "onNavigated");

      if (navigationFailed) {
        throw navigationFailed;
      }

      const title = await view.evaluate("document.title");
      let finalUrl = navigatedUrl ?? url;

      const html = await view.evaluate("document.documentElement.outerHTML");
      const text = await view.evaluate("document.documentElement.innerText");

      const rawText =
        (await htmlParser(finalUrl, html as string)) || (text as string);
      const finalText = `---
title: ${title || "无题"}
url: ${finalUrl}
---

${rawText}
        `;

      return c.text(finalText);
    } finally {
      view.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: "抓取页面失败", message }, 500);
  }
});

Bun.serve({
  fetch: app.fetch,
  port: 9233,
});
