import { pluginRegistry } from "./registry";
import { wechatPlugin } from "./built-in";

pluginRegistry.register(wechatPlugin);

export { pluginRegistry } from "./registry";
export type { UAPlugin } from "./registry";
export { UA_PRESETS } from "./presets";