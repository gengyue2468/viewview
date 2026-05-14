import type { UAPlugin } from "../registry";
import { UA_PRESETS } from "../presets";

const BILIBILI_DOMAINS = [
  "www.bilibili.com",
  "m.bilibili.com",
  "b23.tv",
  "bilibili.com",
];

const bilibiliPlugin: UAPlugin = {
  name: "bilibili",
  match(url: string): boolean {
    try {
      const hostname = new URL(url).hostname;
      return BILIBILI_DOMAINS.some(
        (domain) => hostname === domain || hostname.endsWith("." + domain),
      );
    } catch {
      return false;
    }
  },
  getUserAgent(_url: string): string {
    return UA_PRESETS.Desktop_Chrome;
  },
};

export default bilibiliPlugin;
