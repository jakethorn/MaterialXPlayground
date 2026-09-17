// js/mxsl-engine.js — ShadingLanguageX (.mxsl) WASM compiler loader.
//
// Lazily loads the mxslc WebAssembly bindings (js/mxsl/JsMxslc.js, built
// from the MXSL repo's mxslc++/javascript/ folder — see js/mxsl/README.md
// for how that build is produced and vendored here) and exposes two entry
// points to graph-app.jsx:
//
//   - expandMxsl(), used by ingest() the same way it already uses
//     expandZips() from mtlx-engine.js: given a dropped/opened file map,
//     any .mxsl entries are compiled to MaterialX XML in place and re-keyed
//     with a .mtlx extension, so everything downstream (root-document
//     detection, xi:include resolution, texture binding) treats a compiled
//     .mxsl document exactly like a hand-authored .mtlx one.
//   - decompileMtlxToSlx(), used by the "Export Shader Code…" dialog's
//     ShadingLanguageX target to turn the CURRENT (possibly hand-edited)
//     MaterialX document back into SLX source, via mxslc's decompiler.
//
// Multi-file projects: the mxslc WASM binding exposes compileProjectToMtlx,
// which accepts a root source string plus a plain {relativePath: text}
// object of sibling files for #include / #library resolution (see
// js/mxsl/README.md and the MXSL repo's mxslc++/javascript/README.md).
// expandMxsl() infers which dropped .mxsl file is the compile root by
// scanning every .mxsl file's text for #include/#library directives: a
// file no other file's directives name is a root candidate. Each candidate
// is compiled with every other .mxsl/.mtlx sibling in the drop offered up
// as a virtual file, and every candidate that compiles successfully is
// written back into the map as its own .mtlx entry. When that yields more
// than one .mtlx document, graph-app.jsx's existing "this drop contains
// several .mtlx files — pick one below" flow (already used for plain
// multi-document .mtlx drops) is what lets the user disambiguate — no
// separate UI is needed for .mxsl projects.

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
// file is actually opened (or a ShadingLanguageX export is requested),
// not on every page load. A failed load is NOT cached, so a transient
// network blip doesn't permanently break every subsequent attempt for
// the rest of the session.
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

// Compile one SLX source string to a MaterialX XML string. `files` is an
// optional plain object mapping a relative path — exactly as it would
// appear inside a #include "..." or #library "..." directive in `source`
// — to that sibling file's text; pass null/undefined for a self-contained
// compile with no siblings. `label` is only used to make a thrown error
// identify which file failed.
const compileMxslSource = async (source, files, label) => {
    const mx = await getMxslModule();
    const opts = new mx.CompileOptions();
    try {
        return mx.compileProjectToMtlx(source, files || null, opts);
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

// Decompile a MaterialX XML string to ShadingLanguageX source, via the
// SAME mxslc module compileMxslSource uses (a completely separate WASM
// module from the main MaterialX engine — see js/mtlx-engine.js — so this
// never touches `parsed.mx`). Used by the "Export Shader Code…" dialog's
// ShadingLanguageX target.
const decompileMtlxToSlx = async (xml) => {
    const mx = await getMxslModule();
    try {
        return mx.decompileMtlxToSlx(xml);
    } catch (e) {
        const msg = (e && e.message) || String(e);
        throw new Error('ShadingLanguageX decompile error:\n' + msg);
    }
};

// A #include "..." or #library "..." directive's target, e.g. "colors.mxsl"
// or "utils.mtlx" — LanguageSpecification.md's File Inclusion section.
const DIRECTIVE_RE = /#\s*(?:include|library)\s*"([^"]+)"/g;

// Dropping a whole folder (folder drag-and-drop / the directory file
// picker) reports every entry's path prefixed with the folder's own name
// (File#webkitRelativePath), but a directive inside those files names
// siblings relative to the folder's *contents*, never that outer name. If
// every candidate key shares one leading path segment, strip it so keys
// compare the same way the compiler itself would resolve them; otherwise
// (flat files, or a mixed selection) leave keys exactly as given.
const stripCommonFolderPrefix = (keys) => {
    const parts = keys.map((k) => k.split('/'));
    if (parts.length && parts.every((p) => p.length > 1 && p[0] === parts[0][0])) {
        const prefixLen = parts[0][0].length + 1;
        return (key) => key.slice(prefixLen);
    }
    return (key) => key;
};

// Expand any .mxsl files in the map into their compiled .mtlx equivalent
// (in place), mirroring expandZips(map) in mtlx-engine.js. Called AFTER
// expandZips in ingest(), so a .mxsl shipped inside a .zip is also caught.
//
// `origins`, if given, is a plain object this function populates with
// {compiledMtlxKey: originalMxslSourceText} for every root it successfully
// compiles — graph-app.jsx uses this to know, once a specific .mtlx path
// is actually loaded as the active document, whether it has .mxsl
// provenance and what its as-authored source looked like (the "Original"
// button in the ShadingLanguageX export target). Omit it to just expand,
// same as before this was added.
const expandMxsl = async (map, origins) => {
    const mxslKeys = Object.keys(map).filter((k) => /\.mxsl$/i.test(k));
    if (!mxslKeys.length) return map;

    // Everything a directive could plausibly target: other .mxsl sources
    // (#include) and any .mtlx files dropped alongside them (#library).
    const siblingKeys = Object.keys(map).filter((k) => /\.(mxsl|mtlx)$/i.test(k));
    const effectiveKey = stripCommonFolderPrefix(siblingKeys);

    // Read every candidate's text once, keyed by its effective (prefix-
    // stripped) path — the form a directive would actually reference.
    const textByEffectiveKey = {};
    for (const key of siblingKeys) {
        textByEffectiveKey[effectiveKey(key)] = await map[key].text();
    }

    // A .mxsl file that some other file's #include/#library directive
    // names is not a root — it's pulled in by whichever file does name
    // it. Compare both the full effective path and the bare filename, so
    // a directive written as "colors.mxsl" still matches a file reported
    // as "sub/colors.mxsl".
    const included = new Set();
    for (const key of mxslKeys) {
        let m;
        DIRECTIVE_RE.lastIndex = 0;
        while ((m = DIRECTIVE_RE.exec(textByEffectiveKey[effectiveKey(key)])) !== null) {
            included.add(m[1]);
            included.add(m[1].split('/').pop());
        }
    }
    const isIncluded = (ek) => included.has(ek) || included.has(ek.split('/').pop());

    let rootKeys = mxslKeys.filter((k) => !isIncluded(effectiveKey(k)));
    if (!rootKeys.length) {
        // Nothing looked like a leaf (e.g. a cyclic or otherwise
        // unusual set of directives) — fall back to trying every .mxsl
        // file as its own root rather than refusing the whole drop.
        rootKeys = mxslKeys.slice();
    }

    let lastError = null;
    const compiled = [];
    for (const rootKey of rootKeys) {
        const rootEk = effectiveKey(rootKey);
        const rootSource = textByEffectiveKey[rootEk];
        const files = {};
        for (const ek of Object.keys(textByEffectiveKey)) {
            if (ek !== rootEk) files[ek] = textByEffectiveKey[ek];
        }
        try {
            const xml = await compileMxslSource(rootSource, files, rootKey);
            compiled.push({ rootKey, xml, source: rootSource });
        } catch (e) {
            // Not every root candidate necessarily compiles on its own
            // (e.g. the heuristic above can admit a genuine include as a
            // "root" when it's also never #include'd by anything else in
            // the drop) — skip it and keep the ones that do.
            lastError = e;
        }
    }

    for (const key of mxslKeys) delete map[key];

    if (!compiled.length) {
        throw lastError || new Error('No .mxsl file in this drop compiled successfully.');
    }

    for (const { rootKey, xml, source } of compiled) {
        const mtlxKey = rootKey.replace(/\.mxsl$/i, '.mtlx');
        if (Object.prototype.hasOwnProperty.call(map, mtlxKey)) {
            console.warn('expandMxsl: ' + mtlxKey + ' was already present in this drop — overwriting it with the document compiled from ' + rootKey);
        }
        map[mtlxKey] = new Blob([xml], { type: 'application/xml' });
        if (origins) origins[mtlxKey] = source;
    }
    return map;
};

// Exported for parity with mtlx-engine.js's own Object.assign(window, {...})
// at its tail (real ES modules — e.g. a future VS Code webview path — can't
// see this classic script's top-level bindings otherwise). graph-app.jsx
// itself is a sibling classic <script type="text/babel">, so it reaches
// expandMxsl/decompileMtlxToSlx as bare identifiers, exactly like it
// already does expandZips.
Object.assign(window, { getMxslModule, compileMxslSource, decompileMtlxToSlx, expandMxsl });
