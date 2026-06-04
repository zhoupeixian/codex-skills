---
name: requesting-code-review
description: Use when reviewing SVN revisions to verify changes meet requirements
---

# Requesting Code Review

Dispatch a code reviewer subagent to catch issues before they cascade. The reviewer gets precisely crafted context for evaluation — never your session's history. This keeps the reviewer focused on the work product, not your thought process, and preserves your own context for continued work.

**Core principle:** Review early, review often.

## When to Request Review

**Mandatory:**
- When the user explicitly requests code review
- Before generating the review log

**Optional but valuable:**
- When stuck (fresh perspective)
- When a revision touches several modules
- After fixing complex bug

## How to Request

**1. Prepare SVN review inputs:**

- Revision list with author, time, and message
- Retrieved `svn diff -c <revision>` output
- Requirements or review scope

**2. Dispatch code reviewer subagent:**

Use Task tool with `general-purpose` type, fill template at `code-reviewer.md`

**Placeholders:**
- `{DESCRIPTION}` - Brief summary of what you built
- `{PLAN_OR_REQUIREMENTS}` - What it should do
- `{REVISION_LIST}` - SVN revisions to review
- `{SVN_DIFFS}` - Diff output retrieved with `svn diff -c <revision>`

**3. Act on feedback:**
- Fix Critical issues immediately
- Fix Important issues before proceeding
- Note Minor issues for later
- Push back if reviewer is wrong (with reasoning)

## Example

```
[Just retrieved SVN logs and diffs]

You: Let me request code review before proceeding.

[Dispatch code reviewer subagent]
  DESCRIPTION: Reviewed SVN revisions for the current time window
  PLAN_OR_REQUIREMENTS: User requested ZHERP SVN code review
  REVISION_LIST: r50814, r50819
  SVN_DIFFS: svn diff -c output for each revision

[Subagent returns]:
  Strengths: Clean architecture, real tests
  Issues:
    Important: Missing progress indicators
    Minor: Magic number (100) for reporting interval
  Assessment: Ready to proceed

You: [Fix progress indicators]
[Generate review log]
```

## Integration with Workflows

**SVN Review Workflow:**
- Review after logs and diffs are retrieved
- Catch issues before the review log is finalized
- Apply valid feedback to the final review log

## Red Flags

**Never:**
- Skip review after the user explicitly requested it
- Ignore Critical issues
- Proceed with unfixed Important issues
- Argue with valid technical feedback

**If reviewer wrong:**
- Push back with technical reasoning
- Show code/tests that prove it works
- Request clarification

See template at: requesting-code-review/code-reviewer.md
