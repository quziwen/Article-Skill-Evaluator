#!/usr/bin/env bash
# Multi-scanner security gate. SAFE is emitted only when every required scan ran.

set -uo pipefail

INPUT="${1:-}"
if [[ -z "$INPUT" ]]; then
    echo "Usage: bash vett.sh <skill-name | github-url | local-path>"
    exit 2
fi

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P) || exit 2
TEMP_PARENT=$(cd "${TMPDIR:-/tmp}" && pwd -P) || exit 2
TEMP_ROOT=$(mktemp -d "$TEMP_PARENT/article-skill-evaluator-vetter.XXXXXX") || exit 2
cleanup() {
    local resolved
    resolved=$(cd "$TEMP_ROOT" && pwd -P) || return
    if [[ "$(dirname "$resolved")" == "$TEMP_PARENT" && "$(basename "$resolved")" == article-skill-evaluator-vetter.* ]]; then
        rm -rf -- "$resolved"
    else
        echo "INCOMPLETE: refusing cleanup outside the verified temporary directory" >&2
    fi
}
trap cleanup EXIT

SKILL_DIR=""
SKILL_NAME=""
if [[ -d "$INPUT" ]]; then
    SKILL_DIR=$(cd "$INPUT" && pwd -P) || exit 2
    SKILL_NAME=$(basename "$SKILL_DIR")
elif [[ "$INPUT" == https://github.com/* ]]; then
    command -v git >/dev/null 2>&1 || { echo "INCOMPLETE: git is required for GitHub input"; exit 2; }
    SKILL_NAME=$(basename "$INPUT" .git)
    SKILL_DIR="$TEMP_ROOT/$SKILL_NAME"
    git clone --depth 1 -- "$INPUT" "$SKILL_DIR" >/dev/null 2>&1 \
        || { echo "INCOMPLETE: repository could not be cloned"; exit 2; }
else
    command -v clawhub >/dev/null 2>&1 || { echo "INCOMPLETE: clawhub is required for registry input"; exit 2; }
    SKILL_NAME="$INPUT"
    SKILL_DIR="$TEMP_ROOT/$SKILL_NAME"
    clawhub --workdir "$TEMP_ROOT" --dir . install "$SKILL_NAME" --force >/dev/null 2>&1 \
        || { echo "INCOMPLETE: registry package could not be downloaded"; exit 2; }
fi

FAILURES=0
WARNINGS=0
INCOMPLETE=0
REPORT=()

record_failure() { FAILURES=$((FAILURES + 1)); REPORT+=("BLOCKED: $1"); }
record_warning() { WARNINGS=$((WARNINGS + 1)); REPORT+=("REVIEW: $1"); }
record_incomplete() { INCOMPLETE=$((INCOMPLETE + 1)); REPORT+=("INCOMPLETE: $1"); }
record_pass() { REPORT+=("PASS: $1"); }

echo "SKILL VETTER: $SKILL_NAME"
echo "Path: $SKILL_DIR"

echo "[1/4] aguara"
if ! command -v aguara >/dev/null 2>&1; then
    echo "  INCOMPLETE - scanner is not installed"
    record_incomplete "aguara did not run"
elif ! command -v python3 >/dev/null 2>&1; then
    echo "  INCOMPLETE - python3 is needed to validate scanner JSON"
    record_incomplete "aguara output could not be validated"
else
    aguara_json=""
    if ! aguara_json=$(aguara scan "$SKILL_DIR" --format json 2>/dev/null); then
        echo "  INCOMPLETE - scanner returned an error"
        record_incomplete "aguara returned an error"
    else
        if ! aguara_counts=$(printf '%s' "$aguara_json" | python3 "$SCRIPT_DIR/validate-output.py" aguara); then
            echo "  INCOMPLETE - unrecognized JSON"
            record_incomplete "aguara output schema was unrecognized"
        else
            read -r high_count medium_count <<< "$aguara_counts"
            if (( high_count > 0 )); then
                echo "  BLOCKED - $high_count high-severity finding(s)"
                record_failure "aguara found $high_count high-severity item(s)"
            elif (( medium_count > 0 )); then
                echo "  REVIEW - $medium_count medium-severity finding(s)"
                record_warning "aguara found $medium_count medium-severity item(s)"
            else
                echo "  PASS"
                record_pass "aguara ran with no medium/high findings"
            fi
        fi
    fi
fi

echo "[2/4] skill-scanner"
if ! command -v skill-scanner >/dev/null 2>&1; then
    echo "  INCOMPLETE - scanner is not installed"
    record_incomplete "skill-scanner did not run"
elif ! command -v python3 >/dev/null 2>&1; then
    echo "  INCOMPLETE - python3 is needed to validate scanner JSON"
    record_incomplete "skill-scanner output could not be validated"
else
    scanner_json=""
    if ! scanner_json=$(skill-scanner scan "$SKILL_DIR" --format json 2>/dev/null); then
        echo "  INCOMPLETE - scanner returned an error"
        record_incomplete "skill-scanner returned an error"
    else
        if ! scanner_counts=$(printf '%s' "$scanner_json" | python3 "$SCRIPT_DIR/validate-output.py" cisco); then
            echo "  INCOMPLETE - unrecognized or incomplete scanner evidence"
            record_incomplete "skill-scanner evidence was unrecognized or incomplete"
        else
            read -r high_count medium_count <<< "$scanner_counts"
            if (( high_count > 0 )); then
                echo "  BLOCKED - $high_count high-severity finding(s)"
                record_failure "skill-scanner found $high_count high-severity item(s)"
            elif (( medium_count > 0 )); then
                echo "  REVIEW - $medium_count medium-severity finding(s)"
                record_warning "skill-scanner found $medium_count medium-severity item(s)"
            else
                echo "  PASS"
                record_pass "skill-scanner ran with no medium/high findings"
            fi
        fi
    fi
fi

echo "[3/4] local secrets scan"
if grep -rqE --include='*.sh' --include='*.py' --include='*.js' --include='*.cjs' --include='*.mjs' \
    "(api_key|apikey|secret|token|password|credential)[[:space:]]*=[[:space:]]*['\"][A-Za-z0-9_/-]{16,}['\"]" "$SKILL_DIR" 2>/dev/null; then
    echo "  BLOCKED - possible hardcoded credential"
    record_failure "local scan found a possible hardcoded credential"
elif grep -rqE --include='*.sh' --include='*.py' --include='*.js' --include='*.cjs' --include='*.mjs' \
    "['\"][A-Za-z0-9+/]{40,}={0,2}['\"]" "$SKILL_DIR" 2>/dev/null; then
    echo "  REVIEW - long base64-like literal"
    record_warning "local scan found a long base64-like literal"
else
    echo "  PASS"
    record_pass "local secrets scan found no configured pattern"
fi

echo "[4/4] structure check"
structure_issues=0
if [[ ! -f "$SKILL_DIR/SKILL.md" ]]; then
    structure_issues=$((structure_issues + 1))
    REPORT+=("BLOCKED: SKILL.md is missing")
fi
if [[ -f "$SKILL_DIR/SKILL.md" ]] && ! head -n 5 "$SKILL_DIR/SKILL.md" | grep -q '^---$'; then
    structure_issues=$((structure_issues + 1))
    REPORT+=("BLOCKED: SKILL.md frontmatter is missing or malformed")
fi
if grep -rqE --include='*.sh' --include='*.py' --include='*.js' --include='*.cjs' --include='*.mjs' \
    --exclude='vett.sh' '(rm[[:space:]]+-rf|curl[^|]*\|[[:space:]]*(bash|sh)|wget[^|]*\|[[:space:]]*(bash|sh)|eval[[:space:]])' \
    "$SKILL_DIR" 2>/dev/null; then
    structure_issues=$((structure_issues + 1))
    REPORT+=("BLOCKED: dangerous execution pattern requires manual review")
fi
if (( structure_issues > 0 )); then
    echo "  BLOCKED - $structure_issues issue(s)"
    FAILURES=$((FAILURES + structure_issues))
else
    echo "  PASS"
    record_pass "required structure and dangerous-pattern checks passed"
fi

echo
for line in "${REPORT[@]}"; do echo "$line"; done
if (( FAILURES > 0 )); then
    echo "VERDICT: BLOCKED"
    exit 1
fi
if (( INCOMPLETE > 0 )); then
    echo "VERDICT: INCOMPLETE"
    echo "No SAFE claim is allowed because $INCOMPLETE required scan(s) did not complete."
    exit 2
fi
if (( WARNINGS > 0 )); then
    echo "VERDICT: REVIEW"
    exit 2
fi
echo "VERDICT: SAFE"
echo "All required scanners and local checks completed without medium/high findings."
exit 0
