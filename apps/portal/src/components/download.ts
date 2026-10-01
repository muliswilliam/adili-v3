/**
 * Starts a download from a link that answers with an attachment, such as a presigned URL: the
 * browser saves the file and the page stays. Its own module so tests can replace it.
 */
export function downloadFrom(url: string) {
  window.location.assign(url);
}
