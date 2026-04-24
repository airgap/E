import { Hono } from 'hono';
import status from './status';
import staging from './staging';
import commits from './commits';
import snapshots from './snapshots';
import log from './log';

const app = new Hono();

app.route('/', status);
app.route('/', staging);
app.route('/', commits);
app.route('/', snapshots);
app.route('/', log);

export { app as gitRoutes };
export default app;
