import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Rerunly – AI Browser Agent',
    short_name: 'Rerunly',
    description:
      'Save and rerun browser tasks with OpenRouter or LM Studio models, visual verification, and encrypted local secrets.',
    minimum_chrome_version: '116',
    permissions: ['sidePanel', 'debugger', 'storage', 'tabs', 'tabGroups'],
    optional_host_permissions: [
      'https://openrouter.ai/*',
      'http://localhost/*',
      'http://127.0.0.1/*',
      'http://[::1]/*'
    ],
    action: {
      default_title: 'Open Rerunly',
      default_icon: {
        '16': 'icon/16.png',
        '32': 'icon/32.png',
        '48': 'icon/48.png',
        '128': 'icon/128.png'
      }
    },
    icons: {
      '16': 'icon/16.png',
      '32': 'icon/32.png',
      '48': 'icon/48.png',
      '128': 'icon/128.png'
    },
    side_panel: {
      default_path: 'sidepanel.html'
    }
  }
});
