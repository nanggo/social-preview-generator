# Code Style Guide for Social Preview Generator

## Priority Focus Areas

### High Priority Issues
- **Security vulnerabilities** - Authentication, input validation, XSS prevention
- **Performance problems** - Memory leaks, inefficient algorithms, blocking operations  
- **Logic errors** - Incorrect business logic, edge case handling
- **Type safety** - TypeScript errors, unsafe type assertions

### Medium Priority Issues  
- **Error handling** - Missing try-catch blocks, unhandled promises
- **Resource management** - File handle leaks, connection cleanup
- **API contract violations** - Breaking changes, incorrect interfaces

### Low Priority (Avoid commenting on)
- Code formatting and style preferences (handled by Prettier/ESLint)
- Variable naming conventions (unless truly confusing)
- Minor refactoring suggestions that don't impact functionality
- Documentation formatting improvements
- File organization preferences
- Import statement ordering

## Review Guidelines

### When to Comment
- Issues that could cause runtime errors or security vulnerabilities
- Performance bottlenecks in critical paths (image processing, network requests)
- Missing error handling in async operations
- Type safety violations that could cause runtime errors

### When NOT to Comment  
- Cosmetic code style issues already handled by automated tools
- Personal preferences about code organization
- Minor optimizations with negligible impact
- Suggestions for additional features not related to current changes

## Project Context
This is a social media preview image generator focused on:
- Image processing with Sharp
- Web scraping for metadata  
- SVG template rendering
- TypeScript with comprehensive testing

Comments should focus on correctness and reliability rather than style preferences.