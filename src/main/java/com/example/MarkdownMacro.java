package com.example;

import com.atlassian.confluence.content.render.xhtml.ConversionContext;
import com.atlassian.confluence.macro.Macro;
import com.atlassian.confluence.macro.MacroExecutionException;
import com.atlassian.plugin.webresource.WebResourceManager;

import java.util.Map;

/**
 * Confluence macro that accepts Markdown content (including Mermaid and Graphviz
 * fenced code blocks) and outputs a container that the frontend JavaScript will
 * parse and render into HTML + SVG diagrams.
 *
 * <p>The macro is a body-type macro: the user writes Markdown directly inside the
 * macro body in the Confluence editor.  The backend escapes the raw text and wraps
 * it in a {@code <div>} so that the companion {@code markdown-macro.js} can pick
 * it up at page-view time.</p>
 */
public class MarkdownMacro implements Macro {

    private static final String CSS_CLASS = "markdown-macro-body";
    private static final String WEB_RESOURCE_KEY =
            "com.example.my-markdown-macro:markdown-macro-resources";

    private final WebResourceManager webResourceManager;

    public MarkdownMacro(WebResourceManager webResourceManager) {
        this.webResourceManager = webResourceManager;
    }

    @Override
    public String execute(Map<String, String> parameters, String body,
                          ConversionContext conversionContext) throws MacroExecutionException {
        webResourceManager.requireResource(WEB_RESOURCE_KEY);

        if (body == null || body.trim().isEmpty()) {
            return "<div class=\"" + CSS_CLASS + "\"></div>";
        }

        String escaped = escapeHtml(body);

        return "<div class=\"" + CSS_CLASS + "\">"
                + "<pre class=\"markdown-source\" style=\"display:none;\">"
                + escaped
                + "</pre>"
                + "<div class=\"markdown-rendered\"></div>"
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

    /**
     * Minimal HTML entity escaping to safely embed arbitrary user text inside
     * an HTML {@code <pre>} element.
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
}
