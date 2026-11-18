// Compila la extensión de navegador (Chrome, Edge, Brave…) en dist-extension/.
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import pkg from './package.json' with { type: 'json' }

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const icons = { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' }

const manifest = {
  manifest_version: 3,
  name: 'Llavero',
  version: pkg.version,
  description: 'Rellena tus contraseñas del Llavero en cualquier web. Todo cifrado en tu dispositivo.',
  action: { default_popup: 'popup.html', default_title: 'Llavero', default_icon: icons },
  icons,
  // activeTab: solo puede tocar la pestaña en la que pulsas el icono, y solo en ese momento.
  permissions: ['activeTab', 'scripting', 'storage'],
  commands: { _execute_action: { suggested_key: { default: 'Alt+Shift+L' }, description: 'Abrir Llavero' } },
}

const emitManifest: Plugin = {
  name: 'llavero-manifest',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'manifest.json', source: JSON.stringify(manifest, null, 2) })
  },
}

export default defineConfig({
  root: here('./extension'),
  envDir: here('.'),
  publicDir: here('./extension/public'),
  base: './',
  plugins: [react(), emitManifest],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // Variante de Firebase Auth preparada para extensiones (sin scripts remotos).
  resolve: { alias: [{ find: /^firebase\/auth$/, replacement: 'firebase/auth/web-extension' }] },
  build: {
    outDir: here('./dist-extension'),
    emptyOutDir: true,
    modulePreload: { polyfill: false },
    rollupOptions: { input: here('./extension/popup.html') },
  },
})
