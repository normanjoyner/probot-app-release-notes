/** Copyright (c) 2017 Uber Technologies, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

module.exports = function generateChangelog(changes) {
  let lines = ['## Release Notes'];

  if (changes.security.length > 0) {
    lines.push('### Security Updates');
    for (let change of changes.security) {
      lines.push(getChangeItem(change));
    }
  }

  if (changes.features.length > 0) {
    lines.push('### New Features');
    for (let change of changes.features) {
      lines.push(getChangeItem(change));
    }
  }

  if (changes.bugfixes.length > 0) {
    lines.push('### Bug Fixes');
    for (let change of changes.bugfixes) {
      lines.push(getChangeItem(change));
    }
  }

  if (changes.other.length > 0) {
    lines.push('### Other Changes');
    for (let change of changes.other) {
      lines.push(getChangeItem(change));
    }
  }

  if (lines.length === 1) {
    lines.push('No release notes available for this release.');
  }

  return lines.join('\n');
};

function getChangeItem(pr) {
  return `* ${pr.title} ([#${pr.number}](${pr.url}))`;
}
