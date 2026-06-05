// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: process.env.SITE_URL || 'https://vm.tennisclub-muckensturm.de',
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  vite: {
    plugins: [tailwindcss()],
    // better-sqlite3 ist ein natives Modul und darf nicht gebundlet werden.
    ssr: { external: ['better-sqlite3'] },
  },
});
