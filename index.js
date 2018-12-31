/** Copyright (c) 2017 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// NOTE: prevailing assumption is a release's target_commitish is always a SHA.

const getConfig = require('probot-config');

const generateChangelog = require('./generate-changelog');

module.exports = robot => {
  robot.on('release', handler);

  async function handler(context) {
    const release = context.payload.release;

    const releasesBySha = await fetchAllReleases(context);

    const {commits} = await getChangeInfo(
      context,
      release.target_commitish,
      releasesBySha,
      [release.target_commitish],
    );

    const body = await notesForCommits(context, commits);

    updateRelease(context, release, body);
  }
};

async function updateRelease(context, release, body) {
  const {github} = context;
  github.repos.updateRelease(
    context.repo({
      release_id: release.id,
      tag_name: release.tag_name,
      body,
    }),
  );
}

async function fetchAllReleases(context, handler = () => {}) {
  const {github} = context;

  const releasesBySha = new Map();

  const req = github.repos.getReleases(
    context.repo({
      per_page: 100,
    }),
  );
  await fetchPages(github, req, results => {
    results.data.forEach(release => {
      releasesBySha.set(release.target_commitish, release);
      handler(release);
    });
  });
  return releasesBySha;
}

async function getChangeInfo(
  context,
  commitShaInReleaseOrChildReleaseCommitSha,
  releaseCommits,
  pertinentReleaseCommits,
) {
  const loadedCommits = new Map();

  for (const sha of pertinentReleaseCommits) {
    if (loadedCommits.has(sha)) {
      // skip this commit if visited already
      continue;
    }

    const done = await fetchRelevantCommits(
      context,
      loadedCommits,
      sha,
      releaseCommits,
      commitShaInReleaseOrChildReleaseCommitSha,
    );

    if (done) {
      return {
        commits: buildCommits(
          loadedCommits,
          done.releaseSha,
          done.parentReleaseSha,
        ),
        release: releaseCommits.get(done.releaseSha),
      };
    }
  }
}

async function notesForCommits(context, commits) {
  const {github} = context;

  const prs = [];
  const req = await github.pullRequests.list(
    context.repo({
      per_page: 100,
      state: 'closed',
    }),
  );

  await fetchPages(github, req, async results => {
    results.data.forEach(async pr => {
      if (commits.includes(pr.merge_commit_sha)) {
        prs.push({
          labels: pr.labels,
          title: pr.title,
          number: pr.number,
          url: pr.html_url,
        });
      }
    });
  });

  const config = await getConfig(context, 'release.yml', {}, {});

  if (!config.changelog) {
    config.changelog = {};
  }

  if (!config.changelog.sections) {
    config.changelog.sections = {};
  }

  if (!config.changelog.sections.security) {
    config.changelog.sections.security = 'security';
  }

  if (!config.changelog.sections.features) {
    config.changelog.sections.features = 'features';
  }

  if (!config.changelog.sections.bugfixes) {
    config.changelog.sections.bugfixes = 'bugfixes';
  }

  if (!config.changelog.ignoredLabels) {
    config.changelog.ignoredLabels = ['release'];
  }

  let changes = {
    security: [],
    features: [],
    bugfixes: [],
    other: [],
  };

  for (let pr of prs) {
    if (
      pr.labels.some(label =>
        config.changelog.ignoredLabels.includes(label.name),
      )
    ) {
      continue;
    } else if (
      pr.labels.some(label => config.changelog.sections.security === label.name)
    ) {
      changes.security.push(pr);
    } else if (
      pr.labels.some(label => config.changelog.sections.features === label.name)
    ) {
      changes.features.push(pr);
    } else if (
      pr.labels.some(label => config.changelog.sections.bugfixes === label.name)
    ) {
      changes.bugfixes.push(pr);
    } else {
      changes.other.push(pr);
    }
  }

  return generateChangelog(changes);
}

function buildCommits(commitsBySha, releaseSha, prevReleaseSha) {
  const commits = [];
  let nextSha = releaseSha;
  while (nextSha !== prevReleaseSha) {
    const commit = commitsBySha.get(nextSha);
    commits.push(commit.sha);
    if (commit.parents.length > 1) {
      throw new Error(`commit has ${commit.sha} multiple parents`);
    }
    nextSha = commit.parents.length === 0 ? void 0 : commit.parents[0].sha;
  }
  return commits;
}

async function fetchRelevantCommits(
  context,
  commitCache,
  sha,
  releaseCommits,
  commitShaInReleaseOrChildReleaseCommitSha,
) {
  if (commitCache.has(sha)) {
    return; // return early
  }

  const {github} = context;

  let nearestDescendantReleaseSha = sha;

  let req = github.repos.getCommits(
    context.repo({
      sha,
      per_page: 100,
    }),
  );

  let releaseSha;
  let parentReleaseSha;

  // todo: verify no two releases target same commit hash

  await fetchPages(github, req, commits => {
    for (let commit of commits.data) {
      if (commitCache.has(commit.sha)) {
        // break out of loop if we've already encountered this commit.
        // hence as we have already visited all parents
        return true;
      }
      commitCache.set(commit.sha, commit);
      if (commit.sha === commitShaInReleaseOrChildReleaseCommitSha) {
        releaseSha = nearestDescendantReleaseSha;
      } else {
        if (releaseCommits.has(commit.sha)) {
          nearestDescendantReleaseSha = commit.sha;
          if (releaseSha) {
            if (commit.sha !== releaseSha) {
              // set parent release
              parentReleaseSha = commit.sha;
            }
            // exit now
            return true;
          }
        }
      }
    }
  });

  if (!releaseSha) {
    throw new Error('Unexpected state');
  }

  return {
    releaseSha,
    parentReleaseSha,
  };
}

async function fetchPages(github, pageReq, pageHandler) {
  while (pageReq) {
    const page = await pageReq;
    const stopEarly = await pageHandler(page);
    pageReq =
      !stopEarly && github.hasNextPage(page)
        ? github.getNextPage(page)
        : void 0;
  }
}
