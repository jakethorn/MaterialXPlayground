// tests/embed/graph-slx-node.spec.mjs: ShadingLanguageX code nodes in the
// Graph Editor (js/graph/slx-node.jsx). A code node is a root nodegraph
// whose interior is compiled from the SLX source in its slxsource
// attribute; edits made inside the graph decompile back into that source.
// vendor/mxslc/ is gitignored (fetched by `npm run vendor`), so these skip
// cleanly when it isn't on disk.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, WAIT_TIMEOUT } from './lib/test-base.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HAS_MXSLC = fs.existsSync(path.join(REPO_ROOT, 'vendor', 'mxslc', 'JsMxslc.wasm'));

const ROOT_ONLY = [
  '<?xml version="1.0"?>',
  '<materialx version="1.39">',
  '  <constant name="c1" type="float">',
  '    <input name="value" type="float" value="0.25" />',
  '  </constant>',
  '</materialx>',
].join('\n');

// A code node as saved by the editor: in1 wired from c1 at the root, in2
// changed on the node from its code default, the result feeding ss1. The
// comment's quotes, < and > must survive the attribute round trip, and the
// code view's decompile (an @slxsource string couldn't hold the quotes).
const CODE = [
  '[[nodegraph]]',
  'float brighten(float in1 = 0.0, float in2 = 0.0, float gain = 2.0)',
  '{',
  '    // keep the "gain" > 0 and < 10',
  '    return (in1 + in2) * clamp(gain, 0.0, 10.0);',
  '}',
].join('\n');
const attr = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '&#10;');
const WITH_NODE = [
  '<?xml version="1.0"?>',
  '<materialx version="1.39">',
  '  <constant name="c1" type="float" xpos="0" ypos="0">',
  '    <input name="value" type="float" value="0.25" />',
  '  </constant>',
  '  <nodegraph name="NG_brighten" slxsource="' + attr(CODE) + '" xpos="1.5" ypos="0">',
  '    <input name="in1" type="float" nodename="c1" />',
  '    <input name="in2" type="float" value="0.5" />',
  '    <input name="gain" type="float" value="2" />',
  '    <add name="var__0" type="float">',
  '      <input name="in1" type="float" interfacename="in1" />',
  '      <input name="in2" type="float" interfacename="in2" />',
  '    </add>',
  '    <clamp name="var__1" type="float">',
  '      <input name="in" type="float" interfacename="gain" />',
  '      <input name="low" type="float" value="0" />',
  '      <input name="high" type="float" value="10" />',
  '    </clamp>',
  '    <multiply name="var__2" type="float">',
  '      <input name="in1" type="float" nodename="var__0" />',
  '      <input name="in2" type="float" nodename="var__1" />',
  '    </multiply>',
  '    <output name="out" type="float" nodename="var__2" />',
  '  </nodegraph>',
  '  <standard_surface name="ss1" type="surfaceshader" xpos="3.5" ypos="0">',
  '    <input name="base" type="float" nodegraph="NG_brighten" output="out" />',
  '  </standard_surface>',
  '</materialx>',
].join('\n');

const openGraphWith = async (page, embedURL, xml) => {
  await page.goto(embedURL + '/index.html#!graph');
  await page.waitForSelector('.gtb-bar', { timeout: WAIT_TIMEOUT });
  await page.waitForFunction(() => typeof window.parseMtlxDocument === 'function', null, { timeout: WAIT_TIMEOUT });
  await page.evaluate((x) => {
    window.dispatchEvent(new CustomEvent('mtlx-load-document', { detail: { xml: x, name: 'slxnode' } }));
  }, xml);
};

const graphXml = (page) => page.evaluate(async () => {
  try { return await window.__mtlxGetGraphXml(); } catch (e) { return ''; }
});

const decodeAttr = (s) => s.replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
// The opening <nodegraph> tag of `name`, and its decoded slxsource.
const graphTag = (xml, name) => (new RegExp('<nodegraph name="' + name + '"[^>]*>').exec(xml) || [''])[0];
const slxSource = (xml, name) => {
  const m = /slxsource="([^"]*)"/.exec(graphTag(xml, name));
  return m ? decodeAttr(m[1]) : null;
};
const graphBody = (xml, name) => (new RegExp('<nodegraph name="' + name + '"[\\s\\S]*?</nodegraph>').exec(xml) || [''])[0];

// Hands keyboard focus back to the page, where the editor's own shortcuts
// (Tab, Ctrl+Z) listen.
const focusStage = (page) => page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });

const card = (page, id) => page.locator('.react-flow__node[data-id="' + id + '"]');
const editorOf = (page, id) => card(page, id).locator('.mtlx-slx-editor textarea');

test('adds a ShadingLanguageX node from the Tab palette and compiles edited code into it', async ({ page, embedURL }) => {
  test.skip(!HAS_MXSLC, 'vendor/mxslc not on disk (gitignored, run npm run vendor first)');
  await openGraphWith(page, embedURL, ROOT_ONLY);
  await card(page, 'n:c1').waitFor({ state: 'visible', timeout: WAIT_TIMEOUT });

  await focusStage(page);
  await page.keyboard.press('Tab');
  const search = page.getByPlaceholder(/Add a node/);
  await search.fill('shadinglanguagex');
  await page.keyboard.press('Enter');

  // The new node lands with the starter code, its caret in the editor.
  const editor = editorOf(page, 'g:NG_slx_node');
  await editor.waitFor({ state: 'visible', timeout: WAIT_TIMEOUT });
  await expect(editor).toBeFocused();
  await expect.poll(async () => slxSource(await graphXml(page), 'NG_slx_node'), { timeout: 10000 })
    .toMatch(/^\[\[nodegraph\]\]\ncolor3 slx_node\(/);
  expect(graphBody(await graphXml(page), 'NG_slx_node')).toMatch(/<checkerboard name="p"/);

  // Typed code (real keystrokes: the editor auto-indents after "{" and
  // steps back for "}"), compiled with Ctrl+Enter. Renaming the function
  // renames the graph after it.
  await editor.fill('');
  await page.keyboard.type('[[nodegraph]]\nfloat scale(float in1 = 0.0, float gain = 3.0)\n{\nreturn in1 * gain;\n}');
  await expect(editor).toHaveValue('[[nodegraph]]\nfloat scale(float in1 = 0.0, float gain = 3.0)\n{\n    return in1 * gain;\n}');
  await page.keyboard.press('Control+Enter');

  await expect(card(page, 'g:NG_scale')).toBeVisible({ timeout: 10000 });
  await expect(card(page, 'g:NG_slx_node')).toHaveCount(0);
  const xml = await graphXml(page);
  expect(xml).not.toMatch(/NG_slx_node/);
  const body = graphBody(xml, 'NG_scale');
  expect(body).toMatch(/<input name="gain" type="float" value="3" \/>/);
  expect(body).toMatch(/<multiply name="var__0"/);
  await expect(card(page, 'g:NG_scale').locator('span', { hasText: /^gain$/ })).toBeVisible();
});

test('recompiling keeps the node\'s wires and changed values, and shows compile errors', async ({ page, embedURL }) => {
  test.skip(!HAS_MXSLC, 'vendor/mxslc not on disk (gitignored, run npm run vendor first)');
  await openGraphWith(page, embedURL, WITH_NODE);
  const editor = editorOf(page, 'g:NG_brighten');
  await editor.waitFor({ state: 'visible', timeout: WAIT_TIMEOUT });
  // Read back exactly as authored: line breaks and the escaped "<".
  await expect(editor).toHaveValue(CODE);

  // A compile error stays on the card, squiggled on its line, and leaves
  // the graph alone.
  await editor.fill(CODE.replace('(in1 + in2)', '(in1 + )'));
  await card(page, 'g:NG_brighten').getByRole('button', { name: 'Compile' }).click();
  await expect(card(page, 'g:NG_brighten').locator('.mtlx-slx-error')).toContainText(/Invalid expression/, { timeout: 10000 });
  await expect(card(page, 'g:NG_brighten').locator('.slx-marks .slx-error')).toHaveText('return (in1 + ) * clamp(gain, 0.0, 10.0);');
  expect(graphBody(await graphXml(page), 'NG_brighten')).toMatch(/<clamp name="var__1"/);

  // New code: in1's wire and in2's 0.5 (changed on the node from its 0.0
  // default) survive, gain takes the code's new default.
  await editor.fill(CODE.replace('float gain = 2.0', 'float gain = 4.0').replace('(in1 + in2) * clamp(gain, 0.0, 10.0)', 'in1 * gain + in2'));
  await page.keyboard.press('Control+Enter');
  await expect.poll(async () => graphBody(await graphXml(page), 'NG_brighten'), { timeout: 10000 })
    .toMatch(/<input name="gain" type="float" value="4" \/>/);
  let body = graphBody(await graphXml(page), 'NG_brighten');
  expect(body).toMatch(/<input name="in1" type="float" nodename="c1" \/>/);
  expect(body).toMatch(/<input name="in2" type="float" value="0.5" \/>/);
  expect(await graphXml(page)).toMatch(/<input name="base" type="float" nodegraph="NG_brighten" output="out" \/>/);
  await expect(card(page, 'g:NG_brighten').locator('.mtlx-slx-error')).toHaveCount(0);

  // Two outputs: the root wire reading the old "out" is cut.
  await editor.fill('[[nodegraph]]\n{float a, float b} brighten(float in1 = 0.0, float in2 = 0.0)\n{\n    return {in1, in2};\n}');
  await page.keyboard.press('Control+Enter');
  await expect.poll(async () => graphBody(await graphXml(page), 'NG_brighten'), { timeout: 10000 })
    .toMatch(/<output name="out__b"/);
  body = graphBody(await graphXml(page), 'NG_brighten');
  expect(body).not.toMatch(/name="gain"/);
  expect(await graphXml(page)).not.toMatch(/nodegraph="NG_brighten"/);
});

test('editing inside a code node\'s graph rewrites its code, and undo restores it', async ({ page, embedURL }) => {
  test.skip(!HAS_MXSLC, 'vendor/mxslc not on disk (gitignored, run npm run vendor first)');
  await openGraphWith(page, embedURL, WITH_NODE);
  const node = card(page, 'g:NG_brighten');
  await node.waitFor({ state: 'visible', timeout: WAIT_TIMEOUT });

  // Double-click the card (outside its code) to open the graph.
  await node.locator('span', { hasText: /^in2$/ }).dblclick();
  const inner = card(page, 'n:var__0');
  await inner.waitFor({ state: 'visible', timeout: WAIT_TIMEOUT });
  await expect(page.getByText(/editing this graph rewrites the node's code/)).toBeVisible();

  // Rename a node inside: the code is decompiled from the graph.
  await inner.locator('.mtlx-node-name').dblclick();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('total');
  await page.keyboard.press('Enter');
  await expect.poll(async () => slxSource(await graphXml(page), 'NG_brighten'), { timeout: 10000 })
    .toMatch(/float total = in1 \+ in2;/);
  const code = slxSource(await graphXml(page), 'NG_brighten');
  // The code keeps its own defaults, not the node's wire (which would
  // decompile to an uncompilable "= null") or its changed in2 value.
  expect(code).toMatch(/float brighten\(float in1 = 0\.0, float in2 = 0\.0, float gain = 2\.0\)/);
  expect(code).not.toMatch(/null/);
  const recompiles = await page.evaluate(async (src) => {
    try { const { mx } = await getMxEnv(); await compileSlxGraph(mx, src, 'check'); return true; } catch (e) { return String(e.message || e); }
  }, code);
  expect(recompiles).toBe(true);
  // ...while the node's own wire and value stay put.
  const body = graphBody(await graphXml(page), 'NG_brighten');
  expect(body).toMatch(/<input name="in1" type="float" nodename="c1" \/>/);
  expect(body).toMatch(/<input name="in2" type="float" value="0.5" \/>/);

  // Back at the root, the card shows the rewritten code.
  await page.getByRole('button', { name: 'Back to the code' }).click();
  await expect(editorOf(page, 'g:NG_brighten')).toHaveValue(code, { timeout: WAIT_TIMEOUT });

  // One undo step covers the edit and its rewritten code.
  await focusStage(page);
  await page.keyboard.press('Control+Z');
  await expect.poll(async () => slxSource(await graphXml(page), 'NG_brighten'), { timeout: 10000 }).toBe(CODE);
  await expect(editorOf(page, 'g:NG_brighten')).toHaveValue(CODE, { timeout: WAIT_TIMEOUT });
});

test('the code view leaves a code node\'s source out of its code, and its Compile keeps the node a code node', async ({ page, embedURL }) => {
  test.skip(!HAS_MXSLC, 'vendor/mxslc not on disk (gitignored, run npm run vendor first)');
  await page.addInitScript(() => { try { localStorage.setItem('mtlxGraphCodeViewOpen', 'true'); } catch (e) { /* no storage */ } });
  await openGraphWith(page, embedURL, WITH_NODE);
  await card(page, 'g:NG_brighten').waitFor({ state: 'visible', timeout: WAIT_TIMEOUT });

  // The code view's own editor (the node card's sits on the canvas).
  const panel = page.locator('aside', { has: page.locator('textarea[aria-label="ShadingLanguageX code"]') });
  const panelCode = panel.locator('textarea');
  await expect(panelCode).toHaveValue(/float brighten\(/, { timeout: WAIT_TIMEOUT });
  const decompiled = await panelCode.inputValue();
  expect(decompiled).not.toMatch(/slxsource/);

  // Compiling it unchanged keeps the node's own code, quotes and comment included.
  await panel.getByRole('button', { name: /^Compile/ }).click();
  await expect(panel.getByText('Compiled into the node graph.')).toBeVisible({ timeout: 10000 });
  expect(slxSource(await graphXml(page), 'NG_brighten')).toBe(CODE);
  await expect(editorOf(page, 'g:NG_brighten')).toHaveValue(CODE);

  // A function changed in the code view: the node's code is rebuilt from
  // its new graph, standalone (no references to other nodes).
  expect(decompiled).toMatch(/clamp\(gain, 0\.0, 10\.0\)/);
  await panelCode.fill(decompiled.replace('clamp(gain, 0.0, 10.0)', 'clamp(gain, 0.0, 5.0)'));
  await panel.getByRole('button', { name: /^Compile/ }).click();
  await expect.poll(async () => slxSource(await graphXml(page), 'NG_brighten'), { timeout: 10000 })
    .toMatch(/clamp\(gain, 0\.0, 5\.0\)/);
  const code = slxSource(await graphXml(page), 'NG_brighten');
  expect(code).toMatch(/^\[\[nodegraph\]\]\nfloat brighten\(float in1 = 0\.0, float in2 = 0\.0, float gain = 2\.0\)/);
  expect(code).not.toMatch(/c1|null/);
  const recompiles = await page.evaluate(async (src) => {
    try { const { mx } = await getMxEnv(); await compileSlxGraph(mx, src, 'check'); return true; } catch (e) { return String(e.message || e); }
  }, code);
  expect(recompiles).toBe(true);
});
