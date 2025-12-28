import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  compilerOptions: {
    // Disable runes mode to use traditional store syntax
    runes: false,
  },
};
