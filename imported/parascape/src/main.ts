import { mount } from 'svelte';
// Same global styling stack the demos/components/builder entries load:
// global-styles supplies the base font/reset + the awsui design tokens the
// ported components reference; the vendored token files add light + dark.
import '@cloudscape-design/global-styles/index.css';
import './lib/tokens/cloudscape-tokens.css';
import './lib/tokens/cloudscape-tokens-dark.css';
import './lib/site.css';
import App from './App.pui';

const target = document.getElementById('app');
if (!target) throw new Error('parascape: #app mount target not found');

export default mount(App, { target });
