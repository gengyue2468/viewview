import { Hono, MiddlewareHandler } from "hono";
import { isValidURL } from "./lib/valid";
import { getBrowserDebuggingURL } from "./lib/browser";
import { htmlParser } from "./lib/parser";

import { pluginRegistry } from "./plugins";

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

  const waitMs = Number(c.req.query("wait") ?? "120000");

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

    const view = new Bun.WebView({
      backend: {
        type: "chrome",
        url: await getBrowserDebuggingURL(),
      },
      headless: true,
    });

    view.onNavigationFailed = (err) => {
      navigationFailed = err;
    };

    async function navigateAndWait(target: string, timeout: number) {
      navigationFailed = null;
      const p = new Promise<void>((resolve, reject) => {
        view.onNavigated = (nextUrl, nextTitle) => {
          navigatedUrl = nextUrl;
          navigatedTitle = nextTitle;
          resolve();
        };
        view.onNavigationFailed = (err) => {
          navigationFailed = err;
          reject(err);
        };
      });
      await view.navigate(target);
      await withTimeout(p, timeout, "onNavigated");
      if (navigationFailed) throw navigationFailed;
    }

    try {
      await navigateAndWait("about:blank", 5000);

      const matchedUA = pluginRegistry.resolve(url);
      if (matchedUA) {
        await view.cdp("Network.setUserAgentOverride", { userAgent: matchedUA });
      }

      await navigateAndWait(url, waitMs);

      const title = await view.evaluate(`document.title
        || document.querySelector('meta[property="og:title"]')?.content
        || document.querySelector('meta[name="twitter:title"]')?.content
        || document.querySelector('h1')?.textContent?.trim()
        || document.querySelector('h2')?.textContent?.trim()
        || ""`);

      const html = await view.evaluate("document.documentElement.outerHTML");
      const text = await view.evaluate("document.documentElement.innerText");

      const rawText =
        (await htmlParser(url, html as string)) || (text as string);
      const finalText = `---
title: ${title || "无题"}
url: ${url}
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
