import editIcon from "../assets/Edit_pen-to-square-regular.svg";
import languageIcon from "../assets/Language.svg";
import navGenerateIcon from "../assets/Nav-Generate.svg";
import navHistoryIcon from "../assets/Nav-History.svg";
import saveIcon from "../assets/Save.svg";
import trashIcon from "../assets/Trash.svg";
import uploadIcon from "../assets/Upload.svg";
import wavMp3Icon from "../assets/WAV or MP3.svg";

const ICONS = {
  language: languageIcon,
  upload: uploadIcon,
  save: saveIcon,
  "nav-transcribe": navGenerateIcon,
  "nav-generate": navGenerateIcon,
  "nav-history": navHistoryIcon,
  "wav-mp3": wavMp3Icon,
  trash: trashIcon,
  edit: editIcon,
};

export default function StudioIcon({
  name,
  className = "",
  size = 18,
  alt = "",
  decorative = true,
}) {
  const src = ICONS[name];
  if (!src) return null;

  return (
    <img
      src={src}
      alt={decorative ? "" : alt}
      width={size}
      height={size}
      className={className ? `studio-icon-img ${className}` : "studio-icon-img"}
      aria-hidden={decorative || undefined}
      draggable={false}
    />
  );
}
