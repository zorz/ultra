/**
 * Ultra Web GUI - Application Entry Point
 */

import { mount } from 'svelte';
import App from './App.svelte';
import { ecpClient } from './lib/ecp/client';
import { loadTheme } from './lib/theme/loader';

async function init(): Promise<void> {
  // Connect to ECP server
  const wsUrl = `ws://${window.location.host}/ws`;

  try {
    await ecpClient.connect(wsUrl);
    console.log('Connected to ECP server');

    // Load theme from server
    await loadTheme();

    // Mount the app
    const app = mount(App, {
      target: document.getElementById('app')!,
    });

    // Clean up on page unload
    window.addEventListener('beforeunload', () => {
      ecpClient.disconnect();
    });
  } catch (error) {
    console.error('Failed to connect to ECP server:', error);
    document.getElementById('app')!.innerHTML = `
      <div class="ultra-loading" style="flex-direction: column; gap: 10px;">
        <span>Failed to connect to Ultra server</span>
        <span style="font-size: 12px; opacity: 0.7;">Make sure the server is running</span>
      </div>
    `;
  }
}

init();
