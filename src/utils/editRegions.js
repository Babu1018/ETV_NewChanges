import { formatTimePrecise } from "../tts/utils/waveform.js";

/** Human-readable label matching the TTS waveform UI. */
export function formatEditRegionLabel(
  startSec,
  endSec,
  status = "selected",
  hasCorrectionAudio = false
) {
  const spanSec = endSec - startSec;
  const range = `${formatTimePrecise(startSec)} – ${formatTimePrecise(endSec)}`;
  if (status === "replaced") {
    return `${range} (replaced)`;
  }
  if (status === "deleted") {
    return `${range} (deleted)`;
  }
  if (hasCorrectionAudio) {
    return `${range} (record or upload)`;
  }
  return `${range} (${formatTimePrecise(spanSec)} selected)`;
}

export function buildEditRegionEntry(startSec, endSec, status = "selected") {
  return {
    startSec,
    endSec,
    spanSec: endSec - startSec,
    status,
    label: formatEditRegionLabel(startSec, endSec, status),
  };
}

/** Keep one pending selection; preserve completed replacements. */
export function mergeEditRegionEntry(existing, entry) {
  const list = Array.isArray(existing) ? [...existing] : [];
  if (entry.status === "selected") {
    const completed = list.filter((item) => item.status !== "selected");
    return [...completed, entry];
  }
  return [...list.filter((item) => item.status !== "selected"), entry];
}

export function attachCorrectionAudio(existing, startSec, endSec, meta) {
  const list = Array.isArray(existing) ? [...existing] : [];
  let matched = false;
  const updated = list.map((item) => {
    if (item.startSec === startSec && item.endSec === endSec) {
      matched = true;
      const status = item.status || "selected";
      return {
        ...item,
        ...meta,
        label: formatEditRegionLabel(startSec, endSec, status, true),
      };
    }
    return item;
  });
  if (!matched) {
    updated.push({
      startSec,
      endSec,
      spanSec: endSec - startSec,
      status: "selected",
      label: formatEditRegionLabel(startSec, endSec, "selected", true),
      ...meta,
    });
  }
  return updated;
}

export function editRegionsDisplayText(regions) {
  if (!Array.isArray(regions) || regions.length === 0) return "";
  return regions.map((item) => item.label || "").filter(Boolean).join("\n");
}
