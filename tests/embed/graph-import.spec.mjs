import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect } from './lib/test-base.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures');

async function gotoGraph(page, embedURL) {
  await page.goto(embedURL + '/index.html#!graph');
  await page.waitForFunction(() => typeof window.__mtlxGetGraphXml === 'function');
}

async function openGraphFiles(page, files) {
  await page.locator('input[type="file"][accept=".mtlx,.mxsl,.zip"]').setInputFiles(files);
}

async function currentGraphXml(page) {
  return page.evaluate(async () => window.__mtlxGetGraphXml());
}

test('graph view still loads a standard MaterialX file', async ({ page, embedURL }) => {
  await gotoGraph(page, embedURL);
  await openGraphFiles(page, path.join(FIXTURES, 'multi-material.mtlx'));
  await expect(page.getByRole('button', { name: 'multi-material.mtlx' })).toBeVisible();
  const xml = await currentGraphXml(page);
  expect(xml).toContain('<materialx');
  expect(xml).toContain('MatA');
  await expect(page.getByText('imported from .mxsl · saves as .mtlx')).toHaveCount(0);
});

test('graph view compiles a ShadingLanguageX file into MaterialX', async ({ page, embedURL }) => {
  await gotoGraph(page, embedURL);
  await openGraphFiles(page, path.join(FIXTURES, 'graph-redbrick.mxsl'));
  await expect(page.getByRole('button', { name: 'graph-redbrick.mxsl' })).toBeVisible();
  await expect(page.getByText('imported from .mxsl · saves as .mtlx')).toBeVisible();
  const xml = await currentGraphXml(page);
  expect(xml).toContain('<materialx');
  expect(xml).toContain('standard_surface');
  expect(xml).not.toContain('.mxsl');
});

test('graph view resolves companion .mxsl includes before compiling', async ({ page, embedURL }) => {
  await gotoGraph(page, embedURL);
  await openGraphFiles(page, [
    path.join(FIXTURES, 'graph-brick-wall.mxsl'),
    path.join(FIXTURES, 'graph-brick-pattern.mxsl'),
    path.join(FIXTURES, 'graph-glsl-macros.mxsl'),
  ]);
  await expect(page.getByRole('button', { name: 'graph-brick-wall.mxsl' })).toBeVisible();
  const xml = await currentGraphXml(page);
  expect(xml).toContain('<materialx');
  expect(xml).toContain('surfacematerial');
});

test('graph view surfaces ShadingLanguageX compile failures', async ({ page, embedURL }) => {
  await gotoGraph(page, embedURL);
  await openGraphFiles(page, path.join(FIXTURES, 'graph-invalid.mxsl'));
  await expect(page.getByText(/ShadingLanguageX compilation failed:/)).toBeVisible();
});
