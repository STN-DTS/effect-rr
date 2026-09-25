import { reactRouter } from '@react-router/dev/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  environments: {
    ssr: {
      build: {
        rollupOptions: {
          // The SSR bundle exports the React Router server build *and* the
          // Effect runtime factory, so both share one module graph (and one
          // instance of every router context key).
          input: './ssr-bundle.ts',
        },
      },
    },
  },
  plugins: [reactRouter()],
  resolve: {
    tsconfigPaths: true,
  },
});
