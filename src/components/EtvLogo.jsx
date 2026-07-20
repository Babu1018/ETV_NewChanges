import etvLogoPurple from "../assets/etv-logo-purple.png";
import etvLogoWhite from "../assets/etv-logo.png";

const LOGOS = {
  purple: etvLogoPurple,
  white: etvLogoWhite,
};

export default function EtvLogo({
  variant = "purple",
  className = "",
  alt = "ETV Validator Studio",
}) {
  const src = LOGOS[variant] ?? LOGOS.purple;

  return (
    <img
      src={src}
      alt={alt}
      className={["etv-logo-img", className].filter(Boolean).join(" ")}
      draggable={false}
      decoding="async"
    />
  );
}
