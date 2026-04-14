package com.example;

import static org.junit.Assert.*;
import static org.mockito.Mockito.*;

import com.atlassian.plugin.webresource.WebResourceManager;
import org.junit.Before;
import org.junit.Test;

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
        assertTrue("Escaped tag should appear", result.contains("&lt;script&gt;"));
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
