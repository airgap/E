// LYK-965 "Open PR": push generated code to a GitHub repo and open a pull request.
//
// Uses GitHub's REST Git Data API directly from the browser (api.github.com sends
// permissive CORS headers and accepts an Authorization header), so no backend
// secret or OAuth app is needed — the user supplies a fine-grained / classic PAT
// with `contents` + `pull_requests` (repo) write. All files land in ONE commit
// (blobs → tree → commit → ref), then a PR is opened against the base branch.
//
// The token is the caller's responsibility to store; this module only sends it to
// api.github.com (never to the Parascape Worker).
export type PrFile = { path: string; content: string };
export type OpenPrOpts = {
	token: string;
	repo: string; // "owner/name"
	base?: string; // default: the repo's default branch
	branch: string; // new head branch to create
	message: string; // commit message
	title: string; // PR title
	body?: string; // PR body
	files: PrFile[];
};

const API = 'https://api.github.com';

function b64(str: string): string {
	// UTF-8 → base64 without relying on deprecated escape()
	const bytes = new TextEncoder().encode(str);
	let bin = '';
	for (let i = 0; i < bytes.length; i += 0x8000)
		bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(bin);
}

export async function openPullRequest(opts: OpenPrOpts): Promise<{ url: string; number: number }> {
	const { token, repo, branch, message, title } = opts;
	if (!token) throw new Error('A GitHub token is required.');
	if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new Error('Repo must be "owner/name".');
	if (!branch.trim()) throw new Error('A branch name is required.');
	if (!opts.files.length) throw new Error('Nothing to commit.');

	const headers = {
		Authorization: `Bearer ${token}`,
		Accept: 'application/vnd.github+json',
		'Content-Type': 'application/json',
		'X-GitHub-Api-Version': '2022-11-28',
	};
	const gh = async (path: string, init?: RequestInit) => {
		const res = await fetch(`${API}/repos/${repo}${path}`, { ...init, headers });
		if (!res.ok) {
			let detail = '';
			try {
				detail = (await res.json())?.message ?? '';
			} catch {}
			if (res.status === 401)
				throw new Error('GitHub rejected the token (401). Check it has repo write scope.');
			if (res.status === 404)
				throw new Error(`Repo "${repo}" not found, or the token can't see it (404).`);
			throw new Error(`GitHub ${res.status}: ${detail || res.statusText}`);
		}
		return res.json();
	};

	// resolve base branch + its tip commit/tree
	const base = opts.base?.trim() || (await gh('')).default_branch;
	const baseRef = await gh(`/git/ref/heads/${encodeURIComponent(base)}`);
	const baseSha: string = baseRef.object.sha;
	const baseCommit = await gh(`/git/commits/${baseSha}`);
	const baseTree: string = baseCommit.tree.sha;

	// one blob per file → a tree layered on the base tree → a commit
	const tree = await Promise.all(
		opts.files.map(async (f) => {
			const blob = await gh('/git/blobs', {
				method: 'POST',
				body: JSON.stringify({ content: b64(f.content), encoding: 'base64' }),
			});
			return { path: f.path.replace(/^\/+/, ''), mode: '100644', type: 'blob', sha: blob.sha };
		}),
	);
	const newTree = await gh('/git/trees', {
		method: 'POST',
		body: JSON.stringify({ base_tree: baseTree, tree }),
	});
	const commit = await gh('/git/commits', {
		method: 'POST',
		body: JSON.stringify({ message, tree: newTree.sha, parents: [baseSha] }),
	});

	// create the head branch (422 = it already exists → fast-forward it instead)
	const refBody = JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha });
	const created = await fetch(`${API}/repos/${repo}/git/refs`, {
		method: 'POST',
		headers,
		body: refBody,
	});
	if (!created.ok) {
		if (created.status === 422) {
			await gh(`/git/refs/heads/${encodeURIComponent(branch)}`, {
				method: 'PATCH',
				body: JSON.stringify({ sha: commit.sha, force: true }),
			});
		} else {
			let detail = '';
			try {
				detail = (await created.json())?.message ?? '';
			} catch {}
			throw new Error(`GitHub ${created.status}: ${detail || created.statusText}`);
		}
	}

	// open (or reuse) the PR
	try {
		const pr = await gh('/pulls', {
			method: 'POST',
			body: JSON.stringify({ title, head: branch, base, body: opts.body ?? '' }),
		});
		return { url: pr.html_url, number: pr.number };
	} catch (e) {
		// a PR for this head may already be open — surface it rather than erroring
		const open = await gh(
			`/pulls?head=${repo.split('/')[0]}:${encodeURIComponent(branch)}&state=open`,
		);
		if (Array.isArray(open) && open.length)
			return { url: open[0].html_url, number: open[0].number };
		throw e;
	}
}
