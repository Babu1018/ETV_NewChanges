import ttsLogo from "../assets/TTS.png";
import voxcraftLogo from "../assets/voxcraft.png";

const LOGOS = {
  auth: { src: voxcraftLogo, alt: "VoxCraft AI voice studio" },
  studio: { src: ttsLogo, alt: "TTS" },
};

export default function BrandLogo({ variant = "auth", className = "", alt }) {
  const { src, alt: defaultAlt } = LOGOS[variant] ?? LOGOS.auth;
  return (
    <img
      src={src}
      alt={alt ?? defaultAlt}
      className={["brand-logo", className].filter(Boolean).join(" ")}
      decoding="async"
    />
  );
}
