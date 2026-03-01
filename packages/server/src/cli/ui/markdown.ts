/**
 * E CLI — Markdown Renderer
 */

import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';
import chalk from 'chalk';

marked.setOptions({
  renderer: new TerminalRenderer({
    code: chalk.bgBlack.white,
    codespan: chalk.bgBlack.white,
    firstHeading: chalk.bold.cyan.underline,
    heading: chalk.bold.cyan,
    hr: chalk.gray,
    listitem: chalk.white,
    table: chalk.white,
    paragraph: chalk.white,
    strong: chalk.bold.white,
    em: chalk.italic.white,
    link: chalk.cyan.underline,
    href: chalk.cyan.underline,
    unescape: true,
  }) as any,
});

export function renderMarkdown(md: string): string {
  return marked.parse(md).toString();
}
