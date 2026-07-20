import logoIconUrl from "../assets/ASR-logo.png";
import logoNameUrl from "../assets/ASR-logo-name.png";

const LOGO_BY_VARIANT = {
  nav: { src: logoIconUrl, alt: "ASR Studio" },
  auth: { src: logoIconUrl, alt: "ASR Studio" },
  login: { src: logoNameUrl, alt: "VerbaVerify" },
};

export default function AsrLogo({ variant = "nav", className = "" }) {
  const { src, alt } = LOGO_BY_VARIANT[variant] ?? LOGO_BY_VARIANT.nav;
  const classes = ["asr-logo-img", `asr-logo-img--${variant}`, className]
    .filter(Boolean)
    .join(" ");
  return <img src={src} alt={alt} className={classes} draggable={false} />;
}
