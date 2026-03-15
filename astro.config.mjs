// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  // 部署到 GitHub Pages 时需要设置
  // 如果仓库名为 <username>.github.io，site 设为 https://<username>.github.io
  // 如果仓库名为其他（如 openlens），还需要设置 base: '/openlens'
  site: 'https://jyao0708.github.io',
  base: '/openlens/',
});
