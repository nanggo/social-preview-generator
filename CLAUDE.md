# Social Preview Generator - Development Guidelines

## Development Workflow: Plan-Code-Test-Security-Commit Cycle

### 1. Plan Phase
- Define optimal solution strategy for the problem at hand
- When troubleshooting, deeply analyze:
  - Why the problem occurred
  - Root cause identification  
  - Solution approach and alternatives

### 2. Code Phase  
- Write high-performance, maintainable code
- Focus on bug-free, robust implementation
- Avoid over-engineering - keep solutions simple and effective
- Minimize unnecessary comments
- Strictly follow the established plan - no deviation without replanning

### 3. Test Phase
- Reference package.json for available test commands
- Ensure all checks pass:
  - Formatting (prettier)
  - Linting (eslint)
  - TypeScript compilation
  - Build process
  - Unit/Integration tests
- If tests fail: return to Plan phase and iterate until success
- On test success: proceed to security review phase

### 4. Security Review Phase
- **MANDATORY**: Always run `/security-review` before any commit
- Address any security vulnerabilities identified in the review
- Only proceed to commit after security review passes

### 5. Completion
- Commit and push changes after successful testing and security review
- For PR review tasks: comment '/gemini review'

## Project Organization

### Branch Management
- Create new branch for each task/feature
- Follow naming convention: `feature/task-name` or `fix/issue-name`
- Work on isolated branches, merge via PR

### Progress Tracking
- Maintain planning and progress files (not committed)
- Document decisions and implementation notes
- Track task completion status

### Code Quality Standards
- Prioritize maintainability and performance
- Write self-documenting code
- Add comments only when business logic requires explanation
- Follow existing project patterns and conventions

## Testing Requirements
- All code changes must pass the complete test suite
- Include unit tests for new functionality
- Verify integration points work correctly
- Performance testing for image generation features

## Commit Guidelines
- Make atomic, focused commits
- Write clear commit messages describing the change
- Only commit after all tests pass
- Push to feature branches, create PRs for review

## GitHub PR Review Queries

### Query Latest Review Comments
Use this GitHub CLI command to fetch all comments from the most recent PR review:

```bash
# Get the latest review ID and its comments (replace PR_NUMBER)
gh api /repos/nanggo/social-preview-generator/pulls/PR_NUMBER/reviews | jq '.[0].id' | xargs -I {} gh api /repos/nanggo/social-preview-generator/pulls/reviews/{}/comments

# Alternative: Get specific review comments (replace REVIEW_ID)
gh api /repos/nanggo/social-preview-generator/pulls/reviews/REVIEW_ID/comments
```

### GraphQL Query for PR Reviews
For more detailed review information including discussion threads:

```bash
gh api graphql -f query='
{
  repository(owner: "nanggo", name: "social-preview-generator") {
    pullRequest(number: PR_NUMBER) {
      reviews(last: 1) {
        nodes {
          id
          body
          state
          author { login }
          createdAt
          comments(first: 50) {
            nodes {
              id
              body
              path
              line
              diffHunk
              author { login }
              createdAt
            }
          }
        }
      }
    }
  }
}'
```

### Usage Examples
- Replace `PR_NUMBER` with actual PR number (e.g., 6)
- Replace `REVIEW_ID` with actual review ID (e.g., 3114484133)
- Use when addressing code review feedback or analyzing discussion threads