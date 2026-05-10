import type { UAPlugin } from "../registry";
import { UA_PRESETS } from "../presets";

const WECHAT_DOMAINS = [
  "mp.weixin.qq.com",
  "channels.weixin.qq.com",
  "weixin.qq.com",
  "open.weixin.qq.com",
];

const wechatPlugin: UAPlugin = {
  name: "wechat",
  match(url: string): boolean {
    try {
      const hostname = new URL(url).hostname;
      return WECHAT_DOMAINS.some((domain) => hostname === domain || hostname.endsWith("." + domain));
    } catch {
      return false;
    }
  },
  getUserAgent(_url: string): string {
    return UA_PRESETS.iPhone_WebView;
  },
};

export default wechatPlugin;