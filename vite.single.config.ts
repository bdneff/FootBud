import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// One-file build used for zero-install demo hosting (artifact page).
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: { outDir: 'dist-single' },
});
