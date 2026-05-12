import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { Plugin } from 'vite';

// Copies ffmpeg-core files from node_modules to /static/ffmpeg/ so the browser
// can load them from the same origin (required for SharedArrayBuffer via COOP/COEP).
// /static/ffmpeg/ is in .gitignore — files are regenerated at dev-server start / build.
function copyFfmpegCore(): Plugin {
	const src = resolve('./node_modules/@ffmpeg/core/dist/umd');
	const dest = resolve('./static/ffmpeg');

	function copy() {
		try {
			mkdirSync(dest, { recursive: true });
			copyFileSync(`${src}/ffmpeg-core.js`, `${dest}/ffmpeg-core.js`);
			copyFileSync(`${src}/ffmpeg-core.wasm`, `${dest}/ffmpeg-core.wasm`);
		} catch (e) {
			console.warn('[copy-ffmpeg-core] Could not copy ffmpeg-core files:', e);
		}
	}

	return {
		name: 'copy-ffmpeg-core',
		buildStart: copy,
		configureServer(server) {
			if (!existsSync(`${dest}/ffmpeg-core.wasm`)) copy();
			server.middlewares.use((req, res, next) => {
				if (req.url?.startsWith('/node_modules/@ffmpeg/')) {
					res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
					res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
				}
				next();
			});
		}
	};
}

export default defineConfig({ plugins: [tailwindcss(), sveltekit(), copyFfmpegCore()] });
