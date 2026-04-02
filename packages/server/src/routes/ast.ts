/**
 * Tree-sitter AST Routes
 */

import { Hono } from 'hono';
import {
  parseFileStructure,
  parseContent,
  extractFunctionSignatures,
  extractClassOutlines,
} from '../services/ast-parser';
import type { TreeSitterLanguage } from '@e/shared';

export const astRoutes = new Hono();

// Parse a file's structure
astRoutes.post('/parse', async (c) => {
  try {
    const body = await c.req.json();
    if (body.filePath) {
      const structure = parseFileStructure(body.filePath);
      return c.json({ ok: true, structure });
    }
    if (body.content && body.language) {
      const structure = parseContent(
        body.content,
        body.language as TreeSitterLanguage,
        body.filePath,
      );
      return c.json({ ok: true, structure });
    }
    return c.json({ ok: false, error: 'Provide filePath or content+language' }, 400);
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 400);
  }
});

// Extract function signatures from a file
astRoutes.get('/functions', (c) => {
  const filePath = c.req.query('path');
  if (!filePath) return c.json({ ok: false, error: 'path query param required' }, 400);
  const signatures = extractFunctionSignatures(filePath);
  return c.json({ ok: true, signatures });
});

// Extract class outlines from a file
astRoutes.get('/classes', (c) => {
  const filePath = c.req.query('path');
  if (!filePath) return c.json({ ok: false, error: 'path query param required' }, 400);
  const outlines = extractClassOutlines(filePath);
  return c.json({ ok: true, outlines });
});
