import axios from "axios";

async function getBrowserDebuggingURL(): Promise<string> {
  try {
    const response = await axios.get("http://localhost:9222/json/version");
    return response.data.webSocketDebuggerUrl;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`获取浏览器调试 URL 失败: ${message}`);
    throw new Error("获取浏览器调试 URL 失败");
  }
}

export { getBrowserDebuggingURL };
