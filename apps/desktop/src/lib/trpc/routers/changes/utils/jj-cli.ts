import { execWithShellEnv } from "../../workspaces/utils/shell-env";
import { withJjRepoLock } from "./jj-repo-lock";

export async function jj(repoPath: string, args: string[]): Promise<string> {
	return withJjRepoLock(repoPath, async () => {
		const { stdout } = await execWithShellEnv(
			"jj",
			["--no-pager", "--color=never", "-R", repoPath, ...args],
			{ cwd: repoPath },
		);
		return stdout.trim();
	});
}
