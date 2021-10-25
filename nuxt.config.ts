import { defineNuxtConfig } from 'nuxt3';

export default defineNuxtConfig({
  ssr: false,
  vite: false,
  buildModules: [
    {
      handler: function () {
        this.nuxt.hook('webpack:config', (configs) => {
          configs.forEach((config) => {
            (config.resolve || (config.resolve = {})).fallback = {
              path: false,
              fs: false,
            };
          });
        });
      },
    },
  ],
  build: {
    // extend(config) {
    //   console.log('>>>> got config');
    //   process.exit();
    //   const node = config.node || (config.node = {});
    //   node.fs = 'empty';
    //   config.module.rules.push({
    //     test: /.wasm/i,
    //     type: 'javascript/auto',
    //   });
    // },
  },
});
