import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

/**
 * CM6 theme that reads from CSS custom properties (--syn-*, --bg-*, etc.)
 * so it automatically adapts to all 6 E themes.
 */
export const eEditorTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      fontSize: '13px',
      backgroundColor: 'var(--bg-code)',
      color: 'var(--text-primary)',
      fontFamily: 'var(--font-family)',
    },
    '.cm-content': {
      caretColor: 'var(--accent-primary)',
      padding: '8px 0',
      fontFamily: 'var(--font-family)',
      lineHeight: '1.6',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--accent-primary)',
      borderLeftWidth: '2px',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'var(--bg-selection)',
    },
    '.cm-panels': {
      backgroundColor: 'var(--bg-secondary)',
      color: 'var(--text-primary)',
      borderColor: 'var(--border-primary)',
    },
    '.cm-panels.cm-panels-top': {
      borderBottom: '1px solid var(--border-primary)',
    },
    '.cm-panels.cm-panels-bottom': {
      borderTop: '1px solid var(--border-primary)',
    },
    '.cm-searchMatch': {
      backgroundColor: 'rgba(0, 180, 255, 0.2)',
      outline: '1px solid rgba(0, 180, 255, 0.4)',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'rgba(0, 180, 255, 0.35)',
    },
    '.cm-activeLine': {
      backgroundColor: 'var(--bg-hover)',
    },
    '.cm-selectionMatch': {
      backgroundColor: 'rgba(0, 180, 255, 0.12)',
    },
    '&.cm-focused .cm-matchingBracket': {
      backgroundColor: 'rgba(0, 180, 255, 0.2)',
      outline: '1px solid var(--accent-primary)',
    },
    '&.cm-focused .cm-nonmatchingBracket': {
      backgroundColor: 'rgba(255, 51, 68, 0.2)',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--bg-secondary)',
      color: 'var(--text-tertiary)',
      borderRight: '1px solid var(--border-secondary)',
      fontFamily: 'var(--font-family)',
      fontSize: '12px',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'var(--bg-hover)',
      color: 'var(--text-secondary)',
    },
    // Test status gutter
    '.cm-test-gutter': {
      width: '18px',
      padding: '0 2px',
      textAlign: 'center',
    },
    '.cm-test-marker': {
      fontSize: '12px',
      lineHeight: '1.6',
      display: 'inline-block',
      width: '14px',
      textAlign: 'center',
      fontWeight: 'bold',
    },
    '.cm-test-pass': {
      color: 'var(--accent-secondary)',
    },
    '.cm-test-fail': {
      color: 'var(--accent-error)',
    },
    '.cm-test-skip': {
      color: 'var(--text-tertiary)',
      opacity: '0.6',
    },
    '.cm-foldPlaceholder': {
      backgroundColor: 'var(--bg-tertiary)',
      border: '1px solid var(--border-primary)',
      color: 'var(--text-tertiary)',
    },
    '.cm-tooltip': {
      backgroundColor: 'transparent',
      border: 'none',
      boxShadow: 'none',
      padding: '0',
    },
    '.cm-tooltip .cm-tooltip-arrow:before': {
      borderTopColor: 'var(--border-primary)',
      borderBottomColor: 'var(--border-primary)',
    },
    '.cm-tooltip .cm-tooltip-arrow:after': {
      borderTopColor: 'var(--bg-elevated)',
      borderBottomColor: 'var(--bg-elevated)',
    },
    // Hover card inside cm-tooltip
    '.cm-tooltip .e-hover-tags': {
      padding: '4px 12px 0',
      fontSize: '10px',
      fontFamily: 'var(--font-family-sans)',
      color: 'var(--accent-primary)',
      letterSpacing: '0.03em',
      textTransform: 'uppercase',
      opacity: '0.8',
    },
    '.cm-tooltip .e-hover-card': {
      backgroundColor: 'var(--bg-elevated)',
      border: '1px solid var(--border-primary)',
      borderRadius: 'var(--radius)',
      boxShadow: '0 4px 12px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.3)',
      minWidth: '180px',
      maxWidth: '520px',
      overflow: 'hidden',
      fontFamily: 'var(--font-family-sans)',
      fontSize: '12.5px',
      animation: 'hoverCardIn 0.12s cubic-bezier(0.2,0,0,1.05)',
    },
    '.cm-tooltip .e-hover-sig': {
      padding: '8px 12px',
      backgroundColor: 'var(--bg-code, var(--bg-secondary))',
    },
    '.cm-tooltip .e-hover-pre': {
      margin: '0',
      padding: '0',
      fontFamily: 'var(--font-family)',
      fontSize: '12.5px',
      lineHeight: '1.55',
      color: 'var(--text-primary)',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      maxHeight: '200px',
      overflowY: 'auto',
      // Reset global <pre> styling (border, background, box-shadow, border-radius)
      // that leaks from app.css and theme-specific overrides
      border: 'none',
      background: 'none',
      boxShadow: 'none',
      borderRadius: '0',
    },
    '.cm-tooltip .e-hover-sep': {
      height: '1px',
      backgroundColor: 'var(--border-primary)',
    },
    '.cm-tooltip .e-hover-docs': {
      padding: '7px 12px',
    },
    '.cm-tooltip .e-hover-doc-para': {
      margin: '0 0 4px',
      color: 'var(--text-secondary)',
      lineHeight: '1.55',
      fontSize: '12px',
    },
    '.cm-tooltip .e-hover-doc-para:last-child': {
      marginBottom: '0',
    },
    '.cm-tooltip .e-hover-inline-code': {
      fontFamily: 'var(--font-family)',
      fontSize: '11.5px',
      backgroundColor: 'var(--bg-tertiary)',
      color: 'var(--accent-primary)',
      padding: '0 3px',
      borderRadius: '3px',
      border: '1px solid var(--border-secondary)',
    },
    // Definition peek section
    '.cm-tooltip .e-hover-peek': {
      backgroundColor: 'var(--bg-secondary)',
    },
    '.cm-tooltip .e-hover-peek-label': {
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      padding: '5px 12px 3px',
      fontSize: '11px',
      color: 'var(--text-tertiary)',
      borderBottom: '1px solid var(--border-secondary)',
    },
    '.cm-tooltip .e-hover-peek-icon': {
      fontSize: '10px',
      color: 'var(--accent-primary)',
      opacity: '0.7',
    },
    '.cm-tooltip .e-hover-peek-path': {
      color: 'var(--text-secondary)',
      fontFamily: 'var(--font-family)',
      fontSize: '11px',
    },
    '.cm-tooltip .e-hover-peek-line': {
      color: 'var(--text-tertiary)',
      fontFamily: 'var(--font-family)',
      fontSize: '11px',
    },
    '.cm-tooltip .e-hover-peek-code': {
      padding: '6px 12px 8px',
      maxHeight: '160px',
      overflowY: 'auto',
      fontSize: '12px',
      lineHeight: '1.5',
      color: 'var(--text-primary)',
      margin: '0',
    },
    // Documentation link section in hover cards
    '.cm-tooltip .e-hover-doc-link': {
      display: 'flex',
      alignItems: 'center',
      gap: '5px',
      padding: '5px 12px',
      backgroundColor: 'var(--bg-secondary)',
      borderTop: '1px solid var(--border-primary)',
      fontSize: '11px',
      fontFamily: 'var(--font-family-sans)',
    },
    '.cm-tooltip .e-hover-doc-link-icon': {
      fontSize: '10px',
      color: 'var(--accent-primary)',
      opacity: '0.6',
      lineHeight: '1',
    },
    '.cm-tooltip .e-hover-doc-link-anchor': {
      color: 'var(--text-link, var(--accent-primary))',
      textDecoration: 'none',
      cursor: 'pointer',
      transition: 'opacity 0.1s',
    },
    '.cm-tooltip .e-hover-doc-link-anchor:hover': {
      textDecoration: 'underline',
      opacity: '0.85',
    },
    '.cm-tooltip .e-hover-doc-link-arrow': {
      fontSize: '11px',
      color: 'var(--text-tertiary)',
      opacity: '0.6',
    },
    // Syntax highlight token classes used in hover card snippets (ht-* = hover token)
    '.e-hover-pre .ht-kw': { color: 'var(--syn-keyword)' },
    '.e-hover-pre .ht-str': { color: 'var(--syn-string)' },
    '.e-hover-pre .ht-num': { color: 'var(--syn-number, var(--syn-string))' },
    '.e-hover-pre .ht-cmt': { color: 'var(--syn-comment)', fontStyle: 'italic' },
    '.e-hover-pre .ht-typ': { color: 'var(--syn-type)' },
    '.e-hover-pre .ht-fn': { color: 'var(--syn-function)' },
    '.e-hover-pre .ht-var': { color: 'var(--syn-variable)' },
    '.e-hover-pre .ht-op': { color: 'var(--syn-operator)' },
    '.e-hover-pre .ht-pun': { color: 'var(--text-secondary)' },
    '.e-hover-pre .ht-err': { color: 'var(--accent-error)' },
    '.cm-tooltip-autocomplete': {
      '& > ul': {
        backgroundColor: 'var(--bg-elevated)',
        border: '1px solid var(--border-primary)',
        borderRadius: 'var(--radius)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        fontFamily: 'var(--font-family-sans)',
        fontSize: '12.5px',
        maxHeight: '280px',
      },
      '& > ul > li': {
        padding: '3px 10px',
        color: 'var(--text-secondary)',
      },
      '& > ul > li[aria-selected]': {
        backgroundColor: 'var(--bg-active)',
        color: 'var(--text-primary)',
      },
    },
    // Code action lightbulb gutter
    '.cm-lightbulb-gutter': {
      width: '20px',
      padding: '0 2px',
      textAlign: 'center',
    },
    '.cm-lightbulb-marker': {
      fontSize: '13px',
      lineHeight: '1.6',
      display: 'inline-block',
      width: '16px',
      textAlign: 'center',
      cursor: 'pointer',
      opacity: '0.7',
      transition: 'opacity 0.15s ease, transform 0.15s ease',
    },
    '.cm-lightbulb-marker:hover': {
      opacity: '1',
      transform: 'scale(1.15)',
    },
    // Merge conflict resolution
    '.cm-merge-conflict-header': {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '3px 8px',
      backgroundColor: 'var(--bg-tertiary)',
      borderBottom: '1px solid var(--border-primary)',
      fontSize: '11px',
      fontFamily: 'var(--font-family-sans)',
    },
    '.cm-merge-conflict-label': {
      fontWeight: '700',
      color: 'var(--accent-warning, #eab308)',
      letterSpacing: '0.02em',
      marginRight: '4px',
    },
    '.cm-conflict-btn': {
      padding: '1px 8px',
      border: '1px solid var(--border-primary)',
      borderRadius: '3px',
      fontSize: '10.5px',
      fontWeight: '600',
      fontFamily: 'var(--font-family-sans)',
      cursor: 'pointer',
      transition: 'all 0.12s',
      lineHeight: '1.6',
    },
    '.cm-conflict-btn:hover': {
      filter: 'brightness(1.15)',
    },
    '.cm-conflict-btn-current': {
      backgroundColor: 'rgba(34, 197, 94, 0.15)',
      color: '#22c55e',
      borderColor: 'rgba(34, 197, 94, 0.3)',
    },
    '.cm-conflict-btn-incoming': {
      backgroundColor: 'rgba(59, 130, 246, 0.15)',
      color: '#3b82f6',
      borderColor: 'rgba(59, 130, 246, 0.3)',
    },
    '.cm-conflict-btn-both': {
      backgroundColor: 'rgba(168, 85, 247, 0.15)',
      color: '#a855f7',
      borderColor: 'rgba(168, 85, 247, 0.3)',
    },
    '.cm-conflict-btn-ai': {
      backgroundColor: 'rgba(234, 179, 8, 0.15)',
      color: '#eab308',
      borderColor: 'rgba(234, 179, 8, 0.3)',
    },
    '.cm-conflict-marker-line': {
      backgroundColor: 'rgba(148, 163, 184, 0.08)',
      color: 'var(--text-tertiary)',
      fontStyle: 'italic',
    },
    '.cm-conflict-current': {
      backgroundColor: 'rgba(34, 197, 94, 0.08)',
    },
    '.cm-conflict-incoming': {
      backgroundColor: 'rgba(59, 130, 246, 0.08)',
    },
    // Inlay type hints
    '.cm-inlay-hint': {
      fontFamily: 'var(--font-family)',
      fontSize: '11px',
      color: 'var(--text-tertiary)',
      opacity: '0.7',
      fontStyle: 'italic',
      padding: '0 2px',
      borderRadius: '2px',
      backgroundColor: 'rgba(148, 163, 184, 0.08)',
      border: '1px solid rgba(148, 163, 184, 0.1)',
      verticalAlign: 'baseline',
      lineHeight: '1',
    },
    '.cm-inlay-hint-type': {
      color: 'var(--syn-type, var(--text-tertiary))',
    },
    '.cm-inlay-hint-parameter': {
      color: 'var(--syn-variable, var(--text-tertiary))',
    },
    // Code lens (reference counts above functions)
    '.cm-code-lens-line': {
      fontFamily: 'var(--font-family-sans)',
      fontSize: '11px',
      lineHeight: '1.8',
      color: 'var(--text-tertiary)',
      paddingLeft: '62px', // Align with code after gutters
      opacity: '0.75',
      cursor: 'default',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
    },
    '.cm-code-lens-item': {
      cursor: 'pointer',
      transition: 'color 0.12s, opacity 0.12s',
      color: 'var(--text-link, var(--accent-primary))',
      opacity: '0.7',
    },
    '.cm-code-lens-item:hover': {
      opacity: '1',
      textDecoration: 'underline',
    },
    '.cm-code-lens-sep': {
      color: 'var(--text-tertiary)',
      opacity: '0.4',
    },
    // Git blame annotations
    '.cm-blame-annotation': {
      fontFamily: 'var(--font-family)',
      fontSize: '11px',
      color: 'var(--text-tertiary)',
      opacity: '0.45',
      fontStyle: 'italic',
      paddingLeft: '2em',
      whiteSpace: 'nowrap',
      pointerEvents: 'auto',
      cursor: 'default',
    },
    // Code coverage overlay
    '.cm-coverage-covered': {
      backgroundColor: 'rgba(34, 197, 94, 0.08)',
    },
    '.cm-coverage-uncovered': {
      backgroundColor: 'rgba(239, 68, 68, 0.10)',
    },
    '.cm-coverage-partial': {
      backgroundColor: 'rgba(234, 179, 8, 0.08)',
    },
    // Proactive AI warnings
    '.cm-proactive-underline-error': {
      textDecoration: 'underline wavy var(--accent-error)',
      textDecorationThickness: '1px',
      textUnderlineOffset: '3px',
    },
    '.cm-proactive-underline-warning': {
      textDecoration: 'underline dashed var(--accent-warning, #eab308)',
      textDecorationThickness: '1px',
      textUnderlineOffset: '3px',
    },
    '.cm-proactive-underline-info': {
      textDecoration: 'underline dotted var(--accent-primary)',
      textDecorationThickness: '1px',
      textUnderlineOffset: '3px',
    },
    '.cm-proactive-warning-widget': {
      fontFamily: 'var(--font-family-sans)',
      fontSize: '11px',
      paddingLeft: '2em',
      opacity: '0.65',
      whiteSpace: 'nowrap',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '3px',
    },
    '.cm-proactive-warning-icon': {
      fontSize: '11px',
    },
    '.cm-proactive-error': {
      color: 'var(--accent-error)',
    },
    '.cm-proactive-warning': {
      color: 'var(--accent-warning, #eab308)',
    },
    '.cm-proactive-info': {
      color: 'var(--accent-primary)',
    },
    '.cm-proactive-warning-msg': {
      color: 'var(--text-tertiary)',
      fontStyle: 'italic',
    },
    '.cm-proactive-dismiss': {
      marginLeft: '6px',
      cursor: 'pointer',
      color: 'var(--text-tertiary)',
      opacity: '0.5',
      fontSize: '10px',
      transition: 'opacity 0.12s',
    },
    '.cm-proactive-dismiss:hover': {
      opacity: '1',
      color: 'var(--accent-error)',
    },
    // Search panel inputs
    '.cm-panel input': {
      backgroundColor: 'var(--bg-input)',
      color: 'var(--text-primary)',
      border: '1px solid var(--border-primary)',
      fontFamily: 'var(--font-family)',
    },
    '.cm-panel button': {
      color: 'var(--text-secondary)',
    },
    // Scrollbar styling
    '.cm-scroller': {
      fontFamily: 'var(--font-family)',
      overflow: 'auto',
    },
  },
  { dark: true },
);

/**
 * Syntax highlighting using CSS custom properties.
 * We can't use var() in HighlightStyle directly, so we use computed colors
 * that match our theme system. The theme is applied via the EditorView theme above.
 */
export const eHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--syn-keyword)' },
  { tag: tags.controlKeyword, color: 'var(--syn-keyword)' },
  { tag: tags.operatorKeyword, color: 'var(--syn-keyword)' },
  { tag: tags.definitionKeyword, color: 'var(--syn-keyword)' },
  { tag: tags.moduleKeyword, color: 'var(--syn-keyword)' },
  { tag: tags.operator, color: 'var(--syn-operator)' },
  { tag: tags.string, color: 'var(--syn-string)' },
  { tag: tags.special(tags.string), color: 'var(--syn-string)' },
  { tag: tags.regexp, color: 'var(--syn-string)' },
  { tag: tags.number, color: 'var(--syn-number)' },
  { tag: tags.bool, color: 'var(--syn-number)' },
  { tag: tags.null, color: 'var(--syn-number)' },
  { tag: tags.function(tags.variableName), color: 'var(--syn-function)' },
  { tag: tags.function(tags.propertyName), color: 'var(--syn-function)' },
  { tag: tags.definition(tags.function(tags.variableName)), color: 'var(--syn-function)' },
  { tag: tags.comment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: tags.lineComment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: tags.blockComment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: tags.docComment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: tags.typeName, color: 'var(--syn-type)' },
  { tag: tags.typeOperator, color: 'var(--syn-type)' },
  { tag: tags.className, color: 'var(--syn-type)' },
  { tag: tags.namespace, color: 'var(--syn-type)' },
  { tag: tags.variableName, color: 'var(--syn-variable)' },
  { tag: tags.definition(tags.variableName), color: 'var(--syn-variable)' },
  { tag: tags.propertyName, color: 'var(--syn-variable)' },
  { tag: tags.attributeName, color: 'var(--syn-variable)' },
  { tag: tags.labelName, color: 'var(--syn-variable)' },
  { tag: tags.tagName, color: 'var(--syn-keyword)' },
  { tag: tags.angleBracket, color: 'var(--syn-operator)' },
  { tag: tags.attributeValue, color: 'var(--syn-string)' },
  { tag: tags.meta, color: 'var(--syn-comment)' },
  { tag: tags.processingInstruction, color: 'var(--syn-comment)' },
  { tag: tags.punctuation, color: 'var(--text-secondary)' },
  { tag: tags.paren, color: 'var(--text-secondary)' },
  { tag: tags.squareBracket, color: 'var(--text-secondary)' },
  { tag: tags.brace, color: 'var(--text-secondary)' },
  { tag: tags.separator, color: 'var(--text-secondary)' },
  { tag: tags.invalid, color: 'var(--accent-error)' },
  { tag: tags.self, color: 'var(--syn-keyword)' },
  { tag: tags.atom, color: 'var(--syn-number)' },
  { tag: tags.unit, color: 'var(--syn-number)' },
  { tag: tags.heading, color: 'var(--syn-function)', fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.link, color: 'var(--text-link)', textDecoration: 'underline' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
]);

export const eSyntaxHighlighting = syntaxHighlighting(eHighlightStyle);

// Inject global @keyframes for hover card animation (once per page)
if (typeof document !== 'undefined') {
  const _styleId = 'e-cm-hover-keyframes';
  if (!document.getElementById(_styleId)) {
    const s = document.createElement('style');
    s.id = _styleId;
    s.textContent = `
      @keyframes hoverCardIn {
        from { opacity: 0; transform: scale(0.97) translateY(3px); }
        to   { opacity: 1; transform: scale(1) translateY(0); }
      }
    `;
    document.head.appendChild(s);
  }
}
