'use strict';

const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { parse } = require('yaml');
const { checkContract } = require(path.join(hexo.base_dir, 'tools/check-contract.mjs'));
const { renderExample } = require(path.join(hexo.base_dir, 'tools/contract.mjs'));

let prepared;
function contract() {
  prepared ??= readFile(path.join(hexo.source_dir, 'openapi.yaml'), 'utf8').then((source) => {
    const result = checkContract(parse(source));
    if (result.errors.length) throw new Error(result.errors.join('\n'));
    return { spec: result.context.spec, examples: result.examples, renderExample };
  });
  return prepared;
}

async function render(key, format) {
  const { examples, renderExample } = await contract();
  const example = examples.get(key);
  if (!example) throw new Error(`Unknown canonical API example: ${key}`);
  const code = renderExample(example, format);
  const language = example.kind === 'event' ? 'text' : format === 'http' ? 'http' : 'json';
  if (hexo.extend.highlight.query(hexo.config.syntax_highlighter)) {
    return hexo.extend.highlight.exec(hexo.config.syntax_highlighter, {
      context: hexo,
      args: [code, { lang: language, lines_length: code.split('\n').length }],
    });
  }
  return hexo.render.renderSync({
    text: `\`\`\`${language}\n${code}${code.endsWith('\n') ? '' : '\n'}\`\`\`\n`,
    engine: 'markdown',
  });
}

hexo.extend.tag.register('api_example', async (args) => {
  const [operation, target, name, format = 'json'] = args;
  if (args.length < 3 || args.length > 4 || !['json', 'http'].includes(format)) {
    throw new Error('api_example expects operation, request/status, example name, and optional http');
  }
  return render(`${operation}:${target}:${name}`, format);
}, { async: true });

hexo.extend.tag.register('api_request', async (args) => {
  if (args.length < 1 || args.length > 2) throw new Error('api_request expects operation and optional body example name');
  return render(`${args[0]}:request${args[1] ? `:${args[1]}` : ''}`, 'http');
}, { async: true });

hexo.extend.tag.register('api_event', async (args) => {
  if (args.length !== 1) throw new Error('api_event expects a named component example');
  return render(`event:${args[0]}`, 'sse');
}, { async: true });

hexo.extend.tag.register('api_endpoints', async (args) => {
  if (args.length) throw new Error('api_endpoints takes no arguments');
  const { spec } = await contract();
  const rows = ['| Method | Path | Description |', '|---|---|---|'];
  for (const [route, item] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      if (!operation.operationId) continue;
      const summary = String(operation.summary || '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
      rows.push(`| ${method.toUpperCase()} | \`${route}\` | ${summary} |`);
    }
  }
  return hexo.render.renderSync({ text: rows.join('\n'), engine: 'markdown' });
}, { async: true });
