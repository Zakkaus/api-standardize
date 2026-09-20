'use strict';

hexo.extend.filter.register('after_generate', function () {
  const routes = new Set(this.route.list());
  const pages = this.locals.get('pages');
  const root = this.config.root || '/';
  for (const page of pages.toArray()) {
    const markdown = String(page._content || '');
    for (const [, href] of markdown.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^)]*)?\)/g)) {
      if (/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(href)) continue;
      const url = new URL(href, `https://docs.invalid${root}${page.path}`);
      if (!url.pathname.endsWith('.html')) continue;
      const target = decodeURIComponent(url.pathname).slice(root.length);
      if (!routes.has(target)) throw new Error(`${page.source}: unresolved documentation link ${href}`);
    }
  }
});
