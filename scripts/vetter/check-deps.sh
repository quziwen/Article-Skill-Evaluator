#!/usr/bin/env bash
# Read-only dependency check. It never installs or changes system software.

set -uo pipefail

missing_required=()
for dependency in aguara skill-scanner python3; do
    command -v "$dependency" >/dev/null 2>&1 || missing_required+=("$dependency")
done

echo "Required for a SAFE verdict: aguara, skill-scanner, python3"
if (( ${#missing_required[@]} > 0 )); then
    echo "INCOMPLETE: missing ${missing_required[*]}"
    echo "The vetter may still run local checks, but it must not report SAFE."
    exit 1
fi

echo "PASS: all required scanner dependencies are present"
echo "Optional by input type: git for GitHub URLs; clawhub for registry names"
exit 0
