import handler from '@tanstack/react-start/server-entry';

// Local development only: DIRECTORY_MOCK=true serves the directory's Commission endpoints from
// MSW fixtures until the directory implements them (#13). `import.meta.env.DEV` is `false` in
// production builds, so the bundler drops this branch and the mocks never ship; the NODE_ENV
// check keeps them off even if a dev build were started with production settings.
if (
  import.meta.env.DEV &&
  process.env.NODE_ENV !== 'production' &&
  process.env.DIRECTORY_MOCK === 'true' &&
  process.env.DIRECTORY_API_URL
) {
  const { startDirectoryMocks } = await import('./mocks/node');
  startDirectoryMocks(process.env.DIRECTORY_API_URL);
}

export default handler;
