// Builder entry — the deterministic composer. Loads the same Cloudscape
// global styles + vendored tokens so the live preview matches the rest
// of the site, then mounts the composer.
import '@cloudscape-design/global-styles/index.css';
import '../src/lib/tokens/cloudscape-tokens.css';
import '../src/lib/tokens/cloudscape-tokens-dark.css';
import '../src/lib/site.css';
import { mount } from 'svelte';
import Builder from './Builder.pui';

const target = document.getElementById('app');
if (!target) throw new Error('builder: #app mount target not found');
export default mount(Builder, { target });
