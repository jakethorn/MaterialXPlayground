// js/graph/code-view.jsx: left-docked ShadingLanguageX code view: the
// current document decompiled to SLX, editable, with Decompile (graph ->
// code) and Compile (code -> graph) along the bottom. graph-app.jsx owns
// the code text and both operations (see its "code view" state); this
// file is just the panel (SlxCodeView) and its text surface
// (SlxCodeEditor). Self-exports via Object.assign(window, {}); no
// top-level import/export.

        // Resize range and localStorage key, same shape as graph-app.jsx's
        // two sidebars. Being the third docked panel, it's also the one
        // that gives way: never wider than leaves the canvas
        // CODE_VIEW_MIN_CANVAS, whatever the other panels take.
        const CODE_VIEW_MIN_WIDTH = 280;
        const CODE_VIEW_MAX_WIDTH = 960;
        const CODE_VIEW_DEFAULT_WIDTH = 440;
        const CODE_VIEW_MIN_CANVAS = 240;
        const CODE_VIEW_WIDTH_STORAGE_KEY = 'mtlxGraphCodeViewWidth';
        // `shared`: the px this panel and the canvas split between them
        // (0 = not measured yet).
        const clampCodeViewWidth = (w, shared) => {
            let max = CODE_VIEW_MAX_WIDTH;
            if (shared) max = Math.min(max, Math.round(shared - CODE_VIEW_MIN_CANVAS));
            if (max < CODE_VIEW_MIN_WIDTH) max = CODE_VIEW_MIN_WIDTH;
            const n = isFinite(w) ? w : CODE_VIEW_DEFAULT_WIDTH;
            return Math.min(max, Math.max(CODE_VIEW_MIN_WIDTH, n));
        };

        // Text metrics shared by every layer of the editor: the textarea,
        // the line-number gutter and the backdrop under the textarea
        // (current-line band, and later highlighted code). They must agree
        // exactly or lines drift apart.
        const CODE_LINE_HEIGHT = 18; // px
        const CODE_PAD_Y = 8; // px, top padding of every layer
        const CODE_TEXT_CLASS = 'font-mono text-[12px] leading-[18px]';
        // The decompiler indents with tabs.
        const CODE_TAB_SIZE = 4;
        // VS Code-style current-line band and line number.
        const CODE_CURRENT_LINE_CLASS = 'bg-white/[0.04] border-y border-white/[0.07]';
        const CODE_CURRENT_NUMBER_CLASS = 'text-gray-300';

        // mxslc diagnostics read "line N: <message>" (1-based).
        const slxErrorLine = (message) => {
            const m = /\bline (\d+)\b/.exec(message || '');
            return m ? parseInt(m[1], 10) : null;
        };

        // Character offset of the start of 1-based `line` in `text`,
        // clamped to the last line.
        const lineStartOffset = (text, line) => {
            let offset = 0;
            for (let i = 1; i < line; i++) {
                const next = text.indexOf('\n', offset);
                if (next === -1) break;
                offset = next + 1;
            }
            return offset;
        };

        // The text surface. A plain <textarea> for now: syntax highlighting
        // and completion belong HERE (a highlighted layer under a
        // transparent textarea, or a real editor component) so that neither
        // SlxCodeView nor graph-app.jsx has to change. Keep this contract:
        //   value, onChange(text)  controlled text
        //   onSubmit()             Ctrl/Cmd+Enter
        //   readOnly, placeholder
        //   apiRef                 filled with { focus(), revealLine(n) }
        function SlxCodeEditor({ value, onChange, onSubmit, readOnly, placeholder, apiRef }) {
            const taRef = React.useRef(null);
            const gutterRef = React.useRef(null);
            const backdropRef = React.useRef(null);

            const lineCount = React.useMemo(() => {
                let n = 1;
                for (let i = value.indexOf('\n'); i !== -1; i = value.indexOf('\n', i + 1)) n++;
                return n;
            }, [value]);

            // Where the caret is: its 0-based line, and whether the
            // selection is empty (the current-line band hides while a range
            // is selected, as in VS Code; the line number stays lit).
            const [caret, setCaret] = React.useState({ line: 0, collapsed: true });
            // Last known selection, restored when the text is replaced from
            // outside (Decompile), which would otherwise throw the caret to
            // the end of the file.
            const selectionRef = React.useRef({ start: 0, end: 0 });
            // The text this editor last reported through onChange: any other
            // incoming `value` was replaced from outside.
            const emittedRef = React.useRef(value);
            const updateCaret = () => {
                const ta = taRef.current;
                if (!ta) return;
                selectionRef.current = { start: ta.selectionStart, end: ta.selectionEnd };
                const pos = ta.selectionDirection === 'backward' ? ta.selectionStart : ta.selectionEnd;
                let line = 0;
                for (let i = ta.value.indexOf('\n'); i !== -1 && i < pos; i = ta.value.indexOf('\n', i + 1)) line++;
                const collapsed = ta.selectionStart === ta.selectionEnd;
                setCaret((c) => (c.line === line && c.collapsed === collapsed ? c : { line, collapsed }));
            };
            // Native selectionchange rather than React's onSelect, which
            // skips some caret moves (e.g. setSelectionRange). Newer engines
            // fire it on the textarea itself, older ones only on document.
            // Only while focused: the caret can't move otherwise, and Chrome
            // can collapse an unfocused textarea's selection to 0 some time
            // after its text is replaced (Decompile clicked with the mouse),
            // which would drag the band to line 1.
            React.useEffect(() => {
                const ta = taRef.current;
                if (!ta) return;
                const onSelection = () => { if (document.activeElement === ta) updateCaret(); };
                ta.addEventListener('selectionchange', onSelection);
                document.addEventListener('selectionchange', onSelection);
                return () => {
                    ta.removeEventListener('selectionchange', onSelection);
                    document.removeEventListener('selectionchange', onSelection);
                };
            }, []);

            const activeLine = Math.min(caret.line, lineCount - 1);
            const gutterNumbers = React.useMemo(
                () => Array.from({ length: lineCount }, (_, i) => String(i + 1)),
                [lineCount]);
            const gutterBefore = React.useMemo(
                () => gutterNumbers.slice(0, activeLine).map((n) => n + '\n').join(''),
                [gutterNumbers, activeLine]);
            const gutterAfter = React.useMemo(
                () => gutterNumbers.slice(activeLine + 1).map((n) => '\n' + n).join(''),
                [gutterNumbers, activeLine]);

            if (apiRef) {
                apiRef.current = {
                    focus: () => { if (taRef.current) taRef.current.focus(); },
                    // Select the whole line and scroll it to mid-view.
                    revealLine: (line) => {
                        const ta = taRef.current;
                        if (!ta) return;
                        const start = lineStartOffset(ta.value, line);
                        let end = ta.value.indexOf('\n', start);
                        if (end === -1) end = ta.value.length;
                        ta.focus();
                        ta.setSelectionRange(start, end);
                        ta.scrollTop = Math.max(0, (line - 1) * CODE_LINE_HEIGHT - ta.clientHeight / 2);
                        updateCaret();
                    },
                };
            }

            // The gutter and the backdrop follow the textarea's scroll: the
            // gutter by scrollTop (it only scrolls vertically), the backdrop
            // by transform (its band spans the full width regardless of
            // horizontal scroll).
            const syncScroll = () => {
                const ta = taRef.current;
                if (!ta) return;
                if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
                if (backdropRef.current) backdropRef.current.style.transform = 'translateY(' + (-ta.scrollTop) + 'px)';
            };
            React.useLayoutEffect(() => {
                const ta = taRef.current;
                if (ta && value !== emittedRef.current) {
                    emittedRef.current = value;
                    const sel = selectionRef.current;
                    ta.setSelectionRange(Math.min(sel.start, value.length), Math.min(sel.end, value.length));
                }
                updateCaret();
                // A value swap can also move scrollTop without a scroll
                // event reaching the other layers.
                syncScroll();
            }, [value]);

            const emitChange = (text) => {
                emittedRef.current = text;
                onChange(text);
            };

            // execCommand keeps the browser's own undo stack intact (a
            // direct .value write would wipe it) and still fires the input
            // event React's onChange listens for.
            const insertText = (text) => {
                const ta = taRef.current;
                if (!ta) return;
                if (!document.execCommand('insertText', false, text)) {
                    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
                    emitChange(ta.value);
                }
            };

            const onKeyDown = (e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    if (onSubmit) onSubmit();
                    return;
                }
                if (e.key === 'Escape') {
                    // Tab indents in here, so Esc is the keyboard way out.
                    e.currentTarget.blur();
                    return;
                }
                if (readOnly) return;
                if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
                    e.preventDefault();
                    insertText('\t');
                } else if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
                    // Carry the current line's indentation onto the new one.
                    const ta = e.currentTarget;
                    const lineStart = ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
                    const indent = /^[ \t]*/.exec(ta.value.slice(lineStart, ta.selectionStart))[0];
                    e.preventDefault();
                    insertText('\n' + indent);
                }
            };

            return (
                <div className="flex flex-1 min-w-0 min-h-0 bg-gray-900/60">
                    {/* Line numbers: scrolled in lockstep with the textarea
                        (overflow hidden, never scrolled by the user). The
                        extra bottom padding covers the textarea's
                        horizontal scrollbar, so both can reach the same
                        scrollTop at the very end of the file. */}
                    <pre
                        ref={gutterRef}
                        aria-hidden="true"
                        className={CODE_TEXT_CLASS + ' flex-none m-0 overflow-hidden select-none text-right text-gray-500 pl-2 pr-2 border-r border-gray-800'}
                        style={{ paddingTop: CODE_PAD_Y, paddingBottom: CODE_PAD_Y + 24, minWidth: (String(lineCount).length + 2) + 'ch' }}
                    >{gutterBefore}<span className={CODE_CURRENT_NUMBER_CLASS}>{gutterNumbers[activeLine]}</span>{gutterAfter}</pre>
                    <div className="relative flex-1 min-w-0 flex overflow-hidden">
                        {/* Backdrop: painted under the transparent textarea
                            and moved with its scroll (syncScroll). Holds the
                            current-line band; highlighted code would go here
                            too, laid out with the same metrics. */}
                        <div aria-hidden="true" className="absolute inset-0 overflow-hidden pointer-events-none">
                            <div ref={backdropRef} className="relative">
                                {caret.collapsed && (
                                    <div
                                        className={CODE_CURRENT_LINE_CLASS + ' absolute left-0 right-0'}
                                        style={{ top: CODE_PAD_Y + activeLine * CODE_LINE_HEIGHT, height: CODE_LINE_HEIGHT }}
                                    />
                                )}
                            </div>
                        </div>
                        {/* `relative` so it paints above the (positioned)
                            backdrop. */}
                        <textarea
                            ref={taRef}
                            value={value}
                            onChange={(e) => emitChange(e.target.value)}
                            onKeyDown={onKeyDown}
                            onScroll={syncScroll}
                            readOnly={readOnly}
                            placeholder={placeholder}
                            aria-label="ShadingLanguageX code"
                            wrap="off"
                            spellCheck={false}
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="off"
                            className={CODE_TEXT_CLASS + ' relative flex-1 min-w-0 m-0 px-2 resize-none overflow-auto custom-scrollbar bg-transparent text-gray-200 placeholder-gray-600 whitespace-pre focus:outline-none'}
                            style={{ paddingTop: CODE_PAD_Y, paddingBottom: CODE_PAD_Y, tabSize: CODE_TAB_SIZE }}
                        />
                    </div>
                </div>
            );
        }

        // The docked panel: header, editor, status line and the two
        // actions. `code` is null until the first decompile lands.
        // `busy` is 'compile' | 'decompile' | null; `message` is
        // { kind: 'ok' | 'error', text } | null. `canvasRef` is the graph
        // canvas beside the panel, measured so the panel never crowds it out.
        function SlxCodeView({
            code, modified, busy, message,
            onCodeChange, onCompile, onDecompile, onCollapse, canvasRef,
        }) {
            const editorApiRef = React.useRef(null);
            const loading = code == null;
            const errorLine = message && message.kind === 'error' ? slxErrorLine(message.text) : null;

            // Width: the user's preferred width (seeded from localStorage,
            // set by dragging the handle on the panel's right edge, one
            // setState per animation frame like graph-app.jsx's sidebars),
            // clamped to what the canvas can spare right now. Opening
            // another panel squeezes this one; closing it gives the
            // preferred width back.
            const [preferredWidth, setPreferredWidth] = React.useState(() => {
                let stored = NaN;
                try {
                    stored = parseFloat(window.localStorage.getItem(CODE_VIEW_WIDTH_STORAGE_KEY));
                } catch (e) { /* private mode / storage disabled */ }
                return clampCodeViewWidth(stored);
            });
            const [shared, setShared] = React.useState(0);
            const width = clampCodeViewWidth(preferredWidth, shared);
            const widthRef = React.useRef(width);
            widthRef.current = width;
            // This panel plus the canvas: constant however the two split it,
            // so re-measuring after this panel resizes can't feed back.
            const measureShared = () => {
                const canvas = canvasRef && canvasRef.current;
                return canvas ? widthRef.current + canvas.getBoundingClientRect().width : 0;
            };
            const dragRef = React.useRef(null); // { startX, startWidth, lastWidth, shared } while dragging
            const [dragging, setDragging] = React.useState(false);
            const onHandleMouseDown = (e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                dragRef.current = { startX: e.clientX, startWidth: widthRef.current, lastWidth: widthRef.current, shared: measureShared() };
                setDragging(true);
            };
            React.useEffect(() => {
                if (!dragging) return;
                let rafId = null;
                const applyPending = () => {
                    rafId = null;
                    if (dragRef.current) setPreferredWidth(dragRef.current.lastWidth);
                };
                const onMove = (e) => {
                    const drag = dragRef.current;
                    if (!drag) return;
                    drag.lastWidth = clampCodeViewWidth(drag.startWidth + (e.clientX - drag.startX), drag.shared);
                    if (rafId == null) rafId = requestAnimationFrame(applyPending);
                };
                const onUp = () => {
                    if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
                    const drag = dragRef.current;
                    if (drag) {
                        setPreferredWidth(drag.lastWidth);
                        try { window.localStorage.setItem(CODE_VIEW_WIDTH_STORAGE_KEY, String(Math.round(drag.lastWidth))); } catch (e) { /* private mode / storage disabled */ }
                    }
                    dragRef.current = null;
                    setDragging(false);
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
                return () => {
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);
                    if (rafId != null) cancelAnimationFrame(rafId);
                };
            }, [dragging]);
            // Track the shared space as the window or the other panels
            // change the canvas's width.
            React.useEffect(() => {
                const canvas = canvasRef && canvasRef.current;
                if (!canvas) return;
                const measure = () => {
                    const s = measureShared();
                    if (s) setShared(Math.round(s));
                };
                measure();
                const ro = new ResizeObserver(measure);
                ro.observe(canvas);
                return () => ro.disconnect();
            }, []);

            return (
                <React.Fragment>
                    <aside
                        style={{ width }}
                        className="flex-none flex flex-col bg-gray-800/95 border-r border-gray-600 overflow-hidden font-mono">
                        <div className="flex items-center gap-2 px-3 py-2 min-h-[45px] border-b border-gray-700 bg-gray-900/70">
                            <MtlxIcon name="code" className="w-3.5 h-3.5 text-gray-500" />
                            <span className="text-[13px] font-bold text-gray-100 truncate flex-1">ShadingLanguageX</span>
                            {modified && (
                                <span className="flex-none text-[10px] text-amber-300" title="The code has edits that haven't been compiled into the node graph yet">
                                    modified
                                </span>
                            )}
                            <button
                                type="button"
                                title="Collapse the code view"
                                className="flex-none w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-gray-200 hover:bg-gray-700/80 transition-colors"
                                onClick={onCollapse}
                            >
                                <MtlxIcon name="chevrons-left" className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="relative flex-1 min-h-0 flex">
                            <SlxCodeEditor
                                value={loading ? '' : code}
                                onChange={onCodeChange}
                                onSubmit={() => { if (!busy && !loading) onCompile(); }}
                                readOnly={loading}
                                placeholder={loading ? '' : 'Write your ShadingLanguageX code then click Compile to build the node graph.'}
                                apiRef={editorApiRef}
                            />
                            {loading && (
                                <div className="absolute inset-0 flex items-center justify-center text-[11px] text-gray-500 animate-pulse pointer-events-none">
                                    {'Decompiling…'}
                                </div>
                            )}
                        </div>
                        <div className="flex-none flex flex-col gap-2 p-2 border-t border-gray-700 bg-gray-900/70">
                            {message && message.kind === 'error' && (
                                <div className="max-h-40 overflow-y-auto custom-scrollbar px-2 py-1.5 rounded border border-red-800/60 bg-red-950/60 text-red-300 text-[11px] whitespace-pre-wrap break-words">
                                    {message.text}
                                    {errorLine != null && (
                                        <button
                                            type="button"
                                            onClick={() => editorApiRef.current && editorApiRef.current.revealLine(errorLine)}
                                            className="block mt-1 underline decoration-dotted underline-offset-2 hover:text-red-200"
                                        >
                                            Go to line {errorLine}
                                        </button>
                                    )}
                                </div>
                            )}
                            {message && message.kind === 'ok' && (
                                <div className="flex items-center gap-1.5 px-0.5 text-[11px] text-green-300">
                                    <MtlxIcon name="check" className="w-3.5 h-3.5 flex-none" />
                                    <span className="truncate">{message.text}</span>
                                </div>
                            )}
                            <div className="flex items-center gap-2 font-sans">
                                <button
                                    type="button"
                                    onClick={onDecompile}
                                    disabled={!!busy}
                                    title="Replace the code with the current node graph, decompiled to ShadingLanguageX"
                                    className={BTN_SECONDARY + ' flex-1 gap-1.5'}
                                >
                                    <MtlxIcon name="arrow-left" className="w-3.5 h-3.5" />
                                    <span>{busy === 'decompile' ? 'Decompiling…' : 'Decompile'}</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={onCompile}
                                    disabled={!!busy || loading}
                                    title="Compile the code and regenerate the node graph from it (Ctrl+Enter)"
                                    className={BTN_PRIMARY + ' flex-1 gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none'}
                                >
                                    <span>{busy === 'compile' ? 'Compiling…' : 'Compile'}</span>
                                    <MtlxIcon name="arrow-right" className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    </aside>
                    <div
                        onMouseDown={onHandleMouseDown}
                        title="Drag to resize"
                        className={'flex-none w-1.5 cursor-col-resize transition-colors '
                            + (dragging ? 'bg-blue-500/70' : 'bg-transparent hover:bg-blue-500/50')}
                    />
                </React.Fragment>
            );
        }

Object.assign(window, { SlxCodeView, SlxCodeEditor });
