package com.example;

import static org.junit.Assert.*;

import org.junit.Before;
import org.junit.Test;

/**
 * Unit tests for {@link MarkdownMacro}.
 */
public class MarkdownMacroTest {

    private MarkdownMacro macro;

    @Before
    public void setUp() {
        macro = new MarkdownMacro();
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
    public void execute_escapesHtmlInBody() throws Exception {
        String result = macro.execute(null, "<script>alert(1)</script>", null);
        assertFalse("Raw <script> must not appear", result.contains("<script>"));
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
