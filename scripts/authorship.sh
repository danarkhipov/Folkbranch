#!/bin/sh
# Daniel is the only author of this repository. No commit may name an AI assistant as its author,
# committer or co-author, or carry a "generated with" line. Used by the commit-msg and pre-push
# hooks (.githooks) and by CI, so the same rule stops it at every door.
#   authorship.sh message <file>   a commit message about to be saved
#   authorship.sh range <revs>     the commits in a revision range, such as origin/main..HEAD
PEOPLE='claude|anthropic'
LINES='co-authored-by:.*(claude|anthropic)|noreply@anthropic\.com|generated (with|by) .*claude|claude\.ai/(code|share)'

case "$1" in
  message)
    if grep -Eiq "$LINES" "$2"; then
      echo "authorship: the commit message names an AI assistant as co-author or generator; remove that line." >&2
      exit 1
    fi
    ;;
  range)
    bad=0
    for c in $(git rev-list "$2"); do
      if git log -1 --format='%an <%ae>%n%cn <%ce>' "$c" | grep -Eiq "$PEOPLE" || git log -1 --format=%B "$c" | grep -Eiq "$LINES"; then
        echo "authorship: $(git log -1 --format='%h %s' "$c") names an AI assistant as author, committer or co-author." >&2
        bad=1
      fi
    done
    exit $bad
    ;;
  *)
    echo "usage: authorship.sh message <file> | range <revs>" >&2
    exit 2
    ;;
esac
