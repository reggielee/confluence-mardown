/**
 * markdown-macro.js
 *
 * Client-side rendering logic for the Markdown Chart Macro.
 *
 * Workflow:
 *   1. Find every <div class="markdown-macro-body"> on the page and in
 *      same-origin child iframes (handles Confluence editor preview).
 *   2. Read the raw Markdown from the hidden <pre class="markdown-source">.
 *   3. Pre-process: extract fenced code blocks for mermaid / graphviz (dot).
 *   4. Render the remaining Markdown to HTML via marked.js.
 *   5. Inject the HTML and replace diagram placeholders with rendered SVG.
 */
(function () {
    'use strict';

    /* ------------------------------------------------------------------ */
    /*  Configuration                                                      */
    /* ------------------------------------------------------------------ */

    var DIAGRAM_PLACEHOLDER_PREFIX = '___DIAGRAM_PLACEHOLDER_';
    var DIAGRAM_PLACEHOLDER_REGEX = /___DIAGRAM_PLACEHOLDER_(\d+)___/g;
    var PROCESSED_ATTR = 'data-markdown-rendered';

    /* ------------------------------------------------------------------ */
    /*  Helpers                                                             */
    /* ------------------------------------------------------------------ */

    /**
     * Un-escape the minimal HTML entities produced by the Java backend so that
     * the original Markdown source is restored for the parsers.
     */
    function unescapeHtml(text) {
        return text
            .replace(/&#39;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&gt;/g, '>')
            .replace(/&lt;/g, '<')
            .replace(/&amp;/g, '&');
    }

    /**
     * Extract fenced code blocks whose language hint is one of the supported
     * diagram types.  Each match is replaced with a unique placeholder string.
     *
     * @param {string} markdown  Raw Markdown text.
     * @returns {{ markdown: string, diagrams: Array<{type: string, code: string}> }}
     */
    function extractDiagrams(markdown) {
        var diagrams = [];
        var index = 0;

        var fenceRegex = /```(mermaid|graphviz|dot)\s*\n([\s\S]*?)```/g;

        var processed = markdown.replace(fenceRegex, function (_match, lang, code) {
            var type = (lang === 'dot') ? 'graphviz' : lang;
            diagrams.push({ type: type, code: code.trim() });
            return DIAGRAM_PLACEHOLDER_PREFIX + (index++) + '___';
        });

        return { markdown: processed, diagrams: diagrams };
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
        var local = doc.querySelectorAll('.markdown-macro-body:not([' + PROCESSED_ATTR + '])');
        Array.prototype.push.apply(containers, Array.prototype.slice.call(local));

        // Containers inside same-origin child iframes
        var iframes = doc.querySelectorAll('iframe');
        Array.prototype.forEach.call(iframes, function (iframe) {
            try {
                var iframeDoc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
                if (iframeDoc) {
                    var nested = iframeDoc.querySelectorAll(
                        '.markdown-macro-body:not([' + PROCESSED_ATTR + '])'
                    );
                    Array.prototype.push.apply(containers, Array.prototype.slice.call(nested));
                }
            } catch (_e) {
                // Cross-origin iframe – cannot access, skip silently
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
                // Small delay to let Confluence inject content into the iframe
                setTimeout(initMarkdownMacro, 100);
            });
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Rendering helpers                                                   */
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
    function renderDiagram(entry, index) {
        if (entry.type === 'mermaid') {
            return renderMermaid(entry.code, index);
        }
        if (entry.type === 'graphviz') {
            return renderGraphviz(entry.code);
        }
        return Promise.resolve(
            '<pre class="diagram-error">[Unsupported diagram type: ' + entry.type + ']</pre>'
        );
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
            var sourceEl = container.querySelector('.markdown-source');
            if (!sourceEl) {
                return;
            }

            // Mark as processed to prevent duplicate rendering
            container.setAttribute(PROCESSED_ATTR, 'true');

            var rawMarkdown = unescapeHtml(sourceEl.textContent || sourceEl.innerText || '');
            var extracted = extractDiagrams(rawMarkdown);

            // Render Markdown to HTML via marked.js
            var html;
            if (typeof marked !== 'undefined') {
                html = marked.parse(extracted.markdown);
            } else {
                // Fallback: show raw Markdown in a <pre> block
                html = '<pre>' + extracted.markdown + '</pre>';
            }

            var renderedEl = container.querySelector('.markdown-rendered');
            renderedEl.innerHTML = html;

            // Nothing more to do if there are no diagrams
            if (extracted.diagrams.length === 0) {
                return;
            }

            // Render all diagrams in parallel and then swap in the SVGs
            var promises = extracted.diagrams.map(function (entry, idx) {
                return renderDiagram(entry, idx).catch(function (err) {
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
        });

        // Watch for iframes that may load preview content later
        watchIframeLoads(document);
    }

    /* ------------------------------------------------------------------ */
    /*  MutationObserver – react to dynamically injected content            */
    /* ------------------------------------------------------------------ */

    /**
     * Watch the DOM for new macro containers or iframes being added (e.g.
     * Confluence editor inserting a preview iframe after the page loads).
     */
    function observeDynamicContent() {
        if (typeof MutationObserver === 'undefined') {
            return;
        }

        var debounceTimer = null;

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
                    if (node.classList && node.classList.contains('markdown-macro-body')) {
                        shouldReinit = true;
                        break;
                    }
                    // New iframe added (potential preview frame)
                    if (node.tagName === 'IFRAME') {
                        shouldReinit = true;
                        break;
                    }
                    // Container added as a descendant of the new node
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
                debounceTimer = setTimeout(initMarkdownMacro, 200);
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
                setTimeout(initMarkdownMacro, 100);
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
                // Cross-origin parent – cannot notify
            }
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Bootstrap – wait for the DOM                                       */
    /* ------------------------------------------------------------------ */

    function bootstrap() {
        initMarkdownMacro();
        observeDynamicContent();
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
