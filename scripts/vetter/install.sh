#!/usr/bin/env bash
# Historical filename retained for compatibility. This is an advisory only.

set -uo pipefail
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P) || exit 2

echo "This helper does not install packages, use sudo, clone repositories, or create links."
echo "Review and install missing scanner dependencies through your approved package-management process."
echo
bash "$SCRIPT_DIR/check-deps.sh"
