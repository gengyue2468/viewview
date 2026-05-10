export interface UAPlugin {
  name: string;
  match(url: string): boolean;
  getUserAgent(url: string): string;
}

class UAPluginRegistry {
  private plugins: UAPlugin[] = [];

  register(plugin: UAPlugin): void {
    this.plugins.push(plugin);
  }

  resolve(url: string): string | null {
    for (const plugin of this.plugins) {
      if (plugin.match(url)) {
        return plugin.getUserAgent(url);
      }
    }
    return null;
  }

  getAll(): UAPlugin[] {
    return [...this.plugins];
  }
}

export const pluginRegistry = new UAPluginRegistry();