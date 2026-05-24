// Unit tests for the paraInlineSnippets preprocess. Probes each of
// the four documented behaviors against a tiny `.pui` fragment and
// confirms the rewritten markup carries the right structure. Run:
//   bun demos/para-inline-snippets.test.mjs
// Exits 0 on pass, 1 on failure.

import paraInlineSnippets from "./para-inline-snippets.js";

const pp = paraInlineSnippets();
let fails = 0;

function check(label, source, predicate) {
  const r = pp.markup({ content: source, filename: "x.pui" });
  const out = r?.code ?? source;
  let ok;
  let err = "";
  try {
    ok = predicate(out, source);
  } catch (e) {
    ok = false;
    err = (e && e.message) ?? String(e);
  }
  console.log(`  ${ok ? "✓" : "✗"} ${label}${err ? " — " + err : ""}`);
  if (!ok) {
    fails++;
    console.log("    ---- output ----");
    console.log(
      out
        .split("\n")
        .map(l => "    " + l)
        .join("\n"),
    );
  }
}

console.log("paraInlineSnippets:");

check(
  "bare markup attribute lifts to a zero-arg snippet",
  `<Form header={<Header>Hi</Header>}>x</Form>`,
  out =>
    /header=\{\(__para_attr_1\.__para_snippet = true, __para_attr_1\)\}/.test(out) &&
    /\{#snippet __para_attr_1\(\)\}<Header>Hi<\/Header>\{\/snippet\}/.test(out),
);

check(
  "multi-line markup attribute lifts as a single snippet",
  `<Form actions={
    <Wrap>
      <Inner/>
    </Wrap>
  }>x</Form>`,
  out =>
    /actions=\{\s*\(__para_attr_1\.__para_snippet = true, __para_attr_1\)\s*\}/.test(out) &&
    /\{#snippet __para_attr_1\(\)\}\s*<Wrap>\s*<Inner\/>\s*<\/Wrap>\s*\{\/snippet\}/.test(out),
);

check(
  "param form `(arg) => <JSX>` lifts to a parameterized snippet",
  `<Table cell={(r) => <Tag>{r.x}</Tag>}/>`,
  out =>
    out.includes("cell={(__para_attr_1.__para_snippet = true, __para_attr_1)}") &&
    /\{#snippet __para_attr_1\(r\)\}<Tag>\{r\.x\}<\/Tag>\{\/snippet\}/.test(out),
);

check(
  "typed param form preserves TypeScript annotations on the snippet",
  `<Table cell={(r: Row) => <Tag>{r.x}</Tag>}/>`,
  out => /\{#snippet __para_attr_1\(r: Row\)/.test(out),
);

check(
  "JSX in object-literal expression position lifts in place",
  `<Tabs tabs={[{ id: 'a', content: <Box>A</Box> }, { id: 'b', content: <Box>B</Box> }]}/>`,
  out =>
    out.includes("content: (__para_attr_1.__para_snippet = true, __para_attr_1)") &&
    out.includes("content: (__para_attr_2.__para_snippet = true, __para_attr_2)") &&
    out.includes("{#snippet __para_attr_1()}<Box>A</Box>{/snippet}") &&
    out.includes("{#snippet __para_attr_2()}<Box>B</Box>{/snippet}"),
);

check(
  "JSX inside an {#each} hoists INSIDE the each body, not to module top",
  `{#each items as item (item.id)}
    <Row label={<Tag>{item.name}</Tag>}/>
  {/each}`,
  out => {
    const eachOpen = out.indexOf("{#each");
    const eachClose = out.indexOf("{/each}");
    const snipDecl = out.indexOf("{#snippet __para_attr_1");
    // Snippet declaration must land BETWEEN the open and close of {#each}
    return snipDecl > eachOpen && snipDecl < eachClose;
  },
);

check(
  "HTML comments containing attribute-shaped strings pass through verbatim",
  `<!-- header={<Tag>doc</Tag>} should stay a comment -->\n<Form/>`,
  out => !out.includes("__para_attr_1") && out.startsWith("<!-- header={<Tag>doc</Tag>} should stay a comment -->"),
);

check(
  "JS comparison `{x < 5}` is left alone (no leading letter)",
  `<X attr={count < 5 ? 'low' : 'high'}/>`,
  out => !out.includes("__para_attr_1"),
);

check(
  "template-literal `${…}` in attribute body doesn't desync the scanner",
  `<X attr={\`pre-\${count} (\${items.length})\`}/>`,
  out => !out.includes("__para_attr_1") && out.includes("`pre-${count}"),
);

check(
  "<script>/<style> blocks are passed through verbatim",
  `<script>let x = (a, b) => <Junk/>;</script>\n<Y/>`,
  out => out.startsWith("<script>let x = (a, b) => <Junk/>;</script>") && !out.includes("__para_attr_1"),
);

if (fails > 0) {
  console.log(`\nFAIL: ${fails} test(s)`);
  process.exit(1);
}
console.log(`\nOK: all tests pass`);
