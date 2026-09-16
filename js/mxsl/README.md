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

## Known limitation (v1): no `#include` support

The current `JsMxslc.cpp` bindings expose a pure string-in/string-out API
(`compileSlxToMtlx(source, opts)`) with no way to add search directories or
preload sibling files into the compiler's virtual filesystem. A `.mxsl` file
opened through MaterialX Playground that uses `#include "other.mxsl"` will
fail to compile — the include target can't be found. Only self-contained
`.mxsl` files are supported for now. Lifting this needs either new bindings
in `JsMxslc.cpp` (e.g. exposing `CompileOptions::add_search_directory`, or a
compile entry point that accepts a virtual file map) or relying on
Emscripten's `Module.FS` plus the compiler's existing search-directory
fallback of the current working directory — see the discussion in
`js/mxsl-engine.js`'s header comment before picking either approach.
