package com.example;

import static org.junit.Assert.*;
import static org.mockito.Mockito.*;

import com.atlassian.plugin.webresource.WebResourceManager;
import org.junit.Before;
import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

/**
 * Unit tests for {@link MarkdownMacro}.
 */
public class MarkdownMacroTest {

    private MarkdownMacro macro;
    private WebResourceManager webResourceManager;

    @Before
    public void setUp() {
        webResourceManager = mock(WebResourceManager.class);
        macro = new MarkdownMacro(webResourceManager);
    }

    /* ------------------------------------------------------------------ */
    /*  escapeHtml                                                         */
    /* ------------------------------------------------------------------ */

    @Test
    public void escapeHtml_escapesAllSpecialCharacters() {
        String input = "<div class=\"a\" data-x='b'>&";
        String expected = "&lt;div class=&quot;a&quot; data-x=&#39;b&#39;&gt;&amp;";
        assertEquals(expected, MarkdownMacro.escapeHtml(input));
    }

    @Test
    public void escapeHtml_returnsEmptyStringForNull() {
        assertEquals("", MarkdownMacro.escapeHtml(null));
    }

    @Test
    public void escapeHtml_returnsUnchangedWhenNoSpecialChars() {
        assertEquals("hello world", MarkdownMacro.escapeHtml("hello world"));
    }

    /* ------------------------------------------------------------------ */
    /*  execute                                                            */
    /* ------------------------------------------------------------------ */

    @Test
    public void execute_returnsEmptyDivForNullBody() throws Exception {
        String result = macro.execute(null, null, null);
        assertTrue(result.contains("markdown-macro-body"));
        assertFalse(result.contains("markdown-source"));
    }

    @Test
    public void execute_returnsEmptyDivForBlankBody() throws Exception {
        String result = macro.execute(null, "   ", null);
        assertTrue(result.contains("markdown-macro-body"));
        assertFalse(result.contains("markdown-source"));
    }

    @Test
    public void execute_wrapsBodyInExpectedHtmlStructure() throws Exception {
        String result = macro.execute(null, "# Hello", null);
        assertTrue("Should contain outer div", result.contains("class=\"markdown-macro-body\""));
        assertTrue("Should contain hidden source pre", result.contains("class=\"markdown-source\""));
        assertTrue("Should contain rendered target div", result.contains("class=\"markdown-rendered\""));
    }

    @Test
    public void execute_includesCrossFrameNotifyScript() throws Exception {
        String result = macro.execute(null, "# Hello", null);
        assertTrue("Should contain cross-frame postMessage script",
                result.contains("markdown-macro-render-request"));
        assertTrue("Should use postMessage for same-origin only",
                result.contains("window.location.origin"));
    }

    @Test
    public void execute_emptyBodyDoesNotIncludeNotifyScript() throws Exception {
        String result = macro.execute(null, null, null);
        assertFalse("Empty body should not contain notify script",
                result.contains("markdown-macro-render-request"));
    }

    @Test
    public void execute_requiresWebResources() throws Exception {
        macro.execute(null, "# Hello", null);
        verify(webResourceManager).requireResource(
                "com.example.my-markdown-macro:markdown-macro-resources");
    }

    @Test
    public void execute_requiresWebResourcesEvenForEmptyBody() throws Exception {
        macro.execute(null, null, null);
        verify(webResourceManager).requireResource(
                "com.example.my-markdown-macro:markdown-macro-resources");
    }

    @Test
    public void execute_escapesHtmlInBody() throws Exception {
        String result = macro.execute(null, "<script>alert(1)</script>", null);
        assertFalse("User-supplied <script>alert(1) must be escaped",
                result.contains("<script>alert(1)</script>"));
        assertTrue("Escaped tag should appear in source pre",
                result.contains("&lt;script&gt;"));
    }

    /* ------------------------------------------------------------------ */
    /*  Server-side Markdown rendering                                     */
    /* ------------------------------------------------------------------ */

    @Test
    public void execute_rendersMarkdownToHtmlServerSide() throws Exception {
        String result = macro.execute(null, "# Hello", null);
        assertTrue("Rendered div should contain <h1>",
                result.contains("<h1>Hello</h1>"));
    }

    @Test
    public void execute_rendersMarkdownParagraph() throws Exception {
        String result = macro.execute(null, "Some **bold** text", null);
        assertTrue("Rendered div should contain <strong>",
                result.contains("<strong>bold</strong>"));
    }

    @Test
    public void execute_renderedDivHasContent() throws Exception {
        String result = macro.execute(null, "Hello world", null);
        // The rendered div should NOT be empty
        assertFalse("Rendered div must not be empty",
                result.contains("<div class=\"markdown-rendered\"></div>"));
    }

    /* ------------------------------------------------------------------ */
    /*  Diagram extraction                                                 */
    /* ------------------------------------------------------------------ */

    @Test
    public void extractDiagrams_extractsMermaidBlock() {
        String md = "# Title\n\n```mermaid\ngraph TD; A-->B;\n```\n\nEnd";
        List<MarkdownMacro.DiagramEntry> diagrams = new ArrayList<>();
        String result = macro.extractDiagrams(md, diagrams);

        assertEquals(1, diagrams.size());
        assertEquals("mermaid", diagrams.get(0).type);
        assertEquals("graph TD; A-->B;", diagrams.get(0).code);
        assertTrue(result.contains("DIAGRAMPLACEHOLDER0END"));
        assertFalse(result.contains("```mermaid"));
    }

    @Test
    public void extractDiagrams_extractsGraphvizBlock() {
        String md = "```graphviz\ndigraph { A -> B }\n```";
        List<MarkdownMacro.DiagramEntry> diagrams = new ArrayList<>();
        macro.extractDiagrams(md, diagrams);

        assertEquals(1, diagrams.size());
        assertEquals("graphviz", diagrams.get(0).type);
    }

    @Test
    public void extractDiagrams_normalizesDotToGraphviz() {
        String md = "```dot\ndigraph { A -> B }\n```";
        List<MarkdownMacro.DiagramEntry> diagrams = new ArrayList<>();
        macro.extractDiagrams(md, diagrams);

        assertEquals(1, diagrams.size());
        assertEquals("graphviz", diagrams.get(0).type);
    }

    @Test
    public void extractDiagrams_handlesMultipleDiagrams() {
        String md = "```mermaid\ngraph TD;\n```\n\nText\n\n```dot\ndigraph{}\n```";
        List<MarkdownMacro.DiagramEntry> diagrams = new ArrayList<>();
        String result = macro.extractDiagrams(md, diagrams);

        assertEquals(2, diagrams.size());
        assertTrue(result.contains("DIAGRAMPLACEHOLDER0END"));
        assertTrue(result.contains("DIAGRAMPLACEHOLDER1END"));
    }

    @Test
    public void extractDiagrams_leavesNonDiagramCodeBlocks() {
        String md = "```java\nSystem.out.println();\n```";
        List<MarkdownMacro.DiagramEntry> diagrams = new ArrayList<>();
        String result = macro.extractDiagrams(md, diagrams);

        assertEquals(0, diagrams.size());
        assertTrue(result.contains("```java"));
    }

    @Test
    public void execute_emitsDiagramPlaceholderHtml() throws Exception {
        String body = "# Diagram\n\n```mermaid\ngraph TD; A-->B;\n```";
        String result = macro.execute(null, body, null);

        assertTrue("Should contain diagram-placeholder div",
                result.contains("class=\"diagram-placeholder\""));
        assertTrue("Should contain data-diagram-type attribute",
                result.contains("data-diagram-type=\"mermaid\""));
        assertTrue("Should contain diagram-source pre",
                result.contains("class=\"diagram-source\""));
        assertTrue("Should contain diagram-render div",
                result.contains("class=\"diagram-render\""));
    }

    /* ------------------------------------------------------------------ */
    /*  Macro metadata                                                     */
    /* ------------------------------------------------------------------ */

    @Test
    public void bodyType_isPlainText() {
        assertEquals(com.atlassian.confluence.macro.Macro.BodyType.PLAIN_TEXT, macro.getBodyType());
    }

    @Test
    public void outputType_isBlock() {
        assertEquals(com.atlassian.confluence.macro.Macro.OutputType.BLOCK, macro.getOutputType());
    }
}
