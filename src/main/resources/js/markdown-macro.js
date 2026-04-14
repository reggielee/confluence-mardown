/**
 * markdown-macro.js
 *
 * Client-side rendering logic for the Markdown Chart Macro.
 *
 * The server renders Markdown to HTML via commonmark-java.  Diagram code blocks
 * (mermaid / graphviz) are emitted as placeholder elements with the source code
 * in a hidden pre element.  This script finds those placeholders,
 * renders the diagrams into SVG, and swaps the visible content.
 *
 * A MutationObserver watches for dynamically-inserted macro containers so that
 * the Confluence editor preview also triggers rendering.  Same-origin child
 * iframes (e.g. the blank.html preview frame) are also scanned for macro
 * content, and cross-frame postMessage communication ensures the parent is
 * notified when new content appears inside an iframe.
 *
 * A legacy client-side path is kept for backward-compatibility with pages that
 * were cached before the server-side rendering change.
 */
(function () {
    'use strict';

    /* ------------------------------------------------------------------ */
    /*  Legacy constants (client-side rendering path)                       */
    /* ------------------------------------------------------------------ */

    var DIAGRAM_PLACEHOLDER_PREFIX = 'DIAGRAMPLACEHOLDER';
    var DIAGRAM_PLACEHOLDER_REGEX = /DIAGRAMPLACEHOLDER(\d+)END/g;

    /* ------------------------------------------------------------------ */
    /*  Cross-frame timing constants                                        */
    /* ------------------------------------------------------------------ */

    /**
     * Delay (ms) after an iframe loads before re-scanning for macro content.
     * Gives Confluence time to inject the macro HTML into the iframe body.
     */
    var IFRAME_CONTENT_LOAD_DELAY = 100;

    /**
     * Debounce interval (ms) for MutationObserver callbacks.
     * Prevents rapid re-initialisation during editor transitions that may
     * add/remove many DOM nodes in quick succession.
     */
    var MUTATION_DEBOUNCE_DELAY = 200;

    /**
     * Delay (ms) before handling a cross-frame render-request message.
     * Allows the sending iframe's DOM to settle before the parent scans it.
     */
    var CROSS_FRAME_MESSAGE_DELAY = 100;

    /* ------------------------------------------------------------------ */
    /*  Helpers                                                             */
    /* ------------------------------------------------------------------ */

    /**
     * Un-escape the minimal HTML entities produced by the Java backend so that
     * the original source is restored for the diagram renderers / parsers.
     */
    function unescapeHtml(text) {
        return text
            .replace(/&#39;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&gt;/g, '>')
            .replace(/&lt;/g, '<')
            .replace(/&amp;/g, '&');
    }

    /* ------------------------------------------------------------------ */
    /*  Cross-frame helpers                                                 */
    /* ------------------------------------------------------------------ */

    /**
     * Collect all unprocessed macro containers from the given document and
     * from any same-origin child iframes.
     *
     * Confluence's editor preview renders macro HTML inside a blank.html
     * iframe.  By also scanning child iframes we ensure the macro content
     * is found regardless of which frame the script is executing in.
     *
     * @param {Document} doc  The document to search.
     * @returns {Array<Element>}
     */
    function collectContainers(doc) {
        var containers = [];

        // Containers in the current document
        var local = doc.querySelectorAll('.markdown-macro-body');
        Array.prototype.push.apply(containers, Array.prototype.slice.call(local));

        // Containers inside same-origin child iframes
        var iframes = doc.querySelectorAll('iframe');
        Array.prototype.forEach.call(iframes, function (iframe) {
            try {
                var iframeDoc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
                if (iframeDoc) {
                    var nested = iframeDoc.querySelectorAll('.markdown-macro-body');
                    Array.prototype.push.apply(containers, Array.prototype.slice.call(nested));
                }
            } catch (_e) {
                // Cross-origin iframe - cannot access, skip silently
            }
        });

        return containers;
    }

    /**
     * Attach a one-time load listener to every iframe in the document so that
     * when an iframe finishes loading we re-scan for macro content.
     */
    function watchIframeLoads(doc) {
        var iframes = doc.querySelectorAll('iframe');
        Array.prototype.forEach.call(iframes, function (iframe) {
            if (iframe.getAttribute('data-md-watched')) {
                return;
            }
            iframe.setAttribute('data-md-watched', 'true');
            iframe.addEventListener('load', function () {
                setTimeout(initMarkdownMacro, IFRAME_CONTENT_LOAD_DELAY);
            });
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Diagram rendering helpers                                           */
    /* ------------------------------------------------------------------ */

    /**
     * Render a Mermaid diagram and return a promise that resolves to an SVG string.
     */
    function renderMermaid(code, id) {
        return new Promise(function (resolve, reject) {
            if (typeof mermaid === 'undefined') {
                resolve('<pre class="diagram-error">[mermaid.min.js not loaded]</pre>');
                return;
            }
            try {
                mermaid.render('mermaid-' + id, code, function (svg) {
                    resolve(svg);
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Render a Graphviz (DOT) diagram and return a promise that resolves to an SVG string.
     */
    function renderGraphviz(code) {
        return new Promise(function (resolve, reject) {
            if (typeof Viz === 'undefined') {
                resolve('<pre class="diagram-error">[viz.js not loaded]</pre>');
                return;
            }
            try {
                var viz = new Viz();
                viz.renderString(code).then(resolve).catch(reject);
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Render a single diagram entry and return a promise resolving to an SVG string.
     */
    function renderDiagram(type, code, index) {
        if (type === 'mermaid') {
            return renderMermaid(code, index);
        }
        if (type === 'graphviz') {
            return renderGraphviz(code);
        }
        return Promise.resolve(
            '<pre class="diagram-error">[Unsupported diagram type: ' + type + ']</pre>'
        );
    }

    /* ------------------------------------------------------------------ */
    /*  Server-rendered diagram processing                                  */
    /* ------------------------------------------------------------------ */

    /**
     * Find diagram placeholder elements inside a container that was rendered
     * on the server.  For each one, read the source, render via mermaid / viz,
     * and swap the visible content.
     */
    function processDiagramPlaceholders(container) {
        var placeholders = container.querySelectorAll('.diagram-placeholder');
        if (placeholders.length === 0) {
            return;
        }

        Array.prototype.forEach.call(placeholders, function (placeholder) {
            var type = placeholder.getAttribute('data-diagram-type');
            var idx = placeholder.getAttribute('data-diagram-index') || '0';
            var sourceEl = placeholder.querySelector('.diagram-source');
            var renderEl = placeholder.querySelector('.diagram-render');
            if (!sourceEl || !renderEl) {
                return;
            }

            var code = unescapeHtml(sourceEl.textContent || sourceEl.innerText || '');

            renderDiagram(type, code, idx)
                .then(function (svg) {
                    renderEl.innerHTML = '<div class="diagram-container">' + svg + '</div>';
                    renderEl.style.display = '';
                    sourceEl.style.display = 'none';
                })
                .catch(function (err) {
                    renderEl.innerHTML = '<pre class="diagram-error">Diagram render error: '
                        + (err.message || err) + '</pre>';
                    renderEl.style.display = '';
                    sourceEl.style.display = 'none';
                });
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Legacy client-side Markdown rendering (backward-compatibility)       */
    /* ------------------------------------------------------------------ */

    /**
     * Extract fenced code blocks whose language hint is one of the supported
     * diagram types.  Each match is replaced with a unique placeholder string.
     */
    function extractDiagrams(markdown) {
        var diagrams = [];
        var index = 0;

        var fenceRegex = /```(mermaid|graphviz|dot)\s*\n([\s\S]*?)```/g;

        var processed = markdown.replace(fenceRegex, function (_match, lang, code) {
            var type = (lang === 'dot') ? 'graphviz' : lang;
            diagrams.push({ type: type, code: code.trim() });
            return DIAGRAM_PLACEHOLDER_PREFIX + (index++) + 'END';
        });

        return { markdown: processed, diagrams: diagrams };
    }

    /**
     * Full client-side rendering for containers whose .markdown-rendered div
     * is empty (pages cached before the server-side rendering change).
     */
    function legacyClientRender(container) {
        var sourceEl = container.querySelector('.markdown-source');
        if (!sourceEl) {
            return;
        }

        var renderedEl = container.querySelector('.markdown-rendered');
        var rawMarkdown = unescapeHtml(sourceEl.textContent || sourceEl.innerText || '');
        var extracted = extractDiagrams(rawMarkdown);

        var html;
        if (typeof marked !== 'undefined') {
            html = marked.parse(extracted.markdown);
        } else {
            html = '<pre>' + extracted.markdown + '</pre>';
        }

        renderedEl.innerHTML = html;

        if (extracted.diagrams.length === 0) {
            return;
        }

        var promises = extracted.diagrams.map(function (entry, idx) {
            return renderDiagram(entry.type, entry.code, idx).catch(function (err) {
                return '<pre class="diagram-error">Diagram render error: '
                    + (err.message || err) + '</pre>';
            });
        });

        Promise.all(promises).then(function (svgs) {
            var updatedHtml = renderedEl.innerHTML.replace(
                DIAGRAM_PLACEHOLDER_REGEX,
                function (_m, idx) {
                    return '<div class="diagram-container">' + svgs[parseInt(idx, 10)] + '</div>';
                }
            );
            renderedEl.innerHTML = updatedHtml;
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Container processing                                                */
    /* ------------------------------------------------------------------ */

    /**
     * Process a single .markdown-macro-body container.  If the server already
     * rendered content into .markdown-rendered we only handle diagrams;
     * otherwise we fall back to the legacy full client-side rendering path.
     */
    function processContainer(container) {
        if (container.getAttribute('data-macro-rendered')) {
            return; // already processed
        }
        container.setAttribute('data-macro-rendered', 'true');

        var renderedEl = container.querySelector('.markdown-rendered');
        if (!renderedEl) {
            return;
        }

        if (renderedEl.innerHTML.trim()) {
            // Server already rendered content - just handle diagrams
            processDiagramPlaceholders(container);
        } else {
            // Legacy path - render everything client-side
            legacyClientRender(container);
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Main entry point                                                    */
    /* ------------------------------------------------------------------ */

    function initMarkdownMacro() {
        // Initialise Mermaid with safe defaults
        if (typeof mermaid !== 'undefined') {
            mermaid.initialize({
                startOnLoad: false,
                theme: 'default',
                securityLevel: 'strict'
            });
        }

        var containers = collectContainers(document);
        Array.prototype.forEach.call(containers, function (container) {
            processContainer(container);
        });

        // Watch for iframes that may load preview content later
        watchIframeLoads(document);
    }

    /* ------------------------------------------------------------------ */
    /*  MutationObserver - detect dynamically-inserted macro containers     */
    /* ------------------------------------------------------------------ */

    function observeForNewMacros() {
        if (typeof MutationObserver === 'undefined') {
            return;
        }

        var debounceTimer = null;


            // Mark the container as processed so CSS switches from showing the
            // raw source to showing the rendered output.
        container.classList.add('js-rendered');

            // Nothing more to do if there are no diagrams
        if (extracted.diagrams.length === 0) {
            return;
        }


        var observer = new MutationObserver(function (mutations) {
            var shouldReinit = false;

            for (var i = 0; i < mutations.length; i++) {
                var added = mutations[i].addedNodes;
                for (var j = 0; j < added.length; j++) {
                    var node = added[j];
                    if (node.nodeType !== 1) {
                        continue;
                    }

                    // New macro container added directly



                    var containers;

                    if (node.classList && node.classList.contains('markdown-macro-body')) {
                        shouldReinit = true;
                        break;
                    }
                    // New iframe added (potential preview frame)
                    if (node.tagName === 'IFRAME') {
                        shouldReinit = true;
                        break;
                    }
                    // Container or iframe added as a descendant
                    if (node.querySelector &&
                        (node.querySelector('.markdown-macro-body') || node.querySelector('iframe'))) {
                        shouldReinit = true;
                        break;
                    }
                }
                if (shouldReinit) {
                    break;
                }
            }

            if (shouldReinit) {
                // Debounce to avoid rapid re-init during editor transitions
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(initMarkdownMacro, MUTATION_DEBOUNCE_DELAY);
            }
        });

        observer.observe(document.body || document.documentElement, {
            childList: true,
            subtree: true
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Cross-frame messaging                                               */
    /* ------------------------------------------------------------------ */

    /**
     * Listen for messages from child iframes requesting a re-render.
     * Also, if we are inside an iframe ourselves, notify the parent that
     * macro content may be available for rendering.
     */
    function setupCrossFrameMessaging() {
        // Listen for render requests from child frames
        window.addEventListener('message', function (event) {
            if (event.data && event.data.type === 'markdown-macro-render-request') {
                setTimeout(initMarkdownMacro, CROSS_FRAME_MESSAGE_DELAY);
            }
        });

        // If running inside an iframe, notify the parent to trigger rendering
        if (window !== window.parent) {
            try {
                window.parent.postMessage(
                    { type: 'markdown-macro-render-request' },
                    window.location.origin
                );
            } catch (_e) {
                // Cross-origin parent - cannot notify
            }
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Bootstrap - wait for the DOM                                       */
    /* ------------------------------------------------------------------ */

    function bootstrap() {
        initMarkdownMacro();
        observeForNewMacros();
        setupCrossFrameMessaging();
    }

    if (typeof AJS !== 'undefined') {
        AJS.toInit(bootstrap);
    } else if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap);
    } else {
        bootstrap();
    }
})();
