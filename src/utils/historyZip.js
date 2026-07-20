import JSZip from "jszip";

function safeZipBaseName(name, id) {
  const base =
    String(name || "transcript")
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
      .slice(0, 80) || "transcript";
  return `${base}_${id}`;
}

/** Zip of selected history rows — transcript .txt files only (same as row download). */
export async function downloadHistoryZip(_apiBaseUrl, _apiKey, items) {
  if (!items?.length) return;
  const zip = new JSZip();
  const folderName = `asr_history_${new Date().toISOString().slice(0, 10)}`;
  const folder = zip.folder(folderName) ?? zip;

  for (const item of items) {
    const base = safeZipBaseName(item.fileName, item.id);
    const text = String(item.transcriptText ?? item.textPreview ?? "");
    folder.file(`${base}.txt`, text);
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${folderName}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}
