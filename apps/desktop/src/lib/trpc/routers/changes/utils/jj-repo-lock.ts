// Repo-level mutex — serialise jj CLI calls to avoid store-lock contention.
// Used by every jj CLI invocation across the changes router and vcs provider.

const repoLocks = new Map<string, Promise<unknown>>();

export async function withJjRepoLock<T>(
	repoPath: string,
	fn: () => Promise<T>,
): Promise<T> {
	const prev = repoLocks.get(repoPath) ?? Promise.resolve();
	// Always chain — even if prev rejected we still want to run fn
	const next = prev.then(fn, fn) as Promise<T>;
	repoLocks.set(repoPath, next);
	try {
		return await next;
	} finally {
		if (repoLocks.get(repoPath) === next) {
			repoLocks.delete(repoPath);
		}
	}
}
