// js/mxsl-engine.js — ShadingLanguageX (.mxsl) WASM compiler loader.
//
// Lazily loads the mxslc WebAssembly bindings (js/mxsl/JsMxslc.js, built
// from the MXSL repo's mxslc++/javascript/ folder — see js/mxsl/README.md
// for how that build is produced and vendored here) and exposes a single
// entry point, expandMxsl(), used by graph-app.jsx's ingest() the same way
// it already uses expandZips() from mtlx-engine.js: given a dropped/opened
// file map, any .mxsl entries are compiled to MaterialX XML in place and
// re-keyed with a .mtlx extension, so everything downstream (root-document
// detection, xi:include resolution, texture binding) treats a compiled
// .mxsl document exactly like a hand-authored .mtlx one.
//
// v1 scope: each .mxsl file is compiled standalone. The mxslc WASM binding
// (JsMxslc.cpp) exposes no way to add search directories or preload sibling
// files into the compiler's virtual filesystem, so a #include inside a
// dropped .mxsl file will fail to resolve — see js/mxsl/README.md.

let mxslModulePromise = null;

// Mirrors mtlx-engine.js's loadMxFactoryViaScript(): JsMxslc.js is built
// with -s EXPORT_ES6=1, so import() is the normal path below, but this
// keeps the same classic-<script> fallback shape as the MaterialX loader
// in case a future mxslc build ever regresses to a UMD/no-export shape.
const loadMxslFactoryViaScript = () => new Promise((resolve, reject) => {
    const url = './js/mxsl/JsMxslc.js';
    const prevGlobal = window.Mxslc;
    const script = document.createElement('script');
    script.src = url;
    script.onload = () => {
        const captured = window.Mxslc; // synchronous: capture before restoring
        window.Mxslc = prevGlobal;
        script.remove();
        if (typeof captured !== 'function') {
            reject(new Error('mxslc engine script loaded but window.Mxslc is not a factory function (got ' + typeof captured + '), url: ' + url));
            return;
        }
        resolve(captured);
    };
    script.onerror = () => {
        window.Mxslc = prevGlobal;
        script.remove();
        reject(new Error('Failed to load mxslc engine script: ' + url));
    };
    document.head.appendChild(script);
});

// Cached, lazy: the WASM module is only fetched the first time a .mxsl
// file is actually opened, not on every page load. A failed load is NOT
// cached, so a transient network blip doesn't permanently break every
// subsequent .mxsl open for the rest of the session.
const getMxslModule = () => {
    if (!mxslModulePromise) {
        // Absolute URL for the same reason as mtlx-engine.js's getMxEnv:
        // WebKit resolves import() in a classic script against the script
        // URL, not the document base, which breaks under a <base> tag.
        const factoryUrl = new URL('./js/mxsl/JsMxslc.js', document.baseURI).href;
        mxslModulePromise = import(factoryUrl)
            .then((mod) => (typeof mod.default === 'function' ? mod.default : loadMxslFactoryViaScript()))
            .then((factory) => factory({
                // .wasm and .data live next to the .js.
                locateFile: (path) => './js/mxsl/' + path,
            }))
            .catch((e) => {
                mxslModulePromise = null;
                throw e;
            });
    }
    return mxslModulePromise;
};

// Compile one SLX source string to a MaterialX XML string. `label` is only
// used to make a thrown error identify which file failed.
const compileMxslSource = async (source, label) => {
    const mx = await getMxslModule();
    const opts = new mx.CompileOptions();
    try {
        return mx.compileSlxToMtlx(source, opts);
    } catch (e) {
        // JsMxslc.cpp rethrows C++ exceptions as real Error objects
        // (CompileError / Error), so e.message is already a readable
        // compiler diagnostic — just attach which file it came from.
        const msg = (e && e.message) || String(e);
        throw new Error('ShadingLanguageX compile error in ' + label + ':\n' + msg);
    } finally {
        opts.delete(); // embind object: not garbage-collected automatically
    }
};

// Expand any .mxsl files in the map into their compiled .mtlx equivalent
// (in place), mirroring expandZips(map) in mtlx-engine.js. Called AFTER
// expandZips in ingest(), so a .mxsl shipped inside a .zip is also caught.
const expandMxsl = async (map) => {
    const keys = Object.keys(map).filter((k) => /\.mxsl$/i.test(k));
    for (const key of keys) {
        const file = map[key];
        const source = await file.text();
        const xml = await compileMxslSource(source, key);
        delete map[key];
        const mtlxKey = key.replace(/\.mxsl$/i, '.mtlx');
        if (Object.prototype.hasOwnProperty.call(map, mtlxKey)) {
            console.warn('expandMxsl: ' + mtlxKey + ' was already present in this drop — overwriting it with the document compiled from ' + key);
        }
        map[mtlxKey] = new Blob([xml], { type: 'application/xml' });
    }
    return map;
};

// Exported for parity with mtlx-engine.js's own Object.assign(window, {...})
// at its tail (real ES modules — e.g. a future VS Code webview path — can't
// see this classic script's top-level bindings otherwise). graph-app.jsx
// itself is a sibling classic <script type="text/babel">, so it reaches
// expandMxsl as a bare identifier, exactly like it already does expandZips.
Object.assign(window, { getMxslModule, compileMxslSource, expandMxsl });
