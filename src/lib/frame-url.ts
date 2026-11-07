/** Vervaltijd (ms) uit een ondertekende Frame-URL (`exp=` of `Expires=`). 0 = onbekend. */
export function signedUrlExpiry(url: string | null | undefined): number {
  if (!url) return 0;
  const m = url.match(/[?&](?:exp|Expires)=(\d+)/);
  return m ? Number(m[1]) * 1000 : 0;
}
