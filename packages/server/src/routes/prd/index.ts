import { Hono } from 'hono';
import standaloneStories from './standalone-stories';
import templates from './templates';
import crud from './crud';
import generation from './generation';
import dependencies from './dependencies';
import estimation from './estimation';
import planning from './planning';

const app = new Hono();

// IMPORTANT: Route mounting order matters!
// Standalone story routes (/stories, /stories/:storyId, etc.) MUST be mounted
// before crud routes because crud has /:id which would catch "stories" as an id param.
// Similarly, template routes (/templates, /templates/:templateId) must come before /:id.
app.route('/', standaloneStories);
app.route('/', templates);
app.route('/', generation);
app.route('/', dependencies);
app.route('/', estimation);
app.route('/', planning);
app.route('/', crud);

export { app as prdRoutes };
export default app;
