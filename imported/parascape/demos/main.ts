// Demos entry — mounts the side-by-side viewer. Cloudscape's
// global-styles + the vendored cloudscape-tokens.css feed BOTH
// renderings (React Cloudscape on the left, .pui Parascape on the
// right) so the only variable across each demo pane is the component
// implementation. The shared CSS is the proof: same hashed classes,
// same tokens, same DOM shape — pixel-identical by construction.
import '@cloudscape-design/global-styles/index.css';
import '../src/lib/tokens/cloudscape-tokens.css';
// Dark-mode token overrides for `.awsui-dark-mode` on <body>.
// Loaded AFTER cloudscape-tokens.css so its `.awsui-dark-mode { … }`
// block wins source order over the light `body { … }` baseline.
import '../src/lib/tokens/cloudscape-tokens-dark.css';
import '../src/lib/site.css';
import { mount } from 'svelte';
import Demos from './Demos.pui';

const target = document.getElementById('app');
if (!target) throw new Error('demos: #app mount target not found');
export default mount(Demos, { target });
