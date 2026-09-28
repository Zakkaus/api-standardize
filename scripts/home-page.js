'use strict';

// The site has no posts, so hexo-generator-index emits no index.html and the
// header's home link would point nowhere. Render the theme's home page instead.
hexo.extend.generator.register('index', () => ({
  path: 'index.html',
  layout: ['index'],
  data: { __index: true },
}));
