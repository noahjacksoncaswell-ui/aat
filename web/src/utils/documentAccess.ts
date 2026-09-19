import { api } from "../api/client";

/**
 * Every document/photo/schematic in the app is served from an authenticated
 * endpoint (ITAR-controlled technical data cannot be served from a plain,
 * unauthenticated URL). A raw <a href> or <img src> pointing at the file
 * endpoint bypasses the API client's bearer-token interceptor entirely, so
 * the backend correctly rejects it with "Missing bearer token" (v3.1 Item 8).
 *
 * Fetch the file through the authenticated API client instead and hand the
 * caller an object URL backed by the resulting Blob. If the backend is
 * running in S3 mode, the content endpoint 302s to a presigned S3 URL - the
 * browser follows that redirect natively (dropping our Authorization header,
 * which the presigned URL doesn't need since it carries its own signature),
 * so this works identically for both the local-disk and S3 storage backends.
 */
export async function fetchDocumentBlobUrl(documentId: string, version: number): Promise<string> {
  const res = await api.get(`/documents/${documentId}/versions/${version}/content`, { responseType: "blob" });
  return URL.createObjectURL(res.data as Blob);
}
