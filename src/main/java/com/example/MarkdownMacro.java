package com.example;

import com.atlassian.confluence.content.render.xhtml.ConversionContext;
import com.atlassian.confluence.macro.Macro;
import com.atlassian.confluence.macro.MacroExecutionException;
import com.atlassian.plugin.webresource.WebResourceManager;

import org.commonmark.parser.Parser;
import org.commonmark.renderer.html.HtmlRenderer;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Confluence macro that accepts Markdown content (including Mermaid and Graphviz
 * fenced code blocks) and outputs rendered HTML.
 *
 * <p>Markdown is rendered to HTML on the server side using commonmark-java so
 * that the macro preview in the Confluence editor works without client-side
 * JavaScript.  Diagram code blocks (mermaid / graphviz / dot) are extracted and
 * emitted as placeholder elements that the companion {@code markdown-macro.js}
 * will render into SVG at page-view time.</p>
 */
public class MarkdownMacro implements Macro {

    private static final String CSS_CLASS = "markdown-macro-body";
    private static final String WEB_RESOURCE_KEY =
            "com.example.my-markdown-macro:markdown-macro-resources";

    private static final String PLACEHOLDER_PREFIX = "DIAGRAMPLACEHOLDER";
    private static final String PLACEHOLDER_SUFFIX = "END";

    private static final Pattern FENCE_REGEX =
            Pattern.compile("```(mermaid|graphviz|dot)\\s*\\n([\\s\\S]*?)```");

    private final WebResourceManager webResourceManager;
    private final Parser markdownParser;
    private final HtmlRenderer htmlRenderer;

    public MarkdownMacro(WebResourceManager webResourceManager) {
        this.webResourceManager = webResourceManager;
        this.markdownParser = Parser.builder().build();
        this.htmlRenderer = HtmlRenderer.builder()
                .escapeHtml(true)
                .sanitizeUrls(true)
                .build();
    }

    @Override
    public String execute(Map<String, String> parameters, String body,
                          ConversionContext conversionContext) throws MacroExecutionException {
        webResourceManager.requireResource(WEB_RESOURCE_KEY);

        if (body == null || body.trim().isEmpty()) {
            return "<div class=\"" + CSS_CLASS + "\"></div>";
        }

        // 1. Extract diagram fenced code blocks and replace with placeholders
        List<DiagramEntry> diagrams = new ArrayList<>();
        String processedMarkdown = extractDiagrams(body, diagrams);

        // 2. Render Markdown to HTML on the server
        String renderedHtml = htmlRenderer.render(
                markdownParser.parse(processedMarkdown));

        // 3. Replace placeholder paragraphs with diagram container HTML
        for (int i = 0; i < diagrams.size(); i++) {
            String placeholder = PLACEHOLDER_PREFIX + i + PLACEHOLDER_SUFFIX;
            String diagramHtml = buildDiagramHtml(diagrams.get(i), i);
            // commonmark wraps bare text in <p> tags
            renderedHtml = renderedHtml.replace(
                    "<p>" + placeholder + "</p>", diagramHtml);
            renderedHtml = renderedHtml.replace(placeholder, diagramHtml);
        }

        // 4. Keep escaped source for optional client-side re-rendering
        String escaped = escapeHtml(body);

        return "<div class=\"" + CSS_CLASS + "\">"
                + "<pre class=\"markdown-source\">"
                + escaped
                + "</pre>"
                + "<div class=\"markdown-rendered\">"
                + renderedHtml
                + "</div>"
                + "</div>";
    }

    @Override
    public BodyType getBodyType() {
        return BodyType.PLAIN_TEXT;
    }

    @Override
    public OutputType getOutputType() {
        return OutputType.BLOCK;
    }

    /* ------------------------------------------------------------------
     *  Diagram extraction
     * ------------------------------------------------------------------ */

    /**
     * Pull fenced code blocks for supported diagram languages out of the
     * Markdown source and replace them with uniquely-named placeholders.
     */
    String extractDiagrams(String markdown, List<DiagramEntry> diagrams) {
        Matcher matcher = FENCE_REGEX.matcher(markdown);
        StringBuffer sb = new StringBuffer();
        int index = 0;
        while (matcher.find()) {
            String lang = matcher.group(1);
            String code = matcher.group(2).trim();
            String type = "dot".equals(lang) ? "graphviz" : lang;
            diagrams.add(new DiagramEntry(type, code));
            matcher.appendReplacement(sb,
                    Matcher.quoteReplacement(
                            PLACEHOLDER_PREFIX + (index++) + PLACEHOLDER_SUFFIX));
        }
        matcher.appendTail(sb);
        return sb.toString();
    }

    /**
     * Build an HTML snippet for a diagram placeholder.  The source code is
     * shown as a {@code <pre>} fallback when JavaScript is unavailable (e.g.
     * in the Confluence editor preview).  Client-side JS hides the source and
     * renders the diagram into the {@code .diagram-render} container.
     */
    private String buildDiagramHtml(DiagramEntry entry, int index) {
        return "<div class=\"diagram-placeholder\" data-diagram-type=\""
                + escapeHtml(entry.type) + "\" data-diagram-index=\"" + index + "\">"
                + "<pre class=\"diagram-source\">" + escapeHtml(entry.code) + "</pre>"
                + "<div class=\"diagram-render\"></div>"
                + "</div>";
    }

    /* ------------------------------------------------------------------
     *  Helpers
     * ------------------------------------------------------------------ */

    /**
     * Minimal HTML entity escaping to safely embed arbitrary user text inside
     * an HTML element.
     */
    static String escapeHtml(String text) {
        if (text == null) {
            return "";
        }
        return text
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&#39;");
    }

    /* ------------------------------------------------------------------
     *  Inner types
     * ------------------------------------------------------------------ */

    static class DiagramEntry {
        final String type;
        final String code;

        DiagramEntry(String type, String code) {
            this.type = type;
            this.code = code;
        }
    }
}
