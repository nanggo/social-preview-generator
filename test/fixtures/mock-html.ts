export const mockHtmlWithOg = `
<!DOCTYPE html>
<html>
<head>
  <title>Test Page Title</title>
  <meta property="og:title" content="Test OG Title" />
  <meta property="og:description" content="Test OG Description" />
  <meta property="og:image" content="https://example.com/image.jpg" />
  <meta property="og:site_name" content="Test Site" />
  <meta name="description" content="Test Meta Description" />
  <link rel="icon" href="/favicon.ico" />
</head>
<body>
  <h1>Test Content</h1>
</body>
</html>
`;

export const mockHtmlMinimal = `
<!DOCTYPE html>
<html>
<head>
  <title>Minimal Page</title>
</head>
<body>
  <h1>Minimal Content</h1>
</body>
</html>
`;

export const mockHtmlWithTwitter = `
<!DOCTYPE html>
<html>
<head>
  <title>Twitter Test</title>
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Twitter Title" />
  <meta name="twitter:description" content="Twitter Description" />
  <meta name="twitter:image" content="https://example.com/twitter-image.jpg" />
  <meta name="twitter:site" content="@testsite" />
</head>
<body>
  <h1>Twitter Content</h1>
</body>
</html>
`;