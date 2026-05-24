// Components catalog entry. Loads the same Cloudscape global styles +
// vendored tokens the rest of the site uses, then mounts the catalog,
// which is itself built from Parascape's .pui component ports.
import '@cloudscape-design/global-styles/index.css';
import '../src/lib/tokens/cloudscape-tokens.css';
import '../src/lib/tokens/cloudscape-tokens-dark.css';
import '../src/lib/site.css';
import { mount } from 'svelte';
import Components from './Components.pui';

const target = document.getElementById('app');
if (!target) throw new Error('components: #app mount target not found');
export default mount(Components, { target });
