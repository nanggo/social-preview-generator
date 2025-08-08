# Social Preview Generator - Development Guidelines

## Development Workflow: Plan-Code-Test Cycle

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
- On test success: proceed to commit and push

### 4. Completion
- Commit and push changes after successful testing
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