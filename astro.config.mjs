// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://vm.tennisclub-muckensturm.de',
  vite: {
    plugins: [tailwindcss()],
  },
});
