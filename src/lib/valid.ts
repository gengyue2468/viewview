import { parse } from "tldts";

const FILTERED_HOSTS = [
  "multimedia.nt.qq.com.cn",
  "qqdocument.qq.com",
  "docs.qq.com",
  "m.q.qq.com",
];

const IMAGE_CDN_HOSTS = [
  "pic.ugcimg.cn",
  "p.qpic.cn",
  "qpic.cn",
  "imgcache.qq.com",
  "shp.qpic.cn",
  "gchat.qpic.cn",
  "c2cpicdw.qpic.cn",
  "mmbiz.qpic.cn",
  "thirdqq.qlogo.cn",
  "q.qlogo.cn",
  "wx.qlogo.cn",
];

const SHORT_LINK_HOSTS = [
  "ourl.co",
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "ow.ly",
  "is.gd",
  "buff.ly",
  "short.link",
  "cutt.ly",
  "rebrand.ly",
  "shorturl.at",
  "tiny.cc",
  "bit.do",
  "b23.tv",
];

const FILE_EXTENSION_PATTERN = /\.(png|jpg|jpeg|webp|gif|bmp|svg|ico|mp4|mp3|wav|zip|rar|7z|exe|apk|pdf|docx|xlsx|pptx|txt|csv|json|xml)$/i;
const API_PATTERNS = [
  /\/api\//i,
  /\/v\d+\//,
  /\/download\//i,
  /\/upload\//i,
  /\/(jpg|png|webp|gif)\d+$/i,
];

function normalizeUrl(rawUrl: string) {
  return rawUrl.replace(/&amp;/g, "&").trim();
}

export function isValidURL(rawUrl: string) {
  if (!rawUrl) {
    return false;
  }

  const url = normalizeUrl(rawUrl);

  if (!/^https?:\/\//i.test(url)) {
    return false;
  }

  return !isFilteredUrl(url) && hasValidHostname(url);
}

function hasValidHostname(url: string) {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();

    const result = parse(hostname);
    return result.domain !== null && result.isIcann === true;
  } catch {
    return false;
  }
}

function isFilteredUrl(url: string) {
  if (url.includes("CQ:") || url.includes("download?appid=")) {
    return true;
  }

  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();
    const pathname = parsedUrl.pathname.toLowerCase();

    if (FILTERED_HOSTS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
      return true;
    }

    if (IMAGE_CDN_HOSTS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
      return true;
    }

    if (hostname === "mp.weixin.qq.com" && pathname.startsWith("/s/")) {
      const match = pathname.match(/\/s\/([a-z0-9_-]+)/i);
      if (!match || match[1] === undefined || match[1].length < 15) {
        return true;
      }
    }

    if (FILE_EXTENSION_PATTERN.test(pathname)) {
      return true;
    }

    if (!SHORT_LINK_HOSTS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
      if (API_PATTERNS.some((pattern) => pattern.test(url))) {
        return true;
      }
    }
  } catch {
    return true;
  }

  return false;
}