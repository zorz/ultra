/**
 * Ultra Web GUI - Application Entry Point
 */

import { mount } from 'svelte';
import App from './App.svelte';
import { ecpClient } from './lib/ecp/client';
import { loadTheme } from './lib/theme/loader';

async function init(): Promise<void> {
  const statusEl = document.getElementById('app');
  const updateStatus = (msg: string) => {
    console.log(msg);
    if (statusEl) {
      statusEl.innerHTML = `<div class="ultra-loading">${msg}</div>`;
    }
  };

  // Connect to ECP server
  const wsUrl = `ws://${window.location.host}/ws`;

  try {
    updateStatus('Connecting to server...');
    await ecpClient.connect(wsUrl);
    console.log('Connected to ECP server');

    // Load theme from server
    updateStatus('Loading theme...');
    try {
      await loadTheme();
      console.log('Theme loaded');
    } catch (themeError) {
      console.warn('Theme loading failed, using defaults:', themeError);
      // Continue without theme - use CSS defaults
    }

    // Mount the app
    updateStatus('Starting application...');
    const target = document.getElementById('app')!;
    console.log('About to mount app, target:', target);

    // Clear the loading content before mounting
    target.innerHTML = '';

    const app = mount(App, {
      target,
    });
    console.log('App mounted successfully');

    // Clean up on page unload
    window.addEventListener('beforeunload', () => {
      ecpClient.disconnect();
    });
  } catch (error) {
    console.error('Failed to initialize:', error);
    document.getElementById('app')!.innerHTML = `
      <div class="ultra-loading" style="flex-direction: column; gap: 10px;">
        <span>Failed to connect to Ultra server</span>
        <span style="font-size: 12px; opacity: 0.7;">${error instanceof Error ? error.message : 'Unknown error'}</span>
      </div>
    `;
  }
}

// Show any unhandled errors
window.addEventListener('error', (event) => {
  console.error('Unhandled error:', event.error);
  const statusEl = document.getElementById('app');
  if (statusEl) {
    statusEl.innerHTML = `
      <div class="ultra-loading" style="flex-direction: column; gap: 10px;">
        <span>Error: ${event.message}</span>
      </div>
    `;
  }
});

init();
