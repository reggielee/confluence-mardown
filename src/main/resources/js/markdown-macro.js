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
 * the Confluence editor preview also triggers rendering.  Diagram code blocks
 * are emitted as placeholder elements with the source in a hidden "pre" element.
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
            // Server already rendered content – just handle diagrams
            processDiagramPlaceholders(container);
        } else {
            // Legacy path – render everything client-side
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

        var containers = document.querySelectorAll('.markdown-macro-body');
        Array.prototype.forEach.call(containers, function (container) {
            processContainer(container);
        });
    }

    /* ------------------------------------------------------------------ */
    /*  MutationObserver – detect dynamically-inserted macro containers     */
    /* ------------------------------------------------------------------ */

    function observeForNewMacros() {
        if (typeof MutationObserver === 'undefined') {
            return;
        }

        var observer = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                Array.prototype.forEach.call(mutation.addedNodes, function (node) {
                    if (node.nodeType !== 1) {
                        return;
                    }

                    var containers;
                    if (node.classList && node.classList.contains('markdown-macro-body')) {
                        containers = [node];
                    } else if (node.querySelectorAll) {
                        containers = node.querySelectorAll('.markdown-macro-body');
                    }

                    if (containers && containers.length > 0) {
                        Array.prototype.forEach.call(containers, function (container) {
                            processContainer(container);
                        });
                    }
                });
            });
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    /* ------------------------------------------------------------------ */
    /*  Bootstrap – wait for the DOM                                       */
    /* ------------------------------------------------------------------ */

    if (typeof AJS !== 'undefined') {
        AJS.toInit(function () {
            initMarkdownMacro();
            observeForNewMacros();
        });
    } else if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            initMarkdownMacro();
            observeForNewMacros();
        });
    } else {
        initMarkdownMacro();
        observeForNewMacros();
    }
})();
