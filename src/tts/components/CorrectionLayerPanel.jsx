import { useRef, useState } from "react";
import { Spinner } from "react-bootstrap";
import AudioAddMenu from "../../components/AudioAddMenu.jsx";
import CorrectionLayerPlayer from "./CorrectionLayerPlayer.jsx";
import StudioIcon from "../../components/StudioIcon.jsx";
import { audioMimeType, formatFromMimeType } from "../utils/audioFormat.js";

export default function CorrectionLayerPanel({
  layerIndex = 1,
  fileName,
  blob,
  cloning,
  onClone,
  onDelete,
  onUpload,
  onRecord,
}) {
  const [editMenuOpen, setEditMenuOpen] = useState(false);
  const editWrapRef = useRef(null);
  const mime = blob?.type ? formatFromMimeType(blob.type) : "wav";

  return (
    <section className="correction-layer">
      <header className="correction-layer-head">
        <div className="correction-layer-title-wrap">
          <h3 className="correction-layer-title">CORRECTION LAYER - {layerIndex}</h3>
          <span className="correction-layer-filename" title={fileName}>
            {fileName}
          </span>
        </div>
        <div className="correction-layer-actions">
          <div className="correction-layer-edit-wrap" ref={editWrapRef}>
            <button
              type="button"
              className="studio-icon-btn correction-layer-edit-btn"
              title="Change upload or record"
              aria-expanded={editMenuOpen}
              onClick={() => setEditMenuOpen((v) => !v)}
            >
              <StudioIcon name="edit" size={16} />
            </button>
            <AudioAddMenu
              anchorRef={editWrapRef}
              align="end"
              open={editMenuOpen}
              onClose={() => setEditMenuOpen(false)}
              onUpload={() => {
                setEditMenuOpen(false);
                onUpload?.();
              }}
              onRecord={() => {
                setEditMenuOpen(false);
                onRecord?.();
              }}
            />
          </div>
          <button
            type="button"
            className="correction-layer-clone-btn"
            disabled={cloning}
            onClick={onClone}
          >
            {cloning ? (
              <Spinner animation="border" size="sm" />
            ) : (
              <>
                <StudioIcon name="generate" size={14} />
                Clone
              </>
            )}
          </button>
          <button
            type="button"
            className="studio-icon-btn correction-layer-delete-btn"
            title="Remove correction layer"
            disabled={cloning}
            onClick={onDelete}
          >
            <StudioIcon name="trash" size={16} />
          </button>
        </div>
      </header>
      <CorrectionLayerPlayer blob={blob} mimeType={audioMimeType(mime)} />
    </section>
  );
}
