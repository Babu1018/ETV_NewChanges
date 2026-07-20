/** In-memory cache so the same Blob is never decoded twice (e.g. React effect re-runs). */
const peakCache = new WeakMap();

function readFourCC(view, offset) {
  if (offset + 4 > view.byteLength) return "";
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  );
}

/**
 * Fast path for 16-bit PCM WAV. Avoids decodeAudioData on the main thread.
 */
function peaksFromWavPcm(arrayBuffer, barCount) {
  const view = new DataView(arrayBuffer);
  if (view.byteLength < 44 || readFourCC(view, 0) !== "RIFF" || readFourCC(view, 8) !== "WAVE") {
    return null;
  }

  let offset = 12;
  let fmtOffset = -1;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= view.byteLength) {
    const id = readFourCC(view, offset);
    const size = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    if (id === "fmt ") fmtOffset = chunkStart;
    if (id === "data") {
      dataOffset = chunkStart;
      dataSize = size;
      break;
    }
    offset = chunkStart + size + (size % 2);
  }

  if (fmtOffset < 0 || dataOffset < 0 || dataSize < 2) return null;

  const audioFormat = view.getUint16(fmtOffset, true);
  const numChannels = view.getUint16(fmtOffset + 2, true);
  const sampleRate = view.getUint32(fmtOffset + 4, true);
  const bitsPerSample = view.getUint16(fmtOffset + 14, true);

  if (audioFormat !== 1 || bitsPerSample !== 16 || numChannels < 1 || !sampleRate) {
    return null;
  }

  const bytesPerFrame = numChannels * 2;
  const totalFrames = Math.floor(dataSize / bytesPerFrame);
  if (totalFrames < 1) return null;

  const blockFrames = Math.max(1, Math.floor(totalFrames / barCount));
  const peaks = new Array(barCount);
  let maxPeak = 0.001;

  for (let i = 0; i < barCount; i += 1) {
    const frameStart = i * blockFrames;
    const frameEnd = Math.min(totalFrames, frameStart + blockFrames);
    const frameSpan = frameEnd - frameStart;
    const stride = Math.max(1, Math.floor(frameSpan / 96));
    let max = 0;

    for (let f = frameStart; f < frameEnd; f += stride) {
      const base = dataOffset + f * bytesPerFrame;
      for (let ch = 0; ch < numChannels; ch += 1) {
        const off = base + ch * 2;
        if (off + 1 >= view.byteLength) continue;
        const v = Math.abs(view.getInt16(off, true) / 32768);
        if (v > max) max = v;
      }
    }

    peaks[i] = max;
    if (max > maxPeak) maxPeak = max;
  }

  return {
    peaks: peaks.map((p) => p / maxPeak),
    duration: totalFrames / sampleRate,
  };
}

async function peaksFromDecode(blob, barCount, arrayBuffer) {
  const audioContext = new AudioContext();
  try {
    const buffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const channel = buffer.getChannelData(0);
    const len = channel.length;
    const blockSize = Math.max(1, Math.floor(len / barCount));
    const peaks = new Array(barCount);
    let maxPeak = 0.001;

    for (let i = 0; i < barCount; i += 1) {
      const start = i * blockSize;
      const end = Math.min(len, start + blockSize);
      const span = end - start;
      const stride = Math.max(1, Math.floor(span / 96));
      let max = 0;
      for (let j = start; j < end; j += stride) {
        const v = Math.abs(channel[j]);
        if (v > max) max = v;
      }
      peaks[i] = max;
      if (max > maxPeak) maxPeak = max;
    }

    return {
      peaks: peaks.map((p) => p / maxPeak),
      duration: buffer.duration,
    };
  } finally {
    await audioContext.close();
  }
}

/**
 * Build normalized peak bars for canvas waveform. Prefers fast WAV PCM parse; caches per Blob.
 */
export async function buildWaveformPeaks(blob, barCount = 160) {
  if (!blob) return { peaks: [], duration: 0 };

  const cached = peakCache.get(blob);
  if (cached) return cached;

  const task = (async () => {
    const arrayBuffer = await blob.arrayBuffer();
    const view = new DataView(arrayBuffer);
    const hasWavHeader =
      view.byteLength >= 12 && readFourCC(view, 0) === "RIFF" && readFourCC(view, 8) === "WAVE";
    const isWav =
      hasWavHeader ||
      blob.type?.includes("wav") ||
      (blob instanceof File && /\.wav$/i.test(blob.name));

    if (isWav) {
      const wav = peaksFromWavPcm(arrayBuffer, barCount);
      if (wav) return wav;
    }

    return peaksFromDecode(blob, barCount, arrayBuffer);
  })();

  peakCache.set(blob, task);
  try {
    return await task;
  } catch (e) {
    peakCache.delete(blob);
    throw e;
  }
}

export function formatTimeShort(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Sub-second precision for edit selections (e.g. 0:32.45). */
export function formatTimePrecise(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00.00";
  const m = Math.floor(seconds / 60);
  const frac = (seconds % 60).toFixed(2);
  const [whole, dec] = frac.split(".");
  return `${m}:${whole.padStart(2, "0")}.${dec}`;
}

/** Parse m:ss.xx (also accepts m:ss:xx). Returns NaN if invalid. */
export function parseTimePrecise(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return NaN;

  const colonMatch = raw.match(/^(\d+)\s*:\s*(\d{1,2})(?:\s*[.:]\s*(\d{1,2}))?$/);
  if (colonMatch) {
    const minutes = Number(colonMatch[1]);
    const seconds = Number(colonMatch[2]);
    const fracDigits = colonMatch[3] ?? "";
    const frac =
      fracDigits.length === 1
        ? Number(fracDigits) / 10
        : fracDigits.length >= 2
          ? Number(fracDigits.slice(0, 2)) / 100
          : 0;
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return NaN;
    return minutes * 60 + seconds + frac;
  }

  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

export function minSelectionSpanSec(durationSec) {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0.35;
  return Math.max(0.0015, Math.min(0.06, 0.35 / durationSec)) * durationSec;
}

/** Clamp and enforce minimum span for editor / waveform selection. */
export function clampSelectionRange(startSec, endSec, durationSec) {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return { startSec: 0, endSec: 0 };
  }
  const minSpan = minSelectionSpanSec(durationSec);
  let start = Math.max(0, Math.min(Number(startSec) || 0, durationSec));
  let end = Math.max(0, Math.min(Number(endSec) || 0, durationSec));

  if (end <= start) {
    end = Math.min(durationSec, start + minSpan);
  }
  if (end - start < minSpan) {
    if (start + minSpan <= durationSec) {
      end = start + minSpan;
    } else {
      start = Math.max(0, end - minSpan);
    }
  }

  start = Math.round(start * 100) / 100;
  end = Math.round(end * 100) / 100;
  return { startSec: start, endSec: end };
}

/** Pixel distance within which a time snaps to the nearest timeline tick (WaveSurfer-style). */
export const STUDIO_SNAP_MARK_PX = 12;

export function snapThresholdSec(metrics, durationSec, snapPx = STUDIO_SNAP_MARK_PX) {
  if (!metrics?.trackWidth || !Number.isFinite(durationSec) || durationSec <= 0) {
    return 0.04;
  }
  return (snapPx / metrics.trackWidth) * durationSec;
}

function nearestTimelineMark(seconds, marks) {
  if (!marks?.length || !Number.isFinite(seconds)) return null;
  let best = null;
  let bestDist = Infinity;
  for (const m of marks) {
    const d = Math.abs(m - seconds);
    if (d < bestDist) {
      bestDist = d;
      best = m;
    }
  }
  return best;
}

/**
 * Snap to the nearest visible timeline mark when the pointer is close (on release).
 * Otherwise keep centisecond precision so edits between ticks stay accurate.
 */
export function snapStudioTime(seconds, durationSec, options = {}) {
  if (!Number.isFinite(seconds) || !Number.isFinite(durationSec) || durationSec <= 0) {
    return 0;
  }
  const { marks = null, metrics = null, snapPx = STUDIO_SNAP_MARK_PX } = options;

  let t = Math.max(0, Math.min(durationSec, seconds));
  const mark = marks?.length ? nearestTimelineMark(t, marks) : null;
  const threshold = snapThresholdSec(metrics, durationSec, snapPx);

  if (mark != null && Math.abs(t - mark) <= threshold) {
    t = mark;
  }

  return Math.round(t * 100) / 100;
}

export function snapStudioSelectionRange(startSec, endSec, durationSec, options = {}) {
  const start = snapStudioTime(startSec, durationSec, options);
  const end = snapStudioTime(endSec, durationSec, options);
  return clampSelectionRange(start, end, durationSec);
}

export function formatTimelineLabel(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0";
  const snapped = Math.round(sec * 100) / 100;
  if (snapped < 60) {
    if (snapped === 0) return "0";
    const whole = Math.floor(snapped + 0.0001);
    const frac = Math.round((snapped - whole) * 100);
    if (frac === 0) return `0:${String(whole).padStart(2, "0")}`;
    return `0:${String(whole).padStart(2, "0")}.${String(frac).padStart(2, "0").slice(0, 2)}`;
  }
  const m = Math.floor(snapped / 60);
  const s = Math.round((snapped - m * 60) * 100) / 100;
  const whole = Math.floor(s + 0.0001);
  const frac = Math.round((s - whole) * 100);
  if (frac === 0) return `${m}:${String(whole).padStart(2, "0")}`;
  return `${m}:${String(whole).padStart(2, "0")}.${String(frac).padStart(2, "0").slice(0, 2)}`;
}

/** Fallback insets when CSS variables are unavailable (must match `--studio-track-pad-*`). */
export const STUDIO_TRACK_INSET_X = 8;
export const STUDIO_TRACK_INSET_RIGHT_X = 52;

const TRACK_PAD_LEFT = "var(--studio-track-pad-left, 8px)";
const TRACK_PAD_RIGHT = "var(--studio-track-pad-right, 3.25rem)";

export function clampTrackProgress(progress) {
  return Math.min(1, Math.max(0, Number(progress) || 0));
}

/** Read padding + drawable width from a track container (waveform wrap or timeline etched). */
export function readStudioTrackMetrics(element) {
  if (!element) {
    return { layoutWidth: 0, padLeft: 0, padRight: 0, trackWidth: 0 };
  }
  const styles = getComputedStyle(element);
  const padLeft = parseFloat(styles.paddingLeft) || 0;
  const padRight = parseFloat(styles.paddingRight) || 0;
  const layoutWidth = element.clientWidth;
  const trackWidth = Math.max(0, layoutWidth - padLeft - padRight);
  return { layoutWidth, padLeft, padRight, trackWidth };
}

/** Pixel X from the container's border-box left edge (for absolute overlays). */
export function trackXFromLayout(progress, metrics) {
  const p = clampTrackProgress(progress);
  return metrics.padLeft + p * metrics.trackWidth;
}

/** X within the canvas/content box (padding already applied by layout). */
export function trackXOnCanvas(progress, metrics) {
  return clampTrackProgress(progress) * metrics.trackWidth;
}

/** CSS `left` for playhead / marks / handles inside a padded track container. */
export function trackPositionCssLeft(progress) {
  const p = clampTrackProgress(progress);
  return `calc(${TRACK_PAD_LEFT} + (100% - ${TRACK_PAD_LEFT} - ${TRACK_PAD_RIGHT}) * ${p})`;
}

/** CSS `width` for selection bands on timeline + waveform. */
export function trackSelectionCssWidth(startRatio, endRatio) {
  const span = Math.max(0, clampTrackProgress(endRatio) - clampTrackProgress(startRatio));
  return `calc((100% - ${TRACK_PAD_LEFT} - ${TRACK_PAD_RIGHT}) * ${span})`;
}

/** Pixel X for overlays — must match `readStudioTrackMetrics` + canvas mapping. */
export function trackOverlayPx(metrics, ratio) {
  if (!metrics?.trackWidth) return 0;
  return metrics.padLeft + clampTrackProgress(ratio) * metrics.trackWidth;
}

export function trackSelectionPx(metrics, startRatio, endRatio) {
  if (!metrics?.trackWidth) return { left: 0, width: 0 };
  const sr = clampTrackProgress(startRatio);
  const er = clampTrackProgress(endRatio);
  return {
    left: metrics.padLeft + sr * metrics.trackWidth,
    width: Math.max(0, (er - sr) * metrics.trackWidth),
  };
}

/** Inline styles for playhead / marks (pixel-accurate studio overlays). */
export function trackOverlayStyle(metrics, ratio) {
  if (metrics?.trackWidth > 0) {
    return { left: `${trackOverlayPx(metrics, ratio)}px` };
  }
  return { left: trackPositionCssLeft(ratio) };
}

export function trackSelectionStyle(metrics, startRatio, endRatio) {
  if (metrics?.trackWidth > 0) {
    const { left, width } = trackSelectionPx(metrics, startRatio, endRatio);
    return { left: `${left}px`, width: `${width}px` };
  }
  return {
    left: trackPositionCssLeft(startRatio),
    width: trackSelectionCssWidth(startRatio, endRatio),
  };
}

/** One duration for ruler, selection, and playback UI. */
export function resolveAudioDuration(peaksDuration, audioDuration) {
  const peaks = Number(peaksDuration);
  const audio = Number(audioDuration);
  if (Number.isFinite(audio) && audio > 0) return audio;
  if (Number.isFinite(peaks) && peaks > 0) return peaks;
  return 0;
}

export function clientXToTrackRatio(clientX, element) {
  const metrics = readStudioTrackMetrics(element);
  const rect = element?.getBoundingClientRect();
  if (!rect?.width || metrics.trackWidth <= 0) return 0;
  const x = clientX - rect.left - metrics.padLeft;
  return clampTrackProgress(x / metrics.trackWidth);
}

/** Studio main editor zoom steps (horizontal). */
export const STUDIO_ZOOM_STEPS = [1, 1.5, 2, 3, 4, 6, 8];

export function getStudioTrackInner(scrollEl) {
  return scrollEl?.querySelector?.(".studio-track-inner") ?? null;
}

/** Map pointer X to 0–1 time ratio when the track is zoomed + horizontally scrolled. */
export function getStudioWaveformWrap(scrollEl) {
  const inner = getStudioTrackInner(scrollEl);
  return inner?.querySelector?.(".audio-waveform-wrap") ?? null;
}

export function getStudioTimelineEtched(scrollEl) {
  const inner = getStudioTrackInner(scrollEl);
  return inner?.querySelector?.(".studio-timeline-etched") ?? null;
}

export function clientXToZoomedTrackRatio(clientX, scrollEl) {
  const wrap = getStudioWaveformWrap(scrollEl);
  if (!wrap) return 0;
  return clientXToTrackRatio(clientX, wrap);
}

export function maxStudioTrackScroll(scrollEl) {
  const inner = getStudioTrackInner(scrollEl);
  if (!inner || !scrollEl) return 0;
  return Math.max(0, inner.offsetWidth - scrollEl.clientWidth);
}

/** Scroll so `ratio` (0–1) is centered in the viewport when zoomed. */
export function centerScrollOnRatio(scrollEl, ratio) {
  const wrap = getStudioWaveformWrap(scrollEl);
  const metrics = readStudioTrackMetrics(wrap || scrollEl);
  if (!scrollEl || metrics.trackWidth <= 0) return;

  const p = clampTrackProgress(ratio);
  const target = metrics.padLeft + p * metrics.trackWidth - scrollEl.clientWidth / 2;
  const maxScroll = maxStudioTrackScroll(scrollEl);
  scrollEl.scrollLeft = Math.min(maxScroll, Math.max(0, target));
}

export function buildTimelineMarks(durationSec, maxMarks = 12) {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return [0];
  const end = Math.round(durationSec * 100) / 100;
  const count = Math.min(maxMarks, Math.max(5, Math.round(durationSec / 7) + 1));

  if (count <= 1) return [0, end];

  // Short clips: integer-second ticks so labels (0:04) match positions (4.00s).
  if (durationSec <= 120) {
    const roughStep = durationSec / (count - 1);
    const stepSec = Math.max(1, Math.round(roughStep));
    const marks = [];
    for (let s = 0; s < end; s += stepSec) {
      marks.push(Math.round(s * 100) / 100);
    }
    if (!marks.length || marks[marks.length - 1] !== end) marks.push(end);
    return marks;
  }

  const step = durationSec / (count - 1);
  return Array.from({ length: count }, (_, i) =>
    i === count - 1 ? end : Math.round(i * step * 100) / 100
  );
}
