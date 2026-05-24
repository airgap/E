// Designer entry — the Wix-style site designer. Loads the same Cloudscape
// global styles + vendored tokens as the rest of the site (the dark tokens
// are needed so light-text sections render their Parascape content in
// awsui-dark-mode), plus the shared site chrome, then mounts the designer.
import '@cloudscape-design/global-styles/index.css';
import '../src/lib/tokens/cloudscape-tokens.css';
import '../src/lib/tokens/cloudscape-tokens-dark.css';
import '../src/lib/site.css';
import { mount } from 'svelte';
import Designer from './Designer.pui';

const target = document.getElementById('app');
if (!target) throw new Error('designer: #app mount target not found');
export default mount(Designer, { target });
