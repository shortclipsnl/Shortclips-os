import "server-only";
import mammoth from "mammoth";

/** Haalt platte tekst uit een Word-document (.docx), aangeleverd als base64. */
export async function extractDocxText(base64: string): Promise<string> {
  try {
    const buffer = Buffer.from(base64, "base64");
    const result = await mammoth.extractRawText({ buffer });
    return result.value.trim();
  } catch {
    return "";
  }
}
