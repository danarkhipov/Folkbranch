#!/bin/sh
# Everything before a release, on an invented family in throwaway containers. No paid model is called.
# Run with SOAK=10 for the long run.
set -e
# A hung build must fail, not wait for ever with nothing in the log.
perl -e 'alarm 900; exec @ARGV' docker build -q -t folkbranch:check . >/dev/null
# The install without Docker tries the archive this computer would download.
pnpm build >/dev/null && node scripts/make-bundle.mjs >/dev/null
rc=0
for s in tests/e2e/local-install.mjs tests/e2e/family-file.mjs tests/e2e/case-import.mjs tests/e2e/tell.mjs tests/e2e/npx.mjs tests/e2e/chart.mjs tests/e2e/hand-fixes.mjs tests/e2e/views.mjs tests/e2e/print.mjs tests/e2e/share.mjs tests/e2e/stories.mjs tests/e2e/card.mjs tests/e2e/merge.mjs tests/e2e/onboarding.mjs tests/e2e/english.mjs tests/e2e/english-everywhere.mjs tests/e2e/multiuser.mjs tests/e2e/screens.mjs tests/e2e/render.mjs tests/e2e/page-recovery.mjs tests/stability/crash.mjs tests/stability/failures.mjs tests/stability/restore.mjs; do
  echo "== $s"
  out=$(node "$s" 2>&1) || rc=1
  echo "$out" | grep -E '^(FAIL|PASS within|ИТОГО)|^ok|Error' | grep -vE '^ok' || true
  echo "$out" | grep -qE '^FAIL' && rc=1
done
[ -n "$SOAK" ] && node tests/stability/soak.mjs "$SOAK"
for c in fg-hand fg-cross fg-onb fg-merge fg-card fg-stories fg-share fg-print fg-views fg-chart fg-render fg-cl fg-stab fg-dur fgb fg-typ fg-typ2; do docker rm -fv $c >/dev/null 2>&1 || true; done
exit $rc
