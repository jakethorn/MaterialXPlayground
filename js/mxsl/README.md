# js/mxsl/

Holds the mxslc (ShadingLanguageX compiler) WebAssembly module: the compiled
output of the MXSL project's `mxslc++/javascript/` bindings (`JsMxslc.cpp`). This directory is committed
manually, the same way `js/materialx/<version>/` is (see
[docs/BUILDING.md](../../docs/BUILDING.md)) — it predates, and is not
managed by, `scripts/vendor.mjs`, and it is excluded from the `buildid`
source fingerprint (`scripts/lib/build-id.mjs`) for the same reason: it's
vendored binary output, not hand-written source.

## Expected contents

```
js/mxsl/JsMxslc.js     — ES6 module glue (EXPORT_ES6=1, MODULARIZE=1)
js/mxsl/JsMxslc.wasm   — the compiled WebAssembly binary
js/mxsl/JsMxslc.data   — preloaded libraries/ folder (mxsl stdlib + node defs)
js/mxsl/LICENSE.txt    — MXSL's license (Apache-2.0), copied alongside the
                          build, same convention as js/materialx/LICENSE.txt
```

`js/mxsl-engine.js` loads `JsMxslc.js` lazily (only once a `.mxsl` file is
actually opened) and expects `.wasm`/`.data` to sit right next to it, via
`locateFile: (path) => './js/mxsl/' + path`.

## Producing the build

From the MXSL repo:

```sh
javascript/build_javascript.sh [emsdk_location] [materialx_source]
```

See that repo's `mxslc++/javascript/README.md` for details (emsdk setup,
required MaterialX source tree, etc). The build writes:

```
javascript/build/mxslc/javascript/bin/JsMxslc.js
javascript/build/mxslc/javascript/bin/JsMxslc.wasm
javascript/build/mxslc/javascript/bin/JsMxslc.data
```

Copy those three files here (plus the repo's `LICENSE` as `LICENSE.txt`),
then run `npm run build && npm run check` in MaterialXPlayground to confirm
the build id stays consistent.

## Multi-file projects (`#include` / `#library`)

`JsMxslc.cpp` also exposes `compileProjectToMtlx(rootSource, files, opts)`,
where `files` is a plain `{relativePath: text}` object of sibling `.mxsl`/
`.mtlx` files made available for `#include`/`#library` resolution — see that
repo's `mxslc++/javascript/README.md` for the binding itself.

`js/mxsl-engine.js`'s `expandMxsl()` uses this to support opening a whole
`.mxsl` project (e.g. via folder drag-and-drop, or multi-selecting files in
the Open dialog), not just a single self-contained file: it infers which
dropped `.mxsl` file is the compile root by scanning every `.mxsl` file's
text for `#include`/`#library` directives — a file nothing else's directives
name is a root — and compiles each root candidate with every other `.mxsl`/
`.mtlx` sibling in the drop offered up as a virtual file. When that produces
more than one `.mtlx` document (an ambiguous drop with no single inferable
root), MaterialX Playground's existing "this drop contains several `.mtlx`
files — pick one below" flow is what lets the user disambiguate, the same as
it already does for a plain multi-document `.mtlx` drop.
