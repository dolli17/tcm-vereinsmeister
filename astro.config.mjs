// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: process.env.SITE_URL || 'https://vm.tennisclub-muckensturm.de',
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  // Hinter einem TLS-terminierenden Reverse-Proxy (Traefik) sieht der Node-Adapter
  // intern http://, der Browser sendet aber Origin https:// → Astros Origin-Check
  // würde jeden Formular-POST blocken. CSRF-Schutz übernimmt stattdessen das
  // Session-Cookie (SameSite=Lax wird bei Cross-Site-POSTs nicht mitgesendet).
  security: { checkOrigin: false },
  vite: {
    plugins: [tailwindcss()],
    // better-sqlite3 ist ein natives Modul und darf nicht gebundlet werden.
    ssr: { external: ['better-sqlite3'] },
  },
});
