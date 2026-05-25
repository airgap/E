// Insertable building blocks for the designer palette (LYK-969).
//
// This is the BUILT-IN set: plain HTML elements that need no imports and render
// in any `.pui`. It's the extension point — a real component manifest (si-bits /
// Cloudscape, ported from Parascape's `gen-sibits-manifest`) plugs in here as
// additional groups, each item contributing its own import + snippet. Keeping the
// shape small now means the insert path (DesignerView.insertSnippet) is exercised
// before the heavier manifest work lands.

export interface PaletteItem {
  /** Display name in the palette. */
  label: string;
  /** Source inserted at the cursor. May be multi-line; it gets re-indented. */
  snippet: string;
}

export interface PaletteGroup {
  group: string;
  items: PaletteItem[];
}

export const BUILTIN_PALETTE: PaletteGroup[] = [
  {
    group: 'Text',
    items: [
      { label: 'Heading', snippet: '<h2>Heading</h2>' },
      { label: 'Paragraph', snippet: '<p>Text</p>' },
      { label: 'Span', snippet: '<span>text</span>' },
    ],
  },
  {
    group: 'Layout',
    items: [
      { label: 'Container', snippet: '<div class="container"></div>' },
      { label: 'Section', snippet: '<section></section>' },
      { label: 'List', snippet: '<ul>\n  <li>Item</li>\n</ul>' },
    ],
  },
  {
    group: 'Controls',
    items: [
      { label: 'Button', snippet: '<button>Button</button>' },
      { label: 'Input', snippet: '<input type="text" />' },
      { label: 'Link', snippet: '<a href="#">link</a>' },
      { label: 'Image', snippet: '<img src="" alt="" />' },
    ],
  },
];
