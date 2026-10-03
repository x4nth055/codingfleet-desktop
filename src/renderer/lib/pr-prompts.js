'use strict';
// What the pull-request buttons ask the agent. Written into the prompt, not
// sent, so the user can read and change it first. No DOM and no state: the
// window loads this before its own scripts, and the tests and the live e2e
// run require it, so they send the very words the buttons write.
(function (root) {
  /**
   * Review a pull request, or look over one's own before others do.
   * @param {{ slug: string }} repo
   * @param {{ number: number, title: string, url: string }} pr
   */
  function reviewPrompt(repo, pr, { own = false } = {}) {
    const slug = repo.slug;
    const lines = [
      own
        ? `Look over my pull request #${pr.number} ("${pr.title}") in ${slug} before others review it: ${pr.url}`
        : `Review pull request #${pr.number} ("${pr.title}") in ${slug}: ${pr.url}`,
      '',
      `Use the GitHub CLI: \`gh pr view ${pr.number} --repo ${slug} --comments\` for the description and the discussion so far, and \`gh pr diff ${pr.number} --repo ${slug}\` for the changes. Read the surrounding code where you need context. Do not check out the branch or change any files.`,
      '',
      'Report what you find, most important first: bugs, security problems, missing tests, and anything unclear. Give the file and line for each.',
      '',
    ];
    if (own) lines.push('Then offer to fix what you found on this branch.');
    else {
      lines.push(`Then ask me whether to post it on GitHub as a review (\`gh pr review ${pr.number} --repo ${slug} --comment\`, \`--approve\` or \`--request-changes\`). Do not post anything until I say so.`);
    }
    return lines.join('\n');
  }

  /**
   * Open a pull request for the work in the folder.
   * @param {{ slug: string, remote: string }} repo  `remote` is where the PR goes: "upstream" in a fork
   * @param {{ base?: string, onBase?: boolean }} where
   */
  function createPrompt(repo, { base = '', onBase = false } = {}) {
    const into = base || 'the default branch';
    const fork = repo.remote === 'upstream';
    const steps = [];
    if (onBase) steps.push(`I am on ${into}: first create a new branch with a short name that says what the change is.`);
    steps.push('If there are uncommitted changes, look at them and commit them with a clear message. Leave out anything that should not be committed (secrets, build output, local settings) and tell me what you left out.');
    steps.push(fork
      ? 'Push the branch to my fork: `git push -u origin HEAD`.'
      : `Push the branch: \`git push -u ${repo.remote} HEAD\`.`);
    steps.push(`Create the pull request with \`gh pr create --repo ${repo.slug} --base ${base || '<default branch>'}${fork ? ' --head <my user>:<branch>' : ''} --title "…" --body "…"\`: a short title, and a body that says what changed, why, and how it was tested.`);
    steps.push('Give me the link.');
    return [`Open a pull request for my work in ${repo.slug}, into ${into}.`, '',
      ...steps.map((step, i) => `${i + 1}. ${step}`)].join('\n');
  }

  const api = { reviewPrompt, createPrompt };
  root.CF_PR_PROMPTS = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
