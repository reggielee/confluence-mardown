/**
 * markdown-macro.js
 *
 * Client-side rendering logic for the Markdown Chart Macro.
 *
 * Workflow:
 *   1. Find every <div class="markdown-macro-body"> on the page.
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

        var containers = document.querySelectorAll('.markdown-macro-body');

        Array.prototype.forEach.call(containers, function (container) {
            var sourceEl = container.querySelector('.markdown-source');
            if (!sourceEl) {
                return;
            }

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
    }

    /* ------------------------------------------------------------------ */
    /*  Bootstrap – wait for the DOM                                       */
    /* ------------------------------------------------------------------ */

    if (typeof AJS !== 'undefined') {
        AJS.toInit(initMarkdownMacro);
    } else if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMarkdownMacro);
    } else {
        initMarkdownMacro();
    }
})();
